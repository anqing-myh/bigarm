import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createServer } from '../server/index.js';

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
  const type = id.startsWith('basic') ? 'basic' : ['foam', 'ghost'].includes(id) ? 'equipment' : 'attack';
  await p.locator(`[data-act=tab][data-id=${type}]`).click();
  await p.locator(`[data-act=move][data-id=${id}]`).click();
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
  await move(a, 'basicB');
  const secret = await info(b); assert.equal(secret.room.actions, null); assert.equal(secret.room.ownAction, null);
  await move(b, 'basicB'); await waitInfo(a, s => s.room.round === 2 && s.room.phase === 'selecting');
  await round(a, b, 'kick', 'basicB');
  assert.equal((await info(b)).room.players.find(p => p.name === '乙').hp, 4);
  for (const bm of ['basicF', 'foam', 'basicF', 'foam']) await round(a, b, 'basicB', bm);
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
  await ten.locator('.many-players').waitFor(); assert.equal(await ten.locator('.seat').count(), 10); await fits(ten);
  await ten.screenshot({ path: 'test-results/ten-players-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: home, rules, two independent identities, room/ready, hidden locks, real attacks, equipment, owner choice after reload, mobile layout, history, forfeit result, scores, invite.');
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
