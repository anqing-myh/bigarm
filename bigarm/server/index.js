import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { MOVES, EQUIPMENT, RESOURCE_NAMES, RULE_VERSION, createPlayer, createMatch, validateAction, beginRound, resumeRound } from '../rules/engine.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const fail = message => { throw new Error(message); };
const clean = (value, max = 20) => (typeof value === 'string' ? value : '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const active = room => room.members.filter(m => !m.left);
const playing = room => ['selecting', 'choice', 'reveal'].includes(room.phase);
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function bodyOf(req) {
  const buffers = []; let size = 0;
  for await (const part of req) { size += part.length; if (size > 16384) fail('请求过大。'); buffers.push(part); }
  try { return JSON.parse(Buffer.concat(buffers).toString() || '{}'); } catch { fail('无效 JSON。'); }
}

// The room adapter owns identities and clocks. All rule decisions go through rules/engine.js.
export function createServer(options = {}) {
  const selectionMs = options.selectionMs ?? Number(process.env.SELECTION_MS || 30000);
  const choiceMs = options.choiceMs ?? Number(process.env.CHOICE_MS || 45000);
  const disconnectMs = options.disconnectMs ?? Number(process.env.DISCONNECT_MS || 60000);
  const sessions = new Map(), rooms = new Map(); let revision = 0;
  function timer(room, ms, callback) {
    clearTimeout(room.timer); room.deadline = Date.now() + ms;
    room.timer = setTimeout(() => { if (rooms.has(room.id)) { callback(); broadcast(); } }, ms);
    room.timer.unref?.();
  }
  function roomView(room, self) {
    const visible = room.phase !== 'selecting' && room.phase !== 'waiting';
    const gameState = room.phase === 'choice' ? room.job.state : room.match;
    const players = room.members.map(member => ({ ...(gameState?.players.find(p => p.id === member.id) || createPlayer(member.id, member.name, member.seat)), ...member }));
    return {
      id: room.id, name: room.name, hostId: room.hostId, capacity: room.capacity, phase: room.phase, round: ['reveal', 'finished'].includes(room.phase) ? room.result?.round : room.match?.round || 0,
      players, submitted: Object.keys(room.actions), ownAction: room.actions[self.id] || null, actions: visible ? room.actions : null,
      pending: room.phase === 'choice' ? room.job.pending : null, deadline: room.deadline, history: room.history,
      lastMatch: room.lastMatch, gameNumber: room.gameNumber, leaderboard: Object.values(room.scores).sort((a, b) => b.wins - a.wins),
      result: room.result,
    };
  }
  const lobby = () => [...rooms.values()].map(r => ({ id: r.id, name: r.name, capacity: r.capacity, count: active(r).length, phase: r.phase }));
  function snapshot(session) {
    const room = rooms.get(session.roomId);
    return { self: { id: session.id, name: session.name }, room: room ? roomView(room, session) : null, rooms: lobby(), serverTime: Date.now(), revision };
  }
  function broadcast() {
    revision++;
    for (const session of sessions.values()) for (const stream of session.streams) {
      if (!stream.destroyed) stream.write(`event: state\ndata: ${JSON.stringify(snapshot(session))}\n\n`);
    }
  }
  function actors(room) { return room.match.players.filter(p => p.hp > 0 && !room.members.find(m => m.id === p.id)?.left); }
  function scoreMember(room, member) { room.scores[member.id] ||= { id: member.id, name: member.name, wins: 0, games: 0 }; }
  function lockResult(room, winnerId) {
    if (room.lastMatch?.gameNumber === room.gameNumber) return;
    room.lastMatch = { gameNumber: room.gameNumber, winnerId, winnerName: room.members.find(m => m.id === winnerId)?.name || null };
    for (const m of room.members) { scoreMember(room, m); room.scores[m.id].games++; if (m.id === winnerId) room.scores[m.id].wins++; }
  }
  function nextRound(room) {
    room.phase = 'selecting'; room.actions = {}; room.job = null; room.result = null;
    timer(room, selectionMs, () => {
      for (const p of room.match.players.filter(p => p.hp > 0)) room.actions[p.id] ||= { move: 'basicB', automatic: true };
      settle(room);
    });
  }
  function maybeStart(room) {
    const members = active(room);
    if (members.length < 2 || !members.every(m => m.ready && m.connected)) return;
    room.members = members.sort((a, b) => a.seat - b.seat);
    room.match = createMatch(members.map(m => createPlayer(m.id, m.name, m.seat)));
    room.gameNumber++; room.lastMatch = null;
    for (const m of members) m.ready = false;
    nextRound(room);
  }
  function defaultAnswer(pending) { return pending.kind === 'blessing' ? {} : pending.options[0].id; }
  function settle(room) {
    clearTimeout(room.timer);
    for (const p of room.match.players.filter(p => p.hp > 0)) room.actions[p.id] ||= { move: 'basicB', automatic: true };
    room.job = beginRound(room.match, room.actions);
    progress(room);
  }
  function progress(room) {
    while (room.job.status === 'choice') {
      const choice = room.job.pending;
      const member = room.members.find(m => m.id === choice.playerId);
      if (member?.left || actors(room).length <= 1) {
        room.job = resumeRound(room.job, choice.playerId, choice.id, defaultAnswer(choice)); continue;
      }
      room.phase = 'choice';
      timer(room, choiceMs, () => { const c = room.job.pending; room.job = resumeRound(room.job, c.playerId, c.id, defaultAnswer(c)); progress(room); });
      return;
    }
    room.match = room.job.state;
    // Network forfeits are applied at a round boundary, never inside the pure resolver.
    for (const m of room.members.filter(m => m.left)) { const p = room.match.players.find(p => p.id === m.id); if (p) p.hp = 0; }
    room.match.ongoing = room.match.ongoing.filter(e => room.match.players.some(p => p.id === e.action.targets[0] && p.hp > 0));
    const living = room.match.players.filter(p => p.hp > 0);
    const finished = living.length <= 1, winnerId = finished && living.length ? living[0].id : null;
    room.result = { round: room.job.completedRound, finished, winnerId, logs: room.job.logs, damage: room.job.damage, hasDamage: room.job.hasDamage };
    room.history.unshift({ ...room.result, actions: structuredClone(room.actions), gameNumber: room.gameNumber });
    room.history = room.history.slice(0, 100);
    if (finished) lockResult(room, winnerId);
    room.phase = 'reveal';
    timer(room, options.revealMs ?? (room.job.hasDamage ? 5000 : 2000), () => {
      if (room.result.finished) { room.phase = 'finished'; room.deadline = null; for (const m of room.members) m.ready = false; }
      else nextRound(room);
    });
  }
  function leave(session) {
    const room = rooms.get(session.roomId); session.roomId = null;
    if (!room) return;
    const member = room.members.find(m => m.id === session.id);
    if (member) { member.left = true; member.ready = false; member.connected = false; }
    if (!active(room).length) { clearTimeout(room.timer); rooms.delete(room.id); return; }
    if (room.hostId === session.id) room.hostId = active(room)[0].id;
    if (room.phase === 'selecting') {
      if (actors(room).length <= 1 || actors(room).every(p => room.actions[p.id])) settle(room);
    } else if (room.phase === 'choice') { clearTimeout(room.timer); progress(room); }
    else if (room.phase === 'reveal' && !room.result.finished) {
      const p = room.match.players.find(p => p.id === session.id); if (p) p.hp = 0;
      room.match.ongoing = room.match.ongoing.filter(e => room.match.players.some(p => p.id === e.action.targets[0] && p.hp > 0));
      const live = room.match.players.filter(p => p.hp > 0);
      if (live.length <= 1) {
        room.result.finished = true; room.result.winnerId = live[0]?.id || null;
        if (room.history[0]?.round === room.result.round) { room.history[0].finished = true; room.history[0].winnerId = room.result.winnerId; }
        lockResult(room, room.result.winnerId);
      }
    }
    else if (!playing(room)) { room.members = active(room); maybeStart(room); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/health') return json(res, 200, { ok: true, game: 'bigarm', version: RULE_VERSION });
      if (url.pathname === '/api/rules' && req.method === 'GET') return json(res, 200, { moves: MOVES, equipment: EQUIPMENT, resourceNames: RESOURCE_NAMES, version: RULE_VERSION });
      if (req.method === 'POST' && req.headers.origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin)) return json(res, 403, { error: '不允许跨站操作。' });
      if (url.pathname === '/api/session' && req.method === 'POST') {
        const body = await bodyOf(req); let session = sessions.get(body.token);
        if (!session) {
          const name = clean(body.name, 12); if (!name) fail('请输入临时昵称。');
          if (sessions.size >= 10000) fail('当前临时身份已满。');
          session = { id: randomUUID(), token: randomBytes(32).toString('hex'), name, roomId: null, streams: new Set(), rates: [], lastSeen: Date.now() };
          sessions.set(session.token, session);
        }
        session.lastSeen = Date.now(); return json(res, 200, { token: session.token, ...snapshot(session) });
      }
      if (url.pathname.startsWith('/api/')) {
        const token = url.pathname === '/api/events' ? url.searchParams.get('token') : req.headers.authorization?.replace(/^Bearer /, '');
        const session = sessions.get(token); if (!session) return json(res, 401, { error: '身份已过期，请重新进入。' });
        session.lastSeen = Date.now();
        const existing = rooms.get(session.roomId), member = existing?.members.find(m => m.id === session.id && !m.left);
        if (member) member.connected = true;
        if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, snapshot(session));
        if (url.pathname === '/api/events' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          session.streams.add(res); res.write(`event: state\ndata: ${JSON.stringify(snapshot(session))}\n\n`);
          const beat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000); beat.unref();
          req.on('close', () => {
            clearInterval(beat); session.streams.delete(res);
            if (!session.streams.size) { session.lastSeen = Date.now(); const room = rooms.get(session.roomId); const m = room?.members.find(m => m.id === session.id); if (m) m.connected = false; broadcast(); }
          }); return;
        }
        if (req.method !== 'POST') return json(res, 404, { error: '接口不存在。' });
        session.rates = session.rates.filter(t => t > Date.now() - 10000);
        if (session.rates.length >= 50) return json(res, 429, { error: '操作过快，请稍候。' });
        session.rates.push(Date.now()); const body = await bodyOf(req); let room = rooms.get(session.roomId);
        switch (url.pathname) {
          case '/api/rooms/create': {
            if (room) fail('请先退出当前房间。');
            const capacity = Number(body.capacity ?? 10); if (!Number.isInteger(capacity) || capacity < 2 || capacity > 10) fail('人数限制为 2–10。');
            if (rooms.size >= 200) fail('当前房间已满。');
            let id; do { id = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(id));
            room = { id, name: clean(body.name) || `${session.name}的房间`, hostId: session.id, capacity, phase: 'waiting', members: [{ id: session.id, name: session.name, seat: 0, ready: false, connected: true, left: false }], actions: {}, match: null, job: null, history: [], scores: {}, gameNumber: 0, lastMatch: null, result: null, deadline: null };
            scoreMember(room, room.members[0]); rooms.set(id, room); session.roomId = id; break;
          }
          case '/api/rooms/join': {
            if (room) fail('你已在房间中。');
            room = rooms.get(String(body.roomId || '').trim().toUpperCase()); if (!room) fail('房间不存在。');
            if (playing(room)) fail('正在对局，请等待结束。'); if (active(room).length >= room.capacity) fail('房间已满。');
            room.members = active(room); const seat = Array.from({ length: 10 }, (_, i) => i).find(i => !room.members.some(m => m.seat === i));
            let name = session.name, n = 2; while (room.members.some(m => m.name === name)) name = `${session.name}·${n++}`;
            const m = { id: session.id, name, seat, ready: false, connected: true, left: false }; room.members.push(m); scoreMember(room, m); session.roomId = room.id; break;
          }
          case '/api/rooms/leave': leave(session); break;
          case '/api/rooms/ready': {
            if (!room || playing(room)) fail('当前不能准备。'); const m = active(room).find(m => m.id === session.id); if (!m) fail('你不在房间中。');
            m.ready = !m.ready; maybeStart(room); break;
          }
          case '/api/rooms/capacity': {
            if (!room || room.hostId !== session.id || playing(room)) fail('只有房主可以在局外调整人数。');
            const n = Number(body.capacity); if (!Number.isInteger(n) || n < 2 || n > 10 || n < active(room).length) fail('人数限制无效。'); room.capacity = n; break;
          }
          case '/api/game/action': {
            if (!room || room.phase !== 'selecting') fail('当前不是选招阶段。');
            if (body.round !== room.match.round) fail('回合已更新。'); if (room.actions[session.id]) fail('已经锁定行动。');
            room.actions[session.id] = validateAction(room.match, session.id, body);
            if (actors(room).every(p => room.actions[p.id])) settle(room); break;
          }
          case '/api/game/choice': {
            if (!room || room.phase !== 'choice') fail('当前不需要选择。'); if (body.round !== room.match.round) fail('回合已更新。');
            room.job = resumeRound(room.job, session.id, body.requestId, body.answer); clearTimeout(room.timer); progress(room); break;
          }
          default: return json(res, 404, { error: '接口不存在。' });
        }
        broadcast(); return json(res, 200, { ok: true });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '不支持的方法。' });
      if (['/rules/engine.js', '/rules/catalog.js'].includes(url.pathname)) {
        const data = await readFile(new URL(`../rules/${path.basename(url.pathname)}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : data);
      }
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/game.css': ['game.css', 'text/css'] };
      const entry = files[url.pathname]; if (!entry) return json(res, 404, { error: '页面不存在。' });
      const data = await readFile(path.join(publicDir, entry[0])); res.writeHead(200, { 'Content-Type': `${entry[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) { if (!res.headersSent) json(res, 400, { error: error.message || '操作失败。' }); else res.end(); }
  });
  const cleanup = setInterval(() => {
    let changed = false;
    for (const session of sessions.values()) {
      if (session.roomId && !session.streams.size && Date.now() - session.lastSeen > disconnectMs) { leave(session); changed = true; }
      if (!session.roomId && !session.streams.size && Date.now() - session.lastSeen > 86400000) sessions.delete(session.token);
    }
    if (changed) broadcast();
  }, Math.min(disconnectMs, 1000)); cleanup.unref();
  server.on('close', () => { clearInterval(cleanup); for (const room of rooms.values()) clearTimeout(room.timer); for (const session of sessions.values()) for (const stream of session.streams) stream.end(); });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3200), server = createServer();
  server.listen(port, '0.0.0.0', () => console.log(`大臂 BIGARM ARENA · http://localhost:${port}`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
