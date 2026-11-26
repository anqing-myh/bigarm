import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, WEIGHTS, createPlayer, createMatch, beginRound, resumeRound, addShield, shieldSlots, validateAction, equipmentLegal } from '../rules/engine.js';

const p = (id, extra = {}) => ({ ...createPlayer(id, id.toUpperCase(), id.charCodeAt(0) - 97), hp: 100, maxHp: 100, resources: { ...Object.fromEntries(Object.keys(WEIGHTS).map(k => [k, 30])), Q: 0 }, ...extra });
const state = (...players) => createMatch(players.length ? players : [p('a'), p('b')]);
const a = (move, target) => ({ move, target });
const get = (job, id) => job.state.players.find(p => p.id === id);
const damage = (job, id) => job.damage.filter(d => d.target === id).reduce((n, d) => n + d.amount - d.blessing, 0);
function finish(job) {
  let steps = 0;
  while (job.status === 'choice') {
    assert.ok(steps++ < 100);
    job = resumeRound(JSON.parse(JSON.stringify(job)), job.pending.playerId, job.pending.id, job.pending.kind === 'blessing' ? {} : job.pending.options[0].id);
  }
  return job;
}
const battle = (s, actions) => finish(beginRound(s, actions));

test('V3 inventory valuation, classification and explicit zero power', () => {
  assert.equal(WEIGHTS.frogAbsent, 0); assert.equal(WEIGHTS.frogBarrier, 0);
  assert.equal(WEIGHTS.solar, 80); assert.equal(WEIGHTS.sunStorm, 160);
  assert.equal(WEIGHTS.giantWave, 120); assert.equal(WEIGHTS.annihilationShield, 180);
  assert.equal(WEIGHTS.voidBlade, 190); assert.equal(MOVES.voidBlade.power, 0);
  for (const id of ['frogAbsent', 'himalaya', 'sixMind', 'damageCurse']) assert.equal(MOVES[id].hasSpell, true);
  for (const id of ['skyDodge', 'fiveDarts', 'sunStorm', 'voidBlade']) assert.equal(MOVES[id].hasSpell, false);
});

test('V3 five darts is one damage event and reads actual chosen basic action', () => {
  for (const [move, expected] of [['basicB', 5], ['basicF', 3], ['basicY', 3], ['basicS', 1], ['basicC', 0], ['heal', 0], ['ghostDodge', 0]]) {
    const j = battle(state(), { a: a('fiveDarts', 'b'), b: a(move) });
    assert.equal(damage(j, 'b'), expected, move); assert.ok(j.damage.length <= 1);
  }
  const j = battle(state(p('a'), p('b'), p('c')), { a: a('fiveDarts', 'b'), b: a('punch', 'c'), c: a('basicB') });
  assert.equal(damage(j, 'b'), 5);
});

test('V3 revised Jing Xiao Peng deals four against any selected attack without reverse targeting', () => {
  let j = battle(state(), { a: a('jingXiaoPeng', 'b'), b: a('sword', 'a') });
  assert.equal(damage(j, 'b'), 4); assert.equal(damage(j, 'a'), 0);
  j = battle(state(p('a'), p('b'), p('c')), { a: a('jingXiaoPeng', 'b'), b: a('sword', 'c'), c: a('basicB') });
  assert.equal(damage(j, 'b'), 4, 'the target may be attacking a different player');
  j = battle(state(), { a: a('jingXiaoPeng', 'b'), b: a('basicC') }); assert.equal(damage(j, 'b'), 2);
  for (const move of ['heal', 'foam']) {
    j = battle(state(), { a: a('jingXiaoPeng', 'b'), b: a(move) }); assert.equal(damage(j, 'b'), 0, move);
  }
  j = battle(state(), { a: a('jingXiaoPeng', 'b'), b: a('flyingKnife', 'a') });
  assert.equal(damage(j, 'b'), 4, 'delayed attack is still the current selected attack action');
  j = battle(j.state, { a: a('jingXiaoPeng', 'b'), b: a('basicB') });
  assert.equal(damage(j, 'b'), 2, 'an old attack does not change this round basic action classification');
});

test('V3 roaming gun uses remaining S inventory after paying 4S', () => {
  const source = p('a'); source.resources.S = 5;
  const j = battle(state(source, p('b')), { a: a('roamingGun', 'b'), b: a('basicB') });
  assert.equal(damage(j, 'b'), 0.5); assert.equal(get(j, 'a').resources.S, 1);
  assert.deepEqual(j.damage.map(d => d.amount), [0.5]);
});

