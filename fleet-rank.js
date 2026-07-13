/* ============================================================================
   Loot Fleet — FLEET RANK  (endgame PvP feature)
   A self-contained, in-game feature prototype. Lives inside the real LootFleet
   shell (wallet + ship HUD + bottom nav); Fleet Rank is one nav destination
   with its own sub-navigation: Base · Defense · Upgrade · Attack · Ranks.
   ============================================================================ */
(function(){
'use strict';
const $=s=>document.querySelector(s);
const el=(h)=>{const t=document.createElement('template');t.innerHTML=h.trim();return t.content.firstElementChild;};

/* ---- fit phone to viewport ---- */
function fit(){
  const p=$('#phone');const s=Math.min(innerWidth/402,innerHeight/872);
  p.style.transform='scale('+Math.min(s,1.06)+')';
}
addEventListener('resize',fit);fit();

/* ---- number format (brand unit ladder) ---- */
function fmt(n){
  const a=Math.abs(n);
  if(a>=1e12)return trim(n/1e12)+'T';
  if(a>=1e9)return trim(n/1e9)+'B';
  if(a>=1e6)return trim(n/1e6)+'M';
  if(a>=1e3)return trim(n/1e3)+'K';
  return ''+Math.round(n);
}
function trim(x){return (Math.round(x*10)/10).toString();}

/* ---- daily payout countdown (to next reset) ---- */
function msToReset(){const n=new Date();const x=new Date(n);x.setHours(24,0,0,0);return x-n;}
function cdStr(){let s=Math.max(0,Math.floor(msToReset()/1000));const p=v=>String(v).padStart(2,'0');return p(s/3600|0)+':'+p((s%3600)/60|0)+':'+p(s%60);}
setInterval(()=>{document.querySelectorAll('.cd-clock').forEach(e=>e.textContent=cdStr());},1000);

/* ============================================================ STATE ====== */
const CIT_LEVELS=[
  {n:'Small Outpost',     hp:'120K', sh:'40K',  reg:'1.2K/s', dmg:'8.4K',  rng:'180', cap:'25K'},
  {n:'Expanded Defenses', hp:'340K', sh:'120K', reg:'2.6K/s', dmg:'19K',   rng:'210', cap:'60K'},
  {n:'Fortified Citadel', hp:'720K', sh:'300K', reg:'4.8K/s', dmg:'42K',   rng:'240', cap:'120K'},
  {n:'War Fortress',      hp:'1.4M', sh:'640K', reg:'8.2K/s', dmg:'88K',   rng:'280', cap:'240K'},
  {n:'Prismatic Mega Citadel',hp:'3.1M',sh:'1.5M',reg:'17K/s',dmg:'205K',  rng:'340', cap:'520K'}
];
const CIT_COST=[null,null,null,
  {gold:1.2e6,gal:18e3},   // 3->4 (already done)
  {gold:3.4e6,gal:62e3}];  // 4->5 (the upgrade shown)

const RANKS=[
  {n:'Recruit',         req:0,    gold:1000,   gal:0},
  {n:'Cadet',           req:8e6,  gold:3000,   gal:100},
  {n:'Commander',       req:25e6, gold:10000,  gal:500},
  {n:'Captain',         req:50e6, gold:22000,  gal:1200},
  {n:'Major',           req:85e6, gold:40000,  gal:2200},
  {n:'Colonel',         req:130e6,gold:70000,  gal:3800},
  {n:'General',         req:185e6,gold:110000, gal:6000},
  {n:'Admiral',         req:220e6,gold:150000, gal:8000},
  {n:'Fleet Admiral',   req:300e6,gold:240000, gal:14000},
  {n:'Galactic Overlord',req:480e6,gold:400000,gal:25000}
];

const FP=[]; // (computed live — see fleetPower / breakdown)

/* ---- value model -------------------------------------------------------
   Attack Power  = active fleet (flagship + mercenaries)
   Defense Value = defensive structures + active fleet + mercenaries
   Fleet Power   = citadel + structures + active fleet + mercs + equip + research
   Every structure shows DPS/effect, the Defense value it adds, and its cost.   */
const ACTIVE_FLEET=51.8e6;          // your piloted flagship + main ships (ship score)
const CIT_POWER=[12e6,28e6,44e6,64e6,92e6];
const EQUIP=22.1e6, RESEARCH=10.0e6;

const STRUCTS={
  laser:  {n:'Laser Tower',     c:'#5fd1ff', kind:'dps',    dps0:4.7e3, def0:0.74e6, buyG:140e3, buyP:1.4e3, eff:'Single-target beam'},
  missile:{n:'Missile Battery', c:'#ff495f', kind:'dps',    dps0:6.1e3, def0:0.86e6, buyG:170e3, buyP:1.8e3, eff:'Area splash damage'},
  shield: {n:'Shield Generator',c:'#5fd1ff', kind:'shield', shp0:90e3,  def0:0.98e6, buyG:160e3, buyP:2.2e3, eff:'Recharges citadel shield'},
  drone:  {n:'Drone Bay',       c:'#c07bff', kind:'dps',    dps0:5.2e3, def0:0.80e6, buyG:150e3, buyP:1.6e3, eff:'3 interceptor drones'},
  repair: {n:'Repair Station',  c:'#3fc56b', kind:'repair', reg0:2.4e3, def0:0.66e6, buyG:120e3, buyP:1.2e3, eff:'Regenerates citadel hull'}
};
const MERCS={
  frigate:   {n:'Frigate',    img:'ships/ship-frigate.png',   atk:5.2e6, hp:'120K', buyG:180e3, buyP:1.6e3, st:'Fast evasive screen'},
  destroyer: {n:'Destroyer',  img:'ships/ship-destroyer.png', atk:8.1e6, hp:'190K', buyG:280e3, buyP:2.6e3, st:'Anti-structure burst'},
  cruiser:   {n:'Cruiser',    img:'ships/ship-cruiser.png',   atk:10.4e6,hp:'260K', buyG:420e3, buyP:3.8e3, st:'Balanced line ship'},
  battleship:{n:'Battleship', img:'ships/ship-battleship.png',atk:14.7e6,hp:'410K', buyG:680e3, buyP:6.2e3, st:'Heavy siege cannons'},
  carrier:   {n:'Carrier',    img:'ships/ship-carrier.png',   atk:18.3e6,hp:'520K', buyG:980e3, buyP:9.0e3, st:'Launches strike wings'}
};

/* per-structure value helpers (linear per level → easy to communicate) */
function structDef(t,L){return STRUCTS[t].def0*L;}
function structDps(t,L){return STRUCTS[t].dps0*L;}
function structEff(t,L){const o=STRUCTS[t];return o.kind==='shield'?o.shp0*L:o.kind==='repair'?o.reg0*L:0;}
function structBuy(t){return {gold:STRUCTS[t].buyG, gal:STRUCTS[t].buyP};}
function structUp(t,L){return {gold:Math.round(STRUCTS[t].buyG*0.5*Math.pow(L,1.45)), gal:Math.round(STRUCTS[t].buyP*0.5*L)};}
function mercBuy(t){return {gold:MERCS[t].buyG, gal:MERCS[t].buyP};}
function effLabel(t){const o=STRUCTS[t];return o.kind==='dps'?'DPS':o.kind==='shield'?'+Shield':'+Regen/s';}
function effVal(t,L){const o=STRUCTS[t];return o.kind==='dps'?structDps(t,L):o.kind==='shield'?structEff(t,L):structEff(t,L);}

/* live aggregates */
function mercTotal(){return S.merc.reduce((a,t)=>a+(t?MERCS[t].atk:0),0);}
function structTotal(){return S.struct.reduce((a,t,i)=>a+(t?structDef(t,S.structLv[i]):0),0);}
function attackPower(){return ACTIVE_FLEET+mercTotal();}
function defenseValue(){return structTotal()+ACTIVE_FLEET+mercTotal();}
function citPower(){return CIT_POWER[S.citLvl-1];}
function fleetPower(){return citPower()+structTotal()+ACTIVE_FLEET+mercTotal()+EQUIP+RESEARCH;}
function diffFor(def){const r=attackPower()/def;return r>=1.12?'easy':r>=0.9?'even':'hard';}
function affordStr(cost){return S.gold>=cost.gold&&S.plasma>=cost.gal;}
function costHTML(cost){const sh=affordStr(cost)?'':' short';return '<div class="pick-cost'+sh+'"><span class="pg">●'+fmt(cost.gold)+'</span><span class="pp">✦'+fmt(cost.gal)+'</span></div>';}

function svgIc(t,size){
  const s=size||22,c=STRUCTS[t].c;
  const w='width="'+s+'" height="'+s+'" viewBox="0 0 24 24" fill="none" stroke="'+c+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  switch(t){
    case'laser':  return '<svg '+w+'><circle cx="12" cy="4" r="1.6" fill="'+c+'"/><path d="M12 5.5V9"/><path d="M9 9h6l-1.3 10h-3.4z"/><path d="M12 19v2"/></svg>';
    case'missile':return '<svg '+w+'><path d="M7 13l5-7 5 7"/><path d="M7 18l5-7 5 7"/></svg>';
    case'shield': return '<svg '+w+'><path d="M12 3l7 3v5c0 4.2-3 6.8-7 8.2C8 17.8 5 15.2 5 11V6z"/><path d="M9.5 11.5l1.8 1.8 3.4-3.6"/></svg>';
    case'drone':  return '<svg '+w+'><path d="M12 3.5l2.6 2.6L12 8.7 9.4 6.1z"/><path d="M5.5 11l2.2 2.2-2.2 2.2L3.3 13.2z"/><path d="M18.5 11l2.2 2.2-2.2 2.2-2.2-2.2z"/></svg>';
    case'repair': return '<svg '+w+'><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg>';
  }
}


/* ---- mutable player state (persisted) ---- */
const SAVE='lf_fr_v1';
const def={
  citLvl:4, rankIdx:7, pos:84, tokens:3,
  gold:2.4e6, plasma:46.2e3,
  struct:['laser','laser','missile','missile','shield','shield','drone',null], // 7/8
  structLv:[12,11,10,9,11,10,8,0],
  merc:['frigate','destroyer','cruiser','battleship',null], // 4/5
  dailyClaimed:false, tokensBought:0
};
let S=load();
function load(){try{const r=JSON.parse(localStorage.getItem(SAVE));return r?Object.assign({},def,r):Object.assign({},def);}catch(e){return Object.assign({},def);}}
function save(){try{localStorage.setItem(SAVE,JSON.stringify(S));}catch(e){}}

/* ============================================================ HELPERS ==== */
function emblem(i,size){
  const s=size||40;
  const tier=[ '#9aa7b8','#9aa7b8','#5fd1ff','#5fd1ff','#4fa6ff','#4fa6ff','#f2b24b','#f2b24b','#c07bff','#ffe27a'][i];
  const chev=i<2?1:i<4?2:i<6?3:i<8?4:5;
  let cv='';for(let k=0;k<chev;k++){const y=15.5+k*2.7;cv+='<path d="M8 '+(y)+'l4 2 4-2" stroke="'+tier+'" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';}
  const star=i>=8?'<path d="M12 4.4l1 2.1 2.3.3-1.7 1.6.4 2.3L12 9.9l-2 1.1.4-2.3L8.7 7.1 11 6.8z" fill="'+tier+'"/>':'';
  return '<svg width="'+s+'" height="'+s+'" viewBox="0 0 24 24" fill="none"><path d="M12 2l8 4v6.5c0 4.6-3.4 7.7-8 9.5-4.6-1.8-8-4.9-8-9.5V6z" fill="rgba(12,18,28,.7)" stroke="'+tier+'" stroke-width="1.4"/>'+(i<8?'':'')+star+cv+'</svg>';
}

let toastT;
function toast(msg,good){
  const t=$('#toast');t.textContent=msg;t.className='toast-fr show'+(good?' good':'');
  clearTimeout(toastT);toastT=setTimeout(()=>t.className='toast-fr',1900);
}
function syncWallet(){
  $('#w-gold').textContent=fmt(S.gold);
  $('#w-plasma').textContent=fmt(S.plasma);
  $('#w-lc').textContent='214';
}

/* ============================================================ SHELL ====== */
let tab='base';
const SUBTABS=[
  {id:'base',   label:'Base',   crumb:'Home Base',        ic:'<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'},
  {id:'defense',label:'Defense',crumb:'Defense Grid',      ic:'<path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z"/>'},
  {id:'upgrade',label:'Upgrade',crumb:'Citadel Upgrades',  ic:'<path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z"/>'},
  {id:'attack', label:'Attack', crumb:'PvP Raids',         ic:'<path d="M5 19l7-7M9 5l10 10M14 4l6 6-2 2-6-6z"/>'},
  {id:'ranks',  label:'Ranks',  crumb:'Fleet Rank Ladder',  ic:'<path d="M5 21V9l4-2 3 2 3-2 4 2v12z"/><path d="M9 21v-6h6v6"/>'}
];

function buildScreen(){
  const v=el('<div class="view active" id="v-fleetrank"></div>');
  v.appendChild(el(
    '<div class="scr-head"><div class="sh-l"><span class="scr-title">Fleet Rank</span>'+
    '<span class="scr-sub" id="fr-crumb">Home Base</span></div>'+
    '<button class="daily-bell" id="daily-bell" title="Daily Fleet Rank Rewards">⚡'+(S.dailyClaimed?'':'<span class="nd"></span>')+'</button></div>'));
  const tabs=el('<div class="frtabs" id="frtabs"></div>');
  SUBTABS.forEach(t=>{
    const b=el('<button class="frtab'+(t.id==='base'?' active':'')+'" data-tab="'+t.id+'">'+
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+t.ic+'</svg>'+
      '<span class="ft">'+t.label+'</span>'+(t.id==='attack'&&S.tokens>0?'<span class="b"></span>':'')+'</button>');
    b.onclick=()=>setTab(t.id);
    tabs.appendChild(b);
  });
  v.appendChild(tabs);
  v.appendChild(el('<div class="scr-body" id="fr-body"></div>'));
  $('#screens').appendChild(v);
  $('#daily-bell').onclick=openDaily;
}
function setTab(id){
  tab=id;
  document.querySelectorAll('.frtab').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));
  $('#fr-crumb').textContent=SUBTABS.find(t=>t.id===id).crumb;
  const body=$('#fr-body');body.scrollTop=0;
  ({base:renderBase,defense:renderDefense,upgrade:renderUpgrade,attack:renderAttack,ranks:renderRanks})[id]();
}

