import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, EQUIPMENT, WEIGHTS, createPlayer, createMatch, beginRound, resumeRound, validateAction, addShield, equipmentLegal, availableMoves } from '../rules/engine.js';

const p = (id, overrides = {}) => ({ ...createPlayer(id, id.toUpperCase(), id.charCodeAt(0) - 97), resources: { ...Object.fromEntries(Object.keys(WEIGHTS).map(k => [k, 30])), Q: 0 }, ...overrides });
const a = (move, target, extra = {}) => ({ move, target, ...extra });
const state = (...players) => createMatch(players);
const get = (job, id) => job.state.players.find(p => p.id === id);
function finish(job) {
  let steps = 0;
  while (job.status === 'choice') {
    assert.ok(steps++ < 100, 'continuations terminate');
    job = resumeRound(job, job.pending.playerId, job.pending.id, job.pending.kind === 'blessing' ? {} : job.pending.options[0].id);
  }
  return job;
}
const battle = (s, actions) => finish(beginRound(s, actions));
const pair = (x, y, players = [p('a'), p('b')]) => battle(state(...players), { a: x, b: y });
const damage = (job, id) => job.damage.filter(d => d.target === id).reduce((sum, d) => sum + d.amount - d.blessing, 0);

test('current catalog: 68 actions, removed moves absent, exact integer power', () => {
  assert.deepEqual(Object.values(MOVES).reduce((r, m) => ({ ...r, [m.type]: (r[m.type] || 0) + 1 }), {}), { basic: 6, attack: 41, equipment: 11, spell: 10 });
  assert.equal(MOVES.phoenix.power, 200); assert.equal(MOVES.balance.power, 113);
  assert.equal(MOVES.skyCannon.power, 53); assert.equal(MOVES.sickle.power, 16);
  for (const name of ['锤', '幽灵回旋镖', '打断']) assert.ok(!Object.values(MOVES).some(m => m.name === name));
});
test('T01–T03: point comparison, equal cancellation, local group suppression', () => {
  let j = pair(a('sword', 'b'), a('punch', 'a')); assert.equal(damage(j, 'a'), 0); assert.equal(damage(j, 'b'), 2);
  j = pair(a('sword', 'b'), a('sword', 'a')); assert.equal(j.damage.length, 0);
  j = battle(state(p('a'), p('b'), p('c')), { a: a('wave'), b: a('sword', 'a'), c: a('basicB') });
  assert.equal(damage(j, 'a'), 0); assert.equal(damage(j, 'b'), 1); assert.equal(damage(j, 'c'), 1);
});
test('T04–T08: ber, knife fallback/true damage, ingredient clash, balance', () => {
  let j = pair(a('ber', 'b'), a('knife', 'a')); assert.equal(damage(j, 'a'), 0); assert.equal(damage(j, 'b'), 1);
  j = pair(a('knife', 'b'), a('comboPunch', 'a')); assert.equal(damage(j, 'a'), 3); assert.equal(damage(j, 'b'), 0.5);
  const s = state(p('a'), p('b')); addShield(s, s.players[1], 'foam');
  j = pair(a('knife', 'b'), a('basicZ'), s.players); assert.equal(damage(j, 'b'), 0.5); assert.equal(get(j, 'b').shields.length, 1);
  j = pair(a('knifePoint', 'b'), a('punch', 'a')); assert.equal(damage(j, 'a'), 0); assert.equal(damage(j, 'b'), 2);
  j = pair(a('balance', 'b'), a('punch', 'a')); assert.equal(j.damage.length, 0);
  j = pair(a('knifePoint', 'b'), a('knife', 'a')); assert.equal(damage(j, 'b'), 0); assert.equal(damage(j, 'a'), 0.5);
});
test('T09: S blocks only first wheel segment; ordinary guard covers unlimited matching hits', () => {
  const j = pair(a('fireWheel', 'b'), a('basicS')); assert.equal(damage(j, 'b'), 0.5); assert.equal(get(j, 'a').resources.Y, 29);
  assert.equal(get(j, 'b').resources.S, 31);
  assert.equal(pair(a('fireWheel', 'b'), a('basicC')).damage.length, 0);
});
test('T10–T12: one shield per damage event, ghost capacity decreases with layers', () => {
  for (const move of ['fireWheel', 'arrows']) {
    const s = state(p('a'), p('b')); addShield(s, s.players[1], 'foam'); addShield(s, s.players[1], 'foam');
    const j = pair(a(move, 'b'), a('basicB'), s.players);
    assert.equal(damage(j, 'b'), 0); assert.equal(get(j, 'b').shields.length, 0);
    if (move === 'fireWheel') assert.equal(get(j, 'a').resources.Y, 30);
  }
  const s = state(p('a'), p('b')); addShield(s, s.players[1], 'ghost');
  const j = pair(a('punch', 'b'), a('basicB'), s.players); assert.equal(get(j, 'b').shields[0].layers, 2); assert.equal(damage(j, 'b'), 0);
});
test('T13–T16: radar ignore, shock before attacks, phoenix independent gain, elemental immunity', () => {
  const s = state(p('a'), p('b')); addShield(s, s.players[1], 'radar');
  let j = pair(a('sixFists', 'b'), a('basicB'), s.players); assert.equal(get(j, 'b').hp, -2); assert.equal(get(j, 'b').shields.length, 1); assert.equal(j.winnerId, 'a');
  j = pair(a('phoenix'), a('basicC')); assert.equal(damage(j, 'b'), 0); assert.equal(get(j, 'a').resources.Q, 3);
  const q = state(p('a'), p('b')); addShield(q, q.players[1], 'ocean');
  j = pair(a('sixFists', 'b'), a('basicB'), q.players); assert.equal(damage(j, 'b'), 0); assert.equal(get(j, 'b').shields.length, 1);
  const r = state(p('a'), p('b'), p('c')); addShield(r, r.players[1], 'lightning');
  j = battle(r, { a: a('shock', 'b'), b: a('basicB'), c: a('arrows') }); assert.equal(damage(j, 'b'), 1.5); assert.equal(damage(j, 'a'), 0);
});
test('T17–T19, T36: duration includes cast, independent old/new attacks, all boomerang singles sorted', () => {
  let j = pair(a('skyCannon', 'b'), a('basicB')); assert.equal(damage(j, 'b'), 1); assert.equal(j.state.ongoing[0].end, 3);
  j = battle(j.state, { a: a('punch', 'b'), b: a('basicB') }); assert.equal(damage(j, 'b'), 2);
  j = battle(j.state, { a: a('basicB'), b: a('basicB') }); assert.equal(damage(j, 'b'), 1); assert.equal(j.state.ongoing.length, 0);
  const s = state(p('a'), p('b'), p('c'), p('d'));
  j = battle(s, { a: a('boomerang', null, { direction: 'clockwise' }), b: a('basicB'), c: a('basicB'), d: a('basicB') });
  assert.deepEqual(j.hits.map(h => [h.target, h.power]), [['d', 50], ['c', 40], ['b', 30]]);
});
test('T24–T28: per-event integer blessing, capped healing, simultaneous death', () => {
  let j = pair(a('heal'), a('punch', 'a'), [p('a', { hp: 1 }), p('b')]); assert.equal(get(j, 'a').hp, 1);
  j = pair(a('heal'), a('sword', 'a')); assert.equal(get(j, 'a').hp, 3);
  j = pair(a('sword', 'b'), a('basicB'), [p('a'), p('b', { resources: { ...p('b').resources, Q: 2 } })]);
  assert.equal(damage(j, 'b'), 2); // default choice spends zero
  let pending = beginRound(state(p('a'), p('b', { resources: { ...p('b').resources, Q: 2 } })), { a: a('sword', 'b'), b: a('basicB') });
  const e = pending.pending.events[0];
  assert.throws(() => resumeRound(pending, 'b', pending.pending.id, { [e.id]: 2 }), /大于零/);
  assert.throws(() => resumeRound(pending, 'b', pending.pending.id, { [e.id]: 0.5 }), /整数/);
  pending = resumeRound(pending, 'b', pending.pending.id, { [e.id]: 1 }); assert.equal(get(pending, 'b').hp, 4); assert.equal(get(pending, 'b').resources.Q, 1);
  j = battle(state(p('a', { hp: 1 }), p('b', { hp: 1 }), p('c', { hp: 1 })), { a: a('punch', 'b'), b: a('punch', 'c'), c: a('punch', 'a') });
  assert.equal(j.finished, true); assert.equal(j.winnerId, null);
});
test('T34–T35: new shield can be shocked; recoil is separate half-damage events', () => {
  let j = battle(state(p('a'), p('b'), p('c')), { a: a('shock', 'b'), b: a('thunder'), c: a('skyCannon', 'b') }); assert.equal(damage(j, 'b'), 1);
  j = battle(state(p('a', { resources: { ...p('a').resources, Q: 1 } }), p('b'), p('c'), p('d')), { a: a('meteor'), b: a('basicS'), c: a('basicS'), d: a('basicS') });
  assert.deepEqual(j.damage.map(d => d.amount), [0.5, 0.5, 0.5]); assert.equal(get(j, 'a').resources.Q, 1);
});
test('T39–T40: three ghost layers block pierced hit, two layers pass through to health', () => {
  for (const layers of [3, 2, 1]) {
    const s = state(p('a'), p('b')); addShield(s, s.players[1], 'ghost').layers = layers;
    const j = pair(a('tsunami'), a('basicB'), s.players); assert.equal(damage(j, 'b'), layers === 3 ? 0 : 1);
  }
});
test('T42–T46: equivalent defenses count, no reflections, void scope persists separately', () => {
  const b = p('b'); b.effects.push({ id: 'old', kind: 'defense', value: 'C', start: 1, end: 2 });
  let j = pair(a('meteor'), a('basicB'), [p('a'), b]); assert.equal(damage(j, 'a'), 0.5);
  j = battle(state(p('a'), p('b'), p('c')), { a: a('tripleKick', 'b'), b: a('basicB'), c: a('punch', 'a') }); assert.equal(damage(j, 'a'), 1); assert.equal(damage(j, 'b'), 2); assert.equal(damage(j, 'c'), 0);
  const s = state(p('a'), p('b'), p('c')); addShield(s, s.players[0], 'radar');
  j = battle(s, { a: a('sunPunch', 'b'), b: a('basicB'), c: a('shock', 'a') }); assert.equal(get(j, 'a').shields.length, 0); assert.equal(damage(j, 'b'), 1);
  const voidPlayer = p('b'); voidPlayer.effects.push({ id: 'oldVoid', kind: 'scope', start: 0, end: 2 });
  j = pair(a('boomerang', null, { direction: 'clockwise' }), a('basicB'), [p('a'), voidPlayer]); assert.equal(damage(j, 'b'), 0);
  j = pair(a('wave'), a('basicB'), [p('a'), voidPlayer]); assert.equal(damage(j, 'b'), 1);
});
test('T47–T51: removed/self/duplicate/invalid inputs rejected; dead source continues, dead target removed', () => {
  const s = state(p('a'), p('b'));
  for (const move of ['hammer', 'ghostBoomerang', '__proto__']) assert.throws(() => validateAction(s, 'a', a(move, 'b')));
  assert.throws(() => validateAction(s, 'a', a('shock', 'a')));
  assert.throws(() => validateAction(s, 'a', a('quake', null, { targets: ['b', 'b'] })));
  assert.throws(() => validateAction(s, 'a', a('punch', 'missing')));
  let j = pair(a('skyCannon', 'b'), a('basicB')); get(j, 'a').hp = 0; j.finished = false;
  j = battle(j.state, { b: a('basicB') }); assert.equal(damage(j, 'b'), 1);
  j = pair(a('skyCannon', 'b'), a('basicB'), [p('a'), p('b', { hp: 1 })]); assert.equal(j.state.ongoing.length, 0);
});
test('choice continuation is pure, serializable, authorized and never double-pays or double-fires', () => {
  const s = state(p('a'), p('b')); addShield(s, s.players[1], 'foam'); addShield(s, s.players[1], 'ghost');
  const original = clone(s), job = beginRound(s, { a: a('fireWheel', 'b'), b: a('basicB') });
  assert.deepEqual(s, original); assert.equal(job.status, 'choice');
  assert.throws(() => resumeRound(job, 'a', job.pending.id, job.pending.options[0].id), /不属于你/);
  assert.throws(() => resumeRound(job, 'b', 'stale', job.pending.options[0].id), /过期/);
  const snapshot = clone(job), result = finish(JSON.parse(JSON.stringify(job)));
  assert.deepEqual(job, snapshot); assert.equal(get(result, 'a').resources.Y, 30); // 30 - 2 + 2
  assert.equal(result.logs.filter(l => l.type === 'hit').length, 2);
});
test('validated canonical actions can be stored and passed directly to the resolver', () => {
  const s = state(p('a'), p('b'));
  const actions = { a: validateAction(s, 'a', a('punch', 'b')), b: validateAction(s, 'b', a('basicB')) };
  assert.deepEqual(actions.a, { move: 'punch', targets: ['b'] });
  assert.equal(damage(battle(s, actions), 'b'), 1);
});
test('equipment overflow waits until after damage/death, options are inclusion-minimal', () => {
  const s = state(p('a'), p('b')); for (const type of ['foam', 'foam', 'producerB', 'lightning']) addShield(s, s.players[0], type);
  const j = beginRound(s, { a: a('ocean'), b: a('basicB') }); assert.equal(j.pending.kind, 'discard');
  const owner = get(j, 'a');
  for (const option of j.pending.options) {
    const gone = owner.shields.filter(s => option.shieldIds.includes(s.id)), kept = owner.shields.filter(s => !option.shieldIds.includes(s.id));
    assert.ok(equipmentLegal(kept)); assert.ok(gone.every(s => !equipmentLegal([...kept, s])));
  }
  assert.ok(equipmentLegal(get(finish(j), 'a').shields));
});
test('consecutive dodge restriction counts actions only; producers and ghost synthesis', () => {
  const b = p('b', { history: ['S', 'C'] }), s = state(p('a'), b);
  assert.throws(() => validateAction(s, 'b', a('basicC')), /连续/);
  assert.throws(() => validateAction(s, 'b', a('basicS')), /连续/);
  assert.ok(validateAction(s, 'b', a('ghostDodge')));
  assert.ok(!availableMoves(s, 'b').some(m => m.id === 'basicS'));
  const t = state(p('a'), p('b')); addShield(t, t.players[0], 'producerF');
  assert.equal(get(pair(a('basicF'), a('basicB'), t.players), 'a').resources.F, 33);
  const u = state(p('a'), p('b')); addShield(u, u.players[0], 'foam'); addShield(u, u.players[0], 'foam');
  const j = pair(a('ghost'), a('punch', 'a'), u.players); assert.equal(get(j, 'a').shields[0].type, 'ghost'); assert.equal(get(j, 'a').shields[0].layers, 2);
});
test('all declared moves run through the same resolver without mutating input', () => {
  for (const m of Object.values(MOVES)) {
    const s = state(p('a', { resources: { ...p('a').resources, Q: 5 } }), p('b'), p('c'));
    if (m.id === 'ghost') { addShield(s, s.players[0], 'foam'); addShield(s, s.players[0], 'foam'); }
    const input = clone(s);
    const j = battle(s, { a: a(m.id, 'b', { targets: ['b'], direction: 'clockwise' }), b: a('basicB'), c: a('basicB') });
    assert.equal(j.status, 'complete', m.id); assert.deepEqual(s, input, m.id);
    assert.ok(j.state.players.every(p => Object.values(p.resources).every(n => Number.isSafeInteger(n) && n >= 0)), m.id);
  }
});
test('torch, concentrated quake, splash de-duplication and balance resource damage', () => {
  assert.equal(damage(pair(a('torch', 'b'), a('basicF')), 'b'), 2);
  const j = pair(a('quake', null, { targets: ['b'] }), a('basicB'));
  assert.equal(j.hits[0].power, 150); assert.equal(damage(j, 'b'), 1);
  for (const [resource, amount] of [['B', 1], ['Z', 0.5], ['F', 1.5], ['Y', 2], ['S', 2.5], ['C', 3.5]]) {
    assert.equal(damage(pair(a('balance', 'b'), a(`basic${resource}`)), 'b'), amount);
  }
  const flame = pair(a('phoenixFlame', 'b'), a('basicB'), [p('a', { resources: { ...p('a').resources, Q: 2 } }), p('b')]);
  assert.equal(flame.hits.length, 1); assert.equal(damage(flame, 'a'), 0); assert.equal(damage(flame, 'b'), 2);
});
test('piercing beats matching element, ignore preserves shields, all directions precompute points', () => {
  const s = state(p('a'), p('b')); addShield(s, s.players[1], 'lightning'); addShield(s, s.players[1], 'foam');
  let j = pair(a('quake', null, { targets: ['b'] }), a('basicB'), s.players);
  assert.equal(get(j, 'b').shields.length, 0); assert.equal(damage(j, 'b'), 1);
  const t = state(p('a'), p('b')); addShield(t, t.players[1], 'flame');
  j = pair(a('staff'), a('basicB'), t.players); assert.equal(damage(j, 'b'), 2); assert.equal(get(j, 'b').shields.length, 1);
  j = battle(state(p('a'), p('b'), p('c'), p('d')), { a: a('boomerang', null, { direction: 'counterclockwise' }), b: a('basicB'), c: a('basicB'), d: a('basicB') });
  assert.deepEqual(j.hits.map(h => [h.target, h.power]), [['b', 50], ['c', 40], ['d', 30]]);
});
test('seats determine results regardless of player input order; status expiry and IDs are safe', () => {
  const s = state(p('a'), p('b'), p('c')), actions = { a: a('wave'), b: a('punch', 'a'), c: a('basicB') };
  const expected = battle(s, actions), reversed = clone(s); reversed.players.reverse();
  assert.deepEqual(battle(reversed, actions), expected);
  let j = pair(a('voidDodge'), a('basicB')); assert.equal(get(j, 'a').effects.filter(e => e.kind === 'defense').length, 1); assert.equal(get(j, 'a').effects.find(e => e.kind === 'scope').end, 4);
  j = battle(j.state, { a: a('basicB'), b: a('basicB') });
  j = battle(j.state, { a: a('basicB'), b: a('basicB') }); assert.equal(get(j, 'a').effects.length, 1);
  j = battle(j.state, { a: a('basicB'), b: a('basicB') }); assert.equal(get(j, 'a').effects.length, 0);
  const x = createPlayer('__proto__', '特殊身份', 0), y = createPlayer('other', '其他', 1);
  const job = beginRound(createMatch([x, y]), Object.fromEntries([['__proto__', { move: 'basicB' }], ['other', { move: 'basicB' }]]));
  assert.equal(get(job, '__proto__').resources.B, 1);
});
test('small electric obeys control immunity while all current intrinsic protection is active', () => {
  const s = state(p('a'), p('b')); addShield(s, s.players[1], 'radar');
  const j = pair(a('shock', 'b'), a('thunderDodge'), s.players);
  assert.equal(get(j, 'b').shields.length, 1); assert.equal(j.damage.length, 0);
});
function clone(x) { return structuredClone(x); }
