import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../server/index.js';

async function fixture(t, options = {}) {
  const server = createServer({ selectionMs: 10000, choiceMs: 10000, revealMs: 5, disconnectMs: 60000, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(path, body, token, status = 200, headers = {}) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json(); assert.equal(response.status, status, `${path}: ${JSON.stringify(json)}`); return json;
  }
  const session = name => api('/api/session', { name });
  const state = token => api('/api/state', undefined, token);
  async function wait(token, predicate) {
    for (let i = 0; i < 500; i++) { const s = await state(token); if (predicate(s)) return s; await new Promise(r => setTimeout(r, 5)); }
    assert.fail('room did not reach expected state');
  }
  async function room() {
    const a = await session('甲'), b = await session('乙');
    await api('/api/rooms/create', { name: '测试房间', capacity: 2 }, a.token);
    const id = (await state(a.token)).room.id;
    await api('/api/rooms/join', { roomId: id }, b.token);
    await api('/api/rooms/ready', {}, a.token); await api('/api/rooms/ready', {}, b.token);
    return { a, b, id };
  }
  return { api, session, state, wait, room, base };
}
test('HTTP identity, capacity, origin, static allowlist and shared pure module', async t => {
  const f = await fixture(t);
  assert.equal((await f.api('/api/health')).game, 'bigarm');
  await f.api('/api/state', undefined, null, 401);
  const a = await f.session('<甲>');
  await f.api('/api/rooms/create', { capacity: 11 }, a.token, 400);
  await f.api('/api/rooms/create', { capacity: 2 }, a.token, 403, { Origin: 'https://unrelated.example' });
  await f.api('/api/rooms/create', { capacity: 2 }, a.token);
  const b = await f.session('乙'), c = await f.session('丙'), id = (await f.state(a.token)).room.id;
  await f.api('/api/rooms/join', { roomId: id }, b.token);
  await f.api('/api/rooms/join', { roomId: id }, c.token, 400);
  await f.api('/api/rooms/capacity', { capacity: 3 }, b.token, 400);
  await f.api('/api/rooms/capacity', { capacity: 3 }, a.token);
  await f.api('/api/rooms/join', { roomId: id }, c.token);
  assert.equal((await f.state(c.token)).room.players.length, 3);
  const rules = await f.api('/api/rules'); assert.equal(Object.keys(rules.moves).length, 57);
  assert.equal((await fetch(f.base + '/rules/engine.js')).status, 200);
  assert.equal((await fetch(f.base + '/rules/catalog.js')).status, 200);
  assert.equal((await fetch(f.base + '/rules/../package.json')).status, 404);
});
test('multiplayer lock secrecy, full match, exactly-once result and restart', async t => {
  const f = await fixture(t), { a, b, id } = await f.room();
  let s = await f.state(a.token);
  assert.equal(s.room.phase, 'selecting'); assert.ok(s.room.players.every(p => p.hp === 5 && p.resources.B === 0));
  await f.api('/api/game/action', { round: 1, move: 'basicB' }, a.token);
  const other = await f.state(b.token); assert.equal(other.room.actions, null); assert.equal(other.room.ownAction, null); assert.equal(other.room.submitted.length, 1);
  await f.api('/api/game/action', { round: 1, move: 'basicF' }, a.token, 400);
  await f.api('/api/game/action', { round: 0, move: 'basicB' }, b.token, 400);
  await f.api('/api/game/action', { round: 1, move: 'basicB' }, b.token);
  s = await f.wait(a.token, x => x.room.phase === 'selecting' && x.room.round === 2);
  for (let turn = 0; turn < 12 && s.room.phase !== 'finished'; turn++) {
    const round = s.room.round, me = s.room.players.find(p => p.id === a.self.id);
    await f.api('/api/game/action', { round, move: me.resources.B ? 'kick' : 'basicB', target: b.self.id }, a.token);
    await f.api('/api/game/action', { round, move: 'basicB' }, b.token);
    s = await f.wait(a.token, x => x.room.phase === 'finished' || x.room.phase === 'selecting' && x.room.round > round);
  }
  assert.equal(s.room.phase, 'finished'); assert.equal(s.room.lastMatch.winnerId, a.self.id);
  assert.equal(s.room.leaderboard.find(p => p.id === a.self.id).wins, 1);
  for (let i = 0; i < 3; i++) assert.equal((await f.state(a.token)).room.leaderboard.find(p => p.id === a.self.id).wins, 1);
  await f.api('/api/rooms/leave', {}, a.token);
  s = await f.state(b.token); assert.equal(s.room.lastMatch.winnerId, a.self.id);
  const c = await f.session('丙'); await f.api('/api/rooms/join', { roomId: id }, c.token);
  await f.api('/api/rooms/ready', {}, b.token); await f.api('/api/rooms/ready', {}, c.token);
  s = await f.state(c.token); assert.equal(s.room.gameNumber, 2); assert.equal(s.room.round, 1);
  assert.ok(s.room.players.every(p => p.hp === 5 && p.resources.B === 0 && p.shields.length === 0));
});
test('timeout uses free B, forfeit completes round, room host transfers', async t => {
  const f = await fixture(t, { selectionMs: 150 }), { a, b } = await f.room();
  let s = await f.wait(a.token, x => x.room.round >= 2);
  assert.ok(s.room.players.every(p => p.resources.B >= 1));
  await f.api('/api/rooms/leave', {}, b.token);
  s = await f.wait(a.token, x => x.room.phase === 'finished');
  assert.equal(s.room.lastMatch.winnerId, a.self.id);
  assert.equal(s.room.leaderboard.find(p => p.id === a.self.id).wins, 1);
});
test('choosing endpoints reject spectators, stale rounds and missing continuation', async t => {
  const f = await fixture(t), { a, b } = await f.room(), c = await f.session('旁观者');
  await f.api('/api/game/choice', { requestId: 'fake', round: 1, answer: 's1' }, a.token, 400);
  await f.api('/api/game/action', { round: 1, move: 'basicB' }, c.token, 400);
  await f.api('/api/game/action', { round: 1, move: 'shock', target: a.self.id }, b.token, 400);
  await f.api('/api/game/action', { round: 1, move: '__proto__', target: b.self.id }, a.token, 400);
});
test('real mid-round shield choice is owned, resumable, visible and charged once', async t => {
  const f = await fixture(t), { a, b } = await f.room();
  let s = await f.state(a.token);
  for (const move of ['basicB', 'basicF', 'foam', 'basicB', 'basicF', 'foam']) {
    const round = s.room.round;
    await f.api('/api/game/action', { round, move: 'basicB' }, a.token);
    await f.api('/api/game/action', { round, move }, b.token);
    s = await f.wait(a.token, x => x.room.phase === 'selecting' && x.room.round > round);
  }
  const round = s.room.round, before = s.room.players.find(p => p.id === a.self.id).resources.B;
  await f.api('/api/game/action', { round, move: 'punch', target: b.self.id }, a.token);
  await f.api('/api/game/action', { round, move: 'basicZ' }, b.token);
  s = await f.state(b.token); assert.equal(s.room.phase, 'choice'); assert.equal(s.room.pending.kind, 'shield');
  assert.equal(s.room.pending.playerId, b.self.id); assert.ok(s.room.actions[a.self.id]);
  const c = s.room.pending;
  await f.api('/api/game/choice', { round, requestId: c.id, answer: c.options[0].id }, a.token, 400);
  await f.api('/api/game/choice', { round: round - 1, requestId: c.id, answer: c.options[0].id }, b.token, 400);
  await f.api('/api/game/choice', { round, requestId: c.id, answer: c.options[0].id }, b.token);
  s = await f.wait(a.token, x => x.room.phase === 'selecting' && x.room.round > round);
  assert.equal(s.room.players.find(p => p.id === a.self.id).resources.B, before - 1);
  assert.equal(s.room.players.find(p => p.id === b.self.id).shields.length, 1);
  assert.equal(s.room.players.find(p => p.id === b.self.id).hp, 5);
});
test('disconnect grace expires without blocking the connected player or host transfer', async t => {
  const f = await fixture(t, { disconnectMs: 250 }), { a, b } = await f.room();
  const s = await f.wait(b.token, x => x.room.phase === 'finished');
  assert.equal(s.room.hostId, b.self.id); assert.equal(s.room.lastMatch.winnerId, b.self.id);
  assert.equal(s.room.players.find(p => p.id === a.self.id).left, true);
});