/* ============================================================ BASE ======= */
function renderBase(){
  const cit=CIT_LEVELS[S.citLvl-1];
  const rank=RANKS[S.rankIdx],next=RANKS[S.rankIdx+1];
  const prog=next?Math.max(0,Math.min(1,(fleetPower()-rank.req)/(next.req-rank.req))):1;
  const filled=t=>t.filter(Boolean).length;

  $('#fr-body').innerHTML=
  '<div class="subview">'+
    // fleet power
    '<div class="fp-banner" id="fp-open"><div class="fp-l">'+
      '<div class="fp-lab">⚡ Fleet Power</div>'+
      '<div class="fp-val">'+fmt(fleetPower())+'</div>'+
      '<div class="fp-trend">▲ +14.2M this week · tap for breakdown</div>'+
    '</div><span class="fp-chev">›</span></div>'+

    // attack / defense split (the two numbers that decide raids)
    '<div class="ad-split">'+
      '<div class="ad atk"><div class="adl">⚔ Attack Power</div><div class="adv">'+fmt(attackPower())+'</div><div class="ads">your active fleet</div></div>'+
      '<div class="ad def"><div class="adl">⛨ Defense Value</div><div class="adv">'+fmt(defenseValue())+'</div><div class="ads">structures + fleet</div></div>'+
    '</div>'+

    // citadel hero
    '<div class="cit-stage">'+
      '<div class="cit-top">'+
        '<div class="cit-lvlbadge"><span class="l">CITADEL</span><span class="n">'+S.citLvl+'</span></div>'+
        '<div class="cit-rankchip">'+emblem(S.rankIdx,22)+'<span><span class="rk">'+rank.n.toUpperCase()+'</span> <span class="pos">#'+S.pos+'</span></span></div>'+
      '</div>'+
      '<div class="cit-img-wrap"><img class="cit-img" src="ships/ship-citadel.png" alt="Citadel"></div>'+
      '<div class="cit-name">'+cit.n+'</div>'+
      '<div class="cit-bars">'+
        '<div class="bar-wrap"><div class="bar-fill sh" style="width:100%"></div><div class="bar-label"><span>⛨ SHIELD</span><span>'+cit.sh+'</span></div></div>'+
        '<div class="bar-wrap"><div class="bar-fill hp" style="width:100%"></div><div class="bar-label"><span>HULL</span><span>'+cit.hp+'</span></div></div>'+
      '</div>'+
    '</div>'+

    // daily claim CTA
    (S.dailyClaimed
      ? '<div class="card" style="display:flex;align-items:center;gap:11px;margin-bottom:13px"><span style="font-size:22px">✓</span><div style="flex:1"><div style="font-family:var(--font-d);font-weight:700;font-size:12.5px;color:var(--good)">Daily rewards claimed</div><div style="font-size:11px;color:var(--muted)">Next reset in 14h 22m · keep your rank</div></div></div>'
      : '<button class="btn gold lg" id="daily-cta" style="margin-bottom:13px">⚡ Claim Daily Rewards<span class="sub"> · '+rank.n+'</span></button>')+

    // defense grid summary
    '<div class="sec-head"><h3>Defense Grid</h3><span class="more" id="go-def">Edit ›</span></div>'+
    '<div class="sec-blurb">Your saved layout auto-defends the citadel when rivals raid you.</div>'+
    '<div class="grid-card">'+
      '<div class="slot-row-lab"><span>Structures</span><span><b>'+filled(S.struct)+'</b>/8</span></div>'+
      '<div class="slot-grid struct" id="base-struct">'+S.struct.map((t,i)=>slotMini(t,i,false)).join('')+'</div>'+
      '<div class="slot-row-lab mt"><span>Mercenaries</span><span><b>'+filled(S.merc)+'</b>/5</span></div>'+
      '<div class="slot-grid merc" id="base-merc">'+S.merc.map((t,i)=>slotMini(t,i,true)).join('')+'</div>'+
    '</div>'+

    // rank info
    '<div class="sec-head"><h3>Fleet Rank</h3><span class="more" id="go-ranks">Ladder ›</span></div>'+
    '<div class="rank-card">'+
      '<div class="rank-top">'+emblem(S.rankIdx,52)+
        '<div class="rank-info"><div class="rn">'+rank.n+'</div>'+
        '<div class="rmeta">Top <b>2%</b> of all operators</div></div>'+
        '<div class="rank-pos"><div class="pl">Global</div><div class="pv">#'+S.pos+'</div></div>'+
      '</div>'+
      (next?'<div class="rank-prog"><div class="lab"><span>to '+next.n+'</span><span><b>'+fmt(fleetPower())+'</b> / '+fmt(next.req)+'</span></div>'+
        '<div class="minibar"><i style="width:'+(prog*100).toFixed(0)+'%"></i></div></div>':'')+
      '<div class="reward-strip">'+
        '<div class="rwd gold"><span class="g">●</span><span class="amt">+'+fmt(rank.gold)+'</span><span class="rl">Daily Gold</span></div>'+
        '<div class="rwd gal"><span class="g">✦</span><span class="amt">+'+fmt(rank.gal)+'</span><span class="rl">Daily Galaxy</span></div>'+
      '</div>'+
    '</div>'+

    // daily payout countdown + replays
    '<div class="payout-banner" id="go-payout"><span class="pb-ic">⏳</span><div class="pb-l">'+
      '<div class="pb-t">Daily payout in <span class="cd-clock">'+cdStr()+'</span></div>'+
      '<div class="pb-s">Hold '+rank.n+' to bank <b class="gd">●'+fmt(rank.gold)+'</b> <b class="gl">✦'+fmt(rank.gal)+'</b></div>'+
    '</div><span class="fp-chev">›</span></div>'+
    '<button class="btn ghost" id="go-board">⚑ Global Leaderboard<span class="sub"> · you’re #'+S.pos+'</span></button>'+
  '</div>';

  $('#fp-open').onclick=openBreakdown;
  $('#go-def').onclick=()=>setTab('defense');
  $('#go-ranks').onclick=()=>setTab('ranks');
  $('#go-payout').onclick=openDailyPayout;
  $('#go-board').onclick=()=>setTab('ranks');
  const dc=$('#daily-cta');if(dc)dc.onclick=openDaily;
  // defense-grid summary tiles are tappable too — same detail/upgrade sheets as the Defense tab
  document.querySelectorAll('#base-struct .dslot').forEach((d,i)=>d.onclick=()=>{S.struct[i]?openStructDetail(i):openPicker(false,i);});
  document.querySelectorAll('#base-merc .dslot').forEach((d,i)=>d.onclick=()=>{S.merc[i]?openMercDetail(i):openPicker(true,i);});
}
function slotMini(t,i,isMerc){
  if(!t)return '<div class="dslot empty"><span class="plus">+</span></div>';
  if(isMerc){const m=MERCS[t];return '<div class="dslot filled"><img src="'+m.img+'" alt=""><span class="tnm">'+m.n+'</span></div>';}
  const s=STRUCTS[t];return '<div class="dslot filled">'+svgIc(t,26)+'<span class="lv">L'+S.structLv[i]+'</span><span class="tnm">'+s.n.split(' ')[0]+'</span></div>';
}

