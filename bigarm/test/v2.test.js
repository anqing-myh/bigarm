import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, WEIGHTS, createPlayer, createMatch, beginRound, resumeRound, validateAction, availableMoves, addShield } from '../rules/engine.js';

const p = (id, extra = {}) => ({ ...createPlayer(id, id, id.charCodeAt(0) - 97), resources: { ...Object.fromEntries(Object.keys(WEIGHTS).map(k => [k, 30])), Q: 0 }, ...extra });
const state = (...players) => createMatch(players.length ? players : [p('a'), p('b')]);
const action = (move, target) => ({ move, target });
const get = (job, id) => job.state.players.find(p => p.id === id);
const damage = (job, id) => job.damage.filter(d => d.target === id).reduce((n, d) => n + d.amount - d.blessing, 0);
function finish(job) {
  let steps = 0;
  while (job.status === 'choice') {
    assert.ok(++steps < 100);
    job = resumeRound(job, job.pending.playerId, job.pending.id, job.pending.kind === 'blessing' ? {} : job.pending.options[0].id);
  }
  return job;
}
const battle = (input, actions) => finish(beginRound(input, actions));

test('V2 gun is blocked by action identity, not by spending or holding dodge resources', () => {
  for (const move of ['basicB', 'basicZ', 'basicF', 'basicY', 'ghostDodge', 'heal']) {
    const j = battle(state(), { a: action('gun', 'b'), b: action(move) });
    assert.equal(damage(j, 'b'), 0, move);
  }
  for (const move of ['basicS', 'basicC']) {
    const j = battle(state(), { a: action('gun', 'b'), b: action(move) });
    assert.equal(damage(j, 'b'), .5, move);
  }
});

test('V2 flying knife attacks only next round, once, alongside a new action', () => {
  const input = state();
  let j = battle(input, { a: action('flyingKnife', 'b'), b: action('basicB') });
  assert.equal(damage(j, 'b'), 0);
  assert.equal(get(j, 'a').resources.S, 29);
  assert.deepEqual(j.state.ongoing.map(o => [o.start, o.end]), [[2, 2]]);
  j = battle(j.state, { a: action('punch', 'b'), b: action('basicB') });
  assert.equal(damage(j, 'b'), 2);
  assert.equal(j.state.ongoing.length, 0);
  j = battle(j.state, { a: action('basicB'), b: action('basicB') });
  assert.equal(damage(j, 'b'), 0);
  assert.equal(input.players[0].resources.S, 30, 'pure input preserved');
});

test('V2 delayed knife survives source death, but vanishes when its target dies', () => {
  let j = battle(state(p('a', { hp: 1 }), p('b'), p('c')), { a: action('flyingKnife', 'b'), b: action('basicB'), c: action('punch', 'a') });
  assert.equal(get(j, 'a').hp, 0); assert.equal(j.state.ongoing.length, 1);
  j = battle(j.state, { b: action('basicB'), c: action('basicB') });
  assert.equal(damage(j, 'b'), 1); assert.equal(j.state.ongoing.length, 0);
  j = battle(state(p('a'), p('b', { hp: 1 }), p('c')), { a: action('flyingKnife', 'b'), b: action('basicB'), c: action('punch', 'b') });
  assert.equal(j.state.ongoing.length, 0);
});

test('V2 whole-ghost piercing: full ghost blocks; partial ghost passes; foam chain is finite', () => {
  for (const [move, amount] of [['cloudArrow', 1], ['punchKick', 2]]) for (const layers of [1, 2, 3]) {
    const input = state();
    addShield(input, input.players[1], 'foam');
    addShield(input, input.players[1], 'ghost').layers = layers;
    addShield(input, input.players[1], 'foam');
    const j = battle(input, { a: action(move, 'b'), b: action('basicY') });
    assert.equal(damage(j, 'b'), layers === 3 ? 0 : amount, `${move}/${layers}`);
    assert.equal(get(j, 'b').shields.some(s => s.type === 'ghost'), false);
  }
  const input = state();
  addShield(input, input.players[1], 'foam'); addShield(input, input.players[1], 'foam');
  const j = battle(input, { a: action('cloudArrow', 'b'), b: action('basicY') });
  assert.equal(get(j, 'b').shields.length, 0); assert.equal(damage(j, 'b'), 1);
});

