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
const errors = [], contexts = [];
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
  await a.locator('#create [name=name]').fill('朋友的竞技场'); await a.locator('#create [name=capacity]').selectOption('2'); await a.locator('#create button').click();
  const roomId = (await waitInfo(a, s => !!s.room)).room.id;
  await b.locator('#join [name=roomId]').fill(roomId); await b.locator('#join button').click();
  await a.locator('[data-act=ready]').click(); await b.locator('[data-act=ready]').click();
  await a.locator('[data-act=move][data-id=basicB]').waitFor();
  await battlefieldFits(a);
  await a.locator('#move-search').fill('huixuanbiao'); assert.equal(await a.locator('#move-results button').count(), 0);
  await a.locator('#move-search').fill(''); await a.locator('[data-act=all-moves]').click();
  assert.equal(await a.locator('.available-list button').count(), 7); // Six basic actions plus the free guard-six spell.
  await a.locator('.available-list [data-id=basicB]').click(); assert.equal(await a.locator('#modal').isVisible(), false);
  await b.setViewportSize({ width: 390, height: 844 }); await battlefieldFits(b);
  await b.screenshot({ path: 'test-results/selection-mobile.png', fullPage: true });
  await a.screenshot({ path: 'test-results/selection-desktop.png', fullPage: true });
  await move(a, 'basicB');
  const secret = await info(b); assert.equal(secret.room.actions, null); assert.equal(secret.room.ownAction, null);
  await move(b, 'basicB'); await waitInfo(a, s => s.room.round === 2 && s.room.phase === 'selecting');
  await round(a, b, 'kick', 'basicB');
  assert.equal((await info(b)).room.players.find(p => p.name === '乙').hp, 4);
  await b.locator('.combat-fx.damage').waitFor();
  await b.screenshot({ path: 'test-results/damage-mobile.png', fullPage: true });
  for (const bm of ['basicF', 'foam', 'basicF', 'foam']) await round(a, b, 'basicB', bm);
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
  await b.setViewportSize({ width: 390, height: 844 }); await fits(b);
  await b.screenshot({ path: 'test-results/choice-mobile.png', fullPage: true });
  await a.screenshot({ path: 'test-results/arena-desktop.png', fullPage: true });
  await b.locator('.choice-option').first().click();
  await waitInfo(a, s => s.room.phase === 'selecting');
  assert.equal((await info(b)).room.players.find(p => p.name === '乙').shields.length, 1);
  await b.locator('.combat-fx.shield-loss').waitFor();
  await b.screenshot({ path: 'test-results/shield-loss-mobile.png', fullPage: true });
  await a.locator('.arena-corner [data-act=history]').click(); assert.ok((await a.locator('#modal-content').innerText()).includes('命中')); await a.locator('#close-modal').click();
  await b.locator('[data-act=leave]').click(); await waitInfo(a, s => s.room.phase === 'finished');
  await a.locator('[data-act=scores]').click(); assert.ok((await a.locator('#modal-content').innerText()).includes('1 胜')); await a.locator('#close-modal').click();
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
  const small = blessed.locator('.blessing-event').filter({ has: blessed.getByText('剑', { exact: true }) });
  assert.equal(await big.locator('.blessing-quick:visible').count(), 5);
  assert.equal(await small.locator('.blessing-quick:visible').count(), 1);
  await big.locator('input').fill('6'); assert.equal(await small.locator('.blessing-quick:visible').count(), 0);
  await big.locator('input').fill('7'); assert.equal(await blessed.locator('#blessing .primary-button').isDisabled(), true);
  await big.locator('input').fill('0');
  await big.locator('[data-act=bless][data-value="5"]').click();
  await small.locator('[data-act=bless][data-value="1"]').click();
  assert.equal(await blessed.locator('#blessing-left').innerText(), '0');
  const confirm = await blessed.locator('#blessing .primary-button').boundingBox();
  assert.ok(confirm.y >= 0 && confirm.y + confirm.height <= 844, 'blessing confirmation stays visible while damage entries scroll');
  await blessed.screenshot({ path: 'test-results/blessing-mobile.png', fullPage: true });
  await blessed.setViewportSize({ width: 1360, height: 950 }); await battlefieldFits(blessed);
  await blessed.screenshot({ path: 'test-results/blessing-desktop.png', fullPage: true });
  await blessed.locator('#blessing .primary-button').click();
  const result = await waitInfo(blessed, s => s.room.phase !== 'choice');
  assert.equal(result.room.players.find(p => p.id === result.self.id).hp, 2);
  assert.deepEqual(errors, []);
  console.log('PASS: room lifecycle, hidden locks, Chinese/pinyin/initial search, legal move picker, same-screen desktop/mobile/ten-player layout, health/shield feedback, real per-hit blessing shortcuts/input/shared budget, history, forfeit, scores and invite.');
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