/* ============================================================ DEFENSE ==== */
function renderDefense(){
  $('#fr-body').innerHTML=
  '<div class="subview">'+
    '<div class="defval-head"><div><div class="ad def" style="background:none;border:none;padding:0"><div class="adl">⛨ Defense Value</div></div>'+
      '<div class="dh-v">'+fmt(defenseValue())+'</div></div>'+
      '<div class="dh-bd">Structures <b>'+fmt(structTotal())+'</b><br>+ Active Fleet <b>'+fmt(ACTIVE_FLEET)+'</b><br>+ Mercenaries <b>'+fmt(mercTotal())+'</b></div></div>'+
    '<div class="fr-arena" id="fr-arena"></div>'+
    '<div class="arena-hint">▣ Tap an empty node to build · tap a unit to upgrade or move</div>'+
    '<div class="slot-row-lab"><span>⚙ Structures <b>'+S.struct.filter(Boolean).length+'</b>/8</span><span>★ Mercenaries <b>'+S.merc.filter(Boolean).length+'</b>/5</span></div>'+
    '<button class="btn green lg" id="save-layout">⛨ Save Defense Layout</button>'+
  '</div>';
  const arena=$('#fr-arena');
  if(window.FRCombat)FRCombat.mountDefense(arena,S,{openPicker:(merc,i)=>{
    const cur=(merc?S.merc:S.struct)[i];
    if(cur){merc?openMercDetail(i):openStructDetail(i);}else openPicker(merc,i);
  }});
  $('#save-layout').onclick=()=>{save();toast('Defense layout saved',true);};
}