test('V3 revised roaming gun consumes shields independently per half-damage segment and resumes without replay', () => {
  const source = p('a'); source.resources.S = 7;
  const s = state(source, p('b')); addShield(s, s.players[1], 'foam'); addShield(s, s.players[1], 'ghost').layers = 1;
  const original = structuredClone(s);
  let j = beginRound(s, { a: a('roamingGun', 'b'), b: a('basicB') });
  assert.equal(j.pending.kind, 'shield');
  j = resumeRound(JSON.parse(JSON.stringify(j)), 'b', j.pending.id, j.pending.options.find(o => o.label.includes('泡沫')).id);
  j = finish(j);
  assert.equal(j.hits.length, 3); assert.equal(damage(j, 'b'), 0.5); assert.equal(get(j, 'b').shields.length, 0);
  assert.equal(j.logs.filter(e => e.type === 'hit').length, 3); assert.equal(get(j, 'a').resources.S, 3);
  assert.equal(get(j, 'a').resources.roamingGun, 31); assert.deepEqual(s, original);
  for (const move of ['basicS', 'basicC']) {
    const blocked = battle(state(source, p('b')), { a: a('roamingGun', 'b'), b: a(move) });
    assert.equal(damage(blocked, 'b'), 0); assert.equal(blocked.hits.length, 3);
  }
});

test('V3 zero-segment roaming gun preserves its declared attack intention but does not consume shields', () => {
  const source = p('a'); source.resources.S = 4;
  const s = state(source, p('b')); addShield(s, s.players[1], 'foam');
  const j = battle(s, { a: a('roamingGun', 'b'), b: a('punch', 'a') });
  assert.equal(j.hits.filter(h => h.move === 'roamingGun').length, 0);
  assert.equal(j.intentions.find(h => h.move === 'roamingGun').power, 100);
  assert.equal(damage(j, 'a'), 0); assert.equal(damage(j, 'b'), 0); assert.equal(get(j, 'b').shields.length, 1);
  assert.equal(j.logs.filter(e => e.type === 'hit').length, 0);
});

test('V3 protectors provide live defenses, expire on matching actual basics, and never alter resource income or history', () => {
  for (const key of 'BZFYSC') {
    let s = state(); addShield(s, s.players[1], `protector${key}`);
    const beforeStock = s.players[1].resources[`protector${key}`];
    const j = battle(s, { a: a('basicB'), b: a(`basic${key}`) });
    assert.equal(get(j, 'b').shields.length, 0, key);
    assert.equal(get(j, 'b').resources[`protector${key}`], beforeStock, 'expired real shield does not consume stock');
    assert.equal(get(j, 'b').resources[key], 31); assert.equal(get(j, 'b').history.at(-1), key);
    s = state(); addShield(s, s.players[1], `protector${key}`); addShield(s, s.players[1], `protector${key}`);
    const duplicate = battle(s, { a: a('basicB'), b: a(`basic${key}`) }); assert.equal(get(duplicate, 'b').shields.length, 0);
  }
  let s = state(); addShield(s, s.players[1], 'protectorF');
  let j = battle(s, { a: a('punch', 'b'), b: a('basicB') });
  assert.equal(damage(j, 'b'), 0); assert.equal(get(j, 'b').shields.length, 1, 'defense prevents consuming a shield');
  s = state(); addShield(s, s.players[1], 'protectorY');
  j = battle(s, { a: a('fireWheel', 'b'), b: a('basicB') }); assert.equal(get(j, 'b').shields.length, 1);
  s = state(); addShield(s, s.players[1], 'protectorC');
  j = battle(s, { a: a('comboPunch', 'b'), b: a('torch', 'a') });
  assert.equal(get(j, 'b').shields.length, 1, 'spending Y does not expire a C protector');
  assert.equal(get(j, 'b').resources.C, 30, 'extra C defense does not grant C inventory');
  s = state(); addShield(s, s.players[1], 'protectorZ');
  j = battle(s, { a: a('ghostSword', 'b'), b: a('basicB') });
  assert.equal(get(j, 'b').shields.length, 1, 'named Z defense can guard ghost sword');
});

test('V3 new protectors activate before attacks, but lose defense immediately when their physical shield is removed', () => {
  let j = battle(state(), { a: a('punch', 'b'), b: a('protectorF') });
  assert.equal(get(j, 'b').shields.length, 1); assert.equal(get(j, 'b').resources.F, 25);
  const s = state(p('a'), p('b'), p('c')); addShield(s, s.players[1], 'protectorF');
  j = battle(s, { a: a('knifePoint', 'b'), b: a('basicB'), c: a('punch', 'b') });
  assert.equal(get(j, 'b').shields.length, 0); assert.equal(damage(j, 'b'), 1, 'later punch sees that earlier attack consumed protector');
});

