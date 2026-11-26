import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createServer } from '../server/index.js';
import { MOVES } from '../rules/engine.js';

let pw;
try { pw = await import('playwright'); }
catch (error) {
  if (!process.env.PLAYWRIGHT_MODULE_DIR) throw new Error('浏览器测试需要 npm ci，或设置 PLAYWRIGHT_MODULE_DIR 指向已有的 playwright 包。', { cause: error });
  pw = await import(pathToFileURL(path.join(process.env.PLAYWRIGHT_MODULE_DIR, 'index.js')).href);
}
const chromium = pw.chromium || pw.default.chromium;
const server = createServer({ selectionMs: 120000, choiceMs: 120000, revealMs: 1200 });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const errors = [], contexts = [], extraServers = [];
await mkdir('test-results', { recursive: true });
async function page(width = 1360) {
  const c = await browser.newContext({ viewport: { width, height: 950 } }); contexts.push(c);
  const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
  p.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  return p;
}
async function info(p) { return p.evaluate(async () => (await fetch('/api/state', { headers: { Authorization: `Bearer ${sessionStorage.getItem('bigarm-token')}` } })).json()); }
async function waitInfo(p, predicate) {
  for (let i = 0; i < 200; i++) { const s = await info(p); if (predicate(s)) return s; await p.waitForTimeout(50); }
  assert.fail('browser did not reach room state');
}
async function login(p, name, url = base) { await p.goto(url); await p.locator('#nickname').fill(name); await p.locator('#login button').click(); await p.locator('.room-toolbar,.lobby').first().waitFor(); }
async function move(p, id) {
  if (!id.startsWith('basic')) await p.locator('#move-search').fill(MOVES[id].name);
  await p.locator(`#app [data-act=move][data-id=${id}]`).click();
  await p.locator('[data-act=lock]').click();
}
async function round(a, b, am, bm) {
  const n = (await info(a)).room.round;
  await a.waitForFunction(() => !!document.querySelector('[data-act=lock]'));
  await b.waitForFunction(() => !!document.querySelector('[data-act=lock]'));
  await move(a, am); await move(b, bm);
  await waitInfo(a, s => s.room.phase === 'selecting' && s.room.round > n);
}
async function fits(p) { assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow'); }
async function battlefieldFits(p) {
  await fits(p);
  const box = await p.locator('.battle-layout').boundingBox();
  const viewport = p.viewportSize();
  assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1, `battlefield and controls must share viewport: ${JSON.stringify({ box, viewport })}`);
}
try {
  const a = await page(), b = await page();
  await a.goto(base); await fits(a); await a.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
  await a.locator('#rules-button').click(); await a.locator('#rule-search').fill('回旋镖');
  assert.ok((await a.locator('.rules-list').innerText()).includes('单体'));
  await a.locator('#close-modal').click();
  await login(a, '甲'); await login(b, '乙');
  await a.locator('#create [name=name]').fill('朋友的竞技场');
  await a.locator('#create [name=name]').evaluate(el => { el.focus(); el.setSelectionRange(2, 2); });
  await b.locator('#create button').click(); await b.locator('[data-act=leave]').waitFor();
  await a.waitForTimeout(1200);
  assert.equal(await a.locator('#create [name=name]').inputValue(), '朋友的竞技场');
  assert.equal(await a.locator('#create [name=name]').evaluate(el => el.selectionStart), 2);
  await a.locator('#create [name=name]').evaluate(el => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.value = '朋友的竞技场'; el.dataset.composingNode = 'original';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  });
  await b.locator('[data-act=leave]').click(); await a.waitForTimeout(1200);
  assert.equal(await a.locator('#create [name=name]').getAttribute('data-composing-node'), 'original', 'polling must not replace an IME input');
  await a.locator('#create [name=name]').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await a.locator('#create [name=name]').fill('朋友的竞技场'); await a.locator('#create [name=capacity]').selectOption('2'); await a.locator('#create button').click();
  const roomId = (await waitInfo(a, s => !!s.room)).room.id;
  assert.equal((await info(a)).room.name, '朋友的竞技场');
  await b.locator('#join [name=roomId]').fill(roomId.slice(0, 3));
  await b.locator('#join [name=roomId]').evaluate(el => { el.focus(); el.setSelectionRange(1, 1); });
  await a.evaluate(async () => {
    await fetch('/api/rooms/capacity', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('bigarm-token')}` }, body: JSON.stringify({ capacity: 3 }) });
  });
  await b.waitForTimeout(1200);
  assert.equal(await b.locator('#join [name=roomId]').inputValue(), roomId.slice(0, 3));
  assert.equal(await b.locator('#join [name=roomId]').evaluate(el => el.selectionStart), 1);
  await b.locator('#join [name=roomId]').fill(roomId); await b.locator('#join button').click();
  await a.locator('[data-act=ready]').click(); await b.locator('[data-act=ready]').click();
  await a.locator('[data-act=move][data-id=basicB]').waitFor();
  await battlefieldFits(a);
  await a.locator('#move-search').fill('huixuanbiao'); assert.equal(await a.locator('#move-results button').count(), 0);
  await a.locator('#move-search').fill(''); await a.locator('[data-act=all-moves]').click();
  assert.equal(await a.locator('.available-list button').count(), 8); // Six basics, guard-six, and frog-absent.
  await a.locator('.available-list [data-id=basicB]').click(); assert.equal(await a.locator('#modal').isVisible(), false);
  await b.setViewportSize({ width: 390, height: 844 }); await battlefieldFits(b);
  await b.screenshot({ path: 'test-results/selection-mobile.png', fullPage: true });
  await a.screenshot({ path: 'test-results/selection-desktop.png', fullPage: true });
  await move(a, 'basicB');
  const secret = await info(b); assert.equal(secret.room.actions, null); assert.equal(secret.room.ownAction, null);
  const spectator = await page(390); await spectator.setViewportSize({ width: 390, height: 844 });
  await login(spectator, '观战朋友');
  await spectator.locator(`[data-act=join][data-id="${roomId}"]`).click();
  await spectator.locator('.spectator-panel').waitFor();
  assert.equal((await info(spectator)).room.isSpectator, true);
  assert.equal((await info(spectator)).room.actions, null);
  assert.equal(await spectator.locator('.seat').count(), 2);
  assert.equal(await spectator.locator('[data-act=lock], [data-act=ready], .targetable').count(), 0);
  await battlefieldFits(spectator);
  await spectator.locator('.seat').first().click(); await spectator.locator('.equipment-detail').waitFor(); await spectator.locator('#close-modal').click();
  await spectator.reload(); await spectator.locator('.spectator-panel').waitFor();
  await spectator.screenshot({ path: 'test-results/spectator-mobile.png', fullPage: true });
  await move(b, 'basicB'); await waitInfo(a, s => s.room.round === 2 && s.room.phase === 'selecting');
  await round(a, b, 'kick', 'basicB');
  assert.equal((await info(b)).room.players.find(p => p.name === '乙').hp, 4);
  await b.locator('.combat-fx.damage').waitFor();
  await b.screenshot({ path: 'test-results/damage-mobile.png', fullPage: true });
  for (const bm of ['basicF', 'foam', 'basicF', 'foam', 'ghost', 'basicB', 'basicF', 'foam']) await round(a, b, 'basicB', bm);
  for (const query of ['hxb', 'huixuanbiao', '回镖']) {
    await a.locator('#move-search').fill(query);
    await a.locator('#move-results [data-id=boomerang]').waitFor();
  }
  await a.locator('#move-search').fill(''); await a.locator('#move-search').pressSequentially('hxb');
  await a.waitForTimeout(1000);
  assert.equal(await a.locator('#move-search').inputValue(), 'hxb');
  assert.equal(await a.evaluate(() => document.activeElement.id), 'move-search');
  await a.screenshot({ path: 'test-results/search-desktop.png', fullPage: true });
  await a.locator('#move-search').fill('');
  await a.locator('[data-act=lock]').waitFor(); await b.locator('[data-act=lock]').waitFor();
  await move(a, 'punch'); await move(b, 'basicZ');
  const pending = await waitInfo(b, s => s.room.phase === 'choice'); assert.equal(pending.room.pending.playerId, pending.self.id);
  await b.reload(); await b.locator('.choice-option').first().waitFor();
  await spectator.locator('.spectator-panel').waitFor();
  assert.equal(await spectator.locator('.choice-option, #blessing, [data-act=lock]').count(), 0);
  await b.setViewportSize({ width: 390, height: 844 }); await fits(b);
  await b.screenshot({ path: 'test-results/choice-mobile.png', fullPage: true });
  await a.screenshot({ path: 'test-results/arena-desktop.png', fullPage: true });
  await b.getByRole('button', { name: '泡沫盾', exact: true }).click();
  await waitInfo(a, s => s.room.phase === 'selecting');
  assert.equal((await info(b)).room.players.find(p => p.name === '乙').shields.length, 1);
  await b.locator('.combat-fx.shield-loss').waitFor();
  await b.screenshot({ path: 'test-results/shield-loss-mobile.png', fullPage: true });
  await a.locator('.arena-corner [data-act=history]').click(); assert.ok((await a.locator('#modal-content').innerText()).includes('命中')); await a.locator('#close-modal').click();
  await b.locator('[data-act=leave]').click(); await waitInfo(a, s => s.room.phase === 'finished');
  await a.locator('[data-act=scores]').click(); assert.ok((await a.locator('#modal-content').innerText()).includes('1 胜')); await a.locator('#close-modal').click();
  await spectator.locator('[data-act=participate]:not([disabled])').waitFor();
  await spectator.locator('[data-act=participate]').click(); await spectator.locator('[data-act=ready]').waitFor();
  assert.equal((await info(spectator)).room.isSpectator, false);
  await spectator.locator('[data-act=leave]').click();
  const c = await page(390); await login(c, '丙', `${base}/?room=${roomId}`); await c.locator('.room-toolbar').waitFor(); await fits(c);
  await c.screenshot({ path: 'test-results/room-mobile.png', fullPage: true });
  assert.equal((await info(c)).room.id, roomId);
  const ten = await page(390); await ten.goto(base); await fits(ten); await ten.screenshot({ path: 'test-results/home-mobile.png', fullPage: true });
  await login(ten, '十人测试'); await ten.locator('#create button').click();
  const tenId = (await waitInfo(ten, s => !!s.room)).room.id;
  await ten.evaluate(async ({ tenId }) => {
    const post = async (path, body, token) => { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
    const tokens = [];
    for (let i = 1; i < 10; i++) { const s = await post('/api/session', { name: `玩家${i}` }); tokens.push(s.token); await post('/api/rooms/join', { roomId: tenId }, s.token); }
    await post('/api/rooms/ready', {}, sessionStorage.getItem('bigarm-token'));
    for (const token of tokens) await post('/api/rooms/ready', {}, token);
  }, { tenId });
  await ten.locator('.many-players').waitFor(); assert.equal(await ten.locator('.seat').count(), 10); await battlefieldFits(ten);
  await ten.screenshot({ path: 'test-results/ten-players-mobile.png', fullPage: true });
  await ten.setViewportSize({ width: 375, height: 667 }); await battlefieldFits(ten);
  await ten.screenshot({ path: 'test-results/ten-players-small-mobile.png', fullPage: true });

  // Earn blessing through real legal moves, then allocate it across two independent hits.
  const blessed = await page(390); await blessed.setViewportSize({ width: 390, height: 844 }); await login(blessed, '祝福测试');
  await blessed.locator('#create [name=capacity]').selectOption('3'); await blessed.locator('#create button').click();
  await blessed.locator('[data-act=ready]').waitFor();
  await blessed.evaluate(async () => {
    const own = sessionStorage.getItem('bigarm-token');
    const post = async (url, body, token) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(await r.text()); return r.json();
    };
    const get = async () => (await fetch('/api/state', { headers: { Authorization: `Bearer ${own}` } })).json();
    const s = await get(), opponents = [];
    for (const name of ['六拳玩家', '剑玩家']) {
      const p = await post('/api/session', { name }); opponents.push(p.token);
      await post('/api/rooms/join', { roomId: s.room.id }, p.token);
    }
    for (const token of [own, ...opponents]) await post('/api/rooms/ready', {}, token);
    async function round(moves) {
      const state = await get(), round = state.room.round;
      for (const [i, token] of [own, ...opponents].entries()) await post('/api/game/action', { round, move: moves[i], target: state.self.id }, token);
      for (let i = 0; i < 250; i++) {
        const next = await get();
        if (next.room.phase === 'choice' || next.room.phase === 'selecting' && next.room.round > round) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('blessing fixture round did not advance');
    }
    const charges = ['basicB', 'basicB', ...Array.from({ length: 4 }, () => ['basicF', 'basicY', 'basicS', 'basicC']).flat()];
    for (const [i, m] of charges.entries()) await round([m, [0, 2].includes(i) ? 'basicC' : i % 2 ? 'basicF' : 'basicY', [0, 2].includes(i) ? 'basicC' : 'basicB']);
    await round(['phoenix', 'basicC', 'basicC']);
    await round(['basicB', 'basicB', 'basicB']); // Reset the consecutive-C restriction.
    await round(['phoenix', 'basicC', 'basicC']);
    await round(['basicB', 'sixFists', 'sword']);
  });
  await blessed.locator('#blessing').waitFor(); await battlefieldFits(blessed);
  const big = blessed.locator('.blessing-event').filter({ has: blessed.getByText('六拳合一', { exact: true }) });
  assert.equal(await big.locator('.blessing-quick:visible').count(), 5);
  assert.equal(await blessed.locator('.blessing-event').count(), 1, 'only the current damage event is offered');
  await big.locator('input').fill('6'); assert.equal(await blessed.locator('#blessing-left').innerText(), '0');
  await big.locator('input').fill('7'); assert.equal(await blessed.locator('#blessing .primary-button').isDisabled(), true);
  await big.locator('input').fill('0');
  await big.locator('[data-act=bless][data-value="5"]').click();
  assert.equal(await blessed.locator('#blessing-left').innerText(), '1');
  const confirm = await blessed.locator('#blessing .primary-button').boundingBox();
  assert.ok(confirm.y >= 0 && confirm.y + confirm.height <= 844, 'blessing confirmation stays visible while damage entries scroll');
  await blessed.screenshot({ path: 'test-results/blessing-mobile.png', fullPage: true });
  await blessed.setViewportSize({ width: 1360, height: 950 }); await battlefieldFits(blessed);
  await blessed.screenshot({ path: 'test-results/blessing-desktop.png', fullPage: true });
  await blessed.locator('#blessing .primary-button').click();
  const nextBlessing = await waitInfo(blessed, s => s.room.phase === 'choice' && s.room.pending?.events?.[0]?.move === 'sword');
  assert.equal(nextBlessing.room.pending.budget, 1);
  await blessed.locator('.blessing-event').filter({ has: blessed.getByText('剑', { exact: true }) }).waitFor();
  const small = blessed.locator('.blessing-event');
  assert.equal(await small.locator('.blessing-quick:visible').count(), 1);
  await small.locator('[data-act=bless][data-value="1"]').click();
  assert.equal(await blessed.locator('#blessing-left').innerText(), '0');
  await blessed.locator('#blessing .primary-button').click();
  const result = await waitInfo(blessed, s => s.room.phase !== 'choice');
  assert.equal(result.room.players.find(p => p.id === result.self.id).hp, 2);

  // A fast separate room earns actual spell stock and applies a real delayed curse.
  const v2Server = createServer({ selectionMs: 120000, choiceMs: 120000, revealMs: 30 }); extraServers.push(v2Server);
  v2Server.listen(0, '127.0.0.1'); await once(v2Server, 'listening');
  const v2Base = `http://127.0.0.1:${v2Server.address().port}`;
  const v2 = await page(390); await v2.setViewportSize({ width: 390, height: 844 }); await login(v2, '新版测试', v2Base);
  await v2.locator('#create [name=capacity]').selectOption('3'); await v2.locator('#create button').click();
  await v2.locator('[data-act=ready]').waitFor();
  const actors = await v2.evaluate(async () => {
    const own = sessionStorage.getItem('bigarm-token');
    const post = async (url, body, token) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
    const get = async () => (await fetch('/api/state', { headers: { Authorization: `Bearer ${own}` } })).json();
    const initial = await get(), bots = [];
    for (const name of ['咒术玩家', '旁观战斗']) { const p = await post('/api/session', { name }); bots.push(p.token); await post('/api/rooms/join', { roomId: initial.room.id }, p.token); }
    for (const token of [own, ...bots]) await post('/api/rooms/ready', {}, token);
    async function round(moves) {
      const s = await get();
      for (const [i, token] of [own, ...bots].entries()) await post('/api/game/action', { round: s.room.round, move: moves[i], target: initial.self.id }, token);
      for (let i = 0; i < 200; i++) { const next = await get(); if (next.room.phase === 'selecting' && next.room.round > s.room.round) return; await new Promise(r => setTimeout(r, 10)); }
      throw new Error('v2 fixture did not advance');
    }
    const charges = ['basicB', 'basicF', 'basicY', 'basicC', 'basicB', 'basicF', 'basicY', 'basicC', 'basicS', 'basicB'];
    for (const [i, move] of charges.entries()) await round([move, i % 2 === 0 ? 'basicC' : i === 1 ? 'basicF' : i === 3 ? 'basicY' : 'basicB', 'basicB']);
    await round(['ghostDodge', 'crucio', 'basicB']);
    return { own, bots, ownId: initial.self.id };
  });
  await v2.locator('.own-effects .negative').waitFor();
  assert.ok((await v2.locator('.own-effects').innerText()).includes('钻心咒'));
  assert.ok((await v2.locator('.own-effects').innerText()).includes('幽灵闪'));
  assert.ok((await v2.locator('.own-effects').innerText()).includes('幽灵闪 · 1'), 'cast round already counted; only one round remains');
  assert.ok(await v2.locator('[data-id=basicS]').evaluate(e => e.classList.contains('cursed-dodge')));
  assert.ok(await v2.locator('[data-id=basicC]').evaluate(e => e.classList.contains('cursed-dodge')));
  await battlefieldFits(v2); await v2.screenshot({ path: 'test-results/v2-status-mobile.png', fullPage: true });
  const postV2 = async (move, token, round) => {
    const r = await fetch(`${v2Base}/api/game/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ move, round, target: actors.ownId }) });
    assert.equal(r.status, 200, await r.text());
  };
  await move(v2, 'ghostDodge');
  for (const token of actors.bots) await postV2('basicB', token, 12);
  await waitInfo(v2, s => s.room.round === 13 && s.room.phase === 'selecting');
  await v2.locator('[data-act=lock]').waitFor(); await v2.locator('[data-act=stock]').click();
  assert.ok((await v2.locator('.stock-list').innerText()).includes('幽灵闪'));
  assert.ok((await v2.locator('.stock-list').innerText()).includes('× 2'));
  await v2.screenshot({ path: 'test-results/v2-stock-mobile.png', fullPage: true }); await v2.locator('#close-modal').click();
  await v2.locator('#move-search').fill('ylwjqf'); await v2.locator('#move-results [data-id=ghostArrows]').click(); await v2.locator('[data-act=lock]').click();
  for (const token of actors.bots) await postV2('basicB', token, 13);
  let next = await waitInfo(v2, s => s.room.round === 14 && s.room.phase === 'selecting');
  assert.equal(next.room.players.find(p => p.id === next.self.id).resources.ghostDodge, 0);
  assert.equal(next.room.players.find(p => p.id === next.self.id).resources.ghostArrows, 1);
  await v2.locator('[data-act=lock]').waitFor(); await v2.locator('#move-search').fill('ylwjqf');
  assert.equal(await v2.locator('#move-results [data-id=ghostArrows]').count(), 0, 'spent stock disappears from legal search');
  await v2.locator('#move-search').fill(''); await move(v2, 'basicS');
  await postV2('hammer3', actors.bots[0], 14); await postV2('basicB', actors.bots[1], 14);
  next = await waitInfo(v2, s => s.room.round === 15 && s.room.phase === 'selecting');
  assert.equal(next.room.players.find(p => p.id === next.self.id).hp, 3);
  assert.equal(next.room.history[0].lifeLoss[0].amount, 2);
  assert.equal(next.room.history[0].damage.length, 0, 'curse life loss is not a damage event');
  await v2.setViewportSize({ width: 1360, height: 950 }); await battlefieldFits(v2);
  await v2.screenshot({ path: 'test-results/v2-result-desktop.png', fullPage: true });
  // All V3 entries are now confirmed; affordability still governs selection.
  await v2.locator('[data-act=rules]').first().click();
  await v2.locator('#rule-search').fill('五连镖');
  assert.ok((await v2.locator('.rules-list').innerText()).includes('超闪防法或纯法术/辅助行动'));
  await v2.locator('#rule-search').fill('三昧真火');
  assert.ok((await v2.locator('.rules-list').innerText()).includes('各回合依次'));
  await v2.locator('#rule-search').fill('天闪凌云');
  assert.ok((await v2.locator('.rules-list').innerText()).includes('0至3'));
  assert.ok(!(await v2.locator('.rules-list').innerText()).includes('待确认'));
  await v2.locator('#close-modal').click();
  await v2.locator('#move-search').fill('txly');
  assert.equal(await v2.locator('#move-results [data-id=skyDodge]').count(), 0);
  // Earn 7 real S resources, then verify V3 multisegment shield handling through the normal HTTP/UI flow.
  const v3 = await page(390); await v3.setViewportSize({ width: 390, height: 844 }); await login(v3, '三版测试', v2Base);
  await v3.locator('#create [name=capacity]').selectOption('2'); await v3.locator('#create button').click();
  await v3.locator('[data-act=ready]').waitFor();
  const v3Actors = await v3.evaluate(async () => {
    const own = sessionStorage.getItem('bigarm-token');
    const post = async (url, body, token) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
    const get = async () => (await fetch('/api/state', { headers: { Authorization: `Bearer ${own}` } })).json();
    const initial = await get(), bot = await post('/api/session', { name: '护盾玩家' });
    await post('/api/rooms/join', { roomId: initial.room.id }, bot.token);
    for (const token of [own, bot.token]) await post('/api/rooms/ready', {}, token);
    for (let i = 0; i < 13; i++) {
      const s = await get();
      await post('/api/game/action', { round: s.room.round, move: i % 2 === 0 ? 'basicS' : 'basicB' }, own);
      await post('/api/game/action', { round: s.room.round, move: i < 5 ? 'basicF' : 'basicB' }, bot.token);
      let advanced = false;
      for (let n = 0; n < 200; n++) { const next = await get(); if (next.room.phase === 'selecting' && next.room.round > s.room.round) { advanced = true; break; } await new Promise(r => setTimeout(r, 10)); }
      if (!advanced) throw new Error('v3 fixture did not advance');
    }
    return { own, bot: bot.token, botId: bot.self.id };
  });
  await v3.locator('[data-act=lock]').waitFor();
  await v3.locator('#move-search').fill('myzq');
  await v3.locator('#move-results [data-id=roamingGun]').click(); await battlefieldFits(v3);
  await v3.locator('[data-act=lock]').click();
  const postV3 = async (move, token, round) => {
    const r = await fetch(`${v2Base}/api/game/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ move, round }) });
    assert.equal(r.status, 200, await r.text());
  };
  await postV3('protectorF', v3Actors.bot, 14);
  let v3State = await waitInfo(v3, s => s.room.round === 15 && s.room.phase === 'selecting');
  let target = v3State.room.players.find(p => p.id === v3Actors.botId);
  assert.equal(target.hp, 4); assert.equal(target.shields.length, 0); assert.equal(target.resources.protectorF, 1);
  assert.deepEqual(v3State.room.history[0].damage.map(d => d.amount), [0.5, 0.5]);
  assert.equal(v3State.room.history[0].logs.filter(e => e.type === 'hit').length, 3);
  await v3.locator('[data-act=lock]').waitFor(); await move(v3, 'basicB'); await postV3('protectorB', v3Actors.bot, 15);
  v3State = await waitInfo(v3, s => s.room.round === 16 && s.room.phase === 'selecting');
  assert.equal(v3State.room.players.find(p => p.id === v3Actors.botId).shields.length, 1);
  await v3.locator('[data-act=lock]').waitFor(); await move(v3, 'punch'); await postV3('basicB', v3Actors.bot, 16);
  v3State = await waitInfo(v3, s => s.room.round === 17 && s.room.phase === 'selecting');
  target = v3State.room.players.find(p => p.id === v3Actors.botId);
  assert.equal(target.hp, 3); assert.equal(target.shields.length, 0); assert.equal(target.resources.protectorB, 1);
  assert.ok(v3State.room.history[0].logs.some(e => e.type === 'protectorExpired'));
  await v3.locator('[data-act=lock]').waitFor(); await battlefieldFits(v3);
  await v3.screenshot({ path: 'test-results/v3-result-mobile.png', fullPage: true });
  // Earn the remaining 2S + 4C legally; the recipient uses the real UI for sky-dodge's new choice.
  await v3.evaluate(async ({ bot }) => {
    const own = sessionStorage.getItem('bigarm-token');
    const get = async () => (await fetch('/api/state', { headers: { Authorization: `Bearer ${own}` } })).json();
    const post = async (move, token, round) => { const r = await fetch('/api/game/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ move, round }) }); if (!r.ok) throw new Error(await r.text()); };
    for (const move of ['basicC', 'basicB', 'basicS', 'basicB', 'basicC', 'basicB', 'basicS', 'basicB', 'basicC', 'basicB', 'basicC']) {
      const before = await get(); await post(move, own, before.room.round); await post('basicB', bot, before.room.round);
      let advanced = false;
      for (let n = 0; n < 200; n++) { const next = await get(); if (next.room.phase === 'selecting' && next.room.round > before.room.round) { advanced = true; break; } await new Promise(r => setTimeout(r, 10)); }
      if (!advanced) throw new Error('sky-dodge fixture did not advance');
    }
  }, v3Actors);
  const recipient = await page(390); await recipient.setViewportSize({ width: 390, height: 844 });
  await recipient.addInitScript(token => sessionStorage.setItem('bigarm-token', token), v3Actors.bot);
  await recipient.goto(v2Base); await recipient.locator('[data-act=lock]').waitFor();
  const skyRound = (await info(v3)).room.round;
  await v3.locator('[data-act=lock]').waitFor(); await move(v3, 'skyDodge');
  await move(recipient, 'basicB');
  await waitInfo(recipient, s => s.room.pending?.kind === 'healTransfer');
  await recipient.locator('.choice-option[data-id="3"]').waitFor(); await battlefieldFits(recipient);
  assert.equal(await recipient.locator('.choice-option').count(), 4);
  assert.ok((await recipient.locator('.choice-option[data-id="3"]').innerText()).includes('伤害0，流失3，回血3'));
  await recipient.screenshot({ path: 'test-results/v3-sky-choice-mobile.png', fullPage: true });
  await recipient.locator('.choice-option[data-id="3"]').click();
  const skyResult = await waitInfo(v3, s => s.room.phase === 'finished' || s.room.phase === 'reveal');
  const source = skyResult.room.players.find(p => p.id === skyResult.self.id);
  assert.equal(source.hp, 8); assert.equal(source.maxHp, 8); assert.equal(skyResult.room.history[0].round, skyRound);
  assert.equal(skyResult.room.history[0].damage[0].finalAmount, 0);
  assert.equal(skyResult.room.history[0].lifeLoss[0].amount, 3);
  assert.deepEqual(errors, []);
  console.log('PASS: room lifecycle, hidden locks, legal/pinyin search, desktop/mobile layouts, shields, blessing budgets, V2 statuses/stock/curse, V3 multisegment damage and protector lifecycle, history and scores.');
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
  for (const extra of extraServers) await new Promise(resolve => { extra.close(resolve); extra.closeAllConnections(); });
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