/* ---- build / assign picker (shows value + cost, deducts on buy) ---- */
function openPicker(isMerc,idx){
  const pool=isMerc?MERCS:STRUCTS;const keys=Object.keys(pool);
  const items=keys.map(k=>{
    const o=pool[k];const cost=isMerc?mercBuy(k):structBuy(k);const can=affordStr(cost);
    const stat=isMerc?('ATK <b>'+fmt(o.atk)+'</b> · HP '+o.hp):(o.kind==='dps'?'DPS <b>'+fmt(structDps(k,1))+'</b>':o.kind==='shield'?'<b>+'+fmt(o.shp0)+'</b> shield':'<b>+'+fmt(o.reg0)+'</b>/s regen');
    const gain='+'+fmt(isMerc?o.atk:structDef(k,1))+' '+(isMerc?'Attack & Defense':'Defense Value');
    const ic=isMerc?'<img src="'+o.img+'" alt="">':svgIc(k,24);
    return '<button class="pick'+(can?'':' dis')+'" data-k="'+k+'"'+(can?'':' disabled')+'><div class="pick-ic">'+ic+'</div>'+
      '<div class="pick-meta"><div class="pick-nm">'+o.n+'</div>'+
      '<div class="pick-st">'+stat+'</div>'+
      '<div class="pick-gain">'+gain+'</div>'+costHTML(cost)+'</div></button>';
  }).join('');
  sheet(
    '<div class="sheet-title">'+(isMerc?'Deploy Mercenary':'Build Structure')+'</div>'+
    '<div class="sheet-sub">Slot '+(idx+1)+' · '+(isMerc?'adds to Attack + Defense':'adds to Defense Value')+'</div>'+
    '<div class="pick-grid">'+items+'</div>'+
    '<div class="sec-blurb" style="text-align:center;margin:2px 0 0">Spend Gold + Galaxy to deploy. Upgrade later for more value.</div>',
    sh=>{
      sh.querySelectorAll('.pick:not(.dis)').forEach(b=>b.onclick=()=>{
        const k=b.dataset.k;const cost=isMerc?mercBuy(k):structBuy(k);if(!affordStr(cost))return;
        S.gold-=cost.gold;S.plasma-=cost.gal;
        if(isMerc)S.merc[idx]=k;else{S.struct[idx]=k;S.structLv[idx]=1;}
        save();syncWallet();closeSheet();setTab(tab);toast(pool[k].n+' deployed',true);
      });
    });
}

