import assert from 'node:assert/strict';
import { MOVES, payCosts, resolveRound } from '../server/game.js';

// Run real settlement fixtures through the actual renderer, with normal motion.
// This context never signs in or changes a live room.
export async function checkArenaEffects(browser, base, errors) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const mutations = [];
  page.on('request', request => { if (request.url().includes('/api/') && request.method() !== 'GET') mutations.push(request.url()); });
  let round = 0;
  async function show(moves, interrupts = {}, phase = 'reveal') {
    const players = Object.keys(moves).map((id, seat) => ({ id, name: 'FX ' + id, seat, hp: 10, energy: 10, shields: 5, guards: 5, hammers: 5, connected: true }));
    const actions = Object.fromEntries(Object.entries(moves).map(([id, action]) => [id, typeof action === 'string' ? { move: action } : action]));
    const result = resolveRound(payCosts(players, actions), actions, interrupts);
    const room = { id: 'fx-fixture', name: 'Move effects', hostId: 'a', phase, round: ++round, gameNumber: 1, capacity: players.length,
      players: phase === 'reveal' ? result.players : players, actions, result: phase === 'reveal' ? result : null,
      ownAction: actions.a, submitted: Object.keys(actions), interruptSubmitted: [], history: [], leaderboard: [] };
    await page.evaluate(({ room, catalog }) => {
      moves = catalog; self = { id: 'a', name: 'FX a' }; state = { room, rooms: [] }; render();
    }, { room, catalog: MOVES });
    assert.equal(await page.locator('canvas.arena-fx').count(), 1);
    return result;
  }
  async function capture(name, delay = 650) {
    await page.waitForTimeout(delay);
    await page.screenshot({ path: `test-results/fx-${name}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' has no horizontal overflow');
    assert.equal(await page.locator('canvas.arena-fx').evaluate(canvas => {
      const ctx = canvas.getContext('2d');
      return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data].some((v, i) => i % 4 === 3 && v > 0);
    }), true, name + ' paints the canvas');
  }
  try {
    await page.goto(base);
    await page.locator('.welcome').waitFor();
    await show({ a: 'angel', b: 'charge' });
    assert.equal(await page.locator('.seat[data-id=a] .heal-float').textContent(), '+1 ♥');
    await capture('angel-wings');
    await show({ a: { move: 'darkAngel', target: 'b' }, b: 'charge' });
    await capture('dark-angel-wings');
    await show({ a: 'holy', b: 'charge' });
    await capture('holy-idle');
    await show({ a: 'holy', b: { move: 'gun', target: 'a' } });
    await capture('holy-block');
    await show({ a: { move: 'gold', reflect: 'fireball' }, b: 'charge' });
    await capture('gold-idle-x');
    await show({ a: { move: 'gold', reflect: 'fireball' }, b: { move: 'fireball', target: 'a' } });
    await capture('gold-reflection', 850);
    await show({ a: 'wave', b: { move: 'fireball', target: 'a' }, c: 'charge' });
    await capture('wave-fireball-reflection', 850);
    const eight = { a: 'avalanche', b: 'charge', c: 'guard', d: 'holy', e: 'angel', f: { move: 'gun', target: 'b' }, g: 'wave', h: 'meteor' };
    await show(eight, { h: 'b' });
    assert.equal(await page.locator('.table-action.is-frozen').count(), 8, 'all revealed moves receive frost');
    assert.equal(await page.locator('.table-action.muted.is-frozen').count(), 1, 'muted cards also receive frost');
    await capture('avalanche-eight-cards', 1050);
    await show({ a: 'charge', b: 'guard' }, {}, 'selecting');
    assert.equal(await page.locator('.table-action.is-frozen').count(), 0, 'frost clears next round');
    await show({ a: 'avalanche', b: 'meteor' }, { b: 'a' });
    assert.equal(await page.locator('.table-action.is-frozen').count(), 0, 'muted avalanche never freezes cards');
    for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await show({ a: 'angel', b: { move: 'gun', target: 'a' } });
      assert.equal(await page.locator('.seat[data-id=a] .heal-float').count(), 1);
      assert.equal(await page.locator('.seat[data-id=a] .damage-float').count(), 1);
      const checkFloats=async()=>{
        const floatLayout=await page.locator('.seat[data-id=a]').evaluate(el => {
          const heal = el.querySelector('.heal-float').getBoundingClientRect(), damage = el.querySelector('.damage-float').getBoundingClientRect();
          return { healTop:heal.top, damageBottom:damage.bottom, healHeight:heal.height, damageHeight:damage.height };
        });
        assert.ok(floatLayout.healTop >= floatLayout.damageBottom, 'healing and damage numbers remain separate: '+JSON.stringify(floatLayout));
      };
      await checkFloats();
      await capture('healing-and-damage-' + viewport.width);
      await checkFloats();
    }
    await show({ a: 'avalanche', b: 'charge', c: 'guard' });
    assert.equal(await page.locator('.table-action.is-frozen').count(), 3);
    await capture('avalanche-mobile', 1000);
    await show({ a: 'wave', b: { move: 'fireball', target: 'a' }, c: 'charge' });
    await capture('wave-reflection-mobile', 850);
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
      await page.setViewportSize(viewport);
      for (const count of [2, 3, 8]) {
        const moves=Object.fromEntries(Array.from({length:count},(_,i)=>[String.fromCharCode(97+i),i===0?'meteor':'charge']));
        await show(moves,{},'interrupt');
        assert.equal(await page.locator('.table-action').count(),count);
        await page.locator('.seat[data-id=b] .avatar-shell').click();
        assert.match(await page.locator('.interrupt-controls').textContent(),/FX b/);
        assert.equal(await page.locator('[data-act=interrupt]').isEnabled(),true);
        const obscured=await page.locator('.interrupt-panel').evaluate(panel=>{
          const panelRect=panel.getBoundingClientRect();
          const nodes=[panel.querySelector('h2'),panel.querySelector('p'),panel.querySelector('.interrupt-controls>span'),panel.querySelector('button')];
          return nodes.some(el=>{
            const r=el.getBoundingClientRect();
            return r.left<panelRect.left || r.right>panelRect.right || r.top<panelRect.top || r.bottom>panelRect.bottom ||
              ![.1,.5,.9].every(t=>el.contains(document.elementFromPoint(r.left+r.width*t,r.top+r.height*.5)));
          });
        });
        assert.equal(obscured,false,`interrupt text and confirm button stay above cards at ${count} players / ${viewport.width}`);
        await page.locator('.seat[data-id=a] .avatar-shell').click();
        assert.match(await page.locator('.interrupt-controls').textContent(),/FX a/,'self remains selectable');
        if(count===8)await capture('meteor-interrupt-'+viewport.width,1900);
      }
    }
    await show({a:'meteor',b:'charge'},{a:'b'});
    await capture('meteor-binding',650);
    assert.deepEqual(mutations, [], 'effect fixtures never submit multiplayer commands');
    assert.deepEqual(errors, [], 'normal-motion effects have no browser errors');
  } finally {
    await context.close();
  }
}