test('V2 piercing can pause repeatedly, resume from JSON, and never consume a shield twice', () => {
  const input = state();
  addShield(input, input.players[1], 'ghost').layers = 2;
  addShield(input, input.players[1], 'ghost');
  const untouched = structuredClone(input);
  let j = beginRound(input, { a: action('cloudArrow', 'b'), b: action('basicY') });
  assert.equal(j.pending.kind, 'shield');
  const partial = j.pending.options.find(o => o.label.includes('2层'));
  j = resumeRound(JSON.parse(JSON.stringify(j)), 'b', j.pending.id, partial.id);
  assert.equal(j.status, 'complete'); assert.equal(damage(j, 'b'), 0);
  assert.equal(get(j, 'b').shields.length, 0);
  assert.equal(j.logs.filter(e => e.type === 'hit').length, 1);
  assert.deepEqual(input, untouched);
});

test('V2 arc light reverses numeric comparisons without changing queue order or special clashes', () => {
  let j = battle(state(p('a'), p('b'), p('c')), { a: action('arcLight'), b: action('skyCannon', 'a'), c: action('basicS') });
  assert.equal(j.hits[0].move, 'arcLight', '6.5 points still before 5.3 points');
  assert.equal(damage(j, 'a'), 1, 'lower points win the reverse clash');
  assert.equal(damage(j, 'b'), 0); assert.equal(damage(j, 'c'), 1, 'group only suppressed against counterattacker');
  j = battle(state(), { a: action('arcLight'), b: action('knifePoint', 'a') });
  assert.equal(damage(j, 'a'), 2); assert.equal(damage(j, 'b'), 0, 'ingredient clash remains authoritative');
  j = battle(state(), { a: action('arcLight'), b: action('arcLight') });
  assert.equal(j.damage.length, 0, 'equal points still cancel');
});

test('V2 every action earns separate stock; ordinary blocks do not cancel it; real shields remain distinct', () => {
  let j = battle(state(), { a: action('punch', 'b'), b: action('foam') });
  assert.equal(get(j, 'a').resources.punch, 31);
  assert.equal(get(j, 'b').resources.foam, 31);
  assert.equal(get(j, 'b').shields.length, 0, 'new shield consumed, stock retained');
  const input = state(); input.players[0].resources.foam = 2;
  assert.throws(() => validateAction(input, 'a', action('ghost')), /真实/);
  addShield(input, input.players[0], 'foam'); addShield(input, input.players[0], 'foam');
  j = battle(input, { a: action('ghost'), b: action('basicB') });
  assert.equal(get(j, 'a').resources.foam, 2, 'synthesis consumes physical shields, not stock');
  assert.equal(get(j, 'a').resources.ghost, 31);
  assert.equal(get(j, 'b').resources.B, 31, 'basic action earns normal B without a duplicate basicB currency');
  assert.equal(Object.hasOwn(get(j, 'b').resources, 'basicB'), false);
});

test('V2 cost-sensitive immunity and clashes use actual stock cost rather than point-value expansion', () => {
  const input = state(); addShield(input, input.players[1], 'thunder');
  let j = battle(input, { a: action('ghostArrows'), b: action('basicB') });
  assert.equal(get(j, 'b').shields.length, 0, 'stock ghostDodge is not an actual C payment, so thunder blocks once instead of cost immunity');
  assert.equal(damage(j, 'b'), 0);
  j = battle(state(), { a: action('ghostSword', 'b'), b: action('knifePoint', 'a') });
  assert.equal(damage(j, 'b'), 6); assert.equal(damage(j, 'a'), 0, 'ghost stock is not an actual B payment for knife-point clash');
});

test('V2 stock must be earned before it is spent; spells start next round; spending stock preserves effects', () => {
  const input = state(); input.players[0].resources.ghostDodge = 0;
  assert.throws(() => validateAction(input, 'a', action('ghostArrows')), /幽灵闪不足/);
  assert.ok(!availableMoves(input, 'a').some(m => m.id === 'ghostArrows'));
  let j = battle(input, { a: action('ghostDodge'), b: action('punch', 'a') });
  assert.equal(damage(j, 'a'), 1, 'no same-turn C defense');
  assert.equal(get(j, 'a').resources.ghostDodge, 1);
  assert.deepEqual(get(j, 'a').effects.map(e => [e.name, e.start, e.end]), [['幽灵闪', 2, 3]]);
  j = battle(j.state, { a: action('ghostDodge'), b: action('punch', 'a') });
  assert.equal(damage(j, 'a'), 0); assert.equal(get(j, 'a').effects.length, 1, 'same spell refreshes');
  assert.equal(get(j, 'a').effects[0].end, 4); assert.equal(get(j, 'a').resources.ghostDodge, 2);
  const base = get(j, 'a').resources.B;
  j = battle(j.state, { a: action('ghostArrows'), b: action('basicB') });
  assert.equal(damage(j, 'b'), 2); assert.equal(get(j, 'a').resources.ghostDodge, 0);
  assert.equal(get(j, 'a').resources.B, base, 'tokens are not expanded into a second base-resource cost');
  assert.ok(get(j, 'a').effects.some(e => e.move === 'ghostDodge'));
  assert.equal(MOVES.ghostArrows.power, 160); assert.equal(MOVES.ghostFinisher.power, 175);
});