/* ---- structure detail + upgrade (clear DPS / Defense / cost) ---- */
function openStructDetail(i){
  const ty=S.struct[i];const L=S.structLv[i];const o=STRUCTS[ty];
  const up=structUp(ty,L);const can=affordStr(up);
  const dDef=structDef(ty,L+1)-structDef(ty,L);
  const dEff=effVal(ty,L+1)-effVal(ty,L);
  sheet(
    '<div class="detail-ic">'+svgIc(ty,34)+'</div>'+
    '<div class="sheet-title">'+o.n+'</div>'+
    '<div class="sheet-sub">Level '+L+' · '+o.eff+'</div>'+
    '<div class="card" style="padding:4px 14px;margin-bottom:6px"><div class="stat-list">'+
      '<div class="stat-row"><span class="sn">'+effLabel(ty)+'</span><span class="sv">'+fmt(effVal(ty,L))+'</span></div>'+
      '<div class="stat-row"><span class="sn">⛨ Defense Value</span><span class="sv" style="color:var(--cyan)">'+fmt(structDef(ty,L))+'</span></div>'+
    '</div></div>'+
    '<div class="detail-up"><div class="du-h">Upgrade → Level '+(L+1)+'</div>'+
      '<div class="du-row"><span class="dl">'+effLabel(ty)+'</span><span class="dv">'+fmt(effVal(ty,L))+' <span class="up">▸ '+fmt(effVal(ty,L+1))+'</span></span></div>'+
      '<div class="du-row"><span class="dl">⛨ Defense Value</span><span class="dv">'+fmt(structDef(ty,L))+' <span class="up">▸ '+fmt(structDef(ty,L+1))+'</span></span></div>'+
      '<div class="du-row"><span class="dl">You gain</span><span class="dv" style="color:var(--good)">+'+fmt(dDef)+' DEF · +'+fmt(dEff)+' '+(o.kind==='dps'?'DPS':o.kind==='shield'?'SH':'REG')+'</span></div>'+
      '<div class="cost-row" style="margin:10px 0 0"><span class="cost-item '+(S.gold>=up.gold?'gold':'short')+'"><span class="g">●</span>'+fmt(up.gold)+'</span><span class="cost-item '+(S.plasma>=up.gal?'gal':'short')+'"><span class="g">✦</span>'+fmt(up.gal)+'</span></div>'+
    '</div>'+
    '<button class="btn '+(can?'gold':'ghost')+'" id="d-up"'+(can?'':' disabled')+'>'+(can?'⚡ Upgrade · +'+fmt(dDef)+' Defense':'Need more resources')+'</button>'+
    '<button class="btn ghost" id="d-rm" style="margin-top:8px">Dismantle Structure</button>',
    sh=>{
      const u=sh.querySelector('#d-up');if(u&&can)u.onclick=()=>{S.gold-=up.gold;S.plasma-=up.gal;S.structLv[i]++;save();syncWallet();closeSheet();setTab(tab);toast(o.n+' → Lv '+S.structLv[i]+' · +'+fmt(dDef)+' Defense',true);};
      sh.querySelector('#d-rm').onclick=()=>{S.struct[i]=null;S.structLv[i]=0;save();closeSheet();setTab(tab);toast('Structure dismantled');};
    });
}

/* ---- mercenary detail ---- */
function openMercDetail(i){
  const ty=S.merc[i];const o=MERCS[ty];
  sheet(
    '<div class="detail-ic"><img src="'+o.img+'" alt=""></div>'+
    '<div class="sheet-title">'+o.n+'</div>'+
    '<div class="sheet-sub">Active fleet · '+o.st+'</div>'+
    '<div class="card" style="padding:4px 14px;margin-bottom:10px"><div class="stat-list">'+
      '<div class="stat-row"><span class="sn">⚔ Attack Power</span><span class="sv" style="color:#ff8a96">'+fmt(o.atk)+'</span></div>'+
      '<div class="stat-row"><span class="sn">⛨ Defense Value</span><span class="sv" style="color:var(--cyan)">'+fmt(o.atk)+'</span></div>'+
      '<div class="stat-row"><span class="sn">Hull</span><span class="sv">'+o.hp+'</span></div>'+
    '</div></div>'+
    '<div class="sec-blurb" style="text-align:center;margin-top:0">This ship raids with your fleet <b style="color:#ff8a96">and</b> defends your citadel.</div>'+
    '<button class="btn blue" id="m-swap">Swap Mercenary</button>'+
    '<button class="btn ghost" id="m-rm" style="margin-top:8px">Stand Down</button>',
    sh=>{
      sh.querySelector('#m-swap').onclick=()=>{closeSheet();openPicker(true,i);};
      sh.querySelector('#m-rm').onclick=()=>{S.merc[i]=null;save();closeSheet();setTab(tab);toast('Mercenary stood down');};
    });
}

