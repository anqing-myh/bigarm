import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { payCosts, resolveRound } from '../server/game.js';

// Inspect scheduled effects without adding debugging hooks to the shipped script.
const source = readFileSync(new URL('../public/arena-fx.js', import.meta.url), 'utf8');
function scene(moves, interrupts = {}) {
  const players = Object.keys(moves).map((id, seat) => ({ id, name: id, seat, hp: 10, energy: 10, shields: 5, guards: 5, hammers: 5 }));
  const actions = Object.fromEntries(Object.entries(moves).map(([id, action]) => [id, typeof action === 'string' ? { move: action } : action]));
  const result = resolveRound(payCosts(players, actions), actions, interrupts);
  const context = vm.createContext({ window: { matchMedia: () => ({ matches: false }) } });
  vm.runInContext(source.replace('window.ZaizaiFX = { sync, stop };', `
    window.testFX = {
      spawnRound, spawnInterrupt, clearScene, update,
      setup(ids) { W=800; H=600; stage={cx:400,cy:300,rx:350,ry:250}; positions=Object.fromEntries(ids.map((id,i)=>[id,{x:100+i*300,y:300,r:20}])); },
      read() { return JSON.parse(JSON.stringify({beams,rings,explosions,flashes,parts,auras,frosts,waves,chains})); }
    };
  `), context);
  const fx = context.window.testFX;
  fx.setup(Object.keys(moves));
  fx.spawnRound({ players: result.players, actions, result });
  return { result, read: () => fx.read(), interrupt() { fx.clearScene(); fx.spawnInterrupt({actions}); }, advance(seconds) { for (let i=0; i<Math.round(seconds*100); i++) fx.update(.01); } };
}
const gun = target => ({ move: 'gun', target });
const fireball = target => ({ move: 'fireball', target });

test('meteor uses one flail for settlement and persists while choosing a lock target', () => {
  const s=scene({a:'meteor',b:'charge'},{a:'b'});
  assert.equal(s.read().auras.filter(a=>a.id==='a' && a.kind==='flail').length,1,'no duplicate orbit during reveal');
  s.interrupt();
  s.advance(10);
  assert.equal(s.read().auras.filter(a=>a.id==='a' && a.kind==='flail' && a.persist).length,1);
  assert.equal(s.read().auras.filter(a=>a.kind==='mute').length,0,'target is not muted before confirmation');
});

for (const defense of ['guard', 'holy', 'shieldHammer']) {
  test(`gun travels to ${defense} before the block flashes`, () => {
    const s=scene({a:gun('b'),b:{move:defense,target:'a'}});
    const beams=s.read().beams;
    assert.equal(beams.filter(b=>b.kind==='bullet').length,1);
    assert.ok(beams[0].bx<400 && beams[0].bx>300,'bullet stops at the shield edge');
    assert.equal(s.result.changes.b.damage,0);
    s.advance(.6);
    assert.ok(s.read().rings.some(r=>r.x===400 && r.r0===25),'shield responds on arrival');
  });
}

test('hammer and shield hammer animate resource destruction without transferring it', () => {
  for (const move of ['hammer','shieldHammer']) {
    const s=scene({a:{move,target:'b'},b:'guard'});
    assert.equal(s.read().beams.filter(b=>b.kind==='hammer').length,1);
    assert.equal(s.result.changes.b.energy,-1);
    assert.equal(s.result.changes.a.energy,0);
    s.advance(.7);
    assert.ok(s.read().parts.some(p=>p.color==='#c4f582'));
    assert.equal(s.read().beams.filter(b=>b.kind==='shard').length,0);
  }
});

test('equal attacks collide once at the midpoint and retain fireball splash', () => {
  const s=scene({a:fireball('b'),b:gun('a'),c:'charge'});
  const shots=s.read().beams;
  assert.equal(shots.length,2);
  assert.ok(shots.every(b=>b.bx===250 && b.by===300));
  assert.equal(s.result.changes.a.damage,0);
  assert.equal(s.result.changes.b.damage,0);
  assert.equal(s.result.changes.c.damage,1);
  s.advance(.7);
  assert.equal(s.read().rings.filter(r=>r.x===250 && r.color==='#ffeec9').length,1);
  assert.ok(s.read().explosions.some(e=>e.x===250));
  assert.ok(!s.read().explosions.some(e=>e.x===100 || e.x===400));
  s.advance(.2);
  assert.ok(s.read().explosions.some(e=>e.x===700),'third player still receives splash');
});

test('two-player fireball defeats the bullet and continues from the midpoint', () => {
  const s=scene({a:fireball('b'),b:gun('a')});
  const shots=s.read().beams;
  assert.equal(shots.filter(b=>b.kind==='bullet').length,1);
  assert.equal(shots.filter(b=>b.kind==='comet').length,2);
  assert.ok(shots.some(b=>b.kind==='comet' && b.ax===250 && b.bx===400 && b.delay===.61));
  s.advance(1.05);
  assert.ok(s.read().explosions.some(e=>e.x===400));
  assert.equal(s.result.changes.a.damage,0);
  assert.equal(s.result.changes.b.damage,1);
});