test('V2 ghost sword checks spell components; ghost finisher checks nonbasic action identity', () => {
  for (const move of ['basicZ', 'ghostDodge', 'heal', 'hammer3']) {
    const j = battle(state(p('a'), p('b'), p('c')), { a: action('ghostSword', 'b'), b: action(move, 'c'), c: action('basicB') });
    assert.equal(damage(j, 'b'), 0, move);
    assert.equal(j.lifeLoss.find(e => e.target === 'a').amount, 1);
  }
  const j = battle(state(p('a'), p('b'), p('c')), { a: action('ghostSword', 'b'), b: action('sunPunch', 'c'), c: action('basicB') });
  assert.equal(damage(j, 'b'), 6, 'magic damage alone is not a spell component');
  assert.equal(MOVES.phoenix.hasSpell, true); assert.equal(MOVES.sunPunch.hasSpell, false);
  for (const move of ['basicB', 'basicZ', 'basicF', 'basicY', 'basicS', 'basicC']) {
    const result = battle(state(), { a: action('ghostFinisher', 'b'), b: action(move) });
    assert.equal(damage(result, 'b'), 1, move);
  }
  const input = state(); addShield(input, input.players[1], 'foam');
  const result = battle(input, { a: action('ghostFinisher', 'b'), b: action('basicB') });
  assert.equal(damage(result, 'b'), 1); assert.equal(get(result, 'b').shields.length, 1, 'true damage preserves ordinary shield');
});

test('V2 life loss ignores immunity/blessing and never cancels already chosen effects before final death', () => {
  let j = battle(state(p('a', { hp: 1 }), p('b')), { a: action('ghostSword', 'b'), b: action('basicB') });
  assert.equal(damage(j, 'b'), 6, 'source still attacks at zero health');
  assert.equal(j.winnerId, null); assert.equal(j.finished, true);
  j = battle(state(p('a', { resources: { ...p('a').resources, Q: 10 } }), p('b')), { a: action('axi'), b: action('sixFists', 'a') });
  assert.equal(get(j, 'a').hp, 4); assert.equal(damage(j, 'a'), 0); assert.equal(get(j, 'a').resources.Q, 10);
  assert.equal(j.lifeLoss.length, 1); assert.equal(j.hasDamage, false); assert.equal(j.hasLifeLoss, true);
  assert.equal(j.logs[0].type, 'lifeLoss', 'life loss is the first mutation before grants and spells');
});

test('V2 crucio starts next round, refreshes by max, triggers actual S/C once and expires after 15 rounds', () => {
  let j = battle(state(), { a: action('crucio', 'b'), b: action('basicS') });
  assert.equal(j.lifeLoss.length, 0);
  assert.deepEqual(get(j, 'b').effects.map(e => [e.name, e.start, e.end, e.positive]), [['钻心咒', 2, 16, false]]);
  j = battle(j.state, { a: action('crucio', 'b'), b: action('basicC') });
  assert.equal(j.lifeLoss.length, 1); assert.equal(get(j, 'b').hp, 3);
  assert.equal(get(j, 'b').effects.length, 1); assert.equal(get(j, 'b').effects[0].end, 17);
  j = battle(j.state, { a: action('basicB'), b: action('ghostDodge') });
  assert.equal(j.lifeLoss.length, 0, 'equivalent C is not an actual C action');
  const atEnd = structuredClone(j.state); atEnd.round = 17; get({ state: atEnd }, 'b').hp = 5;
  j = battle(atEnd, { a: action('basicB'), b: action('basicS') });
  assert.equal(get(j, 'b').hp, 3); assert.ok(!get(j, 'b').effects.some(e => e.kind === 'curse'));
  j = battle(j.state, { a: action('basicB'), b: action('basicS') });
  assert.equal(j.lifeLoss.length, 0);
});