/* ============================================================ UPGRADE ==== */
function renderUpgrade(){
  const cur=CIT_LEVELS[S.citLvl-1];
  const maxed=S.citLvl>=5;
  const next=maxed?null:CIT_LEVELS[S.citLvl];
  const cost=maxed?null:CIT_COST[S.citLvl];
  const afford=cost&&S.gold>=cost.gold&&S.plasma>=cost.gal;
  const rows=[['HP','hp'],['Shields','sh'],['Shield Regen','reg'],['Structure Damage','dmg'],['Structure Range','rng'],['Resource Capacity','cap']];
  $('#fr-body').innerHTML=
  '<div class="subview">'+
    '<div class="lvl-steps">'+CIT_LEVELS.map((c,i)=>{
      const cls=i+1<S.citLvl?'done':i+1===S.citLvl?'cur':'';
      return '<div class="lvl-step '+cls+'"><span class="sn">'+(i+1)+'</span><span class="sl">'+c.n.replace('Prismatic Mega ','Prismatic ')+'</span></div>';
    }).join('')+'</div>'+

    '<div class="cit-stage" style="margin-bottom:13px"><div class="cit-img-wrap" style="min-height:180px;padding:22px 10px 14px">'+
      '<img class="cit-img" src="ships/ship-citadel.png" style="width:188px" alt=""></div>'+
      '<div class="cit-name" style="bottom:14px">LV '+S.citLvl+' · '+cur.n+'</div></div>'+

    '<div class="card" style="padding:6px 14px"><div class="stat-list">'+
      rows.map(([lab,key])=>{
        const up=next&&next[key]!==cur[key];
        return '<div class="stat-row"><span class="sn">'+lab+'</span>'+
          '<span class="sv">'+cur[key]+(up?' <span class="up">▸ '+next[key]+'</span>':'')+'</span></div>';
      }).join('')+
    '</div></div>'+

    (maxed
      ? '<div class="card" style="text-align:center;padding:18px"><div style="font-family:var(--font-d);font-weight:800;font-size:15px;color:var(--gold)">MAX CITADEL</div><div style="font-size:11.5px;color:var(--muted);margin-top:4px">The Prismatic Mega Citadel is fully evolved.</div></div>'
      : '<div class="card" style="text-align:center"><div style="font-size:10px;letter-spacing:.16em;color:var(--muted);text-transform:uppercase;font-weight:700;margin-bottom:7px">Upgrade to Lv '+(S.citLvl+1)+' · '+next.n+'</div>'+
        '<div class="detail-up" style="text-align:left;margin:0 0 11px"><div class="du-h">What you gain</div>'+
          '<div class="du-row"><span class="dl">⚡ Fleet Power</span><span class="dv">'+fmt(citPower())+' <span class="up">▸ '+fmt(CIT_POWER[S.citLvl])+'</span></span></div>'+
          '<div class="du-row"><span class="dl">Citadel HP</span><span class="dv">'+cur.hp+' <span class="up">▸ '+next.hp+'</span></span></div>'+
          '<div class="du-row"><span class="dl">Shields</span><span class="dv">'+cur.sh+' <span class="up">▸ '+next.sh+'</span></span></div>'+
          '<div class="du-row"><span class="dl">You gain</span><span class="dv" style="color:var(--good)">+'+fmt(CIT_POWER[S.citLvl]-citPower())+' Fleet Power</span></div>'+
        '</div>'+
        '<div class="cost-row" style="margin-top:0"><span class="cost-item '+(S.gold>=cost.gold?'gold':'short')+'"><span class="g" style="color:var(--gold)">●</span>'+fmt(cost.gold)+'</span>'+
        '<span class="cost-item '+(S.plasma>=cost.gal?'gal':'short')+'"><span class="g">✦</span>'+fmt(cost.gal)+'</span></div>'+
        '<button class="btn '+(afford?'gold':'ghost')+' lg" id="do-upgrade"'+(afford?'':' disabled')+'>'+(afford?'⚡ Upgrade · +'+fmt(CIT_POWER[S.citLvl]-citPower())+' Power':'Need more resources')+'</button>'+
        '<div style="font-size:10.5px;color:var(--muted-2);margin-top:9px">Bigger citadel survives longer raids &amp; lifts your rank</div></div>')+
  '</div>';
  const up=$('#do-upgrade');
  if(up&&afford)up.onclick=()=>{
    S.gold-=cost.gold;S.plasma-=cost.gal;S.citLvl++;save();syncWallet();
    toast('Citadel upgraded to Lv '+S.citLvl+'!',true);renderUpgrade();
  };
}

/* ============================================================ ATTACK ===== */
const TARGETS=[
  {nm:'NebulaQueen', rank:6, def:72e6,  gold:96e3, gal:4.8e3},
  {nm:'RustBaron',   rank:7, def:92e6,  gold:142e3,gal:7.4e3},
  {nm:'VoidReaper',  rank:8, def:128e6, gold:180e3,gal:9e3}
];
function renderAttack(){
  $('#fr-body').innerHTML=
  '<div class="subview">'+
    '<div class="ad-split"><div class="ad atk"><div class="adl">⚔ Your Attack Power</div><div class="adv">'+fmt(attackPower())+'</div><div class="ads">flagship + mercenaries</div></div></div>'+
    tokenBar()+
    '<div class="sec-head"><h3>Raid Targets</h3><span class="more" id="reroll">↻ Refresh</span></div>'+
    '<div class="sec-blurb">Your Attack Power vs their Defense Value decides the fight. Win to loot spoils &amp; climb. 1 token per raid.</div>'+
    '<div id="target-list">'+TARGETS.map((t,i)=>targetCard(t,i)).join('')+'</div>'+
  '</div>';
  document.querySelectorAll('[data-atk]').forEach(b=>b.onclick=()=>raid(TARGETS[+b.dataset.atk]));
  $('#reroll').onclick=()=>{toast('Scanning the galaxy…');};
  $('#buy-tok').onclick=buyTokens;
}
function tokenBar(){
  let pips='';for(let i=0;i<5;i++)pips+='<div class="tpip'+(i<S.tokens?' on':'')+'">⚔</div>';
  return '<div class="token-bar"><div class="token-pips">'+pips+'</div>'+
    '<div class="token-meta"><div class="tn">'+S.tokens+' / 5</div><div class="tt">'+(S.tokens>0?'refresh in 14h':'+1 in 4h 50m')+'</div></div>'+
    '<button class="btn gold" id="buy-tok" style="width:auto;padding:9px 13px;font-size:11px">+1<span class="sub"> '+fmt(tokenCost())+'</span></button></div>';
}
function tokenCost(){return Math.round(500e3*Math.pow(5,S.tokensBought||0));} // 500K → 2.5M → 12.5M → 62.5M … steep so raids can't farm net gold
function buyTokens(){
  const c=tokenCost();
  if(S.gold<c){toast('Not enough gold · next ticket '+fmt(c));return;}
  S.gold-=c;S.tokens++;S.tokensBought=(S.tokensBought||0)+1;save();syncWallet();renderAttack();
  toast('+1 Attack Token · −'+fmt(c)+' · next '+fmt(tokenCost()));
}
function targetCard(t,i){
  const r=RANKS[t.rank];const diff=diffFor(t.def);
  const dtag=diff==='easy'?'▾ Favorable':diff==='even'?'◆ Even match':'▴ Tough raid';
  return '<div class="target-card"><div class="target-top">'+
    '<img class="target-cit" src="ships/ship-citadel.png" alt="">'+
    '<div class="target-info"><div class="tnm">'+t.nm+'</div>'+
      '<div class="trk">'+emblem(t.rank,16)+' '+r.n+' · #'+(60+i*9)+'</div>'+
      '<div class="diff-tag '+diff+'">'+dtag+'</div></div>'+
    '<div class="target-pwr"><div class="pl">⛨ Defense</div><div class="pv">'+fmt(t.def)+'</div></div></div>'+
    '<div class="matchup"><span class="mu atk">⚔ '+fmt(attackPower())+'</span><span class="vs">VS</span><span class="mu def">⛨ '+fmt(t.def)+'</span></div>'+
    '<div class="target-loot"><div class="tl gold"><span style="color:var(--gold)">●</span> '+fmt(t.gold)+'</div>'+
      '<div class="tl gal"><span>✦</span> '+fmt(t.gal)+'</div>'+
      '<button class="btn red" data-atk="'+i+'" style="flex:1.2;width:auto;padding:10px;font-size:12px">⚔ Raid</button></div></div>';
}