test('V3 silence shields stack, annihilation bonus uses current layers, and attack powers freeze at R3', () => {
  let s = state(); addShield(s, s.players[0], 'silenceShield'); addShield(s, s.players[0], 'silenceShield');
  let j = battle(s, { a: a('punch', 'b'), b: a('sword', 'a') });
  assert.equal(j.hits.find(h => h.move === 'punch').power, 90); assert.equal(damage(j, 'b'), 1); assert.equal(damage(j, 'a'), 0);
  s = state(); addShield(s, s.players[0], 'annihilationShield').layers = 2;
  j = battle(s, { a: a('punch', 'b'), b: a('basicB') }); assert.equal(j.hits[0].power, 90);
  s = state(); addShield(s, s.players[1], 'annihilationShield');
  j = battle(s, { a: a('fiveDarts', 'b'), b: a('punch', 'a') });
  assert.equal(j.hits.find(h => h.move === 'punch').power, 130);
  // Attack a third participant to keep both deliveries and consume one layer before the lower-power punch.
  s = state(p('a'), p('b'), p('c')); addShield(s, s.players[1], 'annihilationShield');
  j = battle(s, { a: a('ghostSword', 'b'), b: a('punch', 'c'), c: a('basicB') });
  assert.equal(get(j, 'b').shields[0].layers, 2); assert.equal(j.hits.find(h => h.move === 'punch').power, 130, 'layer loss never rewrites queued power');
});

test('V3 annihilation synthesis consumes two real silence shields, awards separate inventory and follows ghost piercing', () => {
  const s = state();
  assert.throws(() => validateAction(s, 'a', a('annihilationShield')), /真实/);
  addShield(s, s.players[0], 'silenceShield'); addShield(s, s.players[0], 'silenceShield');
  const j = battle(s, { a: a('annihilationShield'), b: a('cloudArrow', 'a') });
  assert.equal(get(j, 'a').shields.length, 0, 'full three-layer ghost grade stops whole-ghost piercing and disappears');
  assert.equal(damage(j, 'a'), 0); assert.equal(get(j, 'a').resources.silenceShield, 30);
  assert.equal(get(j, 'a').resources.annihilationShield, 31);
});

test('V3 giant wave uses occupied shield slots and becomes true damage only when strictly pressing its recipient', () => {
  let s = state(); addShield(s, s.players[0], 'ghost').layers = 2; addShield(s, s.players[1], 'foam');
  let j = battle(s, { a: a('giantWave', 'b'), b: a('punch', 'a') });
  assert.equal(damage(j, 'b'), 3); assert.equal(get(j, 'b').shields.length, 1);
  assert.equal(j.damage.find(d => d.target === 'b').trueDamage, true);
  s = state(p('a'), p('b'), p('c')); addShield(s, s.players[1], 'foam');
  j = battle(s, { a: a('giantWave', 'b'), b: a('punch', 'c'), c: a('basicB') });
  assert.equal(damage(j, 'b'), 0); assert.equal(get(j, 'b').shields.length, 0);
});

test('V3 solar counts actual Y actions; zero damage still consumes a shield', () => {
  let s = state(p('a'), p('b'), p('c'));
  let j = battle(s, { a: a('solar'), b: a('basicY'), c: a('basicZ') });
  assert.equal(damage(j, 'b'), 1); assert.equal(damage(j, 'c'), 1);
  s = state(); addShield(s, s.players[1], 'foam');
  j = battle(s, { a: a('solar'), b: a('basicZ') });
  assert.equal(get(j, 'b').shields.length, 0); assert.equal(damage(j, 'b'), 0);
  assert.ok(j.logs.some(e => e.type === 'hit')); assert.equal(j.hasDamage, false);
});

test('V3 recurring group attacks survive without a single locked target', () => {
  const s = state(p('a'), p('b'), p('c'));
  s.ongoing.push({ id: 'o0', source: 'a', action: { move: 'sunStorm' }, start: 1, end: 4 });
  let j = battle(s, { a: a('basicB'), b: a('basicB'), c: a('basicB') });
  assert.equal(damage(j, 'b'), 0.5); assert.equal(j.state.ongoing.length, 1);
  for (let i = 0; i < 3; i++) {
    j = battle(j.state, { a: a('basicB'), b: a('basicB'), c: a('basicB') });
    assert.equal(damage(j, 'b'), 0.5); assert.equal(damage(j, 'c'), 0.5);
  }
  assert.equal(j.state.ongoing.length, 0);
});

