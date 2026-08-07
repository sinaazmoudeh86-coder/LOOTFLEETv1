/* ============================================================================
   Loot Fleet — FLEET RANK / Combat Arena
   A canvas combat engine matching the game's battle visuals: starfield, citadel
   sprite with shield aura, vector defense turrets, ship sprites with engine glow,
   laser / missile projectiles with trails, hit-flash, explosions, floating text.
   Two modes:  mountDefense()  — spatial base-layout editor (place & range rings)
               openAttack()    — real-time fleet-vs-citadel battle
   ============================================================================ */
(function(){
'use strict';
const TAU=Math.PI*2;
const FRCombat={};window.FRCombat=FRCombat;

let CFG={};           // {MERCS,STRUCTS,fmt}
const IMG={};         // image cache
function preload(){
  const need={citadel:'ships/ship-citadel.png',flag:'ships/ship-dreadnought.png'};
  Object.keys(CFG.MERCS).forEach(k=>need[k]=CFG.MERCS[k].img);
  Object.keys(need).forEach(k=>{const im=new Image();im.src=need[k];IMG[k]=im;});
}
FRCombat.init=function(cfg){CFG=cfg;preload();};

/* ---------- shared canvas setup ---------- */
function setup(canvas,w,h){
  const dpr=Math.min(devicePixelRatio||1,2);
  canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.width=w+'px';canvas.style.height=h+'px';
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  return ctx;
}
function rgba(c,a){return 'rgba('+c+','+a+')';}

/* ---------- starfield ---------- */
function makeStars(w,h,n){const a=[];for(let i=0;i<n;i++)a.push({x:Math.random()*w,y:Math.random()*h,r:Math.random()*1.4+.3,a:Math.random()*.5+.2,s:Math.random()*.4+.1});return a;}
function drawStars(ctx,stars,t){ctx.save();for(const s of stars){ctx.globalAlpha=s.a*(.7+.3*Math.sin(t*2+s.x));ctx.fillStyle='#cfe0ff';ctx.beginPath();ctx.arc(s.x,(s.y+t*s.s*12)%ctx.canvas.clientHeight,s.r,0,TAU);ctx.fill();}ctx.restore();}

/* ---------- citadel sprite ---------- */
function drawCitadel(ctx,x,y,size,t,shieldFrac,hitFlash,skin){
  ctx.save();ctx.translate(x,y);
  // shield aura
  if(shieldFrac>0){
    const sr=size*0.74;
    ctx.save();ctx.globalCompositeOperation='lighter';
    const g=ctx.createRadialGradient(0,0,sr*0.6,0,0,sr);
    g.addColorStop(0,'rgba(95,209,255,0)');g.addColorStop(.82,'rgba(95,209,255,'+(0.05+0.12*shieldFrac)+')');g.addColorStop(1,'rgba(120,220,255,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,sr,0,TAU);ctx.fill();
    ctx.strokeStyle='rgba(120,220,255,'+(0.18+0.4*shieldFrac)+')';ctx.lineWidth=1.6;
    ctx.beginPath();ctx.arc(0,0,sr*(0.98+0.02*Math.sin(t*3)),0,TAU);ctx.stroke();
    ctx.restore();
  }
  // ground glow
  const ag=ctx.createRadialGradient(0,size*0.1,2,0,size*0.1,size*0.6);
  ag.addColorStop(0,'rgba(95,180,255,0.28)');ag.addColorStop(1,'rgba(95,180,255,0)');
  ctx.fillStyle=ag;ctx.beginPath();ctx.arc(0,size*0.12,size*0.6,0,TAU);ctx.fill();
  const im=IMG.citadel,dw=size,dh=size*0.85;
  const bob=Math.sin(t*1.4)*size*0.012;
  if(im&&im.complete&&im.naturalWidth>0){ctx.drawImage(im,-dw/2,-dh/2+bob,dw,dh);
    if(skin==='prismatic'){ctx.save();ctx.globalCompositeOperation='overlay';ctx.globalAlpha=.5;const pg=ctx.createLinearGradient(-dw/2,0,dw/2,0);pg.addColorStop(0,'#ff6ad5');pg.addColorStop(.5,'#5fd1ff');pg.addColorStop(1,'#ffe27a');ctx.fillStyle=pg;ctx.fillRect(-dw/2,-dh/2+bob,dw,dh);ctx.restore();}
    if(hitFlash>0){ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=hitFlash*0.5;ctx.drawImage(im,-dw/2,-dh/2+bob,dw,dh);ctx.restore();}
  }else{ctx.fillStyle='#2a3850';ctx.beginPath();ctx.arc(0,0,size*0.4,0,TAU);ctx.fill();}
  ctx.restore();
}

/* ---------- defense turret (vector, on-brand) ---------- */
function drawTurret(ctx,x,y,type,t,ang,scale,hitFlash,dead){
  const S=CFG.STRUCTS[type];if(!S)return;const c=S.c;scale=scale||1;
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
  if(dead){ctx.globalAlpha=0.5;}
  // base hex
  const R=15;
  ctx.beginPath();for(let i=0;i<6;i++){const a=i/6*TAU+Math.PI/6;ctx.lineTo(Math.cos(a)*R,Math.sin(a)*R);}ctx.closePath();
  const bg=ctx.createLinearGradient(0,-R,0,R);bg.addColorStop(0,'#1d2839');bg.addColorStop(1,'#10151f');
  ctx.fillStyle=bg;ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle=dead?'#39404d':rgba(hex2rgb(c),0.85);ctx.stroke();
  if(!dead){
    ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=.5+.2*Math.sin(t*4+x);
    ctx.fillStyle=c;ctx.beginPath();ctx.arc(0,0,3.4,0,TAU);ctx.fill();ctx.restore();
  }
  // type-specific muzzle
  if(!dead){
    ctx.rotate(ang||0);
    ctx.strokeStyle=c;ctx.fillStyle=c;ctx.lineWidth=2.4;ctx.lineCap='round';
    if(type==='laser'){ctx.beginPath();ctx.moveTo(2,0);ctx.lineTo(15,0);ctx.stroke();}
    else if(type==='missile'){ctx.lineWidth=2;for(const o of[-3.4,3.4]){ctx.beginPath();ctx.moveTo(3,o);ctx.lineTo(12,o);ctx.stroke();}}
    else if(type==='drone'){for(let i=0;i<3;i++){const a=t*2+i/3*TAU;ctx.beginPath();ctx.arc(Math.cos(a)*11,Math.sin(a)*11,1.8,0,TAU);ctx.fill();}}
    else if(type==='shield'){ctx.globalAlpha=.7;ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(0,0,11+Math.sin(t*3)*1.2,0,TAU);ctx.stroke();}
    else if(type==='repair'){ctx.lineWidth=2.2;ctx.beginPath();ctx.moveTo(-6,0);ctx.lineTo(6,0);ctx.moveTo(0,-6);ctx.lineTo(0,6);ctx.stroke();}
  }
  if(hitFlash>0){ctx.globalCompositeOperation='lighter';ctx.globalAlpha=hitFlash*.7;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(0,0,R,0,TAU);ctx.fill();}
  ctx.restore();
}
function hex2rgb(h){h=h.replace('#','');const n=parseInt(h,16);return ((n>>16)&255)+','+((n>>8)&255)+','+(n&255);}

/* ---------- ship sprite ---------- */
function drawShip(ctx,im,x,y,size,ang,hitFlash,engine){
  ctx.save();ctx.translate(x,y);ctx.rotate(ang+Math.PI/2);
  if(engine!==false){ // engine glow behind
    const eg=ctx.createRadialGradient(0,size*0.34,1,0,size*0.34,size*0.4);
    eg.addColorStop(0,'rgba(120,200,255,0.45)');eg.addColorStop(1,'rgba(120,200,255,0)');
    ctx.fillStyle=eg;ctx.beginPath();ctx.arc(0,size*0.34,size*0.38,0,TAU);ctx.fill();
  }
  if(im&&im.complete&&im.naturalWidth>0)ctx.drawImage(im,-size/2,-size/2,size,size);
  else{ctx.fillStyle='#9fb4d6';ctx.beginPath();ctx.moveTo(0,-size*0.4);ctx.lineTo(size*0.3,size*0.3);ctx.lineTo(-size*0.3,size*0.3);ctx.closePath();ctx.fill();}
  if(hitFlash>0&&im&&im.complete&&im.naturalWidth>0){ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=hitFlash*0.6;ctx.drawImage(im,-size/2,-size/2,size,size);ctx.restore();}
  ctx.restore();
}

/* ---------- projectile (matches game render.js: trail + laser lance / rocket) ---------- */
function drawBolt(ctx,p){
  // trail — light for energy, smoke for missiles
  if(p.trail&&p.trail.length>1){
    const tc=p.crit?'255,210,80':(p.wt==='missile'?'170,170,170':p.col);
    for(let i=1;i<p.trail.length;i++){const k=i/p.trail.length;
      ctx.strokeStyle='rgba('+tc+','+(k*(p.crit?0.85:p.wt==='missile'?0.4:0.6))+')';
      ctx.lineWidth=(p.crit?3.2:p.wt==='missile'?2.4:1.6)*k+0.4;ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(p.trail[i-1].x,p.trail[i-1].y);ctx.lineTo(p.trail[i].x,p.trail[i].y);ctx.stroke();}
  }
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(p.vy,p.vx));
  const cs=(p.crit?1.45:1)*1.25;
  if(p.wt==='missile'){
    const fl=0.6+0.4*Math.sin(performance.now()/1000*40+p.x);
    ctx.save();ctx.globalCompositeOperation='lighter';ctx.fillStyle='rgba(255,170,80,'+(0.7*fl)+')';
    ctx.beginPath();ctx.moveTo(-5*cs,0);ctx.lineTo(-11*cs*(0.7+fl*0.5),1.7);ctx.lineTo(-11*cs*(0.7+fl*0.5),-1.7);ctx.closePath();ctx.fill();ctx.restore();
    ctx.fillStyle='#c8ccd4';ctx.fillRect(-5*cs,-1.9*cs,8.4*cs,3.8*cs);
    ctx.fillStyle=p.crit?'#ffd24d':'#ff6a4a';ctx.beginPath();ctx.moveTo(3.4*cs,-1.9*cs);ctx.quadraticCurveTo(7.2*cs,0,3.4*cs,1.9*cs);ctx.closePath();ctx.fill();
  }else{ // searing laser lance — dim wide pass + white-hot core + tip
    const L=24*cs;ctx.lineCap='round';ctx.save();ctx.globalCompositeOperation='lighter';
    ctx.strokeStyle='rgba('+(p.crit?'255,210,80':p.col)+',0.4)';ctx.lineWidth=5*cs;ctx.beginPath();ctx.moveTo(-L,0);ctx.lineTo(4,0);ctx.stroke();
    ctx.strokeStyle=p.crit?'#ffe9b0':'#dff4ff';ctx.lineWidth=1.8*cs;ctx.beginPath();ctx.moveTo(-L*0.7,0);ctx.lineTo(4,0);ctx.stroke();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(4,0,1.6*cs,0,TAU);ctx.fill();ctx.restore();
  }
  ctx.restore();
}

/* ============================================================ ANCHORS ==== */
function defenseAnchors(W,H){
  const cx=W/2,cy=H*0.40;
  const struct=[];for(let i=0;i<8;i++){const a=-Math.PI/2+i*(TAU/8);struct.push({x:cx+Math.cos(a)*W*0.30,y:cy+Math.sin(a)*H*0.20});}
  const merc=[];for(let i=0;i<5;i++){merc.push({x:W*(0.16+0.17*i),y:H*0.84});}
  return {cx,cy,struct,merc};
}

/* ============================================================ DEFENSE ==== */
FRCombat.mountDefense=function(host,S,hooks){
  host.innerHTML='<canvas class="fr-canvas"></canvas>';
  const canvas=host.querySelector('canvas');
  const W=host.clientWidth,H=host.clientHeight;
  const ctx=setup(canvas,W,H);
  const A=defenseAnchors(W,H);
  const stars=makeStars(W,H,60);
  let t=0,raf=true,sel=-1,selMerc=false;

  function hit(px,py){
    for(let i=0;i<A.struct.length;i++){const a=A.struct[i];if(Math.hypot(px-a.x,py-a.y)<24)return{merc:false,i};}
    for(let i=0;i<A.merc.length;i++){const a=A.merc[i];if(Math.hypot(px-a.x,py-a.y)<24)return{merc:true,i};}
    return null;
  }
  canvas.onclick=e=>{
    const r=canvas.getBoundingClientRect();
    const px=(e.clientX-r.left)*(W/r.width),py=(e.clientY-r.top)*(H/r.height);
    const h=hit(px,py);if(!h)return;
    hooks.openPicker(h.merc,h.i);
  };

  function frame(){
    if(!host.isConnected){raf=false;return;}
    t+=0.033;
    ctx.clearRect(0,0,W,H);
    // bg
    const bg=ctx.createRadialGradient(A.cx,A.cy,10,A.cx,A.cy,Math.max(W,H)*0.8);
    bg.addColorStop(0,'#152544');bg.addColorStop(.55,'#0a1322');bg.addColorStop(1,'#06090f');
    ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    drawStars(ctx,stars,t);
    // hex deck grid (subtle)
    ctx.save();ctx.globalAlpha=.16;ctx.strokeStyle='#2a3a55';ctx.lineWidth=1;
    ctx.beginPath();ctx.ellipse(A.cx,A.cy,W*0.42,H*0.30,0,0,TAU);ctx.stroke();
    ctx.beginPath();ctx.ellipse(A.cx,A.cy,W*0.30,H*0.20,0,0,TAU);ctx.stroke();ctx.restore();
    // range rings for offensive structures
    S.struct.forEach((ty,i)=>{
      if(!ty)return;const a=A.struct[i];const rng=ty==='laser'?70:ty==='missile'?86:ty==='drone'?60:0;
      if(rng){ctx.save();ctx.globalAlpha=.10;ctx.fillStyle=CFG.STRUCTS[ty].c;ctx.beginPath();ctx.arc(a.x,a.y,rng,0,TAU);ctx.fill();
        ctx.globalAlpha=.28;ctx.strokeStyle=CFG.STRUCTS[ty].c;ctx.setLineDash([4,5]);ctx.lineWidth=1;ctx.stroke();ctx.restore();}
    });
    // citadel
    drawCitadel(ctx,A.cx,A.cy,W*0.34,t,1,0,S.citLvl>=5?'prismatic':null);
    // structure slots
    S.struct.forEach((ty,i)=>{const a=A.struct[i];
      if(ty){const ang=Math.atan2(a.y-A.cy,a.x-A.cx);drawTurret(ctx,a.x,a.y,ty,t,ang,1,0,false);}
      else emptyNode(ctx,a.x,a.y,t,false);
    });
    // mercenary slots
    S.merc.forEach((ty,i)=>{const a=A.merc[i];
      if(ty){const im=IMG[ty];drawShip(ctx,im,a.x,a.y+Math.sin(t*1.6+i)*3,36,-Math.PI/2,0);}
      else emptyNode(ctx,a.x,a.y,t,true);
    });
    if(raf)requestAnimationFrame(frame);else setTimeout(frame,40);
  }
  // immediate first paint (rAF is throttled when backgrounded), then animate
  frame();
  return ()=>{raf=false;canvas.onclick=null;};
};
function emptyNode(ctx,x,y,t,merc){
  ctx.save();ctx.translate(x,y);ctx.setLineDash([3,4]);ctx.strokeStyle='rgba(120,150,190,'+(0.35+0.15*Math.sin(t*2+x))+')';ctx.lineWidth=1.3;
  ctx.beginPath();ctx.arc(0,0,merc?15:14,0,TAU);ctx.stroke();ctx.setLineDash([]);
  ctx.strokeStyle='rgba(150,180,220,0.6)';ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(-5,0);ctx.lineTo(5,0);ctx.moveTo(0,-5);ctx.lineTo(0,5);ctx.stroke();
  ctx.restore();
}

/* ============================================================ ATTACK ===== */
FRCombat.openAttack=function(host,target,S,hooks){
  host.innerHTML=
    '<canvas class="fr-canvas" id="atk-canvas"></canvas>'+
    '<div class="battle-hud">'+
      '<div class="battle-timer" id="b-timer">5:00</div>'+
      '<div class="def-track" id="b-deftrack"><span class="dt-l">⛨ Enemy Defenses</span><span class="dt-pips" id="b-defpips"></span><b class="dt-n" id="b-defn">0/0</b></div>'+
      '<div><div class="enemy-hp-lab"><span>'+target.nm+'\u2019s Citadel</span><b id="b-hpv">🔒 LOCKED</b></div>'+
        '<div class="bar-wrap citlock" id="b-citbar" style="height:9px;margin-bottom:4px"><div class="bar-fill sh" id="b-sh" style="width:100%"></div></div>'+
        '<div class="bar-wrap citlock" style="height:14px"><div class="bar-fill hp" id="b-hp" style="width:100%"></div></div></div>'+
    '</div>'+
    '<div class="phase-banner" id="b-phase">⛨ DESTROY THE DEFENSES</div>'+
    '<div class="battle-controls"><div class="bc-speed">'+
      '<button class="spd active" data-spd="1">1×</button><button class="spd" data-spd="2">2×</button><button class="spd" data-spd="3">3×</button></div>'+
      '<button class="auto-btn on" id="b-auto"><span class="led"></span>AUTO</button>'+
      '<button class="bail" id="b-bail">⏏ Bail</button></div>'+
    '<div class="battle-result" id="b-result"></div>';
  host.classList.add('open');
  const canvas=host.querySelector('#atk-canvas');
  const W=host.clientWidth,H=host.clientHeight;
  const ctx=setup(canvas,W,H);
  const stars=makeStars(W,H,80);
  const diff=target.diff;

  // ---- build defender ----
  const cx=W/2,cy=H*0.30;
  const defHpMax=diff==='hard'?2600:diff==='even'?1700:1200;
  const defShMax=defHpMax*0.5;
  const cit={x:cx,y:cy,hp:defHpMax,hpMax:defHpMax,sh:defShMax,shMax:defShMax,hit:0};
  // defender structures ring (use a representative loadout scaled by diff)
  const defLoadout=diff==='hard'?['laser','missile','laser','shield','missile','drone','laser','repair']
                  :diff==='even'?['laser','missile','shield','laser','drone',null,'missile',null]
                  :['laser','shield','missile',null,'drone',null,null,null];
  const structs=[];
  defLoadout.forEach((ty,i)=>{if(!ty)return;const a=-Math.PI/2+i*(TAU/8);
    structs.push({x:cx+Math.cos(a)*W*0.26,y:cy+Math.sin(a)*H*0.13,type:ty,hpFrac:1,cd:Math.random()*40,ang:0,hit:0,alive:true,killAt:Infinity,atkStart:Infinity});});
  const NTOW=structs.length;
  // schedule when each tower falls. winnable → ALL fall (then citadel exposed);
  // hard → only ~half fall, the rest hold the line so the timer runs out.
  const TOTAL=6.9, P1S=0.7;
  const winnable0=diff!=='hard';
  const killable=winnable0?NTOW:Math.ceil(NTOW*0.5);
  const P1END=winnable0?TOTAL*0.60:TOTAL*0.92;
  // randomise fall order a little for life
  const order=structs.map((_,i)=>i).sort(()=>Math.random()-0.5);
  for(let k=0;k<killable;k++){const s=structs[order[k]];s.killAt=P1S+(k+1)/killable*(P1END-P1S);s.atkStart=s.killAt-1.0;}

  // ---- build attackers (player fleet) ----
  const fleet=[];
  const mercs=S.merc.filter(Boolean);
  const cols=mercs.length+1;
  mercs.forEach((m,i)=>fleet.push(mkAttacker(m,IMG[m],W*((i+0.6)/cols),38,3.0)));
  fleet.push(mkAttacker('flag',IMG.flag,W*((cols-0.4)/cols),46,3.6)); // flagship
  function mkAttacker(kind,im,x,size,dps){const formY=H*(0.50+Math.random()*0.14);return{kind,im,x,y:formY+78+Math.random()*46,size,hp:200,hpMax:200,ang:-Math.PI/2,cd:Math.random()*16,dps,hit:0,alive:true,ox:x,formY};}

  const bolts=[],eparts=[],ftexts=[];
  let speed=1,timeLeft=300,t=0,over=false,unlockT=null;
  const winnable=diff!=='hard';
  // PHASE 1: break every defense tower.  PHASE 2: citadel is exposed and falls.
  let integ=1;const TIMER_TICKS=210,CIT_DRAIN=1.7;

  host.querySelectorAll('.spd').forEach(s=>s.onclick=()=>{speed=+s.dataset.spd;host.querySelectorAll('.spd').forEach(x=>x.classList.toggle('active',x===s));});
  host.querySelector('#b-bail').onclick=()=>finish(false,true);
  {const ab=host.querySelector('#b-auto');if(ab)ab.onclick=()=>ab.classList.toggle('on');}
  let exposedShown=false,phaseTO=null;
  function showPhase(txt,exposed){const ph=host.querySelector('#b-phase');if(!ph)return;ph.textContent=txt;ph.classList.toggle('exposed',!!exposed);ph.classList.remove('hide');clearTimeout(phaseTO);phaseTO=setTimeout(()=>ph.classList.add('hide'),2200);}
  showPhase('⛨ DESTROY THE DEFENSES',false);

  function nearestStruct(x,y){let best=null,bd=1e9;for(const s of structs){if(!s.alive)continue;const d=Math.hypot(s.x-x,s.y-y);if(d<bd){bd=d;best=s;}}return best;}
  function nearestFleet(x,y){let best=null,bd=1e9;for(const f of fleet){if(!f.alive)continue;const d=Math.hypot(f.x-x,f.y-y);if(d<bd){bd=d;best=f;}}return best;}
  function spawnBolt(x,y,tx,ty,side,wt,col,crit){const a=Math.atan2(ty-y,tx-x);const sp=wt==='missile'?5:8;bolts.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,side,wt,col,crit:!!crit,life:70,trail:[]});}
  function explode(x,y,col,n){for(let i=0;i<n;i++){const a=Math.random()*TAU,sp=Math.random()*2.6+.6;eparts.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1,col});}}
  function ftext(x,y,txt,col,crit,size){ftexts.push({x,y,txt,col,crit:!!crit,size:size||15,life:1});}

  const STEP=33;let acc=0;
  function tick(){
    if(over)return;
    const dt=speed;
    t+=0.033*dt;
    timeLeft=Math.max(0,timeLeft-(300/TIMER_TICKS)*dt);
    // --- tower destruction schedule (phase 1) ---
    for(const s of structs){if(!s.alive)continue;
      if(t>=s.killAt){s.alive=false;s.hpFrac=0;explode(s.x,s.y,hex2rgb(CFG.STRUCTS[s.type].c),20);ftext(s.x,s.y,'DESTROYED','#ff6a6a',false,13);}
      else if(t>=s.atkStart){s.hpFrac=Math.max(0,(s.killAt-t)/(s.killAt-s.atkStart));}
    }
    const aliveTow=structs.filter(s=>s.alive).length;
    const allDown=aliveTow===0;
    // --- citadel only takes damage once every tower is gone (phase 2) ---
    if(allDown){ if(unlockT===null){unlockT=t;} integ=Math.max(0,1-(t-unlockT)/CIT_DRAIN); }
    else integ=1;
    // --- attackers ---
    for(const f of fleet){if(!f.alive)continue;
      // advance into formation
      if(f.y>f.formY){f.y-=1.4*dt;}
      else{f.y+=Math.sin(t*2+f.ox)*0.3;f.x=f.ox+Math.sin(t*1.3+f.ox)*10;}
      const tgt=nearestStruct(f.x,f.y)||cit;
      f.ang=Math.atan2((tgt.y)-f.y,(tgt.x)-f.x);
      f.cd-=dt;
      if(f.cd<=0&&f.y<=f.formY+6){f.cd=(f.kind==='flag'?22:16);
        const wt=f.kind==='battleship'||f.kind==='flag'?'missile':'laser';
        const col=wt==='missile'?'255,170,90':'95,209,255';const crit=Math.random()<0.26;
        spawnBolt(f.x,f.y-f.size*0.3,tgt.x,tgt.y,'atk',wt,col,crit);
      }
      f.hit=Math.max(0,f.hit-0.08*dt);
    }
    // --- defender structures ---
    for(const s of structs){if(!s.alive)continue;
      const tgt=nearestFleet(s.x,s.y);if(tgt){s.ang=Math.atan2(tgt.y-s.y,tgt.x-s.x);}
      s.cd-=dt;s.hit=Math.max(0,s.hit-0.08*dt);
      if(s.type==='repair'){s.cd-=dt;continue;}
      if(s.type==='shield'){s.cd-=dt;continue;}
      if(s.cd<=0&&tgt){s.cd=s.type==='missile'?42:26;
        const wt=s.type==='missile'?'missile':'laser';const col=s.type==='missile'?'255,150,150':hex2rgb(CFG.STRUCTS[s.type].c);
        spawnBolt(s.x,s.y,tgt.x,tgt.y,'def',wt,col,false);
      }
    }
    // citadel returns fire
    cit.hit=Math.max(0,cit.hit-0.06*dt);
    if(((t*10)|0)%9===0){const tgt=nearestFleet(cit.x,cit.y);if(tgt&&Math.random()<0.4*dt)spawnBolt(cit.x,cit.y+10,tgt.x,tgt.y,'def','laser','255,120,140',false);}
    // --- projectiles ---
    for(const p of bolts){if(p.life<=0)continue;p.trail.push({x:p.x,y:p.y});if(p.trail.length>7)p.trail.shift();p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;
      if(p.side==='atk'){
        // hit nearest struct/citadel near target
        let hitObj=null;
        for(const s of structs){if(s.alive&&Math.hypot(p.x-s.x,p.y-s.y)<16){hitObj=s;break;}}
        if(!hitObj&&Math.hypot(p.x-cit.x,p.y-cit.y)<W*0.16)hitObj=cit;
        if(hitObj){p.life=0;explode(p.x,p.y,p.wt==='missile'?'255,170,90':'120,210,255',p.wt==='missile'?9:5);
          if(hitObj===cit){if(allDown){cit.hit=1;ftext(p.x+(Math.random()*24-12),p.y-6,'-'+CFG.fmt((p.crit?2.2:1)*(120000+Math.random()*90000)),p.crit?'#ffd24d':'#7fd8ff',p.crit,p.crit?17:14);}}
          else{hitObj.hit=1;} // tower flash — actual destruction is driven by the phase-1 schedule
        }
      }else{
        const f=nearestFleet(p.x,p.y);
        if(f&&Math.hypot(p.x-f.x,p.y-f.y)<14){p.life=0;f.hp-=14;f.hit=1;explode(p.x,p.y,'255,140,150',5);
          if(f.hp<=0){f.alive=false;explode(f.x,f.y,'255,170,120',20);}}
      }
      if(p.x<-20||p.x>W+20||p.y<-20||p.y>H+20)p.life=0;
    }
    for(let i=bolts.length-1;i>=0;i--)if(bolts[i].life<=0)bolts.splice(i,1);
    for(const e of eparts){e.x+=e.vx*dt;e.y+=e.vy*dt;e.vx*=0.94;e.vy*=0.94;e.life-=0.04*dt;}
    for(let i=eparts.length-1;i>=0;i--)if(eparts[i].life<=0)eparts.splice(i,1);
    for(const f of ftexts){f.y-=0.6*dt;f.life-=0.02*dt;}
    for(let i=ftexts.length-1;i>=0;i--)if(ftexts[i].life<=0)ftexts.splice(i,1);

    // UI — defenses tracker + citadel lock
    const shFrac=Math.max(0,Math.min(1,(integ-0.6)/0.4));
    const hpFrac=Math.max(0,Math.min(1,integ/0.6));
    cit.sh=shFrac*cit.shMax;
    $('#b-sh',host).style.width=(shFrac*100)+'%';
    $('#b-hp',host).style.width=(hpFrac*100)+'%';
    $('#b-defn',host).textContent=aliveTow+' / '+NTOW;
    $('#b-defpips',host).innerHTML=structs.map(s=>'<i class="'+(s.alive?'on':'')+'"></i>').join('');
    if(allDown){
      $('#b-hpv',host).textContent=Math.round(hpFrac*100)+'%';
      host.querySelectorAll('.bar-wrap.citlock').forEach(b=>b.classList.remove('citlock'));
      if(!exposedShown){exposedShown=true;showPhase('⚔ CITADEL EXPOSED · FINISH IT',true);}
      const dtk=$('#b-deftrack',host);if(dtk)dtk.style.opacity='.4';
    }else{
      $('#b-hpv',host).textContent='🔒 '+aliveTow+' LEFT';
    }
    const mm=Math.floor(timeLeft/60),ss=Math.floor(timeLeft%60);const tm=$('#b-timer',host);
    tm.textContent=mm+':'+(ss<10?'0':'')+ss;tm.classList.toggle('crit',timeLeft<60);

    if(allDown&&integ<=0.001)return finish(true,false);
    if(timeLeft<=0||fleet.every(f=>!f.alive))return finish(false,false);
  }

  function render(){
    if(!host.isConnected||over)return;
    ctx.clearRect(0,0,W,H);
    const bg=ctx.createRadialGradient(cx,cy,10,cx,cy,Math.max(W,H));
    bg.addColorStop(0,'#152544');bg.addColorStop(.55,'#0a1322');bg.addColorStop(1,'#06090f');
    ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    drawStars(ctx,stars,t);
    drawCitadel(ctx,cit.x,cit.y,W*0.30,t,cit.sh/cit.shMax,cit.hit,diff==='hard'?'prismatic':null);
    for(const s of structs){if(s.alive){drawTurret(ctx,s.x,s.y,s.type,t,s.ang,1,s.hit,false);
        if(s.hpFrac<0.999){ctx.save();ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(s.x-12,s.y+17,24,3);ctx.fillStyle=s.hpFrac>0.4?'#3fc56b':'#ff495f';ctx.fillRect(s.x-12,s.y+17,24*s.hpFrac,3);ctx.restore();}}
      else drawTurret(ctx,s.x,s.y,s.type,t,0,1,0,true);}
    for(const f of fleet){if(f.alive)drawShip(ctx,f.im,f.x,f.y,f.size,f.ang,f.hit);}
    for(const p of bolts)drawBolt(ctx,p);
    // explosions
    ctx.save();ctx.globalCompositeOperation='lighter';
    for(const e of eparts){ctx.globalAlpha=Math.max(0,e.life);ctx.fillStyle=rgba(e.col,1);ctx.beginPath();ctx.arc(e.x,e.y,2.4*e.life+0.6,0,TAU);ctx.fill();}
    ctx.restore();
    // floating combat text (game style: Rajdhani, black stroke, CRIT! tag)
    ctx.save();ctx.textAlign='center';ctx.lineJoin='round';
    for(const f of ftexts){const a=Math.max(0,f.life);ctx.globalAlpha=a;ctx.font='800 '+f.size+'px Rajdhani, sans-serif';ctx.lineWidth=3.5;ctx.strokeStyle='rgba(0,0,0,0.85)';ctx.strokeText(f.txt,f.x,f.y);ctx.fillStyle=f.col;ctx.fillText(f.txt,f.x,f.y);if(f.crit){ctx.font='800 '+(f.size*0.5)+'px Rajdhani, sans-serif';ctx.fillStyle='#ffd24d';ctx.fillText('CRIT!',f.x,f.y-f.size*0.85);}}
    ctx.restore();
    requestAnimationFrame(render);
  }
  render();
  const iv=setInterval(()=>{if(over){clearInterval(iv);return;}tick();},STEP);

  function finish(win,retreat){
    if(over)return;over=true;clearInterval(iv);
    const res=$('#b-result',host);
    if(retreat){host.classList.remove('open');host.innerHTML='';hooks.onResult(null);return;}
    if(win){
      const newPos=Math.max(1,S.pos-Math.floor(6+Math.random()*8));
      res.innerHTML='<div class="br-verdict win">VICTORY</div><div class="br-sub">'+target.nm+"'s citadel destroyed</div>"+
        '<div class="br-spoils">'+
        '<div class="br-line gold"><span class="l"><span class="g">●</span> Gold looted</span><span class="v">+'+CFG.fmt(target.gold)+'</span></div>'+
        '<div class="br-line gal"><span class="l"><span class="g">✦</span> Galaxy Resources</span><span class="v">+'+CFG.fmt(target.gal)+'</span></div>'+
        '<div class="br-line rank"><span class="l">⚑ Rank position</span><span class="v">#'+S.pos+' ▸ #'+newPos+'</span></div>'+
        '</div><button class="btn gold lg daily-claim" id="b-collect">Collect Spoils</button>';
      res.classList.add('open');
      $('#b-collect',host).onclick=()=>{host.classList.remove('open');host.innerHTML='';hooks.onResult({win:true,gold:target.gold,gal:target.gal,pos:newPos});};
    }else{
      const survivors=fleet.filter(f=>f.alive).length;
      res.innerHTML='<div class="br-verdict loss">DEFEAT</div><div class="br-sub">'+(survivors?'Time expired · citadel held':'Fleet destroyed')+'</div>'+
        '<div class="br-spoils"><div class="br-line"><span class="l">No spoils — defenses too strong</span><span class="v" style="color:var(--muted)">—</span></div></div>'+
        '<button class="btn ghost lg daily-claim" id="b-collect">Return to Base</button>';
      res.classList.add('open');
      $('#b-collect',host).onclick=()=>{host.classList.remove('open');host.innerHTML='';hooks.onResult({win:false});};
    }
  }
};
function $(s,r){return (r||document).querySelector(s);}

})();
