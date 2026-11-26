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
attack('quake', '地震', '3S', 'SC', [1], { target: 'dual', pierce: ['foam', 'electric', 'radar'], pierceExceptions: ['lightning'] });
attack('tripleKick', '三连踹', 'BBF', 'FSC', [2], { spell: 'reflectDamage' });
attack('sunPunch', '太阳拳', 'BBY', 'YSC', [1], { attribute: 'magic', air: true, pierce: ['foam'], spell: 'reflectControl' });
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
attack('cloudArrow', '穿云箭', 'BBC', 'FS', [1], { air: true, pierce: ['foam'], ghostPierce: 'whole', externalImmunity: 2 });
attack('punchKick', '拳打脚踢', 'BBBFY', 'BFC', [2], { pierce: ['foam'], ghostPierce: 'whole' });
attack('arcLight', '弧光', 'BYC', 'BYC', [1], { target: 'all', reverseClash: true });
attack('hammer3', '锤锤锤', 'BFY', 'BZS', [1], { spell: 'silence', controlLevel: 2 });
attack('ghostArrows', '幽灵万箭齐发', { ghostDodge: 2 }, 'C', [2], { target: 'all', attribute: 'magic', air: true, pierce: ['foam'] });
attack('ghostSword', '幽灵毁灭之剑', { ghostDodge: 2 }, 'Z', [6], { attribute: 'magic', guardRule: 'ZOrSpell', lifeCost: 1 });
attack('ghostFinisher', '幽灵必杀', { ghostDodge: 1, voidDodge: 1 }, '', [1], { attribute: 'magic', air: true, trueDamage: true, guardRule: 'nonBasicAction' });

// V3: conditional damage, recurring stages and equipment bonuses use the same pipeline.
attack('frogArrival', '青蛙来了', '9S', 'Y', [9], { frogExplosion: true, description: '单体9物理伤害，圆盾防；青蛙没来或青蛙来不了可导致自身自爆。' });
attack('skyDodge', '天闪凌云', '5S4C', 'S', [6], { attribute: 'magic', air: true, transferHeal: true, transferHealLimit: 3, transferDamagePerUnit: 2, transferLifeLossPerUnit: 1, description: '单体6法术伤害，闪防、对空；受击者选0至3整数x，伤害改为6−2x，自身流失x体力，来源恢复x生命并按需提高生命上限。' });
attack('fiveDarts', '五连镖', '2B5F', '', [5], { air: true, guardRule: 'COrSpell', damageRule: 'fiveDarts', description: '单体一次物理伤害、对空；超闪或纯法术防，实际闪受1伤、方盾/圆盾受3伤、其他受5伤。' });
attack('jingXiaoPeng', '荆霄鹏', '7F', '', [2], { guardRule: 'basicOrAttackOnly', damageRule: 'targetAttackFour', description: '单体物理伤害；目标当回合选攻击时4伤，无须指向自己；其他非资源行动防，基础资源行动受2伤。' });
attack('roamingGun', '漫游之枪', '4S', 'SC', [0.5], { segmentsRule: 'remainingS', description: '单体物理伤害，闪/超闪防；支付4S后每剩余1个闪，产生独立一段0.5伤害，0个则0段。' });
attack('solar', '日曜', '4Y', 'BC', [0], { attribute: 'magic', target: 'all', air: true, damageRule: 'roundY', description: '群体法术伤害、对空，大臂/超闪防；伤害为本回合实际出圆盾的人数，0伤仍可命中消耗盾。' });
attack('sunStorm', '万阳凌空', { solar: 2 }, 'YC', [0.5], { attribute: 'magic', target: 'all', air: true, duration: 4, drain: true, description: '群体0.5法术伤害、对空，圆盾/超闪防；含当回合持续4回合，实际伤害等量即时治疗自身，受生命上限限制。' });
attack('samadhiFire', '三昧真火', '3Y', 'C', [1], { attribute: 'magic', air: true, duration: 3, guardByRound: ['C', 'SC', 'YSC'], description: '单体法术伤害、对空；连续3回合各1伤，防法依次为超闪、闪/超闪、圆盾/闪/超闪。' });
attack('voidBlade', '虚无利刃', { voidDodge: 2 }, 'Z', [0], { attribute: 'magic', air: true, power: 0, guardRule: 'ZOrSpell', segmentsRule: 'targetShieldLayers', description: '单体法术攻击、对空，基础0点、允许盾加点，攒防法或纯法术防；R3固定目标真实盾剩余层数，生成同样段数的0伤害。' });
attack('giantWave', '巨浪炮', { wave: 4 }, 'C', [0], { air: true, damageRule: 'freeSlots', trueWhenPressing: true, description: '单体物理攻击、对空，超闪防；伤害=max(0,5-自身使用盾位)，点压对手时变为真伤。' });

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
shield('frogBarrier', '青蛙来不了', { frogAbsent: 4 }, 'foam', 1, { frogWard: true });
for (const key of 'BZFYSC') shield(`protector${key}`, { B: '大臂防护器', Z: '攒攒防护器', F: '方盾防护器', Y: '圆盾防护器', S: '闪的防护器', C: '超闪防护器' }[key], `5${key}`, 'foam', 1, { defense: key, breakOnResource: key });
shield('plastic', '塑料盾', '3B5Z', 'plastic', 1, { position: 2.5, budget: 80, maxCount: 1, enforceOnCreate: true });
shield('silenceShield', '沉默之盾', 'FFSC', 'foam', 1, { powerBonus: 40 });
shield('annihilationShield', '寂灭之盾', '', 'ghost', 3, { layers: 3, materials: { silenceShield: 2 }, powerPerLayer: 40 });
shield('lightningRod', '避雷针', 'BBBSSC', 'outer', 1, { position: 2, immuneShock: true });