test('V3 samadhi fire changes guard by elapsed attack round, not current action', () => {
  let j = battle(state(), { a: a('samadhiFire', 'b'), b: a('basicY') }); assert.equal(damage(j, 'b'), 1);
  j = battle(j.state, { a: a('basicB'), b: a('basicY') }); assert.equal(damage(j, 'b'), 1);
  j = battle(j.state, { a: a('basicB'), b: a('basicY') }); assert.equal(damage(j, 'b'), 0);
  assert.equal(j.state.ongoing.length, 0);
});

test('V3 six mind starts now, keeps digit immunity for 15 inclusive rounds, but intrinsic invulnerability only now', () => {
  let j = battle(state(), { a: a('sixMind'), b: a('punch', 'a') }); assert.equal(damage(j, 'a'), 0);
  assert.deepEqual(get(j, 'a').effects.map(e => [e.start, e.end]), [[1, 15]]);
  j = battle(j.state, { a: a('basicB'), b: a('fiveDarts', 'a') }); assert.equal(damage(j, 'a'), 0);
  j = battle(j.state, { a: a('basicB'), b: a('punch', 'a') }); assert.equal(damage(j, 'a'), 1);
  for (let t = 4; t <= 15; t++) j = battle(j.state, { a: a('basicB'), b: a('basicB') });
  assert.equal(get(j, 'a').effects.length, 0);
  j = battle(j.state, { a: a('basicB'), b: a('fiveDarts', 'a') }); assert.equal(damage(j, 'a'), 5);
});

test('V3 all ghost-grade shields use remaining layers as capacity and share the hit resolver', () => {
  const s = state(); addShield(s, s.players[0], 'annihilationShield');
  const j = battle(s, { a: a('basicB'), b: a('punch', 'a') });
  assert.equal(get(j, 'a').shields.length, 1); assert.equal(get(j, 'a').shields[0].layers, 2);
  assert.equal(shieldSlots(get(j, 'a').shields[0]), 2);
  assert.equal(get(j, 'a').resources.silenceShield, 30, 'inventory is not synthesis material');
});

test('V3 all confirmed moves are enabled', () => {
  assert.ok(Object.values(MOVES).every(m => m.implementationStatus === 'ready'));
});

test('V3 damage curse doubles damage events, including recoil, but never life loss', () => {
  let j = battle(state(), { a: a('damageCurse', 'b'), b: a('basicB') });
  j = battle(j.state, { a: a('punch', 'b'), b: a('basicB') }); assert.equal(damage(j, 'b'), 2);
  j = battle(j.state, { a: a('basicB'), b: a('axi') });
  assert.equal(j.lifeLoss[0].amount, 1); assert.equal(damage(j, 'b'), 0);
  j = battle(j.state, { a: a('basicS'), b: a('meteor') }); assert.equal(damage(j, 'b'), 1, 'recoil is also damage');
  j = battle(j.state, { a: a('basicS'), b: a('meteor') }); assert.equal(damage(j, 'b'), 0.5, 'curse expires after its third active round');
});

test('V3 lightning rod prevents shock without being consumed or protecting other sources', () => {
  const s = state(); addShield(s, s.players[1], 'lightningRod'); addShield(s, s.players[1], 'radar');
  const j = battle(s, { a: a('shock', 'b'), b: a('basicB') });
  assert.equal(get(j, 'b').shields.length, 2);
});

test('V3 new damage curse is next-round control and can be reflected or silenced', () => {
  let j = battle(state(), { a: a('damageCurse', 'b'), b: a('basicB') });
  assert.deepEqual(get(j, 'b').effects.map(e => [e.start, e.end, e.value, e.positive]), [[2, 4, 'damageDouble', false]]);
  j = battle(state(), { a: a('damageCurse', 'b'), b: a('hammer3', 'a') });
  assert.equal(get(j, 'b').effects.length, 0); assert.equal(get(j, 'a').resources.damageCurse, 30);
  j = battle(state(p('a'), p('b'), p('c')), { a: a('damageCurse', 'b'), b: a('sunPunch', 'c'), c: a('basicB') });
  assert.ok(get(j, 'a').effects.some(e => e.move === 'damageCurse')); assert.equal(get(j, 'b').effects.length, 0);
});

