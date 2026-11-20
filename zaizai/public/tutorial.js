// The course uses the same pure settlement functions as the multiplayer server.
const tutorialEngine = import('/tutorial-game.js');
const course = [
  {name:'基础', steps:[
    ['charge','charge',{}, {},'双方出仔，各获得 1 仔。'],
    ['hammer','guard',{}, {},'锤击防守者，扣除其 1 仔。'],
    ['gun','charge',{}, {},'枪消耗 1 仔，击中出仔的机器人。'],
  ]},
  {name:'范围攻击', steps:[
    ['fireball','charge',{energy:2}, {hp:1},'火球命中目标和相邻的另一名机器人，各造成 1 点伤害。'],
    ['quake','charge',{energy:4}, {hp:2},'地震对两名机器人各造成 2 点伤害。'],
  ]},
  {name:'进阶防御', steps:[
    ['holy','gun',{energy:1}, {energy:1},'圣盾消耗 1 仔，抵挡枪并获得 1 圣盾。'],
    ['gold','gun',{energy:1}, {energy:1},'金盾消耗 1 仔，预选枪，将命中的枪反弹。'],
    ['shieldHammer','guard',{shields:1}, {energy:1},'锤带盾消耗 1 圣盾，获得 1 次锤，不增加防；锤击防守者，抵挡枪、火球、地震和海浪。'],
  ]},
  {name:'强化生命', steps:[
    ['angel','quake',{energy:3}, {energy:4},'天使恢复 1 生命，本回合总伤害至多 1 点。'],
    ['darkAngel','holy',{energy:5}, {energy:1},'黑天使恢复 1 生命，穿透圣盾，本回合总伤害至多 1 点。'],
  ]},
  {name:'特殊招式', steps:[
    ['meteor','gun',{hammers:3}, {energy:1},'流星锤消耗 3 锤；亮招后请选择封锁目标，消耗仍照扣。'],
    ['wave','fireball',{shields:3}, {energy:2,hp:2},'海浪对两名机器人各造成 1 点伤害，并反弹火球，额外对施放火球的机器人造成 1 点火球伤害。'],
    ['avalanche','charge',{guards:3}, {},'雪崩消耗 3 防，下回合起自己禁防，其他玩家禁用当回合所出的招式。'],
  ]},
];
const courseNames={charge:'仔',gun:'枪',hammer:'锤',guard:'防',fireball:'火球',quake:'地震',holy:'圣盾',gold:'金盾',shieldHammer:'锤带盾',angel:'天使',darkAngel:'黑天使',meteor:'流星锤',wave:'海浪',avalanche:'雪崩'};
const courseKey='zaizai-tutorial-v2';
function courseLoad(){
  try {
    const p=JSON.parse(localStorage.getItem(courseKey));
    if(Number.isInteger(p?.level)&&p.level>=0&&p.level<=course.length&&Number.isInteger(p.step)&&p.step>=0){
      if(p.level===0&&p.step>0&&(!p.basic||p.basicVersion!==1)){p.step=0;delete p.basic;}
      else if(p.level===0&&p.step>0&&p.basic?.player?.hp===3)p.basic.player.hp=1;
      if(p.level===course.length||p.step<course[p.level].steps.length)return p;
    }
  } catch {}
  return {level:0,step:0,unlocked:0};
}
function courseSave(){localStorage.setItem(courseKey,JSON.stringify(tutorial.progress));}
function coursePreset(id,seat,extra){return {id,name:id==='player'?'你':id==='robot2'?'机器人 2':'机器人 1',seat,hp:id==='player'?1:3,energy:0,hammers:0,guards:0,shields:0,...extra};}
function courseReset(){
  const [move,robotMove,player,robot]=course[tutorial.progress.level].steps[tutorial.progress.step];
  const saved=tutorial.progress.level===0&&tutorial.progress.step>0?tutorial.progress.basic:null;
  tutorial.move=move;tutorial.robotMove=robotMove;tutorial.player=saved?.player||coursePreset('player',0,player);tutorial.robot=saved?.robot||coursePreset('robot',1,robot);
  tutorial.robot2=['fireball','quake','wave'].includes(move)?coursePreset('robot2',2,{hp:move==='quake'?2:1}):null;
  tutorial.robot2Move=move==='wave'?'guard':'charge';
  tutorial.result=null;tutorial.interrupt=false;
}
startTutorial=function(){
  if(state.room||ui.busy)return;
  tutorial={progress:courseLoad()};
  if(tutorial.progress.level===course.length) tutorial.progress={level:0,step:0,unlocked:tutorial.progress.unlocked||course.length};
  courseReset();
  dialog.close();render();
};
function tutorialReplay(){tutorial={progress:{level:0,step:0,unlocked:courseLoad().unlocked||0}};courseSave();courseReset();render();}
function tutorialNext(){
  if(!tutorial?.result)return;
  const p=tutorial.progress;
  if(p.level===0){p.basic={player:tutorial.player,robot:tutorial.robot};p.basicVersion=1;}
  if(++p.step>=course[p.level].steps.length){p.level++;p.step=0;p.unlocked=Math.max(p.unlocked||0,p.level);}
  courseSave();if(p.level===course.length){tutorial=null;dialog.close();render();return;}courseReset();render();
}
async function courseSettle(interrupt){
  const {validateAction,payCosts,resolveRound,MOVES,RESOURCE_NAMES}=await tutorialEngine;
  if(!tutorial)return;
  const players=[tutorial.player,tutorial.robot,...(tutorial.robot2?[tutorial.robot2]:[])];
  const actions={player:validateAction(players,'player',{move:tutorial.move,target:'robot',reflect:'gun'}),robot:validateAction(players,'robot',{move:tutorial.robotMove,target:'player'})};
  if(tutorial.robot2)actions.robot2=validateAction(players,'robot2',{move:tutorial.robot2Move,target:'player'});
  const result=resolveRound(payCosts(players,actions),actions,interrupt?{player:interrupt}:{});
  const definition=MOVES[tutorial.move], costs=Object.entries(definition.cost).map(([key,n])=>`${n} ${RESOURCE_NAMES[key]}`).join('、');
  tutorial.effect=`${definition.name}：${costs?'消耗 '+costs+'。':'无需消耗资源。'}${definition.description}`;
  tutorial.guardEffect=tutorial.progress.level===0&&tutorial.move==='hammer'?`防：${MOVES.guard.description}`:'';
  tutorial.player=result.players[0];tutorial.robot=result.players[1];tutorial.robot2=result.players[2]||null;tutorial.result=result;tutorial.interrupt=false;sound(result.hasDamage?'damage':'tick');render();
}
tutorialMove=function(id){
  if(!tutorial||tutorial.result||tutorial.interrupt||id!==tutorial.move)return;
  if(id==='meteor'){tutorial.interrupt=true;render();return;}
  courseSettle();
};
function tutorialInterrupt(id){if(tutorial?.interrupt&&['player','robot'].includes(id))courseSettle(id);}
tutorialPage=function(){
  const p=tutorial.progress;
  const level=course[p.level],step=level.steps[p.step],stats=x=>`生命 ${x.hp} · 仔 ${x.energy} · 锤 ${x.hammers} · 圣盾 ${x.shields} · 防 ${x.guards}`;
  const labels={charge:'✦',gun:'↗',hammer:'⚒',guard:'◇',fireball:'✹',quake:'⌁',holy:'✧',gold:'◇',shieldHammer:'⚒',angel:'✦',darkAngel:'✦',meteor:'☄',wave:'≈',avalanche:'❄'};
  const seat=(label,x,index,move)=>{
    const delta=tutorial.result?.changes?.[x.id], muted=tutorial.result?.muted?.includes(x.id);
    return `<div class="tutorial-player ${index?'robot':''} ${muted?'is-muted':''} ${x.hp<=0?'is-dead':''}"><span class="tutorial-seat-label">${label}</span><span class="avatar-shell">${avatar(index,x.hp<=0?'dead':'normal')}${delta?.damage?`<span class="damage-float">−${delta.damage} ♥</span>`:''}${delta?.healing?`<span class="heal-float">+${delta.healing} ♥</span>`:''}</span><strong>${index?esc(x.name):esc(self?.name||'你')}</strong><small>${stats(x)}</small>${move?`<span class="tutorial-action ${move} ${muted?'muted':''}">${labels[move]} ${courseNames[move]}${muted?' · 封锁':''}</span>`:''}</div>`;
  };
  const next=p.step===level.steps.length-1?(p.level===course.length-1?'完成教程':'进入下一关'):'下一题';
  const basic=p.level===0, finished=p.step===level.steps.length-1;
  const robotChoices=`${tutorial.robot2?'机器人 1':'机器人'}出「${courseNames[tutorial.robotMove]}」${tutorial.robot2?`，机器人 2 出「${courseNames[tutorial.robot2Move]}」`:''}`;
  const basicHints=['开局的第一回合，先出仔积蓄力量','对方可能会使用防来抵挡你的枪，试试出锤来攻击！','你已经用锤锤掉了对方的一个仔，现在对方没有仔了，试试用枪攻击他！'];
  const hint=tutorial.result?`本回合你使用「${courseNames[tutorial.move]}」，${robotChoices}。`:basic?basicHints[p.step]: `${robotChoices}，请使用「${courseNames[tutorial.move]}」。${step[4]}`;
  return `<section class="tutorial-page"><div class="tutorial-heading"><div><span class="eyebrow">BEGINNER COURSE · LEVEL ${String(p.level+1).padStart(2,'0')}</span><h1>关卡${p.level+1}：${level.name}</h1></div><button class="text-button" data-act="tutorial-exit">${icon('exit',16)} 退出教程</button></div><div class="tutorial-board"><div class="tutorial-prompt"><span class="eyebrow">第 ${p.step+1} / ${level.steps.length} 题 · ${basic?'连续练习':'独立预设'}</span><p>${hint}</p>${tutorial.move==='gold'?'<p>金盾预选反弹：枪</p>':''}</div><div class="tutorial-arena ${tutorial.result?.hasDamage?'arena-damage':''}">${seat('你',tutorial.player,0,tutorial.result?tutorial.move:null)}<div class="tutorial-arena-center"><span class="tutorial-vs">VS</span><span class="tutorial-round-label">第 ${p.step+1} 回合</span></div><div class="tutorial-opponents">${seat(tutorial.robot2?'机器人 1':'机器人',tutorial.robot,1,tutorial.result?tutorial.robotMove:null)}${tutorial.robot2?seat('机器人 2',tutorial.robot2,2,tutorial.result?tutorial.robot2Move:null):''}</div></div><div class="tutorial-controls">${tutorial.result?`<div><p class="tutorial-result-copy">${esc(tutorial.effect)}${tutorial.guardEffect?`<br>${esc(tutorial.guardEffect)}`:''} ${step[4]} ${tutorial.result.logs.map(l=>esc(l.text)).join(' ')||'本回合结算完成。'}</p>${finished?'<p class="tutorial-result-copy">太棒了！你已完成本关，继续点击按钮前进吧！</p>':''}<div class="tutorial-result-actions"><button class="primary-button" data-act="tutorial-next">${next}</button></div></div>`:tutorial.interrupt?'<div><p>选择流星锤封锁目标：</p><button class="secondary-button" data-act="tutorial-interrupt" data-id="player">封锁自己</button> <button class="primary-button" data-act="tutorial-interrupt" data-id="robot">封锁机器人</button></div>':`<button class="move-card ${tutorial.move==='gun'?'red':tutorial.move==='hammer'?'amber':'mint'}" data-act="tutorial-move" data-id="${tutorial.move}"><span class="move-glyph">${labels[tutorial.move]}</span><strong>${courseNames[tutorial.move]}</strong><span class="move-cost">${tutorial.move==='gold'?'反弹：枪':'开始练习'}</span></button>`}</div></div></section>`;
};
const originalTutorialCatalog=attachTutorialCatalog;
attachTutorialCatalog=function(){
  originalTutorialCatalog();
  const landingActions=app.querySelector('.login-actions');
  if(landingActions)landingActions.insertAdjacentHTML('beforeend','<button type="button" class="secondary-button" data-act="tutorial-start">新手教程</button>');
  const catalog=app.querySelector('.tutorial-catalog small');
  if(catalog)catalog.textContent='继续本地保存的教程进度';
};
render();
