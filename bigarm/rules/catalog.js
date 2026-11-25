// This module contains game data only: no DOM, network, timers or Node APIs.
export const BASE_RESOURCE_NAMES = Object.freeze({ B: '大臂', Z: '攒', F: '方盾', Y: '圆盾', S: '闪', C: '超闪', Q: '祝福值' });
const baseWeights = { B: 10, Z: 8, F: 15, Y: 20, S: 25, C: 35, Q: 45 };
export function parseCost(text = '') {
  if (text && typeof text === 'object') return { ...text };
  const result = {};
  for (const [, n, key] of text.replace(/\s+/g, '').matchAll(/(\d*)([BZFYSCQ])/g)) {
    result[key] = (result[key] || 0) + Number(n || 1);
  }
  return result;
}
const moves = Object.create(null);
const add = (id, name, type, cost, data = {}) => { moves[id] = { id, name, type, cost: parseCost(cost), ...data }; };
for (const key of 'BZF YSC'.replace(' ', '')) add(`basic${key}`, BASE_RESOURCE_NAMES[key], 'basic', '', { resource: key, description: `获得 1 个${BASE_RESOURCE_NAMES[key]}，提供本回合对应防法。` });
const attack = (id, name, cost, guard, damage, data = {}) => add(id, name, 'attack', cost, { guard, damage, target: 'single', attribute: 'physical', air: false, ...data });
attack('punch', '拳', 'B', 'FSC', [1]);
attack('kick', '踹', 'B', 'FYSC', [1], { power: 60 });
attack('ber', 'ber', 'Z', 'BSC', [1], { attribute: 'magic', air: true });
attack('knife', '刀', 'FY', 'YSC', [0.5], { trueDamage: true, fallback: true });
attack('wave', '海浪', '2F', 'SC', [1], { target: 'all' });
attack('torch', '火炬', 'Y', 'YSC', [1], { damageRule: 'torch' });
attack('tsunami', '海啸', '3F', 'SC', [1], { target: 'all', air: true, pierce: ['foam'] });
attack('fireWheel', '火轮', '2Y', 'YSC', [0.5, 0.5], { air: true, firstOnly: 'S', onHit: 'gainY' });
attack('arrows', '万箭齐发', '2S', 'FSC', [1, 0.5], { target: 'all', air: true });
attack('smallWave', '小海波', 'F', 'FSC', [0.5], { target: 'all' });
attack('dart', '镖', 'F', 'SC', [0.5], { air: true });
attack('smallWheel', '小火轮', 'Y', 'YSC', [0.5], { air: true });
attack('quake', '地震', '3S', 'SC', [1], { target: 'dual', pierce: ['foam', 'electric', 'radar'] });
attack('tripleKick', '三连踹', 'BBF', 'FSC', [2]);
attack('sunPunch', '太阳拳', 'BBY', 'YSC', [1], { attribute: 'magic', air: true, pierce: ['foam'] });
attack('comboPunch', '连环拳', '5B', 'C', [3]);
attack('dragonSword', '青龙剑', 'FFYY', 'YSC', [2]);
attack('knifePoint', '刀点刀', 'BFFFY', '', [2], { clash: 'ingredientB' });
attack('sickle', '镰刀', '2Z', 'BZSC', [0.5, 0.5]);
attack('sixFists', '六拳合一', '4F4Y', '', [7], { air: true, ignore: ['foam', 'radar'], immunity: 1, controlImmunity: 1 });
attack('boomerang', '回旋镖', '3B', 'YSC', [1], { target: 'path', air: true });
attack('skyCannon', '冲天炮', 'BZC', 'SC', [1], { air: true, duration: 3 });
attack('skyDrill', '冲天钻', 'BZS', 'SC', [0.5], { air: true, duration: 4 });
attack('dragonBlade', '青龙偃月刀', '3F3Y', 'FSC', [3]);
attack('phoenix', '凤鸣九天', 'BFFYYSSCC', 'C', [2], { target: 'all', attribute: 'magic', air: true, pierce: ['foam'], spell: 'blessing' });
attack('phoenixFlame', '凤之烈焰', '2Q', 'SC', [2], { target: 'splash', attribute: 'magic', air: true, pierce: ['foam'] });
attack('phoenixStar', '凤之长星', '2Q', 'SC', [1], { attribute: 'magic', air: true, pierce: ['electric'], duration: 5 });
attack('meteor', '流星锤', '5F', 'SC', [2], { target: 'all', air: true, pierce: ['foam'], onBlock: 'recoil' });
attack('staff', '少林棍', '5Y', 'YSC', [2], { target: 'all', ignore: ['electric', 'radar'] });
attack('sword', '剑', '2B', 'FYSC', [2]);
attack('upheaval', '天翻地覆', 'BZFYSC', 'SC', [2], { target: 'all', air: true, pierce: ['foam'], onHit: 'ground' });
attack('balance', '均衡之刃', 'BZFYSC', '', [0], { damageRule: 'balance' });