/* ---- real-time raid via the canvas combat engine ---- */
function raid(t){
  if(S.tokens<=0){buyTokens();return;}
  if(!window.FRCombat){toast('Combat engine loading…');return;}
  S.tokens--;save();
  const diff=diffFor(t.def);
  FRCombat.openAttack($('#battle'),Object.assign({},t,{diff}),S,{onResult:(rz)=>{
    if(rz&&rz.win){S.gold+=rz.gold;S.plasma+=rz.gal;S.pos=rz.pos;save();syncWallet();toast('Spoils collected · climbed to #'+rz.pos,true);}
    setTab('attack');
  }});
}

/* ============================================================ LEADERBOARD  */
const LB_TOP=[
  {nm:'OMEGA PRIME',  ri:9, pw:912e6},
  {nm:'Starscourge',  ri:9, pw:861e6},
  {nm:'Vael Dominus', ri:8, pw:704e6},
  {nm:'NovaTyrant',   ri:8, pw:655e6},
  {nm:'Hollow Sun',   ri:8, pw:602e6}
];
let lbMode='board';
function renderRanks(){
  const rank=RANKS[S.rankIdx],next=RANKS[S.rankIdx+1];
  const prog=next?Math.max(0,Math.min(1,(fleetPower()-rank.req)/(next.req-rank.req))):1;
  $('#fr-body').innerHTML=
  '<div class="subview">'+
    // your standing
    '<div class="stand">'+emblem(S.rankIdx,60)+
      '<div class="st-mid"><div class="st-rk">'+rank.n+'</div>'+
        '<div class="st-sub">⚡ '+fmt(fleetPower())+' Fleet Power · top 2%</div>'+
        (next?'<div class="minibar" style="margin-top:8px"><i style="width:'+(prog*100).toFixed(0)+'%"></i></div>'+
          '<div class="st-next">'+fmt(next.req-fleetPower())+' to '+next.n+'</div>':'<div class="st-next">Max rank reached</div>')+
      '</div>'+
      '<div class="st-pos"><div class="pl">Global</div><div class="pv">#'+S.pos+'</div></div>'+
    '</div>'+
    // segmented toggle
    '<div class="lb-seg">'+
      '<button class="'+(lbMode==='board'?'active':'')+'" data-lb="board">⚑ Leaderboard</button>'+
      '<button class="'+(lbMode==='tiers'?'active':'')+'" data-lb="tiers">⛴ Rank Rewards</button>'+
    '</div>'+
    (lbMode==='board'?lbBoard():lbTiers())+
  '</div>';
  document.querySelectorAll('[data-lb]').forEach(b=>b.onclick=()=>{lbMode=b.dataset.lb;renderRanks();});
}
function lbRow(pos,nm,ri,pw,me){
  return '<div class="lb-row'+(me?' me':'')+'">'+
    '<div class="lb-pos'+(pos<=3?' top':'')+'">'+pos+'</div>'+emblem(ri,30)+
    '<div class="lb-mid"><div class="lb-nm">'+nm+'</div><div class="lb-rk">'+RANKS[ri].n+'</div></div>'+
    '<div class="lb-pw"><div class="v">'+fmt(pw)+'</div><div class="l">Fleet Power</div></div></div>';
}
function lbBoard(){
  const me=S.pos;
  let html='<div class="lb-head">⚑ Global Top Operators</div>';
  html+=LB_TOP.map((p,i)=>lbRow(i+1,p.nm,p.ri,p.pw,false)).join('');
  // your division window around your position
  html+='<div class="divider">Your Division</div>';
  const near=[
    {pos:me-2,nm:'GreyTalon',ri:7,pw:fleetPower()+5.4e6},
    {pos:me-1,nm:'Cinderfall',ri:7,pw:fleetPower()+2.3e6},
    {pos:me,nm:'You',ri:S.rankIdx,pw:fleetPower(),me:true},
    {pos:me+1,nm:'AshenVow',ri:7,pw:fleetPower()-1.9e6},
    {pos:me+2,nm:'Ridgeback',ri:7,pw:fleetPower()-4.1e6}
  ].filter(r=>r.pos>=1);
  html+=near.map(r=>lbRow(r.pos,r.nm,r.ri,r.pw,r.me)).join('');
  return html;
}
function lbTiers(){
  return '<div class="sec-blurb" style="margin-top:0">Each rank pays out automatically every day at reset — higher rank, bigger payout.</div>'+
    RANKS.map((r,i)=>{
      const me=i===S.rankIdx;const locked=i>S.rankIdx;
      return '<div class="lad-row '+(me?'me':'')+(locked?' locked':'')+'">'+emblem(i,40)+
        '<div class="lad-mid"><div class="lad-nm">'+r.n+'</div>'+
          '<div class="lad-rw"><span class="gd">●'+fmt(r.gold)+'</span>'+(r.gal?' · <span class="gl">✦'+fmt(r.gal)+'</span>':'')+' / day</div>'+
          (me?'<span class="lad-you">YOU · #'+S.pos+'</span>':'')+'</div>'+
        '<div class="lad-pwr"><div class="pl">Min Power</div><div class="pv">'+(r.req?fmt(r.req):'—')+'</div></div></div>';
    }).join('');
}

/* ============================================================ FP BREAKDOWN  */
function openBreakdown(){
  sheet(
    '<div class="sheet-title">Fleet Power</div>'+
    '<div class="sheet-sub">'+fmt(fleetPower())+' total · split into Attack &amp; Defense</div>'+
    '<div class="ad-split" style="margin-bottom:11px"><div class="ad atk"><div class="adl">⚔ Attack Power</div><div class="adv">'+fmt(attackPower())+'</div><div class="ads">active fleet</div></div>'+
      '<div class="ad def"><div class="adl">⛨ Defense Value</div><div class="adv">'+fmt(defenseValue())+'</div><div class="ads">structures + fleet</div></div></div>'+
    '<div class="card" style="padding:4px 14px"><div class="stat-list">'+
      '<div class="stat-row"><span class="sn"><span class="si">⚡</span>Active Fleet</span><span class="sv">'+fmt(ACTIVE_FLEET)+'</span></div>'+
      '<div class="stat-row"><span class="sn"><span class="si">★</span>Mercenary Fleet</span><span class="sv">'+fmt(mercTotal())+'</span></div>'+
      '<div class="stat-row"><span class="sn"><span class="si">◈</span>Defensive Structures</span><span class="sv">'+fmt(structTotal())+'</span></div>'+
      '<div class="stat-row"><span class="sn"><span class="si">⛴</span>Citadel Level '+S.citLvl+'</span><span class="sv">'+fmt(citPower())+'</span></div>'+
      '<div class="stat-row"><span class="sn"><span class="si">◆</span>Equipment</span><span class="sv">'+fmt(EQUIP)+'</span></div>'+
      '<div class="stat-row"><span class="sn"><span class="si">✦</span>Research</span><span class="sv">'+fmt(RESEARCH)+'</span></div>'+
      '<div class="stat-row"><span class="sn" style="color:var(--gold);font-weight:700">⚡ Total Fleet Power</span><span class="sv" style="color:var(--gold)">'+fmt(fleetPower())+'</span></div>'+
    '</div></div>'+
    '<div class="sec-blurb" style="text-align:center">Farm loot → upgrade fleet → upgrade citadel → climb the ladder.</div>'
  );
}

