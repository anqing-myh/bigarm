import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { MOVES, validateAction, payCosts, resolveRound } from '../server/game.js';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const errors = [];
const contexts = [];
const pages = [];
await mkdir('test-results', { recursive: true });
async function screenshot(page, name) { await page.screenshot({ path: `test-results/${name}.png`, fullPage: true }); }
async function clickMove(page, move, target) {
  await page.locator(`[data-act=move][data-id="${move}"]`).click();
  if (target) await page.locator(`[data-act=target][data-id="${target}"]`).click();
  await page.locator('[data-act=submit-action]').click();
}
async function info(page) { return page.evaluate(async () => { const r = await fetch('/api/state', { headers: { Authorization: 'Bearer ' + sessionStorage.getItem('zaizai-token') } }); return r.json(); }); }
async function checkTutorial(page){
  const requests=[];
  const track=request=>{if(/\/api\/(?:rooms|game)\//.test(request.url()))requests.push(request.url());};
  page.on('request',track);
  try{
    await page.evaluate(()=>localStorage.removeItem('zaizai-tutorial-v2'));
    await page.setViewportSize({width:360,height:800});
    await page.locator('[data-act=tutorial-start]').click();
    const expected=[['charge','hammer','gun'],['fireball','quake'],['holy','gold','shieldHammer'],['angel','darkAngel'],['meteor','wave','avalanche']];
    const basicHints=['开局的第一回合，先出仔积蓄力量','对方可能会使用防来抵挡你的枪，试试出锤来攻击！','你已经用锤锤掉了对方的一个仔，现在对方没有仔了，试试用枪攻击他！'];
    let previous;
    for(let level=0;level<expected.length;level++){
      for(let step=0;step<expected[level].length;step++){
        const move=expected[level][step];
        const before=await page.evaluate(()=>({player:{...tutorial.player},robot:{...tutorial.robot},robot2:tutorial.robot2?{...tutorial.robot2}:null,move:tutorial.move,robotMove:tutorial.robotMove,robot2Move:tutorial.robot2Move}));
        assert.equal(before.move,move);
        assert.equal(before.player.hp,1,'练习开始时玩家生命为 1');
        if(level===0){
          if(step>0)assert.deepEqual([before.player,before.robot],previous,'基础关连续保留结算状态');
          assert.equal(await page.locator('.tutorial-action').count(),0,'亮招前隐藏机器人招式');
          assert.equal((await page.locator('.tutorial-prompt p').first().textContent()),basicHints[step]);
          assert.equal(before.robotMove,['charge','guard','charge'][step]);
          if(step===2)assert.equal(before.robot.energy,0,'锤消耗对手的仔');
        }
        assert.match(await page.locator('.tutorial-prompt').textContent(),new RegExp(courseName(move)));
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'手机教程无横向溢出');
        if(level===0&&step===1){
          await page.locator('[data-act=tutorial-exit]').click();
          await page.locator('[data-act=tutorial-start]').click();
          assert.equal(await page.evaluate(()=>tutorial.progress.step),1,'退出后恢复当前题');
          assert.deepEqual(await page.evaluate(()=>({...tutorial.player})),before.player);
        }
        if(move==='gold')assert.match(await page.locator('.tutorial-prompt').textContent(),/预选反弹：枪/);
        if(move==='avalanche'){
          const prompt=await page.locator('.tutorial-prompt p').first().textContent();
          assert.match(prompt,/禁用当回合所出的招式/);
          assert.equal((prompt.match(/机器人出「仔」/g)||[]).length,1);
          assert.doesNotMatch(prompt,/机器人禁用仔/);
        }
        await page.locator('[data-act=tutorial-move]').click();
        if(move==='meteor'){
          assert.equal(await page.locator('[data-act=tutorial-interrupt]').count(),2);
          await page.locator('[data-act=tutorial-interrupt][data-id=robot]').click();
        }
        await page.locator('[data-act=tutorial-next]').waitFor();
        assert.doesNotMatch(await page.locator('.tutorial-prompt').textContent(),/请使用|选择「/,'结算后不再提示选择招式');
        assert.ok((await page.locator('.tutorial-result-copy').first().textContent()).includes(MOVES[move].description),'结算展示玩法手册完整效果');
        if(level===0&&move==='hammer'){
          assert.ok((await page.locator('.tutorial-result-copy').first().textContent()).includes(MOVES.guard.description),'锤的结算同时教学防的完整效果');
          assert.equal(await page.locator('.tutorial-result-copy').first().locator('br').count(),1,'锤和防分行显示');
        }
        const players=[before.player,before.robot,...(before.robot2?[before.robot2]:[])];
        const actions={player:validateAction(players,'player',{move,target:'robot',reflect:'gun'}),robot:validateAction(players,'robot',{move:before.robotMove,target:'player'})};
        if(before.robot2)actions.robot2=validateAction(players,'robot2',{move:before.robot2Move});
        const result=resolveRound(payCosts(players,actions),actions,move==='meteor'?{player:'robot'}:{});
        assert.deepEqual(await page.evaluate(()=>[tutorial.player,tutorial.robot,...(tutorial.robot2?[tutorial.robot2]:[])]),result.players,'结算与服务端一致');
        if(level===0&&move==='gun')assert.equal(result.changes.robot.damage,1,'枪击中机器人');
        const seats=page.locator('.tutorial-player');
        for(let i=0;i<players.length;i++){
          const delta=result.changes[players[i].id]||{}, seat=seats.nth(i);
          assert.equal(await seat.locator('.damage-float').count(),delta.damage?1:0,'伤害浮字对应结算');
          assert.equal(await seat.locator('.heal-float').count(),delta.healing?1:0,'治疗浮字对应结算');
          assert.equal(await seat.evaluate(el=>el.classList.contains('is-muted')),result.muted.includes(players[i].id),'封锁标识对应结算');
          assert.equal(await seat.evaluate(el=>el.classList.contains('is-dead')),result.players[i].hp<=0,'阵亡状态对应结算');
        }
        assert.equal(await page.locator('.tutorial-arena.arena-damage').count(),result.hasDamage?1:0,'受伤播放场地动画');
        if(before.robot2){
          assert.equal(await page.locator('.tutorial-opponents .tutorial-player').count(),2,'范围攻击展示两名机器人');
          assert.ok(result.players.slice(1).every(p=>p.hp<=0),'范围攻击击败两名机器人');
          if(move==='wave'){
            assert.equal(result.changes.robot.damage,2,'海浪与反弹火球各造成 1 点伤害');
            assert.equal(result.changes.robot2.damage,1);
            assert.match(await page.locator('.tutorial-result-copy').first().textContent(),/反弹火球.*额外.*1 点火球伤害/);
          }
        }
        if(move==='avalanche'){assert.equal(before.robotMove,'charge');assert.equal(result.players[0].hp,before.player.hp);assert.equal(result.avalanche.bans.robot,'charge');}
        previous=result.players;
        if(step===expected[level].length-1)assert.match(await page.locator('.tutorial-result-copy').last().textContent(),/完成本关/);
        await page.locator('[data-act=tutorial-next]').click();
      }
    }
    assert.equal(await page.locator('.tutorial-page').count(),0,'完成后返回原界面');
    await page.locator('[data-act=tutorial-start]').click();
    assert.deepEqual(await page.evaluate(()=>[tutorial.progress.level,tutorial.progress.step]),[0,0],'完成后重新进入从头学习');
    await page.locator('[data-act=tutorial-exit]').click();
    assert.deepEqual(requests,[],'教程不发送房间或联机出招请求');
  }finally{page.off('request',track);await page.setViewportSize({width:1440,height:1050});}
}
function courseName(move){return {charge:'仔',gun:'枪',hammer:'锤',guard:'防',fireball:'火球',quake:'地震',holy:'圣盾',gold:'金盾',shieldHammer:'锤带盾',angel:'天使',darkAngel:'黑天使',meteor:'流星锤',wave:'海浪',avalanche:'雪崩'}[move];}
async function checkRing(page,count){
  const ring=await page.evaluate(()=>[...document.querySelectorAll('.seat[data-seat]')].map(el=>({seat:Number(el.dataset.seat),x:parseFloat(el.style.left),y:parseFloat(el.style.top),me:el.classList.contains('is-me')})).sort((a,b)=>a.seat-b.seat));
  assert.equal(ring.length,count);const me=ring.find(p=>p.me);assert.ok(me);
  assert.ok(Math.abs(me.x-50)<.001&&Math.abs(me.y-86)<.001,'每一名玩家的视角都把自己置于环形底部');
  const angles=ring.map(p=>(Math.atan2((50-p.y)/36,(p.x-50)/39)+Math.PI*2)%(Math.PI*2));
  const total=angles.reduce((sum,a,i)=>sum+(angles[(i+1)%angles.length]-a+Math.PI*2)%(Math.PI*2),0);
  assert.ok(Math.abs(total-Math.PI*2)<.001,'所有视角中序号小到大逆时针排列');
}
async function checkArenaCorners(page){
  const corners=await page.evaluate(()=>{
    const arena=document.querySelector('.arena'),r=arena.getBoundingClientRect();
    return [['show-leaderboard',false],['show-history',true]].map(([act,bottom])=>{
      const button=arena.querySelector('[data-act="'+act+'"]');if(!button)return false;
      const b=button.getBoundingClientRect();
      return button.parentElement===arena&&b.left>=r.left&&b.right<=r.right&&b.top>=r.top&&b.bottom<=r.bottom&&(bottom?b.right>r.left+r.width/2&&b.top>r.top+r.height/2:b.right<r.left+r.width/2&&b.bottom<r.top+r.height/2);
    });
  });
  assert.deepEqual(corners,[true,true],'排行榜与战况按钮直接位于战场内部左上角和右下角');
}

async function checkArenaFooter(page){
  const centers=await page.evaluate(()=>{
    const label=document.querySelector('.match-progress').getBoundingClientRect();
    const me=document.querySelector('.seat.is-me').getBoundingClientRect();
    return {label:label.left+label.width/2,me:me.left+me.width/2};
  });
  assert.ok(Math.abs(centers.label-centers.me)<1,'局数与回合数位于己方角色正下方');
}

async function checkPlayViewport(page){
  const result=await page.evaluate(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect();const arena=rect('.battle-panel'),controls=rect('.arsenal');return {arenaVisible:arena.top>=0&&arena.bottom<=innerHeight,controlsVisible:controls.top>=0&&controls.bottom<=innerHeight,inside:controls.left>=arena.left&&controls.right<=arena.right&&controls.top>=arena.top&&controls.bottom<=arena.bottom};});
  assert.ok(result.arenaVisible&&result.controlsVisible&&result.inside,'环形战场与中央可用招式完整同屏，无需滚动');
}
async function checkAvatarsClear(page){
  const overlaps=await page.evaluate(()=>{const c=document.querySelector('.arena-controls').getBoundingClientRect();return [...document.querySelectorAll('.seat[data-seat] .avatar-shell')].filter(el=>{const r=el.getBoundingClientRect();return Math.min(r.right,c.right)>Math.max(r.left,c.left)&&Math.min(r.bottom,c.bottom)>Math.max(r.top,c.top);}).map(el=>el.closest('.seat').dataset.seat);});
  assert.deepEqual(overlaps,[],'玩家头像不与中央招式区重叠');
}
async function checkActionTable(page,count){
  const result=await page.evaluate(()=>{const arena=document.querySelector('.arena').getBoundingClientRect(),intersects=(a,b)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+.5&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+.5,items=[...document.querySelectorAll('.table-action')].map(el=>{const r=el.getBoundingClientRect(),seat=document.querySelector('.seat[data-id="'+el.dataset.playerId+'"] .avatar-shell').getBoundingClientRect(),style=getComputedStyle(el),centerX=r.left+r.width/2,centerY=r.top+r.height/2,avatarX=seat.left+seat.width/2,avatarY=seat.top+seat.height/2,centerRadius=Math.hypot((centerX-arena.left-arena.width/2)/arena.width,(centerY-arena.top-arena.height/2)/arena.height),avatarRadius=Math.hypot((avatarX-arena.left-arena.width/2)/arena.width,(avatarY-arena.top-arena.height/2)/arena.height),alignment=(centerX-arena.left-arena.width/2)*(avatarX-arena.left-arena.width/2)+(centerY-arena.top-arena.height/2)*(avatarY-arena.top-arena.height/2);return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,fontSize:parseFloat(style.fontSize),inside:r.left>=arena.left&&r.right<=arena.right&&r.top>=arena.top&&r.bottom<=arena.bottom,insideAvatarRing:centerRadius<avatarRadius&&alignment>0,avatarOverlap:intersects(r,seat),rectangular:Math.abs(r.width-r.height)>8&&parseFloat(style.borderTopLeftRadius)>=5,expanded:el.classList.contains('expanded'),seatLabel:!!el.querySelector('.table-action-seat')?.textContent.trim(),moveIcon:!!el.querySelector('.table-action-icon')?.textContent.trim()};});const overlaps=[];for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)if(Math.min(items[i].right,items[j].right)>Math.max(items[i].left,items[j].left)+.5&&Math.min(items[i].bottom,items[j].bottom)>Math.max(items[i].top,items[j].top)+.5)overlaps.push([i,j]);return {items,overlaps,seatBubbles:document.querySelectorAll('.seat .action-bubble:not(.locked)').length};});
  assert.equal(result.items.length,count,'每位玩家在头像内侧展示亮招');
  assert.equal(result.seatBubbles,0,'亮招信息不堆在头像上方');
  assert.ok(result.items.every(item=>item.inside),'亮招卡片完整留在战场范围：'+JSON.stringify(result.items));
  assert.ok(result.items.every(item=>item.insideAvatarRing),'亮招卡片位于头像内侧');
  assert.ok(result.items.every(item=>item.rectangular&&item.fontSize>=12&&!item.avatarOverlap&&item.seatLabel&&item.moveIcon),'亮招为圆角矩形，显示放大后的文字且不遮挡头像：'+JSON.stringify(result.items));
  const expectedSize=count===8?[64,46]:[87,63];
  assert.ok(result.items.filter(item=>!item.expanded).every(item=>Math.abs(item.width-expectedSize[0])<1&&Math.abs(item.height-expectedSize[1])<1),'普通亮招卡片保持基础尺寸');
  assert.equal(result.overlaps.length,0,'亮招矩形卡片之间不重叠：'+JSON.stringify({items:result.items,overlaps:result.overlaps}));
  return result.items;
}
async function waitPhase(page, phase, round) {
  await page.waitForFunction(async ({ phase, round }) => {
    const response = await fetch('/api/state', { headers: { Authorization: 'Bearer ' + sessionStorage.getItem('zaizai-token') } });
    const { room } = await response.json();
    return room?.phase === phase && (!round || room.round === round);
  }, { phase, round }, { timeout: 15000 });
  const selector = { selecting: '.arena-controls .arsenal', interrupt: '.interrupt-panel', reveal: '.arena-hud .center-badge', finished: '.center-welcome' }[phase];
  if(selector)await page.locator(selector).waitFor();
}
try {
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    contexts.push(context); pages.push(page);
  }
  const [a, b, c] = pages;
  await a.goto(base);
  await a.getByRole('heading', { name: /蓄一手/ }).waitFor();
  await a.locator('.welcome [data-act=tutorial-start]').click();
  await a.locator('.tutorial-page h1').waitFor();
  assert.equal(await a.evaluate(()=>self),null,'未登录可进入教程');
  await a.locator('[data-act=tutorial-move][data-id=charge]').click();
  await a.locator('[data-act=tutorial-next]').click();
  await a.locator('[data-act=tutorial-exit]').click();
  await a.locator('.welcome [data-act=tutorial-start]').click();
  assert.equal(await a.evaluate(()=>tutorial.progress.step),1,'未登录退出后保留进度');
  await a.locator('[data-act=tutorial-exit]').click();
  await a.locator('.welcome [data-act=rules]').click();
  await a.locator('#modal .rule-move').last().waitFor();
  assert.equal(await a.locator('#modal .rule-move').count(),14,'未登录也能查看全部 14 个招式');
  assert.ok(await a.locator('#modal .rule-move p b').count()>0,'玩法手册强调招式说明中的数字');
  await a.locator('[data-act=close-modal]').click();
  await screenshot(a, '01-welcome-desktop');
  await a.setViewportSize({ width: 390, height: 844 });
  await screenshot(a, '02-welcome-mobile');
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '手机首页没有横向溢出');
  await a.setViewportSize({ width: 1440, height: 1050 });
  for (const [i, page] of pages.entries()) {
    if (i) await page.goto(base);
    await page.getByLabel('临时昵称').fill(['仔仔测试', '小蓝测试', '橘子测试'][i]);
    await page.getByRole('button', { name: '进入大厅' }).click();
    await page.getByRole('heading', { name: '游戏大厅' }).waitFor();
  }
  await screenshot(a, '03-lobby');
  await checkTutorial(a);
  await a.locator('.page-heading [data-act=create]').click();
  await a.getByLabel('房间名称').fill('今晚见招拆招');
  await a.locator('#room-capacity').selectOption('3');
  await a.locator('#create-form button[type=submit]').click();
  await a.locator('.battle-room-name').filter({hasText:'今晚见招拆招'}).waitFor();
  const roomId = (await info(a)).room.id;
  for (const page of [b,c]) {
    await page.getByLabel('房间号', { exact: true }).fill(roomId);
    await page.locator('#join-form button').click();
    await page.locator('.battle-room-name').filter({hasText:'今晚见招拆招'}).waitFor();
  }
  await a.getByLabel('调整房间人数').selectOption('8');
  await a.waitForTimeout(150);
  assert.equal((await info(b)).room.capacity, 8);
  for(const page of pages){await checkRing(page,3);assert.equal(await page.locator('.not-ready-bubble').count(),3);}
  assert.equal(await a.locator('.seat-extra:not(.hidden)').count(),0,'头像资源默认折叠');
  await a.locator('.seat.is-me .seat-detail').click();
  assert.equal(await a.locator('.seat.is-me .seat-extra:not(.hidden)').count(),1,'可展开自己的公开资源');
  assert.match(await a.locator('.seat.is-me .seat-resources').textContent(),/圣盾 0.*锤 0.*防 0/);
  await a.locator('.seat.is-me .seat-detail').click();
  assert.equal(await a.locator('.seat-extra:not(.hidden)').count(),0,'可收起头像资源');
  await checkArenaCorners(a);await checkArenaFooter(a);
  await screenshot(a, '04-room-waiting');
  await a.setViewportSize({ width: 390, height: 844 });
  await checkArenaCorners(a);await checkArenaFooter(a);
  await screenshot(a, '05-room-mobile');
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '手机房间没有横向溢出');
  await a.setViewportSize({ width: 1440, height: 1050 });
  for (const page of pages) await page.locator('.arena-controls [data-act=ready]').click();
  await waitPhase(a, 'selecting', 1);
  await a.locator('[data-act=move][data-id=charge]').waitFor();
  const idA = (await info(a)).self.id, idB = (await info(b)).self.id, idC = (await info(c)).self.id;
  for(const page of pages)await checkRing(page,3);
  await a.locator('[data-act=move][data-id=hammer]').click();
  assert.equal(await a.locator('[data-act=submit-action]').isDisabled(),true,'三名存活玩家时仍须手动选择目标');
  assert.equal(await a.locator('.seat.target-selected').count(),0);
  await a.locator('.seat[data-id="'+idB+'"] .seat-detail').click();
  assert.equal(await a.locator('.seat[data-id="'+idB+'"] .seat-extra:not(.hidden)').count(),1,'可展开其他玩家的状态栏');
  assert.equal(await a.locator('.seat.target-selected').count(),0,'点击状态栏不会误选攻击目标');
  await a.locator('.seat[data-id="'+idB+'"] .seat-detail').click();
  await a.locator('[data-act=move][data-id=charge]').click();
  assert.equal(await a.locator('.move-card').count(),3,'初始只显示仔、防、锤三种可用招式');
  assert.equal(await a.locator('.log-tabs').count(),0,'战报不再区分本回合和历史标签');
  await a.setViewportSize({width:1366,height:768});await checkPlayViewport(a);await screenshot(a,'12-compact-desktop');
  // Layout stress: all 14 moves available and eight seats, without mutating the server.
  const savedRoom=await a.evaluate(()=>structuredClone(state.room));
  await a.evaluate(()=>{const me=state.room.players.find(p=>p.id===self.id);Object.assign(me,{energy:20,hammers:6,shields:6,guards:6});while(state.room.players.length<8){const i=state.room.players.length;state.room.players.push({...me,id:'layout-'+i,name:'玩家'+(i+1),seat:i});}render();});
  assert.equal(await a.locator('.move-card').count(),14);await checkPlayViewport(a);await checkRing(a,8);
  await a.evaluate(()=>{state.room.phase='reveal';state.room.actions=Object.fromEntries(state.room.players.map(p=>[p.id,{move:'guard'}]));render();});
  await checkActionTable(a,8);
  await a.evaluate(()=>{state.room.phase='selecting';state.room.actions={};render();});

  assert.equal(await a.locator('.seat-resources').count(),8,'所有头像公开资源');
  await a.evaluate(()=>{const me=state.room.players.find(p=>p.id===self.id);me.bannedMove='charge';ui.move='charge';render();});
  assert.equal(await a.locator('[data-act=move][data-id=charge]').count(),0,'雪崩禁招从可选列表移除');
  assert.equal(await a.locator('[data-act=submit-action]').isDisabled(),true,'禁招不能保留为待提交选择');
  assert.equal(await a.locator('.arsenal-heading,.selected-description,.action-detail').count(),0,'选招区只保留招式和锁定控件');
  assert.match(await a.locator('.seat.is-me .seat-ban').textContent(),/雪崩禁用：仔/);
  await a.evaluate(()=>{state.room.players.forEach(p=>p.bannedMove='charge');render();});
  assert.equal(await a.locator('.seat-ban').count(),8);

  await a.evaluate(()=>{state.room.players.forEach(p=>p.bannedMove=null);render();});
  await screenshot(a,'15-eight-players-all-moves');
  await a.locator('[data-act=move][data-id=shieldHammer]').click();
  assert.equal(await a.locator('[data-act=submit-action]').isDisabled(),true,'多人存活时锤带盾需要指定目标');
  await a.locator('.seat[data-id="'+idB+'"]').click();
  assert.equal(await a.locator('[data-act=submit-action]').isEnabled(),true);
  for(const id of await a.locator('.move-card').evaluateAll(els=>els.map(el=>el.dataset.id))){
    await a.evaluate(id=>{ui.move=id;render();},id);
    await checkPlayViewport(a);
    await checkAvatarsClear(a);
  }
  await a.setViewportSize({width:390,height:844});await checkPlayViewport(a);
  await a.evaluate(()=>{state.room.phase='reveal';state.room.actions=Object.fromEntries(state.room.players.map(p=>[p.id,{move:'guard'}]));render();});
  await checkActionTable(a,8);
  await a.evaluate(()=>{const players=state.room.players;players[1].name='小蓝测试这是一个很长的昵称';state.room.actions=Object.fromEntries(players.map(p=>[p.id,{move:'guard'}]));state.room.actions[players[0].id]={move:'gun',target:players[1].id};render();});
  await checkActionTable(a,8);
  const expandedMobile=await a.locator('.table-action.expanded .table-action-move').evaluate(el=>el.scrollHeight<=el.clientHeight+1);
  assert.equal(expandedMobile,true,'八人手机局长目标昵称完整显示在增高卡片内：'+JSON.stringify(await a.locator('.table-action.expanded .table-action-move').evaluate(el=>({text:el.textContent,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,rect:el.getBoundingClientRect().toJSON(),card:el.closest('.table-action').getBoundingClientRect().toJSON(),lineClamp:getComputedStyle(el).webkitLineClamp}))));
  await a.evaluate(()=>{state.room.phase='selecting';state.room.actions={};render();});
  await screenshot(a,'16-eight-players-mobile');
  await checkAvatarsClear(a);
  await a.locator('.seat[data-seat="3"] .seat-detail').click();
  const expandedOverlap=await a.evaluate(()=>{const d=document.querySelector('.seat[data-seat="3"] .seat-detail').getBoundingClientRect();return [...document.querySelectorAll('.arena-controls .move-card,.arena-controls .action-bar')].some(el=>{const r=el.getBoundingClientRect();return Math.min(r.right,d.right)>Math.max(r.left,d.left)&&Math.min(r.bottom,d.bottom)>Math.max(r.top,d.top);});});
  assert.equal(expandedOverlap,false,'手机上单个展开的状态栏不遮挡中央招式区');
  await a.locator('.seat[data-seat="3"] .seat-detail').click();
  for(const id of await a.locator('.move-card').evaluateAll(els=>els.map(el=>el.dataset.id))){
    await a.evaluate(id=>{ui.move=id;ui.target=null;render();},id);
    await checkPlayViewport(a);
    await checkAvatarsClear(a);
  }
  for(const [energy,hammers,shields,guards] of [[0,0,0,0],[1,0,0,0],[2,0,0,0],[3,0,0,0],[4,0,0,0],[5,0,0,0],[5,3,0,0],[0,0,0,3],[0,0,1,0]]){
    await a.evaluate(({energy,hammers,shields,guards})=>{Object.assign(state.room.players.find(p=>p.id===self.id),{energy,hammers,shields,guards});ui.move=null;render();},{energy,hammers,shields,guards});
    for(const id of await a.locator('.move-card').evaluateAll(els=>els.map(el=>el.dataset.id))){
      await a.evaluate(id=>{ui.move=id;render();},id);
      await checkPlayViewport(a);
      await checkAvatarsClear(a);
    }
  }

  const shownResources=await a.locator('.seat.is-me .seat-resources').textContent();
  assert.match(shownResources,/圣盾 1.*锤 0.*防 0/,'头像公开显示当前资源，随资源变化更新');
  const selectingRoom=await a.evaluate(()=>structuredClone(state.room));
  for(const move of ['gun','hammer','darkAngel','fireball','shieldHammer']){
    await a.evaluate(({move,idB,idC})=>{
      state.room.players=state.room.players.slice(0,3);state.room.players.find(p=>p.id===idB).name='小蓝测试这是一个很长的昵称';state.room.phase='reveal';state.room.actions={[self.id]:{move,target:idB,automatic:true},[idB]:{move:'gold',reflect:'fireball'},[idC]:{move:'guard'}};state.room.result={...(state.room.result||{}),muted:[idC]};
      state.room.players.forEach(p=>p.bannedMove='charge');render();
    },{move,idB,idC});
    await checkActionTable(a,3);
    assert.equal(await a.locator('.table-action[data-player-id="'+idA+'"]').evaluate(el=>el.classList.contains('expanded')&&el.getBoundingClientRect().width>87),true,'三人桌面局长目标昵称扩宽卡片');
    assert.match(await a.locator('.table-action[data-player-id="'+idA+'"]').textContent(),new RegExp(move==='shieldHammer'?'锤带盾 → 小蓝测试':({gun:'枪',hammer:'锤',darkAngel:'黑天使',fireball:'火球'}[move])+' → 小蓝测试'));
    assert.match(await a.locator('.table-action[data-player-id="'+idA+'"]').textContent(),/这是一个很长的昵称/);
    assert.match(await a.locator('.table-action[data-player-id="'+idB+'"]').textContent(),/金盾：火球/);
    assert.match(await a.locator('.table-action[data-player-id="'+idA+'"] .table-action-seat').textContent(),/自动/);
    assert.match(await a.locator('.table-action[data-player-id="'+idC+'"] .table-action-seat').textContent(),/封锁/);
    assert.equal(await a.locator('.seat-ban').count(),3);
  }
  await a.setViewportSize({width:390,height:844});await screenshot(a,'18-revealed-targets-and-resources-mobile');
  await a.evaluate(({players,idA,idB,idC})=>{state.room.players=players;state.room.phase='reveal';state.room.actions={[idA]:{move:'gun',target:idB,automatic:true},[idB]:{move:'gold',reflect:'fireball'},[idC]:{move:'guard'}};state.room.result={...(state.room.result||{}),muted:[idC]};render();},{players:savedRoom.players,idA,idB,idC});
  await checkActionTable(a,3);
  assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const bubbled=await a.locator('.table-action').evaluateAll(els=>els.every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth+1;}));
  assert.equal(bubbled,true,'亮招目标与金盾反弹信息完整显示且不超出屏幕');
  await a.evaluate(room=>{state.room=room;render();},selectingRoom);
  await a.setViewportSize({width:1366,height:768});
  await a.evaluate(room=>{state.room=room;render();},savedRoom);
  await a.setViewportSize({width:1440,height:1050});
  for (let round = 1; round <= 3; round++) {
    await waitPhase(a, 'selecting', round);
    await clickMove(a, 'hammer', idB);
    await clickMove(b, 'charge');
    await clickMove(c, 'charge');
    await waitPhase(a, 'reveal', round);
    if (round === 1) await screenshot(a, '06-round-reveal');
  }
  await waitPhase(a, 'selecting', 4);
  await clickMove(a, 'meteor');
  await clickMove(b, 'holy');
  await clickMove(c, 'charge');
  await waitPhase(a, 'interrupt', 4);
  await a.locator('.interrupt-panel').waitFor();
  assert.equal(await a.locator('[data-act=skip-interrupt]').count(),0,'流星锤不提供跳过封锁');
  assert.equal(await a.locator('[data-act=interrupt]').isDisabled(),true,'未选择目标时不能确认封锁');
  assert.match(await a.locator('.interrupt-panel').textContent(),/超时封锁右侧相邻存活玩家/);
  await checkActionTable(a,3);
  await screenshot(a, '07-meteor-interrupt');
  await a.locator(`[data-act=target][data-id="${idC}"]`).click();
  assert.equal(await a.locator('[data-act=interrupt]').isEnabled(),true,'选择存活玩家后可确认封锁');
  await a.locator('[data-act=interrupt]').click();
  await waitPhase(a, 'reveal', 4);
  let room = (await info(a)).room;
  assert.equal(room.players.find(p=>p.id===idB).hp, 0);
  assert.equal(room.players.find(p=>p.id===idC).energy, 3, '封锁仔后不增加资源');
  assert.equal(await b.locator('.seat.is-dead').count(), 1);
  await b.locator('.spectator-banner').waitFor();
  assert.equal(await b.locator('[data-act=submit-action]').count(), 0, '死亡玩家没有操作入口');
  await screenshot(a, '08-damage-reveal');
  await waitPhase(a, 'selecting', 5);
  await a.reload();
  await a.locator('[data-act=move][data-id=charge]').waitFor();
  assert.equal((await info(a)).self.id, idA, '刷新后恢复相同身份');
  const duelResources=await a.evaluate(()=>{const me=state.room.players.find(p=>p.id===self.id);const resources={energy:me.energy,shields:me.shields};me.energy=20;me.shields=1;render();return resources;});
  for(const move of ['hammer','shieldHammer','gun','fireball','darkAngel']){
    await a.locator('[data-act=move][data-id="'+move+'"]').click();
    assert.equal(await a.locator('.seat.target-selected').getAttribute('data-id'),idC,'两人存活时 '+move+' 自动指定对手，跳过死者');
    assert.equal(await a.locator('[data-act=submit-action]').isEnabled(),true);
  }
  await a.evaluate(resources=>{Object.assign(state.room.players.find(p=>p.id===self.id),resources);ui.move=null;ui.target=null;render();},duelResources);
  await clickMove(a,'charge');await clickMove(c,'charge');
  await waitPhase(a,'selecting',6);
  await screenshot(a,'09-battle-desktop');
  await a.setViewportSize({width:390,height:844});
  await checkPlayViewport(a);
  await screenshot(a,'10-battle-mobile');
  assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,'手机对战没有横向溢出');
  await a.locator('[data-act=move][data-id=gun]').click();
  assert.equal(await a.locator('.seat.target-selected').getAttribute('data-id'),idC);
  const box=await a.locator('.action-bar').boundingBox();
  assert.ok(box.y>=0&&box.y+box.height<=844,'手机选中目标后，锁定按钮保持在可见区域');
  await a.locator('[data-act=submit-action]').click();await clickMove(c,'charge');
  await a.setViewportSize({width:1440,height:1050});
  await waitPhase(a,'finished',6);
  room=(await info(a)).room;assert.equal(room.result.winnerId,idA);
  await screenshot(a,'11-victory');
  assert.equal(room.leaderboard.find(p=>p.id===idA).wins,1);
  await a.locator('[data-act=show-leaderboard]').click();
  await a.locator('#modal .leaderboard').waitFor();
  assert.equal(await a.locator('#modal .ranking-list li').count(),3,'排行榜按钮打开本局结果和全员排名');
  assert.equal(await a.locator('#modal .match-result').count(),1);
  await a.locator('#modal [data-act=close-modal]').click();
  await a.locator('[data-act=show-history]').click();
  await a.locator('#modal .battle-log').waitFor();
  assert.ok(await a.locator('#modal .log-round').count()>0,'战况记录弹窗只显示已结算的历史回合');
  await a.locator('#modal [data-act=close-modal]').click();
  for(const page of pages){assert.equal(await page.locator('.not-ready-bubble').count(),3);assert.equal(await page.locator('.seat.is-dead').count(),0);}
  await a.locator('.arena-controls [data-act=ready]').click();
  await b.locator('.seat[data-id="'+idA+'"] .ready-bubble').waitFor();
  assert.equal(await b.locator('.not-ready-bubble').count(),2,'第二局前准备状态正确显示在每个人头像上方');
  await screenshot(b,'13-rematch-readiness');
  await b.locator('.arena-controls [data-act=ready]').click();await c.locator('.arena-controls [data-act=ready]').click();
  await waitPhase(a,'selecting',1);
  assert.ok((await info(a)).room.players.every(p=>p.hp===1&&p.energy===0&&p.shields===0&&p.hammers===0&&p.guards===0&&p.bannedMove===null));
  assert.equal((await info(c)).room.leaderboard.find(p=>p.id===idA).wins,1,'重新开局保留胜场');
  for(const page of [a,b])await page.evaluate(async()=>{await fetch('/api/rooms/leave',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sessionStorage.getItem('zaizai-token')},body:'{}'});});
  await waitPhase(c,'finished');
  assert.equal((await info(c)).room.lastMatch.winnerId,idC);
  // Join after a forfeit win, then the winner leaves: every remaining viewer keeps the locked outcome.
  for(const page of [a,b])await page.evaluate(async roomId=>{await fetch('/api/rooms/join',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sessionStorage.getItem('zaizai-token')},body:JSON.stringify({roomId})});},roomId);
  await c.locator('[data-act=leave]').click();
  await a.locator('.final-winner').filter({hasText:'橘子测试 获胜'}).waitFor();
  assert.equal((await info(a)).room.lastMatch.winnerId,idC);
  await a.locator('[data-act=show-leaderboard]').click();
  assert.match(await a.locator('#modal .match-result').textContent(),/橘子测试 获胜/);
  await a.locator('#modal [data-act=close-modal]').click();
  await screenshot(a,'14-locked-winner-left');
  for(const page of [a,b])await page.locator('.arena-controls [data-act=ready]').click();
  await waitPhase(a,'selecting',1);
  await clickMove(a,'charge');await clickMove(b,'charge');
  await waitPhase(a,'selecting',2);
  await clickMove(a,'gun');await clickMove(b,'gun');
  await waitPhase(a,'reveal',2);
  room=(await info(a)).room;
  assert.ok(room.players.every(p=>p.hp===1&&p.energy===0),'枪对枪彼此抵消，消耗照扣且无人阵亡');
  assert.equal(room.result.hasDamage,false);assert.equal(room.result.finished,false);
  await a.locator('.arena-hud h2').filter({hasText:'无人受伤'}).waitFor();
  await screenshot(a,'17-equal-attacks-cancel');
  await waitPhase(a,'selecting',3);
  assert.ok((await info(a)).room.players.every(p=>p.hp===1),'抵消后继续下一回合');
  assert.deepEqual(errors,[],'浏览器无 JavaScript 或资源错误');
  console.log(JSON.stringify({ok:true,checks:['桌面与移动端同屏布局','首页规则入口与数字强调','头像状态栏折叠展开且不误选目标','所有视角自己居底、序号逆时针','8 人及全部 14 招式布局','精简选招区与底部局数居中','雪崩禁招选项过滤','战场内部左上排行榜与右下战报','两人自动选择对手、多人手动选目标','3 个独立浏览器实时同步','创建/加入/调整房间','准备状态及自动开局','仅展示可用招式','历史战报','流星锤亮招后封锁','伤害与阵亡禁用','刷新重连','胜利与房间胜场排行','重新准备与连续对局','胜者离房后结果保持不变','枪对枪抵消且继续对局','公开资源和雪崩禁招','亮招目标与金盾反弹信息'],screenshots:18,errors},null,2));
} finally {
  for(const page of pages) {
    try { await page.evaluate(async()=>{const token=sessionStorage.getItem('zaizai-token');if(token)await fetch('/api/rooms/leave',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:'{}'});}); } catch {}
  }
  for(const context of contexts)await context.close();
  await browser.close();
}
