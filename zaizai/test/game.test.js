import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, validateAction, payCosts, resolveRound } from '../server/game.js';

const p = (id, options = {}) => ({ id, name: id.toUpperCase(), hp: 1, energy: 10, hammers: 3, shields: 3, seat: id.charCodeAt(0)-97, ...options });
const act = (move, target, reflect) => ({ move, ...(target ? { target } : {}), ...(reflect ? { reflect } : {}) });
const battle = (players, actions, interrupts) => resolveRound(payCosts(players, actions), actions, interrupts);
const get = (result, id) => result.players.find(p => p.id === id);

test('文档中 12 种招式均已定义', () => { assert.equal(Object.keys(MOVES).length, 12); });
test('验证目标、资源、阵亡和反弹类型，拒绝非法输入', () => {
  const players = [p('a', { energy: 0 }), p('b'), p('c', { hp: 0 })];
  assert.throws(() => validateAction(players, 'a', act('gun', 'b')), /不足/);
  assert.throws(() => validateAction(players, 'a', act('hammer', 'a')), /目标/);
  assert.throws(() => validateAction(players, 'a', act('hammer', 'c')), /目标/);
  assert.throws(() => validateAction(players, 'c', act('charge')), /阵亡/);
  assert.throws(() => validateAction(players, 'b', act('gold', null, 'meteor')), /反弹/);
  assert.throws(() => validateAction(players, 'b', act('gold', null, 'hammer')), /.+/);
  assert.throws(() => validateAction(players, 'b', act('__proto__')), /有效/);
  assert.deepEqual(validateAction(players, 'a', { move: 'charge', target: 'b', malicious: 1 }), { move: 'charge' });
});
test('仔积攒资源，锤积攒锤，圣盾积攒圣盾且扣仔', () => {
  const r = battle([p('a'), p('b'), p('c')], {a:act('charge'),b:act('hammer','a'),c:act('holy')});
  assert.equal(get(r,'a').energy,11);assert.equal(get(r,'b').hammers,4);assert.equal(get(r,'c').shields,4);assert.equal(get(r,'c').energy,9);
  assert.equal(r.hasDamage,false);
});
test('防抵挡枪和火球', () => {
  const r=battle([p('a'),p('b'),p('c')],{a:act('guard'),b:act('gun','a'),c:act('fireball','a')});
  assert.equal(get(r,'a').hp,1);assert.equal(get(r,'b').hp,0);
});
test('锤敲防：有仔扣仔，无仔扣血；多锤按站位消耗后造成伤害', () => {
  const r=battle([p('a',{energy:1}),p('b'),p('c')],{a:act('guard'),b:act('hammer','a'),c:act('hammer','a')});
  assert.equal(get(r,'a').energy,0);assert.equal(get(r,'a').hp,0);assert.equal(r.hasDamage,true);
});
test('火球溅射目标和存活邻居，跳过死者，不自伤，不重复伤害', () => {
  const r=battle([p('a'),p('b',{hp:0}),p('c'),p('d'),p('e')],{a:act('fireball','c'),c:act('charge'),d:act('charge'),e:act('charge')});
  assert.equal(get(r,'a').hp,1);assert.equal(get(r,'b').hp,0);assert.equal(get(r,'c').hp,0);assert.equal(get(r,'d').hp,0);assert.equal(get(r,'e').hp,1);
});
test('两人火球为 2 点数，压制对射的枪', () => {
  const r=battle([p('a'),p('b')],{a:act('gun','b'),b:act('fireball','a')});
  assert.equal(get(r,'a').hp,0);assert.equal(get(r,'b').hp,1);assert.equal(r.winnerId,'b');
});
test('三人火球为 1 点数，同点数仍互相伤害', () => {
  const r=battle([p('a'),p('b'),p('c')],{a:act('gun','b'),b:act('fireball','a'),c:act('guard')});
  assert.equal(get(r,'a').hp,0);assert.equal(get(r,'b').hp,0);assert.equal(get(r,'c').hp,1);
});
test('天使没有生命上限；治疗与伤害同时结算', () => {
  const r=battle([p('a'),p('b')],{a:act('angel'),b:act('gun','a')});
  assert.equal(get(r,'a').hp,1);
  const r2=battle([p('a',{hp:80}),p('b')],{a:act('angel'),b:act('charge')});
  assert.equal(get(r2,'a').hp,81);
});
test('地震群攻 2 伤害，锤免疫地震和海浪', () => {
  const r=battle([p('a'),p('b'),p('c')],{a:act('quake'),b:act('hammer','a'),c:act('charge')});
  assert.equal(get(r,'b').hp,1);assert.equal(get(r,'c').hp,-1);assert.equal(get(r,'a').energy,6);
});
test('更低点数的攻击只对压制者失效，仍伤害其他目标', () => {
  const r=battle([p('a',{hp:5}),p('b',{hp:5}),p('c',{hp:5})],{a:act('quake'),b:act('fireball','a'),c:act('charge')});
  assert.equal(get(r,'a').hp,5);assert.equal(get(r,'b').hp,3);assert.equal(get(r,'c').hp,2);
});
test('黑天使穿圣盾，恢复生命，以 4 点数压制地震', () => {
  const r=battle([p('a'),p('b')],{a:act('darkAngel','b'),b:act('holy')});
  assert.equal(get(r,'a').hp,2);assert.equal(get(r,'b').hp,0);
  const r2=battle([p('a'),p('b')],{a:act('darkAngel','b'),b:act('quake')});
  assert.equal(get(r2,'a').hp,2);assert.equal(get(r2,'b').hp,0);
});
test('圣盾挡住地震、海浪、火球；金盾猜错不防御', () => {
  for(const move of ['quake','wave','fireball']) {
    const r=battle([p('a'),p('b')],{a:act('holy'),b:act(move,'a')});
    assert.equal(get(r,'a').hp,1,move);
  }
  const r=battle([p('a'),p('b')],{a:act('gold',null,'fireball'),b:act('gun','a')});
  assert.equal(get(r,'a').hp,0);
});
test('金盾反弹匹配攻击，反弹不无限循环', () => {
  const r=battle([p('a'),p('b')],{a:act('gold',null,'gun'),b:act('gun','a')});
  assert.equal(get(r,'a').hp,1);assert.equal(get(r,'b').hp,0);
  const r2=battle([p('a'),p('b')],{a:act('gold',null,'darkAngel'),b:act('darkAngel','a')});
  assert.equal(get(r2,'a').hp,1);assert.equal(get(r2,'b').hp,1);
});
test('海浪消耗圣盾并群攻；明确的火球反弹优先于点数压制', () => {
  const r=battle([p('a'),p('b'),p('c')],{a:act('wave'),b:act('fireball','a'),c:act('charge')});
  assert.equal(get(r,'a').shields,0);assert.equal(get(r,'a').hp,1);assert.equal(get(r,'b').hp,-1);assert.equal(get(r,'c').hp,-1);
  assert.ok(r.logs.some(log=>log.type==='reflect'&&log.source==='a'&&log.target==='b'));
});
test('流星锤破圣盾和金盾，其他玩家不受破盾伤害', () => {
  const r=battle([p('a'),p('b'),p('c'),p('d')],{a:act('meteor'),b:act('holy'),c:act('gold',null,'gun'),d:act('charge')});
  assert.equal(get(r,'a').hammers,0);assert.equal(get(r,'b').hp,0);assert.equal(get(r,'c').hp,0);assert.equal(get(r,'d').hp,1);
});
test('流星锤抵挡地震海浪；可以封锁攻击，消耗照扣', () => {
  const r=battle([p('a'),p('b'),p('c')],{a:act('meteor'),b:act('quake'),c:act('wave')},{a:'b'});
  assert.equal(get(r,'a').hp,1);assert.equal(get(r,'b').energy,6);assert.equal(get(r,'b').hp,0);assert.equal(get(r,'c').hp,1);
  assert.deepEqual(r.muted,['b']);
});
test('封锁圣盾：支付资源但既不产生盾也不阻挡其他伤害', () => {
  const r=battle([p('a'),p('b',{hp:5}),p('c')],{a:act('meteor'),b:act('holy'),c:act('gun','b')},{a:'b'});
  assert.equal(get(r,'b').energy,9);assert.equal(get(r,'b').shields,3);assert.equal(get(r,'b').hp,3);
});
test('流星锤可封锁自己；消耗锤但不会造成破盾伤害', () => {
  const r=battle([p('a'),p('b')],{a:act('meteor'),b:act('holy')},{a:'a'});
  assert.equal(get(r,'a').hammers,0);assert.equal(get(r,'b').hp,1);assert.equal(get(r,'b').shields,4);
});
test('多个流星锤同时封锁，不因互相封锁而产生顺序偏差', () => {
  const r=battle([p('a'),p('b'),p('c')],{a:act('meteor'),b:act('meteor'),c:act('holy')},{a:'b',b:'a'});
  assert.deepEqual(r.muted,['b','a']);assert.equal(get(r,'c').hp,1);assert.equal(get(r,'a').hammers,0);assert.equal(get(r,'b').hammers,0);
});
test('同时全部阵亡为平局，死亡不抹除同时发出的攻击', () => {
  const r=battle([p('a'),p('b')],{a:act('gun','b'),b:act('gun','a')});
  assert.equal(r.finished,true);assert.equal(r.winnerId,null);assert.equal(get(r,'a').hp,0);assert.equal(get(r,'b').hp,0);
});
test('结算不修改传入数据', () => {
  const players=[p('a'),p('b')],actions={a:act('gun','b'),b:act('charge')};
  const before=structuredClone({players,actions});battle(players,actions);assert.deepEqual({players,actions},before);
});
test('目标在锁定后弃权，不导致火球结算崩溃或攻击错误玩家', () => {
  const r=battle([p('a'),p('b',{hp:0,left:true}),p('c')],{a:act('fireball','b'),b:act('charge'),c:act('charge')});
  assert.equal(get(r,'a').energy,8);assert.equal(get(r,'a').hp,1);assert.equal(get(r,'c').hp,1);assert.equal(r.hasDamage,false);
});


test('fireball power is fixed when an action is submitted', () => {
  const players = [p('a', { hp: 5 }), p('b'), p('c', { hp: 5 })];
  const fireball = validateAction(players, 'a', act('fireball', 'c'));
  assert.equal(fireball.power, 1);
  const remaining = [players[0], { ...players[1], hp: 0, left: true }, players[2]];
  const result = battle(remaining, { a: fireball, c: act('quake') });
  assert.equal(get(result, 'a').hp, 3);
  assert.equal(get(result, 'c').hp, 5);

  const duel = [p('a'), p('b')];
  assert.equal(validateAction(duel, 'a', act('fireball', 'b')).power, 2);
});
