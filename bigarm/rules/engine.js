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
export function validateAction(state, id, action) {
  const p = player(state, id), m = MOVES[action?.move];
  if (!p || p.hp <= 0 || p.left) fail('阵亡玩家不能出招。');
  if (!m) fail('请选择当前版本的有效招式。');
  for (const [k, n] of Object.entries(m.cost)) if ((p.resources[k] || 0) < n) fail(`${RESOURCE_NAMES[k]}不足。`);
  if (m.resource === 'C' && p.history.at(-1) === 'C') fail('超闪不能连续两回合使用。');
  if ('SC'.includes(m.resource || '-') && p.history.length >= 2 && p.history.slice(-2).every(k => 'SC'.includes(k))) fail('闪和超闪合计不能连续三回合使用。');
  for (const [type, count] of Object.entries(m.materials || {})) if (p.shields.filter(s => s.type === type).length < count) fail(`需要 ${count} 面真实${EQUIPMENT[type].name}。`);
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
  const item = { id: uid(state, 's'), type, layers: def.layers || 1 };
  p.shields.push(item); return item;
}
export const shieldSlots = s => s.type === 'ghost' ? s.layers : EQUIPMENT[s.type].slots;
export function equipmentLegal(shields) {
  const count = type => shields.filter(s => s.type === type).length;
  return shields.reduce((sum, s) => sum + shieldSlots(s), 0) <= 5
    && Object.keys(EQUIPMENT).every(t => count(t) <= (EQUIPMENT[t].producer ? 1 : 2))
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
    if (equipmentLegal(keep) && gone.every(s => !equipmentLegal([...keep, s])) && !seen.has(key)) { seen.add(key); options.push({ id: gone.map(s => s.id).join(','), label: gone.map(s => EQUIPMENT[s.type].name + (s.type === 'ghost' ? `（${s.layers}层）` : '')).join('、'), shieldIds: gone.map(s => s.id) }); }
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
  return [MOVES[job.actions[p.id]?.move]?.resource || '', ...activeEffects(job, p).filter(e => e.kind === 'defense').map(e => e.value)].join('');
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
  if ((job.protection[p.id]?.damage || 0) >= (hit.level || 1)) return true;
  if (hit.scope !== 'group' && activeEffects(job, p).some(e => e.kind === 'scope')) return true;
  return p.shields.some(s => {
    if (shieldInteraction(hit, s) !== 'normal') return false;
    const d = EQUIPMENT[s.type];
    return d.immuneAll || (d.immuneResource && MOVES[hit.move].cost[d.immuneResource]) || d.immuneMove === hit.move;
  });
}
function recordDamage(job, target, amount, hit, source = hit.source) {
  const entry = { id: uid(job.state, 'd'), source, target, move: hit.move, amount, blessing: 0, trueDamage: !!hit.trueDamage };
  job.damage.push(entry);
  log(job, 'damage', `${player(job.state, target).name} 受到 ${amount} 点伤害。`, { ...entry });
}
function makeHits(job) {
  const state = job.state, live = job.live.map(id => player(state, id)), ids = [...job.live], batches = [];
  const emit = (source, action, serial) => {
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
    const power = m.id === 'quake' && targets.length === 1 ? 150 : m.power;
    const hits = [];
    for (let segment = 0; segment < m.damage.length; segment++) for (let index = 0; index < targets.length; index++) {
      const target = targets[index], primary = target === action.targets?.[0];
      const hit = { id: uid(state, 'h'), source, target, move: m.id, segment, power: m.target === 'path' ? power + 10 * index : power, amount: m.target === 'splash' && !primary ? 1 : m.damage[segment], scope: m.target === 'all' ? 'group' : m.target === 'dual' && targets.length === 2 ? 'dual' : m.target === 'splash' && !primary ? 'splash' : 'single', air: m.air, trueDamage: !!m.trueDamage, ignore: m.ignore || [], pierce: m.target === 'splash' && !primary ? [] : m.pierce || [] };
      hits.push(hit);
    }
    if (m.target === 'path') hits.forEach((h, n) => batches.push({ power: h.power, seat: player(state, source).seat, serial, part: n, hits: [h] }));
    else batches.push({ power, seat: player(state, source).seat, serial, part: 0, hits });
  };
  let serial = 0;
  for (const ongoing of state.ongoing) if (ongoing.start <= state.round && ongoing.end >= state.round && ids.includes(ongoing.action.targets[0])) emit(ongoing.source, ongoing.action, serial++);
  for (const p of live) {
    const a = job.actions[p.id], m = MOVES[a.move];
    if (m.type === 'attack' && !m.duration && !m.delay) emit(p.id, a, serial++);
  }
  batches.sort((a, b) => b.power - a.power || a.seat - b.seat || a.serial - b.serial || a.part - b.part);
  job.hits = batches.flatMap(b => b.hits);
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
  for (const h of job.hits) h.suppressed = job.hits.some(c => c.source === h.target && c.target === h.source && outranks(c, h));
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
      : m.guardRule === 'ZOrSpell' ? basic?.resource === 'Z' || !!basic?.hasSpell
      : m.damageRule === 'balance' ? basic?.type !== 'basic'
      : (m.id === 'sixFists' && job.protection[p.id]?.six) || [...defenses(job, p)].some(k => m.guard.includes(k) && !(m.firstOnly === k && hit.segment > 0));
    if (blocked) {
      log(job, 'block', `${p.name} 防住了${m.name}。`, { source: hit.source, target: p.id });
      if (m.onBlock === 'recoil' && !(job.protection[hit.source]?.damage >= 1)) recordDamage(job, hit.source, 0.5, { ...hit, trueDamage: true }, null);
      return true;
    }
    if (m.damageRule === 'torch' && basic?.resource === 'F') hit.amount = 2;
    if (m.damageRule === 'balance') hit.amount = basic?.resource === 'Z' ? 0.5 : WEIGHTS[basic.resource] / 10;
    hit.started = true;
    log(job, 'hit', `${m.name} 命中 ${p.name}。`, { source: hit.source, target: p.id, hitId: hit.id });
  }
  if (!hit.trueDamage) {
    while (true) {
      const candidates = p.shields.filter(s => shieldInteraction(hit, s) !== 'ignore');
      if (!candidates.length) break;
      const position = Math.min(...candidates.map(s => EQUIPMENT[s.type].position));
      const options = candidates.filter(s => EQUIPMENT[s.type].position === position).map(s => ({ id: s.id, label: `${EQUIPMENT[s.type].name}${s.type === 'ghost' ? `（${s.layers}层）` : ''}` }));
      const id = hit.selectedShield || chooseShield(job, p, 'shield', options, { hitId: hit.id, move: hit.move });
      if (!id) return false;
      delete hit.selectedShield;
      const shield = p.shields.find(s => s.id === id), interaction = shieldInteraction(hit, shield);
      const wholeGhost = interaction === 'pierce' && shield.type === 'ghost' && m.ghostPierce === 'whole';
      const fullGhostStops = wholeGhost && shield.layers === EQUIPMENT.ghost.layers;
      shield.layers -= wholeGhost ? shield.layers : interaction === 'pierce' && shield.type === 'ghost' ? 2 : 1;
      if (shield.layers <= 0) p.shields = p.shields.filter(s => s.id !== id);
      log(job, interaction === 'pierce' ? 'pierce' : 'shield', `${p.name} 的${EQUIPMENT[shield.type].name}${shield.layers > 0 ? '损失盾层' : '被消耗'}。`, { shieldId: id, target: p.id });
      if (interaction !== 'pierce' || shield.layers > 0 || fullGhostStops) { hitCallback(job, hit); return true; }
    }
  }
  recordDamage(job, p.id, hit.amount, hit);
  hitCallback(job, hit); return true;
}
function advance(job) {
  job.status = 'running'; job.pending = null;
  job.lifeLoss ||= []; job.cancelledSpells ||= [];
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
        const p = player(job.state, id), m = MOVES[job.actions[id].move];
        if (m.type === 'basic' || m.spell && m.spell !== 'silence' && job.cancelledSpells.includes(id)) continue;
        p.resources[m.id] = (p.resources[m.id] || 0) + 1;
        log(job, 'stock', `${p.name} 获得 1 个${m.name}招式资源。`, { target: id, resource: m.id, amount: 1 });
      }
      job.phase = 'spells'; job.cursor = 0; continue;
    }
    if (job.phase === 'spells') {
      const id = job.live[job.cursor];
      if (!id) { makeHits(job); job.phase = 'hits'; job.cursor = 0; continue; }
      const p = player(job.state, id), a = job.actions[id], m = MOVES[a.move], t = job.state.round;
      if (m.spell && m.spell !== 'silence' && job.cancelledSpells.includes(id)) {
        log(job, 'spellCancelled', `${p.name} 的${m.name}法术组件未生效。`, { source: id, move: m.id });
        job.cursor++; continue;
      }
      if (m.spell === 'shock' && !controlImmune(job, player(job.state, a.targets[0]))) {
        const target = player(job.state, a.targets[0]), options = target.shields.filter(s => EQUIPMENT[s.type].electric).map(s => ({ id: s.id, label: EQUIPMENT[s.type].name }));
        if (options.length) {
          const selected = job.spellShield || chooseShield(job, target, 'shock', options, { source: id });
          if (!selected) return job;
          delete job.spellShield; target.shields = target.shields.filter(s => s.id !== selected);
          log(job, 'shock', `${target.name} 的一件装备被小电移除。`, { target: target.id, shieldId: selected });
        }
      }
      if (m.spell === 'blessing') { p.resources.Q += 3; log(job, 'gain', `${p.name} 获得 3 祝福值。`); }
      if (m.spell === 'heal') { const amount = Math.min(1, p.maxHp - p.hp); p.hp += amount; log(job, 'heal', `${p.name} 恢复 ${amount} 生命。`); }
      const statusStart = t + (m.statusStartOffset ?? 1);
      if (m.spell === 'defense') addEffect(job, p, m.id, 'defense', m.defense, statusStart, statusStart + m.duration - 1);
      if (m.spell === 'void') {
        addEffect(job, p, m.id, 'defense', 'C', statusStart, statusStart);
        addEffect(job, p, m.id, 'scope', null, statusStart, statusStart + 2);
      }
      if (m.spell === 'curse') {
        const target = player(job.state, a.targets[0]);
        if (controlImmune(job, target, m.controlLevel)) log(job, 'controlImmune', `${target.name} 免疫了${m.name}。`, { source: id, target: target.id });
        else { addEffect(job, target, m.id, 'curse', 'dodgeLifeLoss', t + 1, t + m.duration, id); log(job, 'status', `${target.name} 将从下一回合进入${m.name}状态。`, { source: id, target: target.id, move: m.id }); }
      }
      if (m.spell === 'guardSix') job.protection[id].six = true;
      job.cursor++; continue;
    }
    if (job.phase === 'hits') {
      const h = job.hits[job.cursor];
      if (h) { if (!resolveHit(job, h)) return job; job.cursor++; continue; }
      job.phase = 'blessing'; job.cursor = 0; continue;
    }
    if (job.phase === 'blessing') {
      const id = job.live[job.cursor];
      if (id) {
        const p = player(job.state, id), events = job.damage.filter(d => d.target === id && d.amount > 1).map(d => ({ ...d, max: Math.ceil(d.amount) - 1 }));
        if (p.resources.Q > 0 && events.length && !job.blessed.includes(id)) return request(job, 'blessing', id, [], { events, budget: p.resources.Q });
        job.cursor++; continue;
      }
      for (const d of job.damage) player(job.state, d.target).hp -= d.amount - d.blessing;
      for (const p of job.state.players) if (p.hp <= 0) log(job, 'death', `${p.name} 阵亡。`, { target: p.id });
      job.state.ongoing = job.state.ongoing.filter(e => player(job.state, e.action.targets[0])?.hp > 0);
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
  const job = { state, actions, live: live.map(p => p.id), protection: Object.fromEntries(live.map(p => [p.id, null])), logs: [], damage: [], lifeLoss: [], hits: [], blessed: [], cancelledSpells: [], phase: 'priority', cursor: 0, status: 'running', pending: null };
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
    for (const e of pending.events) job.damage.find(d => d.id === e.id).blessing = answer[e.id] ?? 0;
    job.blessed.push(playerId);
  } else {
    const selected = pending.options.find(o => o.id === answer);
    if (!selected) fail('请选择当前有效选项。');
    if (pending.kind === 'shock') job.spellShield = selected.id;
    if (pending.kind === 'shield') job.hits[job.cursor].selectedShield = selected.id;
    if (pending.kind === 'discard') { p.shields = p.shields.filter(s => !selected.shieldIds.includes(s.id)); log(job, 'discard', `${p.name} 弃置 ${selected.label}。`); }
  }
  return advance(job);
}