test('V3 frogs require legal resources, explode once without paying or gaining stock, and preserve old attacks', () => {
  const poor = p('a'); poor.resources.S = 8;
  assert.throws(() => validateAction(state(poor, p('b')), 'a', a('frogArrival', 'b')), /不足/);
  let j = battle(state(), { a: a('frogArrival', 'b'), b: a('basicB') });
  assert.equal(damage(j, 'b'), 9); assert.equal(get(j, 'a').resources.S, 21);
  const s = state(); s.ongoing.push({ id: 'o0', source: 'a', action: { move: 'skyCannon', targets: ['b'] }, start: 1, end: 3 });
  const original = structuredClone(s);
  j = battle(s, { a: a('frogArrival', 'b'), b: a('frogAbsent') });
  assert.equal(get(j, 'a').hp, 98); assert.equal(get(j, 'a').resources.S, 30); assert.equal(get(j, 'a').resources.frogArrival, 30);
  assert.equal(get(j, 'b').resources.frogAbsent, 31); assert.equal(j.lifeLoss.length, 1); assert.equal(damage(j, 'b'), 1);
  assert.ok(!j.intentions.some(h => h.move === 'frogArrival')); assert.deepEqual(s, original);
});

test('V3 new frog barrier triggers before ordinary spells; silenced frog-absent does not trigger', () => {
  let j = battle(state(), { a: a('frogArrival', 'b'), b: a('frogBarrier') });
  assert.equal(j.lifeLoss.length, 1); assert.equal(get(j, 'b').shields[0].type, 'frogBarrier');
  assert.equal(get(j, 'b').resources.frogAbsent, 26);
  j = battle(state(p('a'), p('b'), p('c')), { a: a('frogArrival', 'c'), b: a('frogAbsent'), c: a('hammer3', 'b') });
  assert.equal(j.lifeLoss.length, 0); assert.equal(get(j, 'a').resources.S, 21); assert.equal(damage(j, 'c'), 9);
  const s = state(p('a'), p('b'), p('c')); addShield(s, s.players[1], 'frogBarrier');
  j = battle(s, { a: a('frogArrival', 'b'), b: a('basicB'), c: a('punch', 'a') });
  assert.equal(damage(j, 'a'), 1); assert.equal(get(j, 'a').hp, 97, 'exploded frog creates no counter-intention');
});

test('V3 himalaya ignores blocked, missed and already immune attacks, then prevents only the first hit segment', () => {
  let j = battle(state(), { a: a('fireWheel', 'b'), b: a('himalaya') });
  assert.equal(damage(j, 'b'), 0.5); assert.equal(get(j, 'a').resources.Y, 29);
  const s = state(); s.players[1].effects.push({ id: 'old', move: 'chainDodge', kind: 'defense', value: 'S', start: 1, end: 1 });
  addShield(s, s.players[1], 'foam');
  j = battle(s, { a: a('fireWheel', 'b'), b: a('himalaya') });
  assert.equal(get(j, 'b').shields.length, 1); assert.equal(damage(j, 'b'), 0); assert.equal(get(j, 'a').resources.Y, 28);
  assert.equal(j.logs.filter(e => e.type === 'block').length, 1);
  const scope = state(p('a'), p('b'), p('c'));
  scope.players[1].effects.push({ id: 'old', move: 'voidDodge', kind: 'scope', start: 1, end: 1 });
  j = battle(scope, { a: a('cloudArrow', 'b'), b: a('himalaya'), c: a('wave') });
  assert.equal(damage(j, 'b'), 0); assert.ok(j.logs.some(e => e.text.includes('喜马拉雅闪')));
  const air = state(p('a'), p('b', { airborne: true }), p('c'));
  j = battle(air, { a: a('sword', 'b'), b: a('himalaya'), c: a('dart', 'b') });
  assert.equal(damage(j, 'b'), 0); assert.equal(j.logs.filter(e => e.type === 'air').length, 1);
});

test('V3 himalaya is cancellable and consumes neither plastic budget nor shield on its immune segment', () => {
  let s = state(); addShield(s, s.players[1], 'plastic');
  let j = battle(s, { a: a('punch', 'b'), b: a('himalaya') });
  assert.equal(get(j, 'b').shields[0].budget, 80);
  j = battle(state(p('a'), p('b'), p('c')), { a: a('hammer3', 'b'), b: a('himalaya'), c: a('fireWheel', 'b') });
  assert.equal(damage(j, 'b'), 2); assert.equal(get(j, 'b').resources.himalaya, 30);
});