add('shock', '小电', 'spell', 'CC', { target: 'single', spell: 'shock', immunity: 2 });
add('phoenixGuard', '凤之守护', 'spell', 'Q', { immunity: 2, controlImmunity: 2 });
add('ghostDodge', '幽灵闪', 'spell', 'BFYC', { spell: 'defense', defense: 'C', duration: 2, statusStartOffset: 0 });
add('chainDodge', '连环闪', 'spell', 'SSC', { spell: 'defense', defense: 'S', duration: 3, statusStartOffset: 0 });
add('voidDodge', '虚无闪', 'spell', 'FYSC', { spell: 'void', statusStartOffset: 0 });
add('thunderDodge', '雷闪', 'spell', 'CCC', { immunity: 2, controlImmunity: 2 });
add('heal', '回一滴血', 'spell', 'CCC', { spell: 'heal' });
add('guardSix', '防六拳合一', 'spell', '', { spell: 'guardSix' });
add('axi', '阿西吧', 'spell', 'C', { immunity: 2, controlImmunity: 2, lifeCost: 1 });
add('crucio', '钻心咒', 'spell', '5C', { target: 'single', spell: 'curse', duration: 15, controlLevel: 1, immunity: 1, controlImmunity: 1 });
add('frogAbsent', '青蛙没来', 'spell', '', { spell: 'frogWard', description: '无消耗防御性法术，使本回合场上出青蛙来了的玩家自爆。' });
add('himalaya', '喜马拉雅闪', 'spell', '2S', { spell: 'firstAttack', description: '免疫当回合第一段命中攻击；被压制、落空、其他免疫或基础防法挡住的不计，在判定耗盾或掉血前生效。' });
add('sixMind', '六神无主', 'spell', '6Z', { spell: 'digitWard', duration: 15, statusStartOffset: 0, immunity: 1, controlImmunity: 1, description: '当回合无敌；含当回合持续15回合，免疫名称含零一二三四五六七八九十百千万的攻击。' });
add('damageCurse', '诅咒', 'spell', 'BBYS', { target: 'single', spell: 'damageCurse', duration: 3, controlLevel: 1, description: '指定其他一人，从下回合开始3回合，其非流失体力的受伤加倍，同名状态不叠加。' });

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
  move.implementationStatus = 'ready';
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
export const RULE_VERSION = '2026-11-26-v3';
