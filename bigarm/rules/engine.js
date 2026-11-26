import { MOVES, EQUIPMENT, RESOURCE_NAMES, WEIGHTS, RULE_VERSION } from './catalog.js';
export { MOVES, EQUIPMENT, RESOURCE_NAMES, BASE_RESOURCE_NAMES, WEIGHTS, RULE_VERSION } from './catalog.js';

// A continuation is JSON data. Pure entry points clone their inputs; no I/O or clock.
const clone = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const player = (state, id) => state.players.find(p => p.id === id);
const alive = state => state.players.filter(p => p.hp > 0 && !p.left).sort((a, b) => a.seat - b.seat);
const uid = (state, prefix) => `${prefix}${state.nextId++}`;
const log = (job, type, text, data = {}) => job.logs.push({ id: `r${job.state.round}e${job.logs.length + 1}`, type, text, ...data });
export function createPlayer(id, name = id, seat = 0) {
  return { id, name, seat, hp: 5, maxHp: 5, resources: Object.fromEntries(Object.keys(WEIGHTS).map(k => [k, 0])), shields: [], effects: [], history: [], airborne: false };
}
export function createMatch(players) {
  if (!Array.isArray(players) || players.some(p => typeof p.id !== 'string' || !p.id || !Number.isSafeInteger(p.seat) || p.seat < 0)) fail('玩家需要有效身份和非负整数座位。');
  if (players.length < 2 || new Set(players.map(p => p.id)).size !== players.length || new Set(players.map(p => p.seat)).size !== players.length) fail('需要至少两名身份和座位不重复的玩家。');
  return { version: RULE_VERSION, round: 1, nextId: 1, players: clone(players).sort((a, b) => a.seat - b.seat), ongoing: [] };
}
export function ongoingTargetsRemain(state, effect) {
  return MOVES[effect.action.move].target === 'all'
    ? state.players.some(p => p.id !== effect.source && p.hp > 0 && !p.left)
    : state.players.some(p => p.id === effect.action.targets?.[0] && p.hp > 0 && !p.left);
}
export function validateAction(state, id, action) {
  const p = player(state, id), m = MOVES[action?.move];
  if (!p || p.hp <= 0 || p.left) fail('阵亡玩家不能出招。');
  if (!m) fail('请选择当前版本的有效招式。');
  if (m.implementationStatus !== 'ready') fail('该 V3 招式的判定边界待确认，暂未开放选择。');
  for (const [k, n] of Object.entries(m.cost)) if ((p.resources[k] || 0) < n) fail(`${RESOURCE_NAMES[k]}不足。`);
  if (m.resource === 'C' && p.history.at(-1) === 'C') fail('超闪不能连续两回合使用。');
  if ('SC'.includes(m.resource || '-') && p.history.length >= 2 && p.history.slice(-2).every(k => 'SC'.includes(k))) fail('闪和超闪合计不能连续三回合使用。');
  for (const [type, count] of Object.entries(m.materials || {})) if (p.shields.filter(s => s.type === type).length < count) fail(`需要 ${count} 面真实${EQUIPMENT[type].name}。`);
  const equipment = EQUIPMENT[m.equipment];
  if (equipment?.enforceOnCreate && p.shields.filter(s => s.type === m.equipment).length >= equipment.maxCount) fail(`同时只能持有 ${equipment.maxCount} 面${equipment.name}。`);
  const result = { move: m.id };
  if (m.target === 'dual') {
    if (!Array.isArray(action.targets) || action.targets.length < 1 || action.targets.length > 2 || new Set(action.targets).size !== action.targets.length) fail('地震需要一至两个不同目标。');
    result.targets = [...action.targets];
  } else if (['single', 'splash'].includes(m.target)) result.targets = [action.target ?? (Array.isArray(action.targets) && action.targets.length === 1 ? action.targets[0] : undefined)];
  if (result.targets?.some(t => t === id || !alive(state).some(q => q.id === t))) fail('请选择其他存活玩家。');
  if (m.target === 'path') {
    if (!['clockwise', 'counterclockwise'].includes(action.direction)) fail('请选择回旋镖方向。');
    result.direction = action.direction;
  }
  return result;
}
export function availableMoves(state, id) {
  return Object.values(MOVES).filter(m => {
    const opponents = alive(state).filter(p => p.id !== id);
    const a = { move: m.id, target: opponents[0]?.id, targets: opponents.slice(0, 1).map(p => p.id), direction: 'clockwise' };
    try { validateAction(state, id, a); return true; } catch { return false; }
  });
}
export function addShield(state, p, type) {
  const def = EQUIPMENT[type];
  if (!def) fail('未知装备。');
  const item = { id: uid(state, 's'), type, layers: def.layers || 1, ...(def.budget !== undefined ? { budget: def.budget } : {}) };
  p.shields.push(item); return item;
}
export const shieldSlots = s => EQUIPMENT[s.type].grade === 'ghost' ? s.layers : EQUIPMENT[s.type].slots;
export const shieldLabel = s => EQUIPMENT[s.type].name + (EQUIPMENT[s.type].grade === 'ghost' ? `（${s.layers}层）` : '') + (s.budget !== undefined ? `（余${s.budget / 10}点）` : '');
export function equipmentLegal(shields) {
  const count = type => shields.filter(s => s.type === type).length;
  return shields.reduce((sum, s) => sum + shieldSlots(s), 0) <= 5
    && Object.keys(EQUIPMENT).every(t => count(t) <= (EQUIPMENT[t].maxCount || (EQUIPMENT[t].producer ? 1 : 2)))
    && shields.filter(s => EQUIPMENT[s.type].grade === 'electric').length <= 2
    && shields.filter(s => EQUIPMENT[s.type].producer).length <= 2;
}
function shieldKey(shield) {
  return JSON.stringify(Object.keys(shield).filter(k => k !== 'id').sort().map(k => [k, shield[k]]));
}
function distinctShieldOptions(p, options) {
  const seen = new Set();
  return options.filter(o => { const key = shieldKey(p.shields.find(s => s.id === o.id)); if (seen.has(key)) return false; seen.add(key); return true; });
}
function discardOptions(p) {
  const options = [];
  const seen = new Set();
  // R0 has <=5 slots, one new action creates <=3 more; at most 8 instances.
  for (let mask = 1; mask < 2 ** p.shields.length; mask++) {
    const gone = p.shields.filter((_, i) => mask & 2 ** i), keep = p.shields.filter((_, i) => !(mask & 2 ** i));
    const key = JSON.stringify(keep.map(shieldKey).sort());
    if (equipmentLegal(keep) && gone.every(s => !equipmentLegal([...keep, s])) && !seen.has(key)) { seen.add(key); options.push({ id: gone.map(s => s.id).join(','), label: gone.map(shieldLabel).join('、'), shieldIds: gone.map(s => s.id) }); }
  }
  return options;
}
function request(job, kind, id, options, extra = {}) {
  job.status = 'choice';
  job.pending = { id: uid(job.state, 'c'), kind, playerId: id, options, ...extra };
  return job;
}
function chooseShield(job, p, kind, options, extra) {
  options = distinctShieldOptions(p, options);
  if (options.length === 1) return options[0].id;
  request(job, kind, p.id, options, extra); return null;
}
const activeEffects = (job, p) => p.effects.filter(e => e.start <= job.state.round && e.end >= job.state.round);
function defenses(job, p) {
  return [MOVES[job.actions[p.id]?.move]?.resource || '', ...activeEffects(job, p).filter(e => e.kind === 'defense').map(e => e.value), ...p.shields.map(s => EQUIPMENT[s.type].defense || '')].join('');
}
function controlImmune(job, p, level = 1) { return (job.protection[p.id]?.control || 0) >= level; }
function addEffect(job, target, move, kind, value, start, end, source = target.id) {
  const current = target.effects.find(e => e.move === move && e.kind === kind && e.value === value && e.end >= job.state.round);
  if (current) { current.start = Math.min(current.start, start); current.end = Math.max(current.end, end); return; }
  target.effects.push({ id: uid(job.state, 'e'), move, name: MOVES[move].name, kind, value, source, positive: kind !== 'curse', start, end });
}
function loseLife(job, target, amount, move, source = target.id) {
  target.hp -= amount;
  const entry = { id: uid(job.state, 'l'), target: target.id, amount, move, source };
  job.lifeLoss.push(entry);
  log(job, 'lifeLoss', `${target.name} 因${MOVES[move].name}流失 ${amount} 点体力。`, entry);
}
function shieldInteraction(hit, s) {
  const grade = EQUIPMENT[s.type].grade, isFoam = grade === 'foam' || grade === 'ghost';
  if ((hit.ignore || []).some(g => g === grade || (g === 'foam' && isFoam))) return 'ignore';
  if (!(MOVES[hit.move].pierceExceptions || []).includes(s.type) && (hit.pierce || []).some(g => g === grade || (g === 'foam' && isFoam))) return 'pierce';
  return 'normal';
}
function isImmune(job, p, hit) {
  const ownAction = job.actions[p.id], externalLevel = MOVES[ownAction?.move]?.externalImmunity || 0;
  if (externalLevel > 0 && externalLevel >= (hit.level || 1) && hit.source !== ownAction.targets[0]) return true;
  if ((job.protection[p.id]?.damage || 0) >= (hit.level || 1)) return true;
  if (hit.scope !== 'group' && activeEffects(job, p).some(e => e.kind === 'scope')) return true;
  if (activeEffects(job, p).some(e => e.kind === 'digitWard') && /[零一二三四五六七八九十百千万]/u.test(MOVES[hit.move].name)) return true;
  return p.shields.some(s => {
    if (shieldInteraction(hit, s) !== 'normal') return false;
    const d = EQUIPMENT[s.type];
    return d.immuneAll || (d.immuneResource && MOVES[hit.move].cost[d.immuneResource]) || d.immuneMove === hit.move;
  });
}
function damageMultiplier(job, target) {
  return activeEffects(job, target).some(e => e.kind === 'curse' && e.value === 'damageDouble') ? 2 : 1;
}
function heal(job, target, amount, move, expandMax = false) {
  if (!job.live.includes(target.id)) return; // Prior-round deaths cannot revive; current-round negative HP is allowed.
  const before = target.hp;
  if (expandMax) target.maxHp = Math.max(target.maxHp, target.hp + amount);
  target.hp = Math.min(target.maxHp, target.hp + amount);
  log(job, 'heal', `${target.name} 因${MOVES[move].name}恢复 ${target.hp - before} 生命。`, { target: target.id, move, amount: target.hp - before, maxHp: target.maxHp });
}
function recordDamage(job, target, amount, hit, source = hit.source) {
  const p = player(job.state, target), multiplier = damageMultiplier(job, p), spent = hit.damageBlessing || 0;
  // Keep amount - blessing equal to actual damage for consumers; blessingSpent records resource units.
  const entry = { id: hit.damageId || uid(job.state, 'd'), source, target, move: hit.move, baseAmount: amount, multiplier, amount: amount * multiplier, blessing: spent * multiplier, blessingSpent: spent, trueDamage: !!hit.trueDamage };
  entry.finalAmount = entry.amount - entry.blessing;
  job.damage.push(entry);
  p.hp -= entry.finalAmount;
  log(job, 'damage', `${p.name} 受到 ${entry.finalAmount} 点伤害。`, { ...entry });
  if (MOVES[hit.move].drain && source && entry.finalAmount > 0) heal(job, player(job.state, source), entry.finalAmount, hit.move);
}
function resolveDamage(job, hit) {
  const m = MOVES[hit.move], p = player(job.state, hit.target);
  hit.damageId ||= uid(job.state, 'd');
  if (m.transferHeal && hit.healTransfer === undefined) {
    const reduction = m.transferDamagePerUnit || 1, lifeLoss = m.transferLifeLossPerUnit || 0;
    request(job, 'healTransfer', p.id, Array.from({ length: Math.min(m.transferHealLimit, Math.floor(hit.amount / reduction)) + 1 }, (_, n) => ({ id: String(n), label: `x=${n}：伤害${hit.amount - n * reduction}，流失${n * lifeLoss}，回血${n}`, value: n })), { hitId: hit.id, move: m.id, source: hit.source, amount: hit.amount, reductionPerUnit: reduction, lifeLossPerUnit: lifeLoss });
    return false;
  }
  if (m.transferHeal && !hit.transferApplied) {
    const loss = hit.healTransfer * (m.transferLifeLossPerUnit || 0);
    if (loss > 0) loseLife(job, p, loss, m.id, hit.source);
    heal(job, player(job.state, hit.source), hit.healTransfer, m.id, true);
    hit.transferApplied = true;
  }
  const amount = hit.amount - (hit.healTransfer || 0) * (m.transferDamagePerUnit || 1);
  if (hit.damageBlessing === undefined && amount > 1 && p.resources.Q > 0) {
    request(job, 'blessing', p.id, [], { hitId: hit.id, events: [{ id: hit.damageId, source: hit.source, target: p.id, move: m.id, amount, multiplier: damageMultiplier(job, p), max: Math.ceil(amount) - 1 }], budget: p.resources.Q });
    return false;
  }
  recordDamage(job, p.id, amount, hit);
  hitCallback(job, hit);
  return true;
}
function makeHits(job) {
  const state = job.state, live = job.live.map(id => player(state, id)), ids = [...job.live], batches = [];
  const emit = (source, action, serial, age = 0) => {
    const m = MOVES[action.move];
    let targets = [];
    if (m.target === 'all') targets = ids.filter(id => id !== source);
    else if (m.target === 'path') {
      const i = ids.indexOf(source), step = action.direction === 'clockwise' ? 1 : -1;
      targets = ids.slice(1).map((_, n) => ids[(i + step * (n + 1) + ids.length) % ids.length]);
    } else if (m.target === 'splash') {
      const i = ids.indexOf(action.targets[0]);
      if (i < 0) return;
      targets = [...new Set([ids[i], ids[(i + 1) % ids.length], ids[(i - 1 + ids.length) % ids.length]])].filter(t => t !== source);
    } else targets = action.targets.filter(t => ids.includes(t));
    const bonus = player(state, source).shields.reduce((sum, s) => sum + (EQUIPMENT[s.type].powerBonus || 0) + (EQUIPMENT[s.type].powerPerLayer || 0) * s.layers, 0);
    const power = (m.id === 'quake' && targets.length === 1 ? 150 : m.power) + bonus;
    const hits = [];
    const segmentCount = m.segmentsRule === 'remainingS' ? player(state, source).resources.S : m.segmentsRule === 'targetShieldLayers' ? player(state, targets[0]).shields.reduce((sum, s) => sum + s.layers, 0) : m.damage.length;
    // A zero-segment attack still declares a target and power for mutual-attack comparison.
    for (let segment = 0; segment < Math.max(1, segmentCount); segment++) for (let index = 0; index < targets.length; index++) {
      const target = targets[index], primary = target === action.targets?.[0];
      const hit = { id: uid(state, 'h'), source, target, move: m.id, segment, power: m.target === 'path' ? power + 10 * index : power, amount: m.target === 'splash' && !primary ? 1 : m.damage[segment], scope: m.target === 'all' ? 'group' : m.target === 'dual' && targets.length === 2 ? 'dual' : m.target === 'splash' && !primary ? 'splash' : 'single', air: m.air, trueDamage: !!m.trueDamage, ignore: m.ignore || [], pierce: m.target === 'splash' && !primary ? [] : m.pierce || [] };
      hit.guard = m.guardByRound?.[age] ?? m.guard;
      if (m.segmentsRule) hit.amount = m.damage[0];
      if (!segmentCount) hit.noDamageSegments = true;
      if (m.damageRule === 'roundY') hit.amount = live.filter(p => MOVES[job.actions[p.id].move].resource === 'Y').length;
      if (m.damageRule === 'freeSlots') hit.amount = Math.max(0, 5 - player(state, source).shields.reduce((n, s) => n + shieldSlots(s), 0));
      if (reflects(job, target, 'reflectDamage') && actionTarget(job, target) !== source) {
        hit.originalTarget = target; hit.reflectedBy = target; hit.target = source;
        log(job, 'reflectDamage', `${player(state, target).name} 将${m.name}反射给来源。`, { source, target: source, reflectedBy: target, hitId: hit.id });
      }
      hits.push(hit);
    }
    if (m.target === 'path') hits.forEach((h, n) => batches.push({ power: h.power, seat: player(state, source).seat, serial, part: n, hits: [h] }));
    else batches.push({ power, seat: player(state, source).seat, serial, part: 0, hits });
  };
  let serial = 0;
  for (const ongoing of state.ongoing) if (ongoing.start <= state.round && ongoing.end >= state.round && (MOVES[ongoing.action.move].target === 'all' || ids.includes(ongoing.action.targets[0]))) emit(ongoing.source, ongoing.action, serial++, state.round - ongoing.start);
  for (const p of live) {
    const a = job.actions[p.id], m = MOVES[a.move];
    if (m.type === 'attack' && !m.duration && !m.delay && !job.exploded.includes(p.id)) emit(p.id, a, serial++);
  }
  batches.sort((a, b) => b.power - a.power || a.seat - b.seat || a.serial - b.serial || a.part - b.part);
  const intentions = batches.flatMap(b => b.hits);
  job.intentions = intentions.map(({ source, target, move, power }) => ({ source, target, move, power }));
  job.hits = intentions.filter(h => !h.noDamageSegments);
  const outranks = (counter, hit) => {
    const cm = MOVES[counter.move], hm = MOVES[hit.move];
    if (cm.id === 'ber' && hm.id === 'knife') return true;
    if (hm.id === 'ber' && cm.id === 'knife') return false;
    if (cm.id === 'knifePoint' && hm.id === 'knifePoint') return true;
    if (cm.id === 'knifePoint') return !!hm.cost.B;
    if (hm.id === 'knifePoint') return !cm.cost.B;
    if (hm.fallback) return false;
    return cm.reverseClash || hm.reverseClash ? counter.power <= hit.power : counter.power >= hit.power;
  };
  // Compare immutable intentions, including already executed or subsequently blocked hits.
  for (const h of job.hits) {
    const reverse = job.intentions.filter(c => c.source === h.target && c.target === h.source && h.source !== h.target);
    h.suppressed = reverse.some(c => outranks(c, h));
    h.presses = reverse.some(c => h.power > c.power);
    if (MOVES[h.move].trueWhenPressing && h.presses) h.trueDamage = true;
  }
}
function actionTarget(job, id) { return job.actions[id]?.targets?.[0]; }
function reflects(job, id, kind) { return MOVES[job.actions[id]?.move]?.spell === kind && !job.cancelledSpells.includes(id); }
function controlTargets(job, source, targets) {
  job.controlTargets = Object.assign(Object.create(null), job.controlTargets || {});
  if (!Object.hasOwn(job.controlTargets, source)) job.controlTargets[source] = targets.map(target => {
    if (!reflects(job, target, 'reflectControl') || actionTarget(job, target) === source) return target;
    log(job, 'reflectControl', `${player(job.state, target).name} 将有害法术反射给来源。`, { source, target: source, reflectedBy: target });
    return source;
  });
  return job.controlTargets[source];
}
function hitCallback(job, hit) {
  const m = MOVES[hit.move], target = player(job.state, hit.target), caster = player(job.state, hit.source);
  if (m.onHit === 'gainY') { caster.resources.Y++; log(job, 'gain', `${caster.name} 火轮命中，获得 1 圆盾。`); }
  if (m.onHit === 'ground' && target.airborne && !controlImmune(job, target)) { target.airborne = false; log(job, 'ground', `${target.name} 被打落。`); }
}
function resolveHit(job, hit) {
  const p = player(job.state, hit.target), m = MOVES[hit.move];
  if (!hit.started) {
    if (hit.suppressed) { log(job, 'clash', `${m.name} 对 ${p.name} 被互攻压制或抵消。`, { source: hit.source, target: p.id }); return true; }
    if (!hit.air && p.airborne) { log(job, 'air', `${p.name} 在空中，${m.name} 未命中。`); return true; }
    if (isImmune(job, p, hit)) { log(job, 'immune', `${p.name} 免疫了${m.name}。`); return true; }
    const basic = MOVES[job.actions[p.id]?.move];
    const blocked = m.guardRule === 'exceptDodgeAction' ? !['basicS', 'basicC'].includes(basic?.id)
      : m.guardRule === 'nonBasicAction' ? basic?.type !== 'basic'
      : m.guardRule === 'ZOrSpell' ? defenses(job, p).includes('Z') || !!basic?.hasSpell
      : m.guardRule === 'COrSpell' ? defenses(job, p).includes('C') || !!basic?.hasSpell
      : m.guardRule === 'basicOrAttackOnly' ? !['basic', 'attack'].includes(basic?.type)
      : m.damageRule === 'balance' ? basic?.type !== 'basic'
      : (m.id === 'sixFists' && job.protection[p.id]?.six) || [...defenses(job, p)].some(k => hit.guard.includes(k) && !(m.firstOnly === k && hit.segment > 0));
    if (blocked) {
      log(job, 'block', `${p.name} 防住了${m.name}。`, { source: hit.source, target: p.id });
      if (m.onBlock === 'recoil' && !(job.protection[hit.source]?.damage >= 1)) recordDamage(job, hit.source, 0.5, { ...hit, trueDamage: true }, null);
      return true;
    }
    if (m.damageRule === 'torch' && basic?.resource === 'F') hit.amount = 2;
    if (m.damageRule === 'balance') hit.amount = basic?.resource === 'Z' ? 0.5 : WEIGHTS[basic.resource] / 10;
    if (m.damageRule === 'fiveDarts') hit.amount = basic?.resource === 'S' ? 1 : 'FY'.includes(basic?.resource || '-') ? 3 : 5;
    if (m.damageRule === 'targetAttackFour' && basic?.type === 'attack') hit.amount = 4;
    if (job.protection[p.id]?.firstAttack) {
      job.protection[p.id].firstAttack = false;
      log(job, 'immune', `${p.name} 的喜马拉雅闪免疫了第一段命中攻击。`, { source: hit.source, target: p.id, hitId: hit.id });
      return true;
    }
    hit.started = true;
    log(job, 'hit', `${m.name} 命中 ${p.name}。`, { source: hit.source, target: p.id, hitId: hit.id });
  }
  if (!hit.shieldsResolved) {
    while (true) {
      const candidates = p.shields.filter(s => shieldInteraction(hit, s) !== 'ignore' && (!hit.trueDamage || s.budget !== undefined && hit.power <= s.budget));
      if (!candidates.length) break;
      const position = Math.min(...candidates.map(s => EQUIPMENT[s.type].position));
      const options = candidates.filter(s => EQUIPMENT[s.type].position === position).map(s => ({ id: s.id, label: shieldLabel(s) }));
      const id = hit.selectedShield || chooseShield(job, p, 'shield', options, { hitId: hit.id, move: hit.move });
      if (!id) return false;
      delete hit.selectedShield;
      const shield = p.shields.find(s => s.id === id), interaction = shieldInteraction(hit, shield);
      if (shield.budget !== undefined) {
        const before = shield.budget, exceeded = hit.power > before;
        shield.budget = Math.max(0, before - hit.power);
        const broken = exceeded || shield.budget <= 0;
        if (broken) p.shields = p.shields.filter(s => s.id !== id);
        log(job, 'plastic', `${p.name} 的塑料盾${broken ? '耗尽并消失' : `剩余 ${shield.budget / 10} 点预算`}。`, { target: p.id, shieldId: id, before: before / 10, after: shield.budget / 10, attackPower: hit.power / 10 });
        if (broken && /[剑刀]/u.test(m.name)) continue;
        hitCallback(job, hit); return true;
      }
      const ghost = EQUIPMENT[shield.type].grade === 'ghost';
      const wholeGhost = interaction === 'pierce' && ghost && m.ghostPierce === 'whole';
      const fullGhostStops = wholeGhost && shield.layers === EQUIPMENT[shield.type].layers;
      shield.layers -= wholeGhost ? shield.layers : interaction === 'pierce' && ghost ? 2 : 1;
      if (shield.layers <= 0) p.shields = p.shields.filter(s => s.id !== id);
      log(job, interaction === 'pierce' ? 'pierce' : 'shield', `${p.name} 的${EQUIPMENT[shield.type].name}${shield.layers > 0 ? '损失盾层' : '被消耗'}。`, { shieldId: id, target: p.id });
      if (interaction !== 'pierce' || shield.layers > 0 || fullGhostStops) { hitCallback(job, hit); return true; }
    }
    hit.shieldsResolved = true;
  }
  return resolveDamage(job, hit);
}
function advance(job) {
  job.status = 'running'; job.pending = null;
  job.lifeLoss ||= []; job.cancelledSpells ||= []; job.exploded ||= [];
  while (true) {
    if (job.phase === 'priority') {
      for (const id of job.live) {
        const a = job.actions[id], m = MOVES[a.move];
        if (m.spell !== 'silence') continue;
        const target = player(job.state, a.targets[0]);
        if (controlImmune(job, target, m.controlLevel)) log(job, 'controlImmune', `${target.name} 免疫了锤锤锤的禁法。`, { source: id, target: target.id });
        else {
          if (!job.cancelledSpells.includes(target.id)) job.cancelledSpells.push(target.id);
          log(job, 'silence', `${target.name} 本回合新施放的普通法术被锤锤锤取消。`, { source: id, target: target.id });
        }
      }
      for (const id of job.live) {
        const m = MOVES[job.actions[id].move];
        if (!m.frogExplosion) continue;
        const ward = job.live.some(other => (MOVES[job.actions[other].move].spell === 'frogWard' && !job.cancelledSpells.includes(other)) || player(job.state, other).shields.some(s => EQUIPMENT[s.type].frogWard));
        if (!ward) continue;
        const p = player(job.state, id);
        for (const [key, count] of Object.entries(m.cost)) p.resources[key] += count;
        job.exploded.push(id);
        loseLife(job, p, 2, m.id);
        log(job, 'explosion', `${p.name} 的${m.name}自爆：免付本招成本，本次攻击和库存收益取消。`, { target: id, move: m.id });
      }
      for (const id of job.live) {
        const p = player(job.state, id), m = MOVES[job.actions[id].move];
        if (job.exploded.includes(id) || m.type === 'basic' || m.spell && m.spell !== 'silence' && job.cancelledSpells.includes(id)) continue;
        p.resources[m.id] = (p.resources[m.id] || 0) + 1;
        log(job, 'stock', `${p.name} 获得 1 个${m.name}招式资源。`, { target: id, resource: m.id, amount: 1 });
      }
      job.phase = 'spells'; job.cursor = 0; continue;
    }
    if (job.phase === 'spells') {
      const id = job.live[job.cursor];
      if (!id) { makeHits(job); job.phase = 'hits'; job.cursor = 0; continue; }
      const p = player(job.state, id), a = job.actions[id], m = MOVES[a.move], t = job.state.round;
      if (job.exploded.includes(id) || m.spell && m.spell !== 'silence' && job.cancelledSpells.includes(id)) {
        log(job, 'spellCancelled', `${p.name} 的${m.name}法术组件未生效。`, { source: id, move: m.id });
        job.cursor++; continue;
      }
      if (['shock', 'curse', 'damageCurse'].includes(m.spell)) {
        const targets = controlTargets(job, id, a.targets);
        job.controlCursor ||= 0;
        while (job.controlCursor < targets.length) {
          const target = player(job.state, targets[job.controlCursor]);
          if (controlImmune(job, target, m.controlLevel || 1)) {
            log(job, 'controlImmune', `${target.name} 免疫了${m.name}。`, { source: id, target: target.id });
          } else if (m.spell === 'shock') {
            if (target.shields.some(s => EQUIPMENT[s.type].immuneShock)) {
              log(job, 'controlImmune', `${target.name} 的避雷针免疫了小电。`, { source: id, target: target.id });
              job.controlCursor++; continue;
            }
            const options = target.shields.filter(s => EQUIPMENT[s.type].electric).map(s => ({ id: s.id, label: EQUIPMENT[s.type].name }));
            if (options.length) {
              const selected = job.spellShield || chooseShield(job, target, 'shock', options, { source: id });
              if (!selected) return job;
              delete job.spellShield; target.shields = target.shields.filter(s => s.id !== selected);
              log(job, 'shock', `${target.name} 的一件装备被小电移除。`, { target: target.id, shieldId: selected });
            }
          } else {
            addEffect(job, target, m.id, 'curse', m.spell === 'curse' ? 'dodgeLifeLoss' : 'damageDouble', t + 1, t + m.duration, id);
            log(job, 'status', `${target.name} 将从下一回合进入${m.name}状态。`, { source: id, target: target.id, move: m.id });
          }
          job.controlCursor++;
        }
        job.controlCursor = 0;
      }
      if (m.spell === 'blessing') { p.resources.Q += 3; log(job, 'gain', `${p.name} 获得 3 祝福值。`); }
      if (m.spell === 'heal') heal(job, p, 1, m.id);
      const statusStart = t + (m.statusStartOffset ?? 1);
      if (m.spell === 'defense') addEffect(job, p, m.id, 'defense', m.defense, statusStart, statusStart + m.duration - 1);
      if (m.spell === 'void') {
        addEffect(job, p, m.id, 'defense', 'C', statusStart, statusStart);
        addEffect(job, p, m.id, 'scope', null, statusStart, statusStart + 2);
      }
      if (m.spell === 'guardSix') job.protection[id].six = true;
      if (m.spell === 'digitWard') addEffect(job, p, m.id, 'digitWard', null, statusStart, statusStart + m.duration - 1);
      if (m.spell === 'firstAttack') job.protection[id].firstAttack = true;
      job.cursor++; continue;
    }
    if (job.phase === 'hits') {
      const h = job.hits[job.cursor];
      if (h) { if (!resolveHit(job, h)) return job; job.cursor++; continue; }
      job.phase = 'finalize'; job.cursor = 0; continue;
    }
    if (job.phase === 'finalize') {
      for (const p of job.state.players) if (p.hp <= 0) log(job, 'death', `${p.name} 阵亡。`, { target: p.id });
      job.state.ongoing = job.state.ongoing.filter(e => ongoingTargetsRemain(job.state, e));
      job.phase = 'discard'; job.cursor = 0; continue;
    }
    if (job.phase === 'discard') {
      const p = job.state.players[job.cursor];
      if (p) {
        if (p.hp > 0 && !equipmentLegal(p.shields)) {
          const options = discardOptions(p);
          if (options.length > 1) return request(job, 'discard', p.id, options);
          p.shields = p.shields.filter(s => !options[0].shieldIds.includes(s.id));
          log(job, 'discard', `${p.name} 弃置 ${options[0].label}。`);
        }
        job.cursor++; continue;
      }
      const survivors = alive(job.state);
      job.finished = survivors.length <= 1; job.winnerId = job.finished && survivors.length ? survivors[0].id : null;
      job.hasDamage = job.damage.some(d => d.amount > d.blessing);
      job.hasLifeLoss = job.lifeLoss.length > 0;
      job.completedRound = job.state.round;
      job.state.round++;
      for (const p of job.state.players) p.effects = p.effects.filter(e => e.end >= job.state.round);
      job.state.ongoing = job.state.ongoing.filter(e => e.end >= job.state.round);
      job.phase = 'done'; job.status = 'complete'; return job;
    }
    fail('无效的判定阶段。');
  }
}
export function beginRound(input, submitted) {
  const actions = Object.fromEntries(alive(input).map(p => [p.id, validateAction(input, p.id, submitted[p.id])]));
  const state = clone(input);
  state.players.sort((a, b) => a.seat - b.seat);
  state.ongoing.sort((a, b) => a.start - b.start || Number(a.id.slice(1)) - Number(b.id.slice(1)) || a.id.localeCompare(b.id));
  const live = alive(state);
  const job = { state, actions, live: live.map(p => p.id), protection: Object.fromEntries(live.map(p => [p.id, null])), logs: [], damage: [], lifeLoss: [], hits: [], exploded: [], cancelledSpells: [], phase: 'priority', cursor: 0, status: 'running', pending: null };
  for (const p of live) {
    const resource = MOVES[actions[p.id].move].resource;
    const broken = p.shields.filter(s => resource && EQUIPMENT[s.type].breakOnResource === resource);
    if (broken.length) {
      p.shields = p.shields.filter(s => !broken.includes(s));
      for (const shield of broken) log(job, 'protectorExpired', `${p.name} 实际出${RESOURCE_NAMES[resource]}，${EQUIPMENT[shield.type].name}在回合开始消失。`, { target: p.id, shieldId: shield.id });
    }
  }
  // Fix the round participants before unavoidable life loss; death is still decided at round end.
  for (const p of live) {
    const m = MOVES[actions[p.id].move];
    if (m.lifeCost) loseLife(job, p, m.lifeCost, m.id);
    if ('SC'.includes(m.resource || '-')) for (const e of activeEffects(job, p)) {
      if (e.kind === 'curse' && e.value === 'dodgeLifeLoss') loseLife(job, p, 2, e.move, e.source);
    }
  }
  for (const p of live) {
    const a = actions[p.id], m = MOVES[a.move];
    for (const [key, n] of Object.entries(m.cost)) p.resources[key] -= n;
    job.protection[p.id] = { damage: m.immunity || 0, control: m.controlImmunity || 0 };
    if (m.type === 'basic') {
      const amount = p.shields.some(s => EQUIPMENT[s.type].producer === m.resource) ? 3 : 1;
      p.resources[m.resource] += amount;
      log(job, 'gain', `${p.name} 获得 ${amount} ${RESOURCE_NAMES[m.resource]}。`);
    }
    p.history = [...p.history, m.resource || '-'].slice(-2);
    if (m.equipment) {
      for (const [type, count] of Object.entries(m.materials || {})) {
        const ids = p.shields.filter(s => s.type === type).slice(0, count).map(s => s.id);
        p.shields = p.shields.filter(s => !ids.includes(s.id));
      }
      addShield(state, p, m.equipment);
    }
    if (m.type === 'attack' && (m.duration || m.delay)) {
      const start = state.round + (m.delay || 0);
      state.ongoing.push({ id: uid(state, 'o'), source: p.id, action: clone(a), start, end: start + (m.duration || 1) - 1 });
    }
  }
  return advance(job);
}
export function resumeRound(input, playerId, requestId, answer) {
  if (input.status !== 'choice' || input.pending?.id !== requestId || input.pending.playerId !== playerId) fail('选择已过期或不属于你。');
  const job = clone(input), p = player(job.state, playerId), pending = job.pending;
  if (pending.kind === 'blessing') {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer) || Object.keys(answer).some(k => !pending.events.some(e => e.id === k))) fail('无效的减伤分配。');
    let total = 0;
    for (const e of pending.events) { const n = answer[e.id] ?? 0; if (!Number.isSafeInteger(n) || n < 0 || n > e.max) fail('每次减伤必须为整数且最终伤害大于零。'); total += n; }
    if (total > p.resources.Q) fail('祝福值不足。');
    p.resources.Q -= total;
    job.hits[job.cursor].damageBlessing = total;
  } else {
    const selected = pending.options.find(o => o.id === answer);
    if (!selected) fail('请选择当前有效选项。');
    if (pending.kind === 'shock') job.spellShield = selected.id;
    if (pending.kind === 'shield') job.hits[job.cursor].selectedShield = selected.id;
    if (pending.kind === 'healTransfer') job.hits[job.cursor].healTransfer = selected.value;
    if (pending.kind === 'discard') { p.shields = p.shields.filter(s => !selected.shieldIds.includes(s.id)); log(job, 'discard', `${p.name} 弃置 ${selected.label}。`); }
  }
  return advance(job);
}