test('V3 plastic budget is spent only after defense, stays inside rod and outside ordinary shields, and is unique', () => {
  let s = state(); addShield(s, s.players[1], 'plastic'); addShield(s, s.players[1], 'protectorF');
  let j = battle(s, { a: a('punch', 'b'), b: a('basicB') });
  assert.equal(get(j, 'b').shields.find(s => s.type === 'plastic').budget, 80);
  assert.throws(() => validateAction(s, 'b', a('plastic')), /同时只能/);
  addShield(s, s.players[1], 'plastic'); assert.equal(equipmentLegal(s.players[1].shields), false);
  s = state(); addShield(s, s.players[1], 'plastic'); addShield(s, s.players[1], 'lightningRod'); addShield(s, s.players[1], 'foam');
  j = battle(s, { a: a('arrows'), b: a('basicB') });
  assert.equal(get(j, 'b').shields.some(s => s.type === 'lightningRod'), false);
  assert.equal(get(j, 'b').shields.find(s => s.type === 'plastic').budget, 30);
  assert.ok(get(j, 'b').shields.some(s => s.type === 'foam')); assert.equal(damage(j, 'b'), 0);
  for (let i = 0; i < 3; i++) j = battle(j.state, { a: a('punch', 'b'), b: a('basicB') });
  assert.deepEqual(get(j, 'b').shields.map(s => s.type), ['foam']);
  s = state(); addShield(s, s.players[1], 'plastic');
  j = battle(s, { a: a('ber', 'b'), b: a('basicZ') });
  assert.equal(get(j, 'b').shields[0].budget, 72, '0.8-point attack uses exact tenths, not a rounded integer point');
});

test('V3 plastic blocks over-budget ordinary hits and breaks, while the sword/knife breaking hit continues', () => {
  let s = state(); addShield(s, s.players[1], 'plastic');
  let j = battle(s, { a: a('frogArrival', 'b'), b: a('basicB') });
  assert.equal(damage(j, 'b'), 0); assert.equal(get(j, 'b').shields.length, 0);
  s = state(); addShield(s, s.players[1], 'plastic');
  j = battle(s, { a: a('ghostSword', 'b'), b: a('basicB') }); assert.equal(damage(j, 'b'), 6);
  s = state(); addShield(s, s.players[1], 'plastic'); addShield(s, s.players[1], 'foam');
  j = battle(s, { a: a('ghostSword', 'b'), b: a('basicB') });
  assert.equal(damage(j, 'b'), 0); assert.equal(get(j, 'b').shields.length, 0);
  s = state(); addShield(s, s.players[1], 'plastic').budget = 35; addShield(s, s.players[1], 'foam');
  j = battle(s, { a: a('knife', 'b'), b: a('basicB') });
  assert.equal(damage(j, 'b'), 0.5); assert.deepEqual(get(j, 'b').shields.map(s => s.type), ['foam']);
});

test('V3 void blade snapshots all real shield layers, zero damage strips them, and zero base power accepts bonuses', () => {
  let s = state(); addShield(s, s.players[1], 'ghost').layers = 2; addShield(s, s.players[1], 'foam');
  let j = battle(s, { a: a('voidBlade', 'b'), b: a('basicB') });
  assert.equal(j.hits.length, 3); assert.equal(get(j, 'b').shields.length, 0); assert.equal(damage(j, 'b'), 0);
  s = state(); j = battle(s, { a: a('voidBlade', 'b'), b: a('basicB') });
  assert.equal(j.hits.length, 0); assert.equal(j.intentions[0].power, 0);
  s = state(); addShield(s, s.players[0], 'silenceShield'); addShield(s, s.players[0], 'silenceShield');
  addShield(s, s.players[1], 'foam'); addShield(s, s.players[1], 'foam');
  j = battle(s, { a: a('voidBlade', 'b'), b: a('sword', 'a') });
  assert.equal(j.hits.find(h => h.move === 'voidBlade').power, 80); assert.equal(get(j, 'b').shields.length, 0); assert.equal(damage(j, 'a'), 0);
  s = state(); addShield(s, s.players[1], 'plastic'); addShield(s, s.players[1], 'foam');
  j = battle(s, { a: a('voidBlade', 'b'), b: a('basicB') });
  assert.equal(j.hits.length, 2); assert.equal(get(j, 'b').shields[0].budget, 80); assert.equal(get(j, 'b').shields.length, 2);
});

