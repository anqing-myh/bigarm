import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, createPlayer, createMatch, availableMoves } from '../rules/engine.js';
import { PINYIN, matchesMove, searchMoves, blessingLimit, blessingTotal, combatChanges, statusRound } from '../public/interaction.js';

test('remaining status time uses the next round during completed-round reveal', () => {
  const effect = { start: 1, end: 2 };
  const remaining = room => Math.max(0, effect.end - statusRound(room) + 1);
  assert.equal(remaining({ phase: 'choice', round: 1 }), 2);
  assert.equal(remaining({ phase: 'reveal', round: 1 }), 1);
  assert.equal(remaining({ phase: 'selecting', round: 2 }), 1);
  assert.equal(remaining({ phase: 'reveal', round: 2 }), 0);
});

test('every current move can be found by Chinese, pinyin and initials', () => {
  for (const m of Object.values(MOVES)) {
    assert.ok(PINYIN[m.id], m.id);
    assert.ok(matchesMove(m, m.name));
    assert.ok(matchesMove(m, PINYIN[m.id].replaceAll(' ', '')));
    assert.ok(matchesMove(m, PINYIN[m.id].split(' ').map(s => s[0]).join('')));
  }
  for (const query of ['回镖', 'hxb', 'HUI XUAN BIAO', 'huixb', "huí xuán biāo", "hui'xuan'biao"]) assert.ok(matchesMove(MOVES.boomerang, query), query);
  assert.ok(!matchesMove(MOVES.boomerang, 'bxh'));
  assert.ok(!matchesMove(MOVES.boomerang, '<script>'));
});

test('search only finds affordable and legal moves, including equipment synthesis and dodge limits', () => {
  const s = createMatch([createPlayer('a', '甲', 0), createPlayer('b', '乙', 1)]);
  assert.ok(!searchMoves(availableMoves(s, 'a'), 'quan').some(m => m.id === 'punch'));
  s.players[0].resources.B = 3;
  assert.deepEqual(searchMoves(availableMoves(s, 'a'), 'hxb').map(m => m.id), ['boomerang']);
  assert.deepEqual(searchMoves(availableMoves(s, 'a'), 'yld'), []);
  s.players[0].shields = [{ id: 's1', type: 'foam', layers: 1 }, { id: 's2', type: 'foam', layers: 1 }];
  assert.deepEqual(searchMoves(availableMoves(s, 'a'), 'yld').map(m => m.id), ['ghost']);
  s.players[0].history = ['S', 'S'];
  assert.ok(!availableMoves(s, 'a').some(m => m.id === 'basicS'));
});

test('blessing controls keep each damage positive and share a single budget', () => {
  const c = { budget: 6, events: [{ id: 'big', amount: 7, max: 6 }, { id: 'small', amount: 2, max: 1 }, { id: 'half', amount: .5, max: 0 }] };
  assert.equal(blessingLimit(c, {}, 'big'), 6);
  assert.equal(blessingLimit(c, {}, 'small'), 1);
  assert.equal(blessingLimit(c, {}, 'half'), 0);
  assert.equal(blessingLimit(c, { big: 6 }, 'small'), 0);
  assert.equal(blessingLimit(c, { big: 5, small: 1 }, 'big'), 5);
  assert.equal(blessingTotal(c, { big: '5', small: '1', unknown: 999 }), 6);
  assert.equal(blessingLimit({ ...c, budget: 0 }, {}, 'big'), 0);
});

test('combat feedback follows actual health and shield layers without replaying on polling or new games', () => {
  const before = { id: 'room', round: 1, gameNumber: 1, players: [{ id: 'a', hp: 5, shields: [{ id: 'g', type: 'ghost', layers: 3 }, { id: 'f', type: 'foam', layers: 1 }] }] };
  const after = structuredClone(before);
  after.players[0].hp = 3.5;
  after.players[0].shields = [{ id: 'g', type: 'ghost', layers: 1 }];
  assert.deepEqual(combatChanges(before, after).map(e => [e.kind, e.text]), [['damage', '♥ −1.5'], ['shield-loss', '◇ 护盾 −3层']]);
  assert.deepEqual(combatChanges(after, after), []);
  assert.deepEqual(combatChanges(null, after), []);
  assert.deepEqual(combatChanges(before, { ...after, gameNumber: 2 }), []);
  assert.deepEqual(combatChanges(before, { ...after, id: 'other' }), []);
  const healed = structuredClone(after); healed.players[0].hp = 4.5;
  healed.players[0].shields.push({ id: 'new', type: 'foam', layers: 1 });
  assert.deepEqual(combatChanges(after, healed).map(e => e.kind), ['heal', 'shield-gain']);
});