// V2 attacks share the same hit pipeline; special rules are declared as data.
attack('gun', '枪', 'Z', '', [0.5], { air: true, guardRule: 'exceptDodgeAction' });
attack('flyingKnife', '飞刀', 'S', 'SC', [1], { air: true, delay: 1 });
attack('cloudArrow', '穿云箭', 'BBC', 'FS', [1], { air: true, pierce: ['foam'], ghostPierce: 'whole' });
attack('punchKick', '拳打脚踢', 'BBBFY', 'BFC', [2], { pierce: ['foam'], ghostPierce: 'whole' });
attack('arcLight', '弧光', 'BYC', 'BYC', [1], { target: 'all', reverseClash: true });
attack('hammer3', '锤锤锤', 'BFY', 'BZS', [1], { spell: 'silence', controlLevel: 2 });
attack('ghostArrows', '幽灵万箭齐发', { ghostDodge: 2 }, 'C', [2], { target: 'all', attribute: 'magic', air: true, pierce: ['foam'] });
attack('ghostSword', '幽灵毁灭之剑', { ghostDodge: 2 }, 'Z', [6], { attribute: 'magic', guardRule: 'ZOrSpell', lifeCost: 1 });
attack('ghostFinisher', '幽灵必杀', { ghostDodge: 1, voidDodge: 1 }, '', [1], { attribute: 'magic', air: true, trueDamage: true, guardRule: 'nonBasicAction' });

const equipment = Object.create(null);
const shield = (id, name, cost, grade, slots, data = {}) => {
  equipment[id] = { id, name, grade, slots, position: 3, electric: false, ...data };
  add(id, name, 'equipment', cost, { equipment: id, ...(data.materials ? { materials: data.materials } : {}) });
};
shield('foam', '泡沫盾', 'BF', 'foam', 1);
shield('ghost', '幽灵盾', '', 'ghost', 3, { layers: 3, materials: { foam: 2 } });
shield('lightning', '闪电盾', 'BSSS', 'electric', 2, { immuneResource: 'S', electric: true });
shield('thunder', '雷电盾', 'BCCC', 'electric', 2, { immuneResource: 'C', electric: true });
shield('ocean', '海神盾', 'ZZZFFF', 'electric', 2, { immuneResource: 'F', electric: true });
shield('flame', '烈焰盾', 'BBBYYY', 'electric', 2, { immuneResource: 'Y', immuneMove: 'phoenixFlame', electric: true });
for (const key of 'BZFY') shield(`producer${key}`, { B: '大臂生产器', Z: '攒攒生产器', F: '方盾生产器', Y: '圆盾生产器' }[key], `5${key}`, 'foam', 1, { producer: key, position: 4, electric: true });
shield('radar', '雷达', 'ZZZYYY', 'radar', 2, { electric: true, immuneAll: true });

add('shock', '小电', 'spell', 'CC', { target: 'single', spell: 'shock', immunity: 2 });
add('phoenixGuard', '凤之守护', 'spell', 'Q', { immunity: 2, controlImmunity: 2 });
add('ghostDodge', '幽灵闪', 'spell', 'BFYC', { spell: 'defense', defense: 'C', duration: 2, statusStartOffset: 0 });
add('chainDodge', '连环闪', 'spell', 'SSC', { spell: 'defense', defense: 'S', duration: 3, statusStartOffset: 0 });
add('voidDodge', '虚无闪', 'spell', 'FYSC', { spell: 'void', statusStartOffset: 0 });
add('thunderDodge', '雷闪', 'spell', 'CCC', { immunity: 2, controlImmunity: 2 });
add('heal', '回一滴血', 'spell', 'CCC', { spell: 'heal' });
add('guardSix', '防六拳合一', 'spell', '', { spell: 'guardSix' });
add('axi', '阿西吧', 'spell', 'C', { immunity: 2, controlImmunity: 2, lifeCost: 1 });
add('crucio', '钻心咒', 'spell', '5C', { target: 'single', spell: 'curse', duration: 15, controlLevel: 1 });

const weights = { ...baseWeights };
function resourceWeight(key, visiting = new Set()) {
  if (weights[key] !== undefined) return weights[key];
  const move = moves[key];
  if (!move || visiting.has(key)) throw new Error(`无效或循环的资源成本：${key}`);
  const path = new Set([...visiting, key]);
  return weights[key] = [...Object.entries(move.cost), ...Object.entries(move.materials || {})].reduce((sum, [resource, count]) => sum + resourceWeight(resource, path) * count, 0);
}
const resourceNames = { ...BASE_RESOURCE_NAMES };
for (const move of Object.values(moves)) if (move.type !== 'basic') {
  resourceNames[move.id] = move.name;
  resourceWeight(move.id);
}
export const RESOURCE_NAMES = Object.freeze(resourceNames);
export const WEIGHTS = Object.freeze(weights);

for (const move of Object.values(moves)) {
  // Only pure spell/auxiliary actions grant spell defense; contained components remain independent.
  move.hasSpell = move.type === 'spell';
  move.power ??= Object.entries(move.cost).reduce((sum, [key, n]) => sum + WEIGHTS[key] * n, 0);
  move.description ??= move.type === 'attack'
    ? `${move.attribute === 'magic' ? '法术' : '物理'}攻击 · ${move.power / 10} 点 · ${move.damage.join('＋')} 伤害${move.duration ? ` · 持续 ${move.duration} 回合` : ''}`
    : move.type === 'equipment' ? '制造持有装备，攻击前生效。' : '攻击前施放法术。';
  Object.freeze(move.cost);
  if (move.materials) Object.freeze(move.materials);
  for (const value of Object.values(move)) if (Array.isArray(value)) Object.freeze(value);
  Object.freeze(move);
}
for (const def of Object.values(equipment)) Object.freeze(def);
export const MOVES = Object.freeze(moves);
export const EQUIPMENT = Object.freeze(equipment);
export const RULE_VERSION = '2026-11-25';
