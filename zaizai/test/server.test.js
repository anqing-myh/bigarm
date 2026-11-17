import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../server/index.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test('联机服务：身份、权限、2–8 人房间、招式保密、阵亡、展示时长和重新准备', { timeout: 45000 }, async t => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const controllers = [];
  const clients = [];
  t.after(async () => {
    for (const controller of controllers) controller.abort();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  async function request(route, token, body) {
    const response = await fetch(base + '/api' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  async function client(name) {
    const { data } = await request('/session', null, { name });
    const controller = new AbortController(); controllers.push(controller);
    const stream = await fetch(base + '/api/events?token=' + data.token, { signal: controller.signal });
    assert.match(stream.headers.get('content-type'), /event-stream/);
    const reader = stream.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /retry: 1500/);
    const c = { ...data, request: (route, body) => request(route, data.token, body), state: async () => (await request('/state', data.token)).data };
    clients.push(c);
    return c;
  }
  async function until(client, predicate, ms = 6500) {
    const start = Date.now();
    while (Date.now() - start < ms) { const state = await client.state(); if (predicate(state)) return state; await delay(35); }
    throw new Error('等待房间阶段超时');
  }
  const a = await client('仔仔');
  const b = await client('小蓝');
  const c = await client('橘子');
  assert.equal((await request('/state', 'bad-token')).status, 401);
  assert.equal((await a.request('/rooms/create', { capacity: 9 })).status, 400);
  assert.equal((await a.request('/rooms/create', { name: '测试竞技场', capacity: 3 })).status, 200);
  const id = (await a.state()).room.id;
  assert.equal((await b.request('/rooms/join', { roomId: id.toLowerCase() })).status, 200);
  assert.equal((await c.request('/rooms/join', { roomId: id })).status, 200);
  assert.equal((await b.request('/rooms/capacity', { capacity: 8 })).status, 400);
  assert.equal((await a.request('/rooms/capacity', { capacity: 2 })).status, 400);
  assert.equal((await a.request('/rooms/capacity', { capacity: 8 })).status, 200);
  assert.equal((await a.state()).room.capacity, 8);
  await a.request('/rooms/ready', {}); await b.request('/rooms/ready', {});
  assert.equal((await a.state()).room.phase, 'waiting');
  await c.request('/rooms/ready', {});
  const first = (await a.state()).room;
  assert.equal(first.phase, 'selecting'); assert.equal(first.round, 1);
  assert.ok(first.players.every(p => p.hp === 1 && p.energy === 0 && p.hammers === 0 && p.shields === 0));
  assert.equal((await a.request('/rooms/capacity', { capacity: 4 })).status, 400);
  assert.equal((await a.request('/game/action', { round: 1, move: 'gun', target: b.self.id })).status, 400);
  await a.request('/game/action', { round: 1, move: 'charge' });
  const secret = (await b.state()).room;
  assert.equal(secret.actions, null); assert.equal(secret.ownAction, null); assert.deepEqual(secret.submitted, [a.self.id]);
  assert.equal((await a.request('/game/action', { round: 1, move: 'guard' })).status, 400);
  await b.request('/game/action', { round: 1, move: 'charge' });
  await c.request('/game/action', { round: 1, move: 'charge' });
  const reveal1 = (await a.state()).room;
  assert.equal(reveal1.phase, 'reveal'); assert.equal(reveal1.result.hasDamage, false);
  assert.ok(reveal1.deadline - Date.now() <= 2000 && reveal1.deadline - Date.now() > 1500);
  await until(a, s => s.room.phase === 'selecting' && s.room.round === 2);
  assert.equal((await a.request('/game/action', { round: 1, move: 'charge' })).status, 400);
  await a.request('/game/action', { round: 2, move: 'gun', target: b.self.id });
  await b.request('/game/action', { round: 2, move: 'charge' });
  await c.request('/game/action', { round: 2, move: 'charge' });
  const reveal2 = (await a.state()).room;
  assert.equal(reveal2.result.hasDamage, true); assert.equal(reveal2.players.find(p => p.id === b.self.id).hp, 0);
  assert.ok(reveal2.deadline - Date.now() <= 5000 && reveal2.deadline - Date.now() > 4500);
  await until(a, s => s.room.phase === 'selecting' && s.room.round === 3);
  assert.equal((await b.request('/game/action', { round: 3, move: 'charge' })).status, 400);
  await a.request('/game/action', { round: 3, move: 'charge' });
  await c.request('/game/action', { round: 3, move: 'guard' });
  assert.equal((await a.state()).room.phase, 'reveal'); // Dead player is not awaited.
  await until(a, s => s.room.phase === 'selecting' && s.room.round === 4);
  await a.request('/game/action', { round: 4, move: 'gun', target: c.self.id });
  await c.request('/game/action', { round: 4, move: 'charge' });
  assert.equal((await a.state()).room.result.winnerId, a.self.id);
  const finished = await until(a, s => s.room.phase === 'finished');
  assert.ok(finished.room.players.every(p => p.ready === false));
  assert.equal(finished.room.lastMatch.winnerId,a.self.id);
  assert.equal(finished.room.lastMatch.winnerName,'仔仔');
  assert.equal(finished.room.leaderboard.find(p=>p.id===a.self.id).wins,1);
  assert.ok(finished.room.leaderboard.every(p=>p.games===1));
  await a.request('/rooms/ready', {}); await b.request('/rooms/ready', {});
  assert.equal((await a.state()).room.phase, 'finished');
  await c.request('/rooms/ready', {});
  const rematch = (await a.state()).room;
  assert.equal(rematch.phase, 'selecting'); assert.equal(rematch.round, 1);
  assert.ok(rematch.players.every(p => p.hp === 1 && p.energy === 0 && p.hammers === 0 && p.shields === 0));
  assert.equal(rematch.gameNumber,2);
  assert.ok(rematch.history.length>0,'新对局保留房间历史战报');
  assert.equal(rematch.leaderboard.find(p=>p.id===a.self.id).wins,1);
  await a.request('/rooms/leave', {});
  assert.equal((await b.state()).room.hostId, b.self.id);
  await b.request('/rooms/leave', {}); await c.request('/rooms/leave', {});
  const eight = [];
  for (let i = 0; i < 9; i++) eight.push(await client('玩家' + i));
  await eight[0].request('/rooms/create', { capacity: 8 });
  const room8 = (await eight[0].state()).room.id;
  for (let i = 1; i < 8; i++) assert.equal((await eight[i].request('/rooms/join', { roomId: room8 })).status, 200);
  assert.equal((await eight[8].request('/rooms/join', { roomId: room8 })).status, 400);
  assert.equal((await eight[0].state()).room.players.length, 8);
  for(let i=0;i<8;i++)await eight[i].request('/rooms/ready',{});
  assert.equal((await eight[0].state()).room.phase,'selecting');
  for(let i=0;i<8;i++)await eight[i].request('/game/action',{round:1,move:'charge'});
  const eightReveal=(await eight[7].state()).room;
  assert.equal(eightReveal.phase,'reveal');
  assert.equal(Object.keys(eightReveal.actions).length,8);
  assert.ok(eightReveal.players.every(p=>p.energy===1));
  for (const player of eight) await player.request('/rooms/leave', {});
});


test('polling clients stay connected and can start and synchronize a match without SSE', { timeout: 10000 }, async t => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const tokens = [];
  async function request(route, token, body) {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  t.after(async () => {
    for (const token of tokens) await request('/rooms/leave', token, {});
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  for (const name of ['Polling A', 'Polling B']) {
    const client = await request('/session', null, { name });
    tokens.push(client.token);
    await request('/state?poll=1', client.token);
  }
  const [a, b] = tokens;
  await request('/rooms/create', a, { capacity: 2 });
  const roomId = (await request('/state?poll=1', a)).room.id;
  await request('/rooms/join', b, { roomId });
  const joined = await request('/state?poll=1', a);
  assert.equal(joined.room.players.length, 2);
  assert.ok(joined.room.players.every(player => player.connected));
  await request('/rooms/ready', a, {});
  assert.equal((await request('/state?poll=1', b)).room.players[0].ready, true);
  await request('/rooms/ready', b, {});
  assert.equal((await request('/state?poll=1', a)).room.phase, 'selecting');
  await request('/game/action', a, { round: 1, move: 'charge' });
  const secret = await request('/state?poll=1', b);
  assert.equal(secret.room.actions, null);
  assert.equal(secret.room.submitted.length, 1);
  await request('/game/action', b, { round: 1, move: 'charge' });
  const revealed = await request('/state?poll=1', a);
  assert.equal(revealed.room.phase, 'reveal');
  assert.ok(revealed.room.players.every(player => player.energy === 1));
});
