import { MOVES, EQUIPMENT, RESOURCE_NAMES, availableMoves } from '/rules/engine.js';

const $ = selector => document.querySelector(selector);
const app = $('#app'), modal = $('#modal'), modalContent = $('#modal-content');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = sessionStorage.getItem('bigarm-token'), data = null, key = '', busy = false, offset = 0;
const ui = { move: 'basicB', targets: [], tab: 'basic', direction: 'clockwise', blessing: {}, roomName: '', capacity: 10 };
const labels = { basic: '积蓄资源', attack: '攻击招式', equipment: '盾与生产器', spell: '法术防护' };
const spellDescriptions = {
  shock: '指定另一名玩家，移除一件可被小电移除的装备，由受术者选择。自己本回合 2 级免伤。',
  phoenixGuard: '本回合获得 2 级免伤与 2 级免控。', ghostDodge: '本回合和下回合拥有超闪防法，不获得超闪资源。',
  chainDodge: '本回合和后两回合拥有闪防法，不计入基础闪避连续次数。', voidDodge: '本回合拥有超闪防法；本回合和后两回合免疫单体、双目标和溅射，包括回旋镖。普通群攻仍需其他防护。',
  thunderDodge: '本回合获得 2 级免伤与 2 级免控。', heal: '在攻击前恢复自己 1 生命，先按生命上限截顶。', guardSix: '免费防住本回合六拳合一，不获得资源。',
};
const specialDescriptions = {
  ber: '互攻时克制刀。', knife: '真伤绕过普通挡伤盾；普通低点或等点仍可命中，但不能绕过 ber 克制、免疫或防法。', torch: '目标当回合出基础方盾时改为 2 伤害。',
  fireWheel: '两段各 0.5，每段命中（含打盾）获得 1 圆盾。闪只防第一段，圆盾或超闪防两段。',
  quake: '选择一人时点数 15、伤害 1；选择两名不同玩家时点数 7.5、各伤害 1。', knifePoint: '互攻时克制成本含大臂的攻击，被其余攻击克制；镜像抵消。',
  sixFists: '基础动作均不能防；自己本回合 1 级免伤、1 级免控。', boomerang: '按方向从邻座分配 3、4、5…点，全体单体投递初始入队按点数排序；每人伤害 1，可被虚无闪防。',
  phoenix: '攻击前获得 3 祝福值，不要求命中。', phoenixFlame: '主目标 2 伤害，左右存活邻居各溅射 1；去重且不伤自己，仅主目标穿泡级。',
  meteor: '每名以基础/等效防法防住的目标让自己另受一次 0.5 真伤。每次独立，不能合并用祝福减伤。',
  upheaval: '命中后尝试以 1 级控制将空中目标打落，影响后续攻击。', balance: '目标出基础大臂/攒/方盾/圆盾/闪/超闪分别伤害 1/0.5/1.5/2/2.5/3.5；任意非基础行动可防，但仍互攻。',
};
function describe(m) {
  if (spellDescriptions[m.id]) return spellDescriptions[m.id];
  if (m.type === 'equipment') {
    const d = EQUIPMENT[m.id];
    return d.producer ? `对应基础动作总共获得 3 个${RESOURCE_NAMES[d.producer]}。每种生产器最多 1 件，生产器总共最多 2 件。`
      : m.id === 'ghost' ? '消耗两面泡沫盾合成三层盾，每掉一层减少一盾位；穿泡级扣两层，穿尽继续承伤。'
      : d.immuneAll ? '免疫未明确无视或穿透雷达的攻击，可被小电移除。'
      : d.immuneResource ? `免疫成本含${RESOURCE_NAMES[d.immuneResource]}的攻击${d.immuneMove ? '，额外免疫凤之烈焰' : ''}；不匹配时可挡一次伤害并消失。四种元素盾合计最多 2 件。`
      : '抵挡一次普通伤害后消失，没有伤害溢出，真伤不能用普通盾挡住。';
  }
  return [m.description, specialDescriptions[m.id], m.duration && '包含施放当回合，之后仍可正常出招；目标死亡则此持续效果消失。'].filter(Boolean).join(' ');
}
function cost(m) { return Object.entries(m.cost).map(([k, n]) => `${n} ${RESOURCE_NAMES[k]}`).join(' · ') || (m.id === 'ghost' ? '两面泡沫盾' : '免费'); }
function avatar(seat = 0) {
  return `<div class="avatar palette-${seat % 10}"><svg viewBox="0 0 120 100" aria-hidden="true"><path d="M18 83C-3 63 8 20 29 19L41 4 51 18Q68 10 87 23L107 17 104 40Q124 87 88 92L32 92Z" fill="currentColor"/><path d="M37 52Q42 45 47 52M73 52Q78 45 83 52" fill="none" stroke="#22301d" stroke-width="5" stroke-linecap="round"/><path d="M52 65Q60 74 70 64" fill="none" stroke="#22301d" stroke-width="4" stroke-linecap="round"/><circle cx="30" cy="65" r="6" fill="#e78d8544"/><circle cx="90" cy="65" r="6" fill="#e78d8544"/></svg></div>`;
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function connected(ok) { $('#connection').classList.toggle('offline', !ok); $('#connection span').textContent = ok ? '实时联机' : '正在重连'; }
async function api(path, body, method = 'POST') {
  const response = await fetch(path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401) { token = null; sessionStorage.removeItem('bigarm-token'); data = null; key = ''; render(); } throw new Error(result.error || '请求失败'); }
  return result;
}
function receive(next) {
  if (data && next.revision < data.revision) return;
  const newRound = next.room?.phase === 'selecting' && (data?.room?.round !== next.room.round || data?.room?.gameNumber !== next.room.gameNumber);
  if (newRound) { ui.move = 'basicB'; ui.targets = []; ui.blessing = {}; }
  offset = next.serverTime - Date.now(); data = next; connected(true); render();
}
async function refresh() { if (!token) return; const identity = token; const next = await api('/api/state', undefined, 'GET'); if (identity === token) receive(next); }
async function polling() { try { await refresh(); } catch { connected(false); } finally { setTimeout(polling, 800); } }
function show(content) { modalContent.innerHTML = content; if (!modal.open) modal.showModal(); }
function home() {
  return `<section class="hero"><div><span class="pill"><span class="live-dot"></span> 与朋友，共赴一场策略对决</span><h1>积蓄力量，<br>见招拆招<span class="accent">。</span></h1><p>六种资源，百般变化。<br>蓄力、造盾、预判——在同时亮招的瞬间，决定胜负。</p><form id="login" class="login-card"><label for="nickname">给自己起一个临时昵称</label><div class="input-row"><input id="nickname" name="name" maxlength="12" required placeholder="你在战场上的名字" autocomplete="nickname"><button class="primary-button">进入大厅 ↗</button></div><small class="fine">无需账号 · 2–10 人联机 · 手机与电脑都能玩</small></form><button class="text-button" data-act="rules">先看看招式手册 →</button></div><div class="hero-art" aria-label="大臂竞技场插画"><div class="art-grid"></div><div class="orbit outer"></div><div class="orbit"></div><span class="art-label">BIGARM / ROUND 01</span><div class="hero-creature">${avatar(0)}</div><div class="hero-creature two">${avatar(1)}</div><div class="hero-creature three">${avatar(2)}</div><span class="float-card">✦ 积蓄，等待时机</span><span class="float-card lower">◇ 护盾，守住每一招</span><span class="art-bottom">● 同时选择 · 同时亮招 · 一起开局</span></div></section><section class="steps"><div><span class="eyebrow">HOW TO PLAY</span><h2>三步，进入战场。</h2></div><div><h3>01 / 叫上朋友</h3><p>创建房间，分享房间号或邀请链接。</p></div><div><h3>02 / 选择招式</h3><p>积蓄六种资源，制造护盾，指定目标。</p></div><div><h3>03 / 同时亮招</h3><p>比较攻击点数，完成选盾与减伤，决出胜者。</p></div></section>`;
}
function lobby() {
  return `<div class="page-heading"><div><span class="eyebrow">THE LOBBY</span><h1>下一场对决，等你入席 <span class="accent">✦</span></h1><p>你好，${esc(data.self.name)}。创建一个房间，或加入朋友的战场。</p></div></div><div class="lobby"><section class="room-grid">${data.rooms.length ? data.rooms.map(r => `<article class="room-card"><span class="status-pill">${r.phase === 'waiting' || r.phase === 'finished' ? '等待入席' : '正在对局'}</span><h2>${esc(r.name)}</h2><p class="room-id"># ${r.id}</p><footer><span>${r.count} / ${r.capacity} 人</span><button class="text-button accent" data-act="join" data-id="${r.id}" ${['selecting', 'choice', 'reveal'].includes(r.phase) || r.count >= r.capacity ? 'disabled' : ''}>加入房间 ↗</button></footer></article>`).join('') : '<div class="empty"><b>战场还很安静。</b><p>创建第一个房间，叫上朋友一起开始。</p><span class="accent">✦</span></div>'}</section><aside><section class="panel"><span class="eyebrow">YOUR ARENA</span><h2>创建房间</h2><form id="create"><input name="name" aria-label="房间名称" maxlength="20" placeholder="给房间起个名字" value="${esc(ui.roomName)}"><label>人数上限 <select name="capacity">${Array.from({ length: 9 }, (_, i) => i + 2).map(n => `<option ${n === ui.capacity ? 'selected' : ''}>${n}</option>`).join('')}</select></label><button class="primary-button">创建并进入 ↗</button></form></section><section class="panel"><h2>加入朋友</h2><form id="join"><input name="roomId" aria-label="房间号" maxlength="6" placeholder="输入 6 位房间号" required><button class="secondary-button">加入房间 →</button></form></section><button class="text-button" data-act="rules">查看完整招式手册 →</button></aside></div>`;
}
const nameOf = id => data.room.players.find(p => p.id === id)?.name || '玩家';
function seats(room) {
  const members = room.players.filter(p => !p.left), ownIndex = Math.max(0, members.findIndex(p => p.id === data.self.id));
  const revealed = room.actions || {};
  return members.map((p, index) => {
    const action = revealed[p.id], selected = ui.targets.includes(p.id);
    const m = MOVES[ui.move], canTarget = room.phase === 'selecting' && !room.ownAction && ['single', 'dual', 'splash'].includes(m?.target) && p.id !== data.self.id && p.hp > 0;
    const bubble = action ? `${MOVES[action.move]?.name || ''}${action.targets?.length ? ' → ' + action.targets.map(id => nameOf(id)).join('、') : ''}` : room.submitted.includes(p.id) ? '已锁定' : p.ready ? '已准备' : '';
    return `<button class="seat ${p.id === data.self.id ? 'mine' : ''} ${p.hp <= 0 ? 'dead' : ''} ${selected ? 'selected' : ''} ${canTarget ? 'targetable' : ''}" data-act="seat" data-id="${p.id}" data-position="${(index - ownIndex + members.length) % members.length}" data-count="${members.length}" aria-label="${esc(p.name)}，${p.hp} 生命${canTarget ? '，选择目标' : ''}">${bubble ? `<span class="bubble">${esc(bubble)}</span>` : ''}${avatar(p.seat)}<strong>${p.seat + 1}. ${esc(p.name)}${p.id === data.self.id ? ' · 你' : ''}</strong><span class="vitals">♥ ${p.hp} / ${p.maxHp}${p.resources.Q ? ' · 祝 ' + p.resources.Q : ''}</span><span class="resources">${Object.entries(RESOURCE_NAMES).filter(([k]) => k !== 'Q').map(([k, name]) => `<span>${name} ${p.resources[k]}</span>`).join('')}</span><span class="equipment-line">${p.shields.map(s => EQUIPMENT[s.type].name).join(' · ') || (p.connected ? '暂无装备' : '暂时离线')}</span></button>`;
  }).join('');
}
function detail(m) {
  if (!m) return '';
  return `<b>${esc(m.name)}</b> · ${esc(cost(m))}<p>${esc(describe(m))}</p>${m.type === 'attack' ? `<div class="detail-stats"><span>${m.target === 'dual' ? '7.5 / 单目标15' : m.target === 'path' ? '3、4、5…' : m.power / 10} 点</span><span>${({ single: '单目标', all: '其他所有存活者', dual: '一至两个目标', splash: '主目标及存活邻居', path: '方向路径单体' })[m.target]}</span><span>${m.air ? '可对空' : '不对空'}</span><span>防法：${m.id === 'balance' ? '任意非基础行动' : m.id === 'sixFists' ? '防六拳合一及适用免疫' : [...m.guard].map(k => RESOURCE_NAMES[k]).join(' / ') || '无基础防法'}</span>${m.pierce?.length ? `<span>穿透：${m.pierce.join(' / ').replace('foam', '泡级').replace('electric', '闪级').replace('radar', '雷达')}</span>` : ''}${m.ignore?.length ? `<span>无视：${m.ignore.join(' / ').replace('foam', '泡级').replace('electric', '闪级').replace('radar', '雷达')}</span>` : ''}</div>` : ''}`;
}
function choicePanel(room) {
  const c = room.pending, mine = c.playerId === data.self.id;
  const title = { shock: '小电生效 · 选择移除装备', shield: '攻击命中 · 选择承伤护盾', blessing: '回合末 · 分配祝福减伤', discard: '装备超限 · 选择必要弃置' }[c.kind];
  if (!mine) return `<section class="panel choice-panel"><h2>${title}</h2><p>等待 ${esc(nameOf(c.playerId))} 完成选择。</p><span class="clock" data-countdown></span></section>`;
  if (c.kind === 'blessing') return `<section class="panel choice-panel"><h2>${title}</h2><p>可用 ${c.budget} 祝福值。每次最终伤害必须大于 0；花费需为整数。</p><form id="blessing">${c.events.map(e => `<label class="blessing-row">${esc(MOVES[e.move].name)} · ${e.amount} 伤害<input type="number" name="${e.id}" min="0" max="${Math.min(e.max, c.budget)}" step="1" value="${ui.blessing[e.id] || 0}" aria-label="${esc(MOVES[e.move].name)}的祝福减伤"></label>`).join('')}<button class="primary-button">确认减伤</button></form></section>`;
  return `<section class="panel choice-panel"><h2>${title}</h2><p>${c.kind === 'discard' ? '每个方案均只弃置恢复上限所必要的装备。' : '从当前合法对象中选择一项，结算会继续。'}</p><div class="choice-options">${c.options.map(o => `<button class="choice-option" data-act="choice" data-id="${esc(o.id)}">${esc(o.label)}</button>`).join('')}</div></section>`;
}
function arsenal(room, me) {
  if (room.phase === 'choice') return choicePanel(room);
  if (['waiting', 'finished'].includes(room.phase)) return `<section class="panel ready-panel"><div><h2>${room.phase === 'finished' ? room.lastMatch?.winnerId ? `${esc(room.lastMatch.winnerName)} 获胜` : '全员阵亡 · 平局' : '等朋友入席'}</h2><p class="fine">至少两人、全员准备即可开局。每局从 5 生命和零资源重新开始。</p></div><button class="primary-button" data-act="ready">${me.ready ? '取消准备' : room.phase === 'finished' ? '准备下一局' : '准备开局'}</button></section>`;
  if (room.phase === 'reveal') return `<section class="panel waiting"><h2>${room.result?.finished ? room.lastMatch?.winnerName ? `${esc(room.lastMatch.winnerName)} 获胜` : '平局' : '本回合结算完成'}</h2><p>${room.result?.damage?.length ? room.result.damage.map(d => `${esc(nameOf(d.target))} −${d.amount - d.blessing}`).join(' · ') : '本回合无人受伤'}</p><button class="text-button" data-act="history">查看战况记录 →</button></section>`;
  if (me.hp <= 0) return '<section class="panel waiting">你已阵亡，正在观战。持续攻击仍按规则生效。</section>';
  if (room.ownAction) return `<section class="panel waiting"><h2>已锁定 · ${esc(MOVES[room.ownAction.move].name)}</h2><p>其他玩家的选择在全员锁定后同时揭晓。</p></section>`;
  const allowed = availableMoves({ players: room.players, round: room.round }, me.id), visible = allowed.filter(m => m.type === ui.tab), m = MOVES[ui.move];
  return `<section class="arsenal"><div class="arsenal-heading"><h2>选择你的招式</h2><span class="fine">只显示当前可用招式</span></div><div class="tabs">${Object.entries(labels).map(([id, label]) => `<button class="${id === ui.tab ? 'active' : ''}" data-act="tab" data-id="${id}">${label}</button>`).join('')}</div><div class="moves">${visible.length ? visible.map(m => `<button class="move-card ${ui.move === m.id ? 'selected' : ''}" data-act="move" data-id="${m.id}" aria-pressed="${ui.move === m.id}"><b>${esc(m.name)}</b><small>${esc(cost(m))}</small></button>`).join('') : '<p class="fine">暂时没有可用招式，先积蓄对应资源。</p>'}</div><div class="action-detail">${detail(m)}</div>${m.target === 'path' ? `<div class="direction"><button class="secondary-button small" data-act="direction" data-id="clockwise" aria-pressed="${ui.direction === 'clockwise'}">${ui.direction === 'clockwise' ? '✓ ' : ''}顺时针</button><button class="secondary-button small" data-act="direction" data-id="counterclockwise" aria-pressed="${ui.direction === 'counterclockwise'}">${ui.direction === 'counterclockwise' ? '✓ ' : ''}逆时针</button></div>` : ''}<div class="lock-row"><span class="target-hint">${m.target === 'dual' ? '点击头像选择一至两名不同目标' : ['single', 'splash'].includes(m.target) ? '点击战场头像选择目标' : m.target === 'path' ? '从对应方向邻座分配点数，按高点优先结算' : '无需指定目标'}${ui.targets.length ? ' · ' + ui.targets.map(id => esc(nameOf(id))).join('、') : ''}</span><button class="primary-button" data-act="lock" ${busy ? 'disabled' : ''}>锁定 · ${esc(m.name)} ↗</button></div></section>`;
}
function roomPage(room) {
  const me = room.players.find(p => p.id === data.self.id), active = room.players.filter(p => !p.left), living = active.filter(p => p.hp > 0);
  const title = room.phase === 'selecting' ? room.ownAction ? '已锁定，等待亮招' : '秘密选择，同时亮招' : room.phase === 'choice' ? '完成回合中的选择' : room.phase === 'reveal' ? '同时亮招 · 结算结果' : room.phase === 'finished' ? '本局结束' : '集结，准备开局';
  return `<div class="room-toolbar"><div class="room-title"><small>ROOM / ${room.id}</small><h1>${esc(room.name)}</h1></div><div class="toolbar-actions"><button class="secondary-button small" data-act="invite">邀请朋友 ↗</button><button class="text-button" data-act="leave">退出房间</button></div></div><section class="arena-wrap"><div class="arena-corner"><button class="text-button" data-act="scores">胜场榜</button><button class="text-button" data-act="history">战况记录</button><button class="text-button" data-act="rules">招式手册</button></div><div class="arena ${active.length > 6 ? 'many-players' : ''}"><div class="arena-circle"></div><div class="arena-center"><span class="eyebrow">${room.round ? 'ROUND ' + String(room.round).padStart(2, '0') : 'BIGARM ARENA'}</span><div class="symbol">✦</div><h2>${title}</h2><p>${room.phase === 'selecting' ? `${room.submitted.length} / ${living.length} 已锁定` : `${active.length} / ${room.capacity} 人 · ${living.length} 人存活`}</p><div class="clock" data-countdown></div></div>${seats(room)}</div><div class="mobile-status">你的资源：${Object.entries(RESOURCE_NAMES).map(([k, name]) => `${name} ${me.resources[k]}`).join(' · ')}<br>点击玩家头像查看完整资源、盾层与持续效果。</div></section>${arsenal(room, me)}`;
}
function positionSeats() {
  const arena = $('.arena'); if (!arena) return;
  const w = arena.clientWidth, h = arena.clientHeight, mobile = w < 550;
  for (const el of document.querySelectorAll('.seat')) {
    const angle = Math.PI / 2 + Number(el.dataset.position) * Math.PI * 2 / Number(el.dataset.count);
    el.style.left = `${w / 2 + Math.cos(angle) * (w / 2 - (mobile ? 48 : 85))}px`;
    el.style.top = `${h / 2 + Math.sin(angle) * (h / 2 - (mobile ? 100 : 115))}px`;
  }
}
function render() {
  const stable = JSON.stringify([data?.self, data?.rooms, data?.room, ui, token ? true : false, busy]);
  if (stable === key) return; key = stable;
  app.innerHTML = !token || !data ? home() : data.room ? roomPage(data.room) : lobby();
  $('#user-button').classList.toggle('hidden', !data?.self); $('#user-button').textContent = data?.self?.name || '';
  positionSeats(); countdown();
}
function countdown() { const deadline = data?.room?.deadline; for (const el of document.querySelectorAll('[data-countdown]')) el.textContent = deadline ? `${Math.max(0, Math.ceil((deadline - Date.now() - offset) / 1000))}s` : ''; }
function showRules(query = '') {
  const matches = Object.values(MOVES).filter(m => `${m.name}${describe(m)}`.toLowerCase().includes(query.toLowerCase()));
  show(`<span class="eyebrow">FIELD GUIDE / ${Object.keys(MOVES).length} ACTIONS</span><h2>大臂 · 招式手册</h2><p class="fine">开局 5 生命，零资源。基础动作免费获得资源；攻击点数只在互攻时比较，低者失效、等点抵消。</p><input class="rule-search" id="rule-search" placeholder="搜索招式或效果" value="${esc(query)}" aria-label="搜索招式"><div class="rules-note">基础方盾、圆盾是当回合防法，与持有的护盾不同。护盾上限 5 盾位、同名最多 2 件；四种元素盾合计最多 2 件，生产器每种最多 1 件且合计最多 2 件。超限在判死后作必要弃置。祝福值按每次伤害减伤，最终必须大于 0。</div><div class="rules-list">${matches.map(m => `<article class="rule-card">${detail(m)}${m.type === 'equipment' ? `<p>位置 ${EQUIPMENT[m.id].position} · 占 ${EQUIPMENT[m.id].slots} 盾位${EQUIPMENT[m.id].electric ? ' · 可被小电移除' : ''}</p>` : ''}</article>`).join('')}</div>`);
}
function showPlayer(id) {
  const p = data.room.players.find(p => p.id === id);
  show(`<h2>${esc(p.name)}</h2><div class="detail-stats">${Object.entries(RESOURCE_NAMES).map(([k, name]) => `<span>${name} ${p.resources[k]}</span>`).join('')}</div><p>生命 ${p.hp} / ${p.maxHp}${p.airborne ? ' · 在空中' : ''}</p><div class="equipment-detail">${p.shields.map(s => `<p>${esc(EQUIPMENT[s.type].name)}${s.type === 'ghost' ? ` · ${s.layers} 层` : ''}</p>`).join('') || '暂无装备'}</div><p class="fine">${p.effects.map(e => `${e.kind === 'defense' ? RESOURCE_NAMES[e.value] + '防法' : '单体范围免疫'} · 至第 ${e.end} 回合`).join('<br>') || '没有持续防御'}</p>`);
}
async function perform(action) {
  if (busy) return; busy = true;
  try { await action(); await refresh(); } catch (e) { toast(e.message); } finally { busy = false; key = ''; render(); }
}
document.addEventListener('submit', event => {
  event.preventDefault(); const form = event.target, fields = new FormData(form);
  if (form.id === 'login') return perform(async () => { const result = await api('/api/session', { name: fields.get('name') }); token = result.token; sessionStorage.setItem('bigarm-token', token); receive(result); const invite = new URL(location.href).searchParams.get('room'); if (invite) await api('/api/rooms/join', { roomId: invite }); });
  if (form.id === 'create') return perform(() => api('/api/rooms/create', { name: fields.get('name'), capacity: Number(fields.get('capacity')) }));
  if (form.id === 'join') return perform(() => api('/api/rooms/join', { roomId: fields.get('roomId') }));
  if (form.id === 'blessing') return perform(() => api('/api/game/choice', { round: data.room.round, requestId: data.room.pending.id, answer: Object.fromEntries([...fields].map(([k, v]) => [k, Number(v)])) }));
});
document.addEventListener('click', event => {
  const button = event.target.closest('[data-act]'); if (!button || button.disabled) return;
  const { act, id } = button.dataset, room = data?.room;
  if (act === 'rules') return showRules();
  if (act === 'join') return perform(() => api('/api/rooms/join', { roomId: id }));
  if (act === 'ready') return perform(() => api('/api/rooms/ready', {}));
  if (act === 'leave') return perform(() => api('/api/rooms/leave', {}));
  if (act === 'tab') { ui.tab = id; render(); return; }
  if (act === 'direction') { ui.direction = id; render(); return; }
  if (act === 'move') {
    ui.move = id; ui.targets = [];
    const others = room.players.filter(p => p.hp > 0 && !p.left && p.id !== data.self.id);
    if (others.length === 1 && ['single', 'dual', 'splash'].includes(MOVES[id].target)) ui.targets = [others[0].id];
    render(); return;
  }
  if (act === 'seat') {
    const m = MOVES[ui.move], p = room.players.find(p => p.id === id);
    if (room.phase === 'selecting' && !room.ownAction && ['single', 'dual', 'splash'].includes(m?.target) && id !== data.self.id && p.hp > 0 && !p.left) {
      if (m.target === 'dual') ui.targets = ui.targets.includes(id) ? ui.targets.filter(x => x !== id) : [...ui.targets, id].slice(-2);
      else ui.targets = [id]; render();
    } else showPlayer(id);
    return;
  }
  if (act === 'lock') {
    const m = MOVES[ui.move]; if (['single', 'dual', 'splash'].includes(m.target) && !ui.targets.length) return toast('请先点击头像选择目标。');
    return perform(() => api('/api/game/action', { round: room.round, move: m.id, target: ui.targets[0], targets: ui.targets, direction: ui.direction }));
  }
  if (act === 'choice') return perform(() => api('/api/game/choice', { round: room.round, requestId: room.pending.id, answer: id }));
  if (act === 'invite') {
    const link = `${location.origin}/?room=${room.id}`;
    show(`<h2>邀请朋友</h2><p class="fine">房间号：${room.id} · 让朋友访问同一台服务器。</p><input class="invite-field" aria-label="邀请链接" readonly value="${esc(link)}"><button class="primary-button" data-act="copy">复制邀请链接</button>`); return;
  }
  if (act === 'copy') { if (!navigator.clipboard) toast('请长按或选中链接复制。'); else navigator.clipboard.writeText($('.invite-field').value).then(() => toast('邀请链接已复制。')).catch(() => toast('请长按或选中链接复制。')); return; }
  if (act === 'history') { show(`<h2>战况记录</h2><div class="log-list">${room.history.length ? room.history.map(h => `<article class="log-entry"><h3>第 ${h.gameNumber} 局 · 回合 ${h.round}</h3>${h.logs.map(l => `<p>${esc(l.text)}</p>`).join('')}${h.damage.length ? `<p class="accent">最终伤害：${h.damage.map(d => `${esc(nameOf(d.target))} −${d.amount - d.blessing}`).join(' · ')}</p>` : ''}</article>`).join('') : '<p class="fine">第一回合后会在这里记录每一次判定。</p>'}</div>`); return; }
  if (act === 'scores') { show(`<h2>本房间胜场榜</h2>${room.leaderboard.map(p => `<div class="score-row"><b>${esc(p.name)}</b><span>${p.wins} 胜 / ${p.games} 局</span></div>`).join('')}`); return; }
  if (act === 'logout') return perform(async () => { if (room) await api('/api/rooms/leave', {}); token = null; data = null; sessionStorage.removeItem('bigarm-token'); modal.close(); });
});
document.addEventListener('input', event => {
  if (event.target.id === 'rule-search') { const cursor = event.target.selectionStart; showRules(event.target.value); $('#rule-search').focus(); $('#rule-search').setSelectionRange(cursor, cursor); }
  if (event.target.closest('#create')) { ui.roomName = $('#create [name=name]').value; ui.capacity = Number($('#create [name=capacity]').value); }
  if (event.target.closest('#blessing')) ui.blessing[event.target.name] = Number(event.target.value);
});
$('#rules-button').addEventListener('click', () => showRules());
$('#user-button').addEventListener('click', () => show(`<h2>${esc(data.self.name)}</h2><p class="fine">刷新保留同一标签页身份，新标签页可以作为另一个玩家。</p><button class="secondary-button" data-act="logout">${data.room ? '离开房间并' : ''}更换临时昵称</button>`));
$('#close-modal').addEventListener('click', () => modal.close());
window.addEventListener('resize', positionSeats); setInterval(countdown, 250);
render(); connected(true);
if (token) { try { const result = await api('/api/session', { token }); receive(result); const invite = new URL(location.href).searchParams.get('room'); if (invite && !result.room) { try { await api('/api/rooms/join', { roomId: invite }); await refresh(); } catch (e) { toast(e.message); } } } catch { token = null; sessionStorage.removeItem('bigarm-token'); render(); } }
polling();