test('V3 sky dodge transfers at most three healing, raises max HP only as needed, and never replays across blessing continuation', () => {
  const s = state(p('a', { hp: 4, maxHp: 5 }), p('b'));
  s.players[1].resources.Q = 2;
  s.players[1].effects.push({ id: 'curse', move: 'damageCurse', kind: 'curse', value: 'damageDouble', start: 1, end: 1 });
  const original = structuredClone(s);
  let j = beginRound(s, { a: a('skyDodge', 'b'), b: a('basicB') });
  assert.equal(j.pending.kind, 'healTransfer'); assert.deepEqual(j.pending.options.map(o => o.value), [0, 1, 2, 3]);
  assert.throws(() => resumeRound(j, 'b', j.pending.id, '4'), /有效选项/);
  j = resumeRound(JSON.parse(JSON.stringify(j)), 'b', j.pending.id, '2');
  assert.equal(j.pending.kind, 'blessing'); assert.equal(j.pending.events[0].amount, 2); assert.equal(j.pending.events[0].multiplier, 2);
  assert.equal(get(j, 'a').hp, 6); assert.equal(get(j, 'a').maxHp, 6); assert.equal(get(j, 'b').hp, 98);
  const e = j.pending.events[0];
  j = resumeRound(JSON.parse(JSON.stringify(j)), 'b', j.pending.id, { [e.id]: 1 });
  assert.equal(get(j, 'a').hp, 6); assert.equal(get(j, 'b').hp, 96);
  assert.equal(j.damage[0].baseAmount, 2); assert.equal(j.damage[0].blessingSpent, 1); assert.equal(j.damage[0].blessing, 2);
  assert.equal(j.damage[0].finalAmount, 2); assert.equal(get(j, 'b').resources.Q, 1);
  assert.equal(j.lifeLoss.length, 1); assert.equal(j.lifeLoss[0].amount, 2);
  assert.equal(j.logs.filter(e => e.type === 'heal').length, 1); assert.deepEqual(s, original);
});

test('V3 revised sky dodge x=3 leaves zero damage but unavoidable three life loss under curse', () => {
  const s = state(p('a', { hp: 5, maxHp: 5 }), p('b'));
  s.players[1].effects.push({ id: 'curse', move: 'damageCurse', kind: 'curse', value: 'damageDouble', start: 1, end: 1 });
  let j = beginRound(s, { a: a('skyDodge', 'b'), b: a('basicB') });
  j = resumeRound(j, 'b', j.pending.id, '3');
  assert.equal(damage(j, 'b'), 0); assert.equal(get(j, 'b').hp, 97); assert.equal(j.lifeLoss[0].amount, 3);
  assert.equal(get(j, 'a').hp, 8); assert.equal(get(j, 'a').maxHp, 8);
  const shielded = state(); addShield(shielded, shielded.players[1], 'foam');
  j = beginRound(shielded, { a: a('skyDodge', 'b'), b: a('basicB') }); assert.equal(j.status, 'complete'); assert.equal(j.lifeLoss.length, 0);
  j = beginRound(state(), { a: a('skyDodge', 'b'), b: a('himalaya') }); assert.equal(j.status, 'complete'); assert.equal(j.lifeLoss.length, 0);
});

test('V3 current-round negative HP does not stop a later sky-dodge heal or attack', () => {
  const s = state(p('a', { hp: 5, maxHp: 5 }), p('b'), p('c')); addShield(s, s.players[2], 'annihilationShield');
  let j = beginRound(s, { a: a('skyDodge', 'b'), b: a('basicB'), c: a('ghostSword', 'a') });
  assert.equal(j.pending.kind, 'healTransfer'); assert.equal(get(j, 'a').hp, -1);
  j = resumeRound(j, 'b', j.pending.id, '3'); assert.equal(get(j, 'a').hp, 2); assert.equal(damage(j, 'b'), 0); assert.equal(get(j, 'b').hp, 97);
});

test('V3 reflected sky dodge gives the choice to its actual recipient and heals the original source exactly once', () => {
  let j = beginRound(state(p('a', { hp: 5, maxHp: 5 }), p('b'), p('c')), { a: a('skyDodge', 'b'), b: a('tripleKick', 'c'), c: a('basicB') });
  assert.equal(j.pending.kind, 'healTransfer'); assert.equal(j.pending.playerId, 'a'); assert.equal(j.pending.source, 'a');
  j = resumeRound(JSON.parse(JSON.stringify(j)), 'a', j.pending.id, '3');
  assert.equal(get(j, 'a').hp, 5); assert.equal(get(j, 'a').maxHp, 5, 'self life loss happens before self healing');
  assert.equal(damage(j, 'b'), 0); assert.equal(j.logs.filter(e => e.type === 'heal').length, 1);
});