/* ============================================================ DAILY PAYOUT  */
function openDailyPayout(){
  const me=RANKS[S.rankIdx];
  sheet(
    '<div class="sheet-title">Daily Fleet Rank Payout</div>'+
    '<div class="sheet-sub">Auto-paid every 24h at reset · higher rank, bigger payout</div>'+
    '<div class="payout-hero">'+
      '<div class="ph-top"><div class="ph-lab">⏳ Your payout if you hold rank</div>'+
        '<div class="ph-rank">'+emblem(S.rankIdx,28)+'<span>'+me.n+'</span></div></div>'+
      '<div class="ph-amts">'+
        '<div class="ph-amt gd"><span class="v">●+'+fmt(me.gold)+'</span><span class="phl">Gold / day</span></div>'+
        '<div class="ph-amt gl"><span class="v">✦+'+fmt(me.gal)+'</span><span class="phl">Galaxy / day</span></div>'+
      '</div>'+
      '<div class="cd-big"><span class="cd-clock">'+cdStr()+'</span><span class="cd-lab">until next payout</span></div>'+
    '</div>'+
    '<div class="slot-row-lab"><span>Payout Ladder</span><span>gold · galaxy / day</span></div>'+
    RANKS.map((r,i)=>{
      const meRow=i===S.rankIdx;
      return '<div class="pl-row'+(meRow?' me':'')+'">'+emblem(i,30)+
        '<div class="pl-mid"><div class="pl-nm">'+r.n+'</div>'+(meRow?'<span class="lad-you">YOU</span>':'')+'</div>'+
        '<div class="pl-amt"><span class="gd">●'+fmt(r.gold)+'</span>'+(r.gal?' <span class="gl">✦'+fmt(r.gal)+'</span>':'')+'</div></div>';
    }).join('')+
    '<div class="sec-blurb" style="text-align:center;margin-top:10px">Climb a rank before reset and your next payout grows automatically.</div>'+
    '<button class="btn ghost" id="dp-close">Close</button>',
    sh=>sh.querySelector('#dp-close').onclick=closeSheet
  );
}

/* ============================================================ DAILY ====== */
function openDaily(){
  const rank=RANKS[S.rankIdx];
  const d=$('#daily');
  d.innerHTML=
    '<div class="daily-rays"></div>'+
    '<div class="daily-kicker">Fleet Rank Rewards</div>'+
    emblemBig(S.rankIdx)+
    '<div class="daily-rank">'+rank.n.toUpperCase()+'</div>'+
    '<div class="daily-rankl">Current Rank</div>'+
    '<div class="daily-earned">Daily Rewards Earned</div>'+
    '<div class="daily-rewards">'+
      '<div class="daily-rwd gold"><span class="g">●</span><div class="dr-mid"><div class="dr-amt">+'+rank.gold.toLocaleString()+'</div><div class="dr-lab">Gold</div></div></div>'+
      (rank.gal?'<div class="daily-rwd gal"><span class="g">✦</span><div class="dr-mid"><div class="dr-amt">+'+rank.gal.toLocaleString()+'</div><div class="dr-lab">Galaxy Resources</div></div></div>':'')+
    '</div>'+
    '<div class="daily-pos">Current Rank Position · <b>#'+S.pos+'</b></div>'+
    '<div class="daily-foot">'+(S.dailyClaimed?'Already collected today — next reset in <b class="cd-clock">'+cdStr()+'</b>':'Keep climbing for bigger daily payouts.')+'</div>'+
    (S.dailyClaimed
      ? '<button class="btn ghost lg daily-claim" id="d-close">✓ Claimed · Close</button>'
      : '<button class="btn gold lg daily-claim" id="d-claim">Claim Rewards</button>');
  d.classList.add('open');
  const cb=$('#d-close');if(cb)cb.onclick=()=>d.classList.remove('open');
  const claim=$('#d-claim');
  if(claim)claim.onclick=()=>{
    if(S.dailyClaimed)return; // one-time collect — guard against spam
    S.gold+=rank.gold;S.plasma+=rank.gal;S.dailyClaimed=true;save();syncWallet();
    d.classList.remove('open');
    const bell=$('#daily-bell');if(bell){const nd=bell.querySelector('.nd');if(nd)nd.remove();}
    if(tab==='base')renderBase();
    toast('+'+fmt(rank.gold)+' gold · +'+fmt(rank.gal)+' galaxy',true);
  };
}
function emblemBig(i){
  return '<div class="daily-em">'+emblem(i,90)+'</div>';
}

/* ============================================================ SHEET CORE = */
function sheet(html,after){
  const s=$('#sheet');s.innerHTML='<div class="sheet-grab"></div>'+html;
  $('#sheet-backdrop').classList.add('open');
  if(after)after(s);
}
function closeSheet(){$('#sheet-backdrop').classList.remove('open');}
$('#sheet-backdrop').addEventListener('click',e=>{if(e.target.id==='sheet-backdrop')closeSheet();});

/* ============================================================ GAME NAV === */
document.querySelectorAll('#nav .nav-btn').forEach(b=>{
  b.onclick=()=>{
    if(b.dataset.game==='fleetrank'){
      document.querySelectorAll('#nav .nav-btn').forEach(x=>x.classList.toggle('active',x===b));
      setTab('base');return;
    }
    const names={battle:'Battle',zones:'Zone Grind',galaxy:'My Galaxy',bag:'Loot',hangar:'Hangar',skills:'Pilot Skills'};
    toast(names[b.dataset.game]+' — lives in the full game');
  };
});

/* ============================================================ BOOT ======= */
if(window.FRCombat)FRCombat.init({MERCS:MERCS,STRUCTS:STRUCTS,fmt:fmt});
buildScreen();
syncWallet();
setTab('base');
})();