test('fireball block has an incoming projectile and no damage', () => {
  const s=scene({a:fireball('b'),b:'holy'});
  assert.equal(s.read().beams.filter(b=>b.kind==='comet').length,1);
  s.advance(.8);
  assert.ok(s.read().explosions.some(e=>e.x<400 && e.x>300));
  assert.ok(s.read().rings.some(r=>r.x===400 && r.r0===25));
  assert.equal(s.result.changes.b.damage,0);
});

test('reflection follows the incoming shot, then returns the original attack', () => {
  for (const move of ['gun','fireball']) {
    const s=scene({a:{move,target:'b'},b:{move:'gold',reflect:move}});
    assert.equal(s.read().beams.length,1);
    s.advance(.75);
    assert.ok(s.read().beams.some(b=>b.ax>300 && b.bx===100),'reflected projectile returns after contact');
    assert.equal(s.result.changes.a.damage,1);
    assert.equal(s.result.changes.b.damage,0);
  }
});

test('muted projectile does not launch', () => {
  const s=scene({a:fireball('b'),b:'meteor',c:'charge'},{b:'a'});
  assert.equal(s.read().beams.filter(b=>b.kind==='comet').length,0);
  assert.equal(s.result.changes.c.damage,0);
});

test('angel variants summon matching wings, heal, and dark angel also attacks', () => {
  for (const move of ['angel', 'darkAngel']) {
    const s=scene({a:{move,target:'b'},b:'charge'});
    assert.ok(s.read().auras.some(a=>a.id==='a' && a.kind===move));
    assert.equal(s.result.changes.a.healing,1);
    assert.equal(s.read().beams.filter(b=>b.kind==='void').length,move==='darkAngel'?1:0);
    assert.equal(s.result.changes.b.damage,move==='darkAngel'?1:0);
  }
});

test('holy shield only emits holy impact light when it actually blocks', () => {
  const idle=scene({a:'holy',b:'charge'});
  assert.ok(idle.read().auras.some(a=>a.kind==='dome'));
  assert.ok(!idle.read().auras.some(a=>a.kind==='holyImpact'));
  for (const attack of [gun('a'), {move:'quake'}]) {
    const s=scene({a:'holy',b:attack});
    s.advance(.65);
    assert.ok(s.read().auras.some(a=>a.id==='a' && a.kind==='holyImpact'));
    assert.equal(s.result.changes.a.damage,0);
  }
  const pierced=scene({a:'holy',b:{move:'darkAngel',target:'a'}});
  pierced.advance(.8);
  assert.ok(!pierced.read().auras.some(a=>a.kind==='holyImpact'));
  assert.equal(pierced.result.changes.a.damage,1);
});

test('gold shield keeps its idle shape unless its chosen reflection triggers', () => {
  const idle=scene({a:{move:'gold',reflect:'fireball'},b:gun('a')});
  idle.advance(.6);
  assert.ok(idle.read().auras.some(a=>a.id==='a' && a.kind==='mirror'));
  assert.ok(!idle.read().auras.some(a=>a.kind==='goldReflect'));
  for (const attack of [gun('a'),{move:'quake'}]) {
    const s=scene({a:{move:'gold',reflect:attack.move},b:attack});
    s.advance(.65);
    assert.equal(s.read().auras.filter(a=>a.id==='a' && a.kind==='goldReflect').length,1);
    assert.equal(s.result.changes.a.damage,0);
  }
});

test('wave fireball reflection adds water-fire feedback and a returning fireball', () => {
  const s=scene({a:'wave',b:fireball('a'),c:'charge'});
  assert.ok(!s.read().auras.some(a=>a.kind==='waveReflect'));
  s.advance(.8);
  assert.equal(s.read().auras.filter(a=>a.id==='a' && a.kind==='waveReflect').length,1);
  assert.ok(s.read().beams.some(b=>b.kind==='comet' && b.bx===400 && b.ax<200));
  assert.ok(s.read().rings.some(r=>r.x===100 && r.color==='#ffab5e'));
  assert.equal(s.result.changes.b.damage,2,'wave damage plus reflected fireball');
  const idle=scene({a:'wave',b:'charge'});
  idle.advance(.8);
  assert.ok(!idle.read().auras.some(a=>a.kind==='waveReflect'));
});

test('avalanche and meteor show freezing and binding only after successful casts', () => {
  const snow=scene({a:'avalanche',b:'charge'});
  assert.equal(snow.read().frosts.length,1);
  assert.ok(snow.read().auras.some(a=>a.id==='b' && a.kind==='frost'));
  const muted=scene({a:'avalanche',b:'meteor'},{b:'a'});
  assert.equal(muted.read().frosts.length,0);
  assert.ok(muted.read().auras.some(a=>a.id==='a' && a.kind==='mute'));
  assert.equal(muted.read().chains.length,1);
});