test('V3 revised sky dodge covers x=0..3 and never lets blessing or curse alter its life loss', () => {
  for (const x of [0, 1, 2, 3]) {
    const s = state(p('a', { hp: 5, maxHp: 5 }), p('b'));
    s.players[1].effects.push({ id: 'curse', move: 'damageCurse', kind: 'curse', value: 'damageDouble', start: 1, end: 1 });
    let j = beginRound(s, { a: a('skyDodge', 'b'), b: a('basicB') });
    j = resumeRound(JSON.parse(JSON.stringify(j)), 'b', j.pending.id, String(x));
    assert.equal(damage(j, 'b'), (6 - 2 * x) * 2);
    assert.equal(get(j, 'b').hp, 100 - x - (6 - 2 * x) * 2);
    assert.equal(j.lifeLoss.reduce((sum, e) => sum + e.amount, 0), x);
    assert.equal(get(j, 'a').hp, 5 + x); assert.equal(get(j, 'a').maxHp, 5 + x);
    assert.equal(j.hasLifeLoss, x > 0);
  }
  const s = state(p('a', { hp: 5, maxHp: 5 }), p('b', { hp: 3, maxHp: 5 }));
  s.players[1].resources.Q = 30;
  let j = beginRound(s, { a: a('skyDodge', 'b'), b: a('basicB') });
  j = resumeRound(j, 'b', j.pending.id, '3');
  assert.equal(j.status, 'complete'); assert.equal(get(j, 'b').hp, 0); assert.equal(get(j, 'b').resources.Q, 30);
  assert.equal(j.hasDamage, false); assert.equal(j.hasLifeLoss, true); assert.equal(j.winnerId, 'a');
});

test('V3 blessings pause one event at a time, spend a shared budget, and apply before the curse multiplier', () => {
  const s = state(p('a'), p('b'), p('c')); s.players[1].resources.Q = 2;
  s.players[1].effects.push({ id: 'curse', move: 'damageCurse', kind: 'curse', value: 'damageDouble', start: 1, end: 1 });
  let j = beginRound(s, { a: a('jingXiaoPeng', 'b'), b: a('basicB'), c: a('sword', 'b') });
  assert.equal(j.pending.events.length, 1); assert.equal(j.pending.events[0].move, 'jingXiaoPeng');
  j = resumeRound(j, 'b', j.pending.id, { [j.pending.events[0].id]: 1 });
  assert.equal(get(j, 'b').hp, 98); assert.equal(j.pending.kind, 'blessing'); assert.equal(j.pending.budget, 1);
  assert.equal(j.pending.events[0].move, 'sword');
  j = resumeRound(j, 'b', j.pending.id, { [j.pending.events[0].id]: 1 });
  assert.equal(get(j, 'b').hp, 96); assert.equal(get(j, 'b').resources.Q, 0); assert.equal(j.damage.length, 2);
});

test('V3 sun storm heals immediately after actual damage, respects the cap, and can save a current-round negative source', () => {
  let j = battle(state(p('a', { hp: 4.5, maxHp: 5 }), p('b'), p('c')), { a: a('sunStorm'), b: a('basicB'), c: a('basicB') });
  assert.equal(get(j, 'a').hp, 5); assert.equal(get(j, 'a').maxHp, 5);
  const s = state(p('a', { hp: 2.5, maxHp: 5 }), p('b'), p('c'), p('d'));
  j = beginRound(s, { a: a('sunStorm'), b: a('basicB'), c: a('skyDodge', 'a'), d: a('basicB') });
  assert.equal(j.pending.playerId, 'a'); j = resumeRound(j, 'a', j.pending.id, '3');
  assert.equal(get(j, 'a').hp, 0.5); assert.ok(!j.logs.some(e => e.type === 'death' && e.target === 'a'));
  const flow = j.logs.filter(e => e.type === 'damage' || e.type === 'heal');
  assert.deepEqual(flow.map(e => e.type), ['heal', 'damage', 'damage', 'heal', 'damage', 'heal']);
});

test('V3 dead-source sun storm continues damaging but cannot resurrect a prior-round dead player', () => {
  const s = state(p('a', { hp: 0, maxHp: 5 }), p('b'), p('c'));
  s.ongoing.push({ id: 'o0', source: 'a', action: { move: 'sunStorm' }, start: 1, end: 4 });
  const j = battle(s, { b: a('basicB'), c: a('basicB') });
  assert.equal(get(j, 'a').hp, 0); assert.equal(damage(j, 'b'), 0.5); assert.equal(damage(j, 'c'), 0.5);
});
