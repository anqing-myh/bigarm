// Presentation helpers only. The rules engine remains the authority for legality and damage.
export const PINYIN = Object.freeze({
  basicB: 'da bi', basicZ: 'zan', basicF: 'fang dun', basicY: 'yuan dun', basicS: 'shan', basicC: 'chao shan',
  punch: 'quan', kick: 'chuai', ber: 'ber', knife: 'dao', wave: 'hai lang', torch: 'huo ju', tsunami: 'hai xiao',
  fireWheel: 'huo lun', arrows: 'wan jian qi fa', smallWave: 'xiao hai bo', dart: 'biao', smallWheel: 'xiao huo lun',
  quake: 'di zhen', tripleKick: 'san lian chuai', sunPunch: 'tai yang quan', comboPunch: 'lian huan quan',
  dragonSword: 'qing long jian', knifePoint: 'dao dian dao', sickle: 'lian dao', sixFists: 'liu quan he yi',
  boomerang: 'hui xuan biao', skyCannon: 'chong tian pao', skyDrill: 'chong tian zuan', dragonBlade: 'qing long yan yue dao',
  phoenix: 'feng ming jiu tian', phoenixFlame: 'feng zhi lie yan', phoenixStar: 'feng zhi chang xing',
  meteor: 'liu xing chui', staff: 'shao lin gun', sword: 'jian', upheaval: 'tian fan di fu', balance: 'jun heng zhi ren',
  foam: 'pao mo dun', ghost: 'you ling dun', lightning: 'shan dian dun', thunder: 'lei dian dun', ocean: 'hai shen dun',
  flame: 'lie yan dun', producerB: 'da bi sheng chan qi', producerZ: 'zan zan sheng chan qi',
  producerF: 'fang dun sheng chan qi', producerY: 'yuan dun sheng chan qi', radar: 'lei da',
  shock: 'xiao dian', phoenixGuard: 'feng zhi shou hu', ghostDodge: 'you ling shan', chainDodge: 'lian huan shan',
  voidDodge: 'xu wu shan', thunderDodge: 'lei shan', heal: 'hui yi di xue', guardSix: 'fang liu quan he yi',
});
const normalize = text => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s'’_-]/g, '');
function subsequence(text, query) {
  let index = 0;
  for (const char of text) if (char === query[index]) index++;
  return index === query.length;
}
export function matchesMove(move, query) {
  const needle = normalize(query);
  const syllables = (PINYIN[move.id] || '').split(' ');
  return [move.name, syllables.join(''), syllables.map(s => s[0]).join('')]
    .some(text => subsequence(normalize(text), needle));
}
export function searchMoves(moves, query) { return moves.filter(move => matchesMove(move, query)); }

const allocation = value => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
export function blessingTotal(choice, values) { return choice.events.reduce((sum, e) => sum + allocation(values[e.id]), 0); }
export function blessingLimit(choice, values, eventId) {
  const event = choice.events.find(e => e.id === eventId);
  const otherSpent = choice.events.reduce((sum, e) => sum + (e.id === eventId ? 0 : allocation(values[e.id])), 0);
  return Math.max(0, Math.min(event.max, choice.budget - otherSpent));
}

// Compare confirmed snapshots, never predict results from a selected move.
export function combatChanges(before, after) {
  if (!before || !after || before.id !== after.id || before.gameNumber !== after.gameNumber || !before.round || !after.round) return [];
  const changes = [];
  for (const player of after.players) {
    const old = before.players.find(p => p.id === player.id);
    if (!old) continue;
    const delta = player.hp - old.hp;
    if (delta) changes.push({ playerId: player.id, kind: delta < 0 ? 'damage' : 'heal', text: `${delta < 0 ? '♥ −' : '♥ +'}${Math.abs(delta)}` });
    const oldShields = new Map(old.shields.map(s => [s.id, s]));
    const newShields = new Map(player.shields.map(s => [s.id, s]));
    let lost = 0, gained = 0;
    for (const s of old.shields) lost += Math.max(0, (s.layers || 1) - (newShields.get(s.id)?.layers || 0));
    for (const s of player.shields) gained += Math.max(0, (s.layers || 1) - (oldShields.get(s.id)?.layers || 0));
    if (lost) changes.push({ playerId: player.id, kind: 'shield-loss', text: `◇ 护盾 −${lost}层` });
    if (gained) changes.push({ playerId: player.id, kind: 'shield-gain', text: `◇ 护盾 +${gained}层` });
  }
  return changes;
}