test('V2 hammer silence precedes all normal spells, keeps physical attack, and cancels same-name stock', () => {
  let j = battle(state(), { a: action('phoenix'), b: action('hammer3', 'a') });
  assert.equal(get(j, 'a').resources.Q, 0, 'even earlier-seat phoenix loses blessing');
  assert.equal(get(j, 'a').resources.phoenix, 30, 'no stock for cancelled new spell component');
  assert.equal(damage(j, 'b'), 2, 'magic damage remains');
  assert.ok(j.cancelledSpells.includes('a'));
  j = battle(state(), { a: action('hammer3', 'b'), b: action('ghostDodge') });
  assert.equal(get(j, 'b').effects.length, 0); assert.equal(get(j, 'b').resources.ghostDodge, 30);
  assert.equal(get(j, 'b').resources.B, 29, 'cancelled spell still paid cost');
  const input = state(); addShield(input, input.players[0], 'radar');
  j = battle(input, { a: action('hammer3', 'b'), b: action('shock', 'a') });
  assert.equal(get(j, 'a').shields.length, 1, 'cancelled shock does not remove shield');
  assert.equal(damage(j, 'b'), 0, 'shock intrinsic 2-level damage protection remains');
});

test('V2 level-2 control checks and hammer exemption do not create cancellation loops', () => {
  for (const move of ['axi', 'thunderDodge', 'phoenixGuard']) {
    const b = p('b', { resources: { ...p('b').resources, Q: 1 } });
    const j = battle(state(p('a'), b), { a: action('hammer3', 'b'), b: action(move) });
    assert.ok(!j.cancelledSpells.includes('b'), move);
  }
  let j = battle(state(), { a: action('hammer3', 'b'), b: action('sixFists', 'a') });
  assert.ok(j.cancelledSpells.includes('b'), 'one-level control immunity cannot resist level two');
  j = battle(state(), { a: action('hammer3', 'b'), b: action('hammer3', 'a') });
  assert.deepEqual([...j.cancelledSpells].sort(), ['a', 'b']);
  assert.equal(j.damage.length, 0); assert.equal(get(j, 'a').resources.hammer3, 31); assert.equal(get(j, 'b').resources.hammer3, 31);
  const input = state();
  input.players[1].effects.push({ id: 'old', move: 'ghostDodge', name: '幽灵闪', kind: 'defense', value: 'C', start: 1, end: 3 });
  j = battle(input, { a: action('hammer3', 'b'), b: action('basicY') });
  assert.ok(get(j, 'b').effects.some(e => e.id === 'old')); assert.equal(damage(j, 'b'), 1, 'C is not a hammer defense');
  j = battle(state(p('a'), p('b'), p('c')), { a: action('hammer3', 'b'), b: action('fireWheel', 'c'), c: action('basicB') });
  assert.equal(get(j, 'b').resources.Y, 30, 'two hit callbacks remain despite silence');
  assert.equal(get(j, 'b').resources.fireWheel, 31);
});

test('V2 choice continuations do not repeat life loss or award move stock twice', () => {
  const input = state(p('a', { hp: 1 }), p('b')); addShield(input, input.players[1], 'foam'); addShield(input, input.players[1], 'foam');
  let j = beginRound(input, { a: action('ghostSword', 'b'), b: action('basicB') });
  assert.equal(j.pending.kind, 'shield'); assert.equal(get(j, 'a').hp, 0);
  assert.equal(get(j, 'a').resources.ghostSword, 31);
  j = resumeRound(JSON.parse(JSON.stringify(j)), 'b', j.pending.id, j.pending.options[0].id);
  assert.equal(j.status, 'complete'); assert.equal(get(j, 'a').hp, 0);
  assert.equal(get(j, 'a').resources.ghostSword, 31); assert.equal(j.lifeLoss.length, 1);
});

test('V2 delayed spell effects can overlap by name without stacking the same condition', () => {
  let j = battle(state(), { a: action('ghostDodge'), b: action('basicB') });
  j = battle(j.state, { a: action('voidDodge'), b: action('punch', 'a') });
  assert.equal(damage(j, 'a'), 0, 'old ghost defense remains while new void is pending');
  assert.ok(get(j, 'a').effects.some(e => e.move === 'ghostDodge'));
  assert.equal(get(j, 'a').effects.filter(e => e.move === 'voidDodge').length, 2);
  j = battle(j.state, { a: action('basicB'), b: action('wave') });
  assert.equal(damage(j, 'a'), 0, 'next-round void C can defend a group attack');
  j = battle(j.state, { a: action('basicB'), b: action('wave') });
  assert.equal(damage(j, 'a'), 1, 'later scope immunity alone cannot stop group attacks');
});
