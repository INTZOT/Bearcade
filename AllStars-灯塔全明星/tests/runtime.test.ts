import {test} from 'node:test';
import assert from 'node:assert/strict';
import {system,world,HudElement,HudVisibility} from '@minecraft/server';
import {Fighter} from '../src/fighter';
import {Match} from '../src/match';
import {currentClip,clipElapsed,playClip,queueClip,seekClip} from '../src/anim';
import {emptyIntent,deriveIntent,noteSkillPress,handleSkillSelection,pollSkillPress,consumeSkillPress,clearSkillPresses,resetSkillSlot,readSuperTier} from '../src/input';
import {SideCamera,lastCameraPose} from '../src/camera';
import {modelPointToWorld,scenePointToWorld,sceneYaw} from '../src/scene-space';
import {bodyPoint} from '../src/props';
import superScenes from '../src/data/super3-scenes.json';
import {createBoneSampler} from '../../scripts/allstars-bone-sampler.mjs';
import * as hud from '../src/hud';
import {spawnPearl,spawnCommandBlock,despawnAllProps,dismissProp,advanceProps} from '../src/props';
import {MAX_HP,SKILLS,ARENA_FLOOR_Y,ARENA_AXIS,JUMP_STARTUP_TICKS,ROUND_END_TICKS,MATCH_END_TICKS,SUPER_3_CONFIRM_AUTHOR_TICK} from '../src/combat-config';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {stringifyBedrockEntity,entityFloatTokenErrors} from '../../scripts/bedrock-entity-json.mjs';
import {renderCompatibilityErrors,allstarsRenderErrors} from '../../scripts/allstars-render-validation.mjs';
import {applySuperHitBurst,resetVfxThrottle} from '../src/fx';
import {DamageCombo} from '../src/damage';

test('preview coordinates and actor yaw agree for both seats and arena axes',()=>{
 const local=[1.6,22.8,-20.16],anchor=[24.31,0,1.83],yaw=85;
 const r=yaw*Math.PI/180;
 const preview=[local[0]*Math.cos(r)+local[2]*Math.sin(r)+anchor[0],local[1]+anchor[1],-local[0]*Math.sin(r)+local[2]*Math.cos(r)+anchor[2]];
 for(const axis of ['x','z'] as const)for(const facing of [-1,1]){
  const root={x:3,y:8,z:4},base=sceneYaw(facing,axis);
  const at=modelPointToWorld(anchor,root,base);
  const tip=modelPointToWorld(local,at,base+yaw),expected=modelPointToWorld(preview,root,base);
  assert.ok(Math.hypot(tip.x-expected.x,tip.y-expected.y,tip.z-expected.z)<1e-8);
 }
});

test('third SA3 contact kicks the victim surface from the correct lateral side',()=>{
 const read=(p:string)=>JSON.parse(readFileSync('AllStars-灯塔全明星/resource-pack/'+p,'utf8'));
 const sample=createBoneSampler(read('models/entity/chunye.geo.json')['minecraft:geometry'][0]);
 const animation=read('animations/chunye.animation.json').animations['animation.green_beret.super_3_chain'];
 const foot=sample(animation,'RightFoot',70/60,[0,-1.5,-1.5]);
 const frame=superScenes.normal[276-114]!;
 for(const side of [0,1] as const){
  const {a,b}=pair(),caster=side===0?a:b,face=caster.facing;
  caster.placeCinematic(frame.actor.anchor,frame.actor.yaw,0,face);
  const actual=modelPointToWorld(foot,caster.location,caster.entity!.getRotation().y);
  const intended=scenePointToWorld([4.363287463936036,22.679250793323302,-2.1325726502345237],0,face);
  assert.ok(Math.hypot(actual.x-intended.x,actual.y-intended.y,actual.z-intended.z)<0.08,'kick tip must reach the reviewed body contact');
 }
});

test('SA1 throws forward, blinks to its reachable destination, then lands one punch',()=>{
 for(const side of [0,1] as const){
  const {a,b,m,d}=matchPair(),caster=side===0?a:b,victim=side===0?b:a;
  caster.placePerformance(side===0?-1.2:1.2);victim.placePerformance(side===0?1.2:-1.2);
  const from=caster.axisPosition;caster.meter=1;assert.ok(caster.useSkill(6,1));m.onSkillAccepted(side,6);
  let hidden=false,arrived=false,hurt=false;const emissions:any[]=[];
  d.spawnParticle=(id:string,at:any)=>emissions.push({id,at});
  for(let i=0;i<55;i++){
   system.currentTick++;m.tick();
   const t=clipElapsed(caster.entity)*3;
   if(currentClip(caster.entity)==='super_1'&&t<12)assert.equal(caster.axisPosition,from);
   if(caster.entity!.getProperty('bearcade:allstars_opacity')===0)hidden=true;
   if(Math.abs(caster.axisPosition-from)>1)arrived=true;
   if(victim.hp<MAX_HP){hurt=true;assert.ok(hidden&&arrived,'movement must precede damage')}
  }
  assert.ok(hidden&&arrived&&hurt);assert.equal(victim.hp,MAX_HP-2000);
  assert.ok(emissions.filter(p=>p.id==='minecraft:mob_portal').length>=2);
  assert.ok(d.entities.filter((e:any)=>e.typeId==='bearcade:allstars_afterimage').every((e:any)=>e.getProperty('bearcade:allstars_opacity')===0),'only the invisible HUD anchor may use that entity');
 }
});

test('super presentation hides only the existing bars and restores them after recovery',()=>{
 const {a,b,m,ps}=matchPair();m.pushHud=Match.prototype['pushHud'];m.updateCameras=Match.prototype['updateCameras'];
 ps.forEach((p:any)=>m.cameras.set(p.id,new SideCamera(p,{axis:'x'})));
 m.tick();const bars=[...(world.primitiveShapesManager as any).texts].filter((s:any)=>s.attachedTo===m.hudAnchor);
 assert.equal(bars.length,4);assert.ok(bars[0].text.includes(String(MAX_HP)));
 a.meter=1;a.useSkill(6,1);m.onSkillAccepted(0,6);system.currentTick++;m.tick();
 assert.ok(bars.slice(0,3).every((s:any)=>s.text===''&&s.scale===0));
 for(let i=0;i<80;i++){system.currentTick++;m.tick()}
 assert.ok(bars[0].text.includes(String(b.hp)));assert.equal(bars[0].scale,hud.HUD_SCALE);
 hud.clear(ps);
});

test('KO appears on the final contact in the actual camera, freezes both actors, then slows them',()=>{
 for(const low of [false,true]){
  const {a,b,m,ps}=matchPair();m.pushHud=Match.prototype['pushHud'];
  ps.forEach((p:any)=>m.cameras.set(p.id,new SideCamera(p,{axis:'x'})));
  if(low)a.hp=2500;b.hp=1;a.meter=3;a.useSkill(6,3);m.onSkillAccepted(0,6);
  for(let i=0;i<350&&m.phase!=='ko';i++){
   system.currentTick++;m.tick();if(m.super3?.hits<8){assert.equal(b.hp,1);assert.equal(m.phase,'fight')}
  }
  assert.equal(m.phase,'ko');assert.ok(m.super3,'KO must start at contact while the final paired clip is alive');
  assert.equal(m.super3.hits,8);assert.equal(b.hp,0);
  const ko=[...(world.primitiveShapesManager as any).texts].find((s:any)=>s.visibleTo?.includes(ps[0])&&s.text.includes('ＫＯ'));
  assert.ok(ko);assert.equal(ko.attachedTo,undefined);assert.equal(ko.scale,hud.HUD_SCALE*3);
  const pose=lastCameraPose(ps[0].id)!;const point=hud.screenToWorld(pose,0,0);
  assert.deepEqual(ko.location,point);assert.ok(pose.pos.y>ARENA_FLOOR_Y+1);
  const t=m.super3.time,at=a.location,bt=b.location;
  for(let i=0;i<8;i++){system.currentTick++;m.tick();assert.equal(m.super3.time,t);assert.deepEqual(a.location,at);assert.deepEqual(b.location,bt);assert.ok(ko.text.includes('ＫＯ'))}
  let sawSlow=false;
  for(let i=0;i<20;i++){const before=m.super3.time;system.currentTick++;m.tick();const delta=m.super3.time-before;if(delta>0){assert.ok(Math.abs(delta-.3)<1e-8);sawSlow=true}}
  assert.ok(sawSlow);hud.clear(ps);
 }
});

test('air KO winner falls before standing, removes loser, and hard-cuts to the victory camera',()=>{
 const {a,b,m,ps}=matchPair();ps.forEach((p:any)=>m.cameras.set(p.id,new SideCamera(p,{axis:'x'})));
 a.placePerformance(-1,5);a.forceClip('attack_air_heavy');b.hp=0;m.lastHitSkill=3;m.beginKo(0);
 let fall=false;
 for(let i=0;i<130&&m.phase==='ko';i++){
  system.currentTick++;m.tick();
  if(a.feetY>ARENA_FLOOR_Y){assert.notEqual(currentClip(a.entity),'idle_stand');if(currentClip(a.entity)==='air_fall')fall=true}
 }
 assert.ok(fall);assert.equal(m.phase,'roundEnd');
 for(let i=0;i<30&&a.waitingForVictory;i++){system.currentTick++;m.tick();if(a.feetY>ARENA_FLOOR_Y)assert.equal(currentClip(a.entity),'air_fall')}
 assert.equal(a.feetY,ARENA_FLOOR_Y);
 assert.equal(currentClip(a.entity),'victory_round');assert.equal(b.isOnStage,false);
 assert.ok(b.location.y<ARENA_FLOOR_Y-20);assert.equal(b.entity!.getProperty('bearcade:allstars_opacity'),0);
 assert.equal(lastCameraPose(ps[0].id)!.fov,42);
 m.setupRound();assert.equal(b.isOnStage,true);assert.equal(b.entity!.getProperty('bearcade:allstars_opacity'),1);
 hud.clear(ps);
});

test('reviewed super cameras keep the animated heads and torsos in frame on both sides',()=>{
 for(const side of [0,1] as const)for(const low of [false,true]){
  const {a,b,m,ps}=matchPair(),caster=side===0?a:b,victim=side===0?b:a;
  ps.forEach((p:any)=>m.cameras.set(p.id,new SideCamera(p,{axis:'x'})));
  const facing=caster.facing,variant=low?'low':'normal';
  for(const t of [166,230,276,316,352,384,412,low?615:482]){
   const frame=superScenes[variant][t-114]!;
   for(const [f,pose] of [[caster,frame.actor],[victim,frame.victim]] as const){
    playClip(f.entity,pose.id,{force:true});seekClip(f.entity,pose.at/60);f.placeCinematic(pose.anchor,pose.yaw,0,facing);
   }
   m.updateSuper3Camera({caster,victim,variant,time:t,stage:t>=436?3:t>=206?2:1,pairOrigin:0,facing,hits:0});
   const camera=lastCameraPose(ps[0].id)!,yaw=camera.yaw*Math.PI/180,pitch=camera.pitch*Math.PI/180;
   const forward=[-Math.sin(yaw)*Math.cos(pitch),-Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
   const right=[-Math.cos(yaw),0,-Math.sin(yaw)],up=[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),Math.cos(yaw)*Math.sin(pitch)];
   for(const f of [caster,victim])for(const which of ['head','torso'] as const){
    const p=bodyPoint(f,which),v=[p.x-camera.pos.x,p.y-camera.pos.y,p.z-camera.pos.z];
    const dot=(axis:number[])=>v.reduce((sum,n,i)=>sum+n*axis[i]!,0),depth=dot(forward),half=depth*Math.tan(camera.fov*Math.PI/360);
    assert.ok(depth>0);assert.ok(Math.abs(dot(up)/half)<0.95,`${variant} P${side+1} t${t} ${which} clipped vertically`);
    assert.ok(Math.abs(dot(right)/(half*16/9))<0.95,`${variant} P${side+1} t${t} clipped horizontally`);
   }
  }
 }
});

test('Bedrock float property checker rejects the integer tokens from the failed deployment',()=>{
 const entity={'minecraft:entity':{description:{properties:{
  'bearcade:allstars_time':{type:'float',range:[0,60],default:0},
  'bearcade:allstars_opacity':{type:'float',range:[0,1],default:1},
  'bearcade:allstars_clip':{type:'int',range:[0,85],default:44},
 }}}};
 const broken=JSON.stringify(entity),errors=entityFloatTokenErrors(broken);
 assert.equal(errors.length,6);
 assert.ok(errors.some((e:string)=>e.includes('allstars_opacity.default')));
 assert.ok(errors.some((e:string)=>e.includes('allstars_time.default')));
 const fixed=stringifyBedrockEntity(entity);
 assert.deepEqual(entityFloatTokenErrors(fixed),[]);
 assert.match(fixed,/"default": 1\.0/);
 assert.match(fixed,/"default": 0\.0/);
 assert.match(fixed,/"default": 44[,\s]/);
 assert.deepEqual(JSON.parse(fixed),entity);
 assert.equal(stringifyBedrockEntity(JSON.parse(fixed)),fixed);
});

test('float token checks preserve fractional/exponent values, booleans and Molang strings',()=>{
 const source=String.raw`{"minecraft:entity":{"description":{"properties":{
  "fraction":{"type":"float","default":0.25,"range":[-1.0,1e2]},
  "expression":{"type":"float","range":[0.0,60.0],"default":"query.property('v2') + 1"},
  "integer":{"type":"int","range":[0,85],"default":44},
  "boolean":{"type":"bool","default":false}
 }}}}`;
 assert.deepEqual(entityFloatTokenErrors(source),[]);
 const value=JSON.parse(source),fixed=stringifyBedrockEntity(value);
 assert.deepEqual(JSON.parse(fixed),value);
 assert.deepEqual(entityFloatTokenErrors(fixed),[]);
});

test('fighter and afterimage on-disk definitions retain float tokens required for entity loading',()=>{
 for(const name of ['chunye','afterimage']){
  const source=readFileSync(`AllStars-灯塔全明星/entities/allstars_${name}.json`,'utf8');
  assert.deepEqual(entityFloatTokenErrors(source),[],name);
 }
});

let serial=0;
function dimension(){
 const d:any={id:`room-${serial++}`,entities:[],spawnParticle(){},spawnEntity(id:string,location:any){
  const e:any={id:`entity-${serial++}`,typeId:id,isValid:true,dimension:d,location:{...location},properties:{},rotation:{x:0,y:0},
   setProperty(k:string,v:any){this.properties[k]=v},getProperty(k:string){return this.properties[k]},
   teleport(p:any,o:any){this.location={...p};if(o?.rotation)this.rotation=o.rotation},getRotation(){return this.rotation},
   triggerEvent(){},addTag(){},remove(){this.isValid=false},clearVelocity(){},addEffect(){},removeEffect(){}};
  d.entities.push(e);return e;
 }};return d;
}
function player(d:any){return {id:`player-${serial++}`,name:'tester',isValid:true,dimension:d,selectedSlotIndex:0,sendMessage(){},teleport(){},inputInfo:{getMovementVector:()=>({x:0,y:0}),getButtonState:()=>0},inputPermissions:{setPermissionCategory(){}},onScreenDisplay:{setTitle(){},updateSubtitle(){},setActionBar(){}},camera:{setFov(){},setCamera(){},fade(){},clear(){},addShake(){return 1},removeShake(){}}} as any}
function pair(){
 system.currentTick=0;clearSkillPresses();
 const d=dimension(),ps=[player(d),player(d)];
 const a=new Fighter(d,ps[0],0,1,'a',-0.6),b=new Fighter(d,ps[1],1,-1,'b',0.6);
 assert.ok(a.spawn());assert.ok(b.spawn());return {a,b,d,ps};
}
function step(a:Fighter,b:Fighter,n=1){for(let i=0;i<n;i++){system.currentTick++;a.advancePresentation();b.advancePresentation();a.tick(emptyIntent(),b,true);b.tick(emptyIntent(),a,true)}}
function matchPair(){const p=pair();const m:any=new Match({dbg(){}} as any,1,p.ps,{matchId:1,castId:1});m.fighters=[p.a,p.b];m.phase='fight';m.roundStartTick=0;m.holdPlayer=()=>{};m.updateCameras=()=>{};m.pushHud=()=>{};m.broadcast=()=>{};return {...p,m}}

test('all super victims gain meter from actual damage, with no gain at capture or repeated recovery',()=>{
 for(const tier of [1,2,3] as const)for(const side of [0,1] as const){
  const {a,b,m}=matchPair(),caster=side===0?a:b,victim=side===0?b:a;
  caster.meter=tier;caster.useSkill(6,tier);m.onSkillAccepted(side,6);
  for(let i=0;i<450;i++){
   system.currentTick++;m.tick();
   assert.ok(Math.abs(victim.meter-(MAX_HP-victim.hp)*2/MAX_HP)<1e-8,`tier ${tier} tick ${i}`);
  }
  assert.ok(victim.meter>=.4);
 }
 const {a,b}=pair();b.meter=2.95;b.receiveCinematicHit(a,1000,false);assert.equal(b.meter,3);
 b.meter=0;b.receiveCinematicHit(a,0,false);assert.equal(b.meter,0);
});

test('wakeup buffered light starts on the first actionable tick and survives an immediate attack',()=>{
 for(const side of [0,1] as const){
  const {a,b,m,ps}=matchPair(),waking=side===0?a:b,other=side===0?b:a;
  waking.settlePerformanceDown(false,1);
  const until=(waking as any).downUntilTick;
  while(system.currentTick<until-1){system.currentTick++;m.tick()}
  noteSkillPress(ps[side].id,1);m.tick();
  system.currentTick++;m.tick();
  assert.equal(waking.isDown,false);assert.equal(currentClip(waking.entity),'attack_stand_light');
  assert.ok(waking.isInvulnerable);
  assert.equal(waking.receiveHit(other,3).damage,0);assert.equal(waking.receiveHit(other,4).capture,undefined);
  let hit=false;
  for(let i=0;i<6;i++){system.currentTick++;m.tick();if(other.hp<MAX_HP)hit=true}
  assert.ok(hit,'buffered reversal must actually reach its active frames');
 }
});

test('later rise/rise and rise/dive casts win one contact on either seat',()=>{
 for(const side of [0,1] as const)for(const kinds of [['rise','rise'],['rise','dive'],['dive','rise']] as const){
  const {a,b,m}=matchPair(),early=side===0?a:b,late=side===0?b:a;
  const start=(f:Fighter,kind:string)=>{
   if(kind==='dive')f.placePerformance(f.axisPosition,4);
   f.prepareInput({...emptyIntent(),crouch:kind==='rise'});assert.ok(f.useSkill(5));m.onSkillAccepted(f.side,5);
  };
  start(early,kinds[0]);
  for(let i=0;i<2;i++){system.currentTick++;m.tick()}
  start(late,kinds[1]);
  const hits:any[]=[];const original=m.onHit.bind(m);m.onHit=(hit:any)=>{hits.push(hit);original(hit)};
  for(let i=0;i<60;i++){system.currentTick++;m.tick()}
  assert.equal(late.hp,MAX_HP,`late ${kinds} P${late.side+1}`);
  assert.equal(early.hp,MAX_HP-(kinds[1]==='rise'?1400:800),`early ${kinds} P${early.side+1}`);
  assert.equal(hits.filter(h=>!h.blocked).length,1);
 }
});

test('same-tick rising specials cancel without seat bias; ordinary attacks still interrupt startup',()=>{
 const {a,b,m}=matchPair();
 for(const f of [a,b]){f.prepareInput({...emptyIntent(),crouch:true});f.useSkill(5)}
 for(let i=0;i<40;i++){system.currentTick++;m.tick()}
 assert.equal(a.hp,MAX_HP);assert.equal(b.hp,MAX_HP);
 for(const side of [0,1] as const){
  const {a,b,m}=matchPair(),riser=side===0?a:b,puncher=side===0?b:a;
  riser.prepareInput({...emptyIntent(),crouch:true});riser.useSkill(5);puncher.useSkill(1);
  for(let i=0;i<15;i++){system.currentTick++;m.tick()}
  assert.equal(riser.hp,MAX_HP-300);assert.equal(puncher.hp,MAX_HP);
 }
});

test('rising recovery has no attack hitbox and remains punishable by air attacks',()=>{
 const {a,b,m}=matchPair();b.placePerformance(10);a.prepareInput({...emptyIntent(),crouch:true});a.useSkill(5);
 while(system.currentTick<24){system.currentTick++;m.tick()}
 assert.equal(currentClip(a.entity),'leaf_rise_end');assert.ok(a.isBusy);
 b.placePerformance(a.axisPosition+1.3,a.feetY-ARENA_FLOOR_Y);b.prepareInput(emptyIntent());b.useSkill(1);
 const before=a.hp;
 for(let i=0;i<5;i++){system.currentTick++;m.tick()}
 assert.equal(a.hp,before-300);assert.equal(b.hp,MAX_HP);
});

test('ready throws beat a same-tick strike on either seat but startup still loses to a fast jab',()=>{
 for(const side of [0,1] as const){
  const {a,b,m}=matchPair(),grab=side===0?a:b,punch=side===0?b:a;grab.useSkill(4);
  while(system.currentTick<6){system.currentTick++;m.tick()}
  punch.useSkill(1);system.currentTick++;m.tick();
  assert.ok(m.throwPair);assert.equal(grab.hp,MAX_HP);assert.equal(m.throwPair.caster,grab);
 }
 const {a,b,m}=matchPair();a.useSkill(4);b.useSkill(1);
 for(let i=0;i<10;i++){system.currentTick++;m.tick()}
 assert.equal(a.hp,MAX_HP-300);assert.equal(m.throwPair,undefined);
});

test('leaf cooldown spans all variants, allows other attacks, and resets each round',()=>{
 const {a,b,m,ps}=matchPair();b.placePerformance(10);a.useSkill(5);m.onSkillAccepted(0,5);
 while(system.currentTick<21){system.currentTick++;m.tick()}
 assert.equal(a.isBusy,false);assert.equal(a.leafCooldownRemaining,7);
 a.prepareInput({...emptyIntent(),crouch:true});assert.equal(a.useSkill(5),false);
 assert.ok(a.useSkill(1));
 while(system.currentTick<27){system.currentTick++;m.tick()}
 noteSkillPress(ps[0].id,5);m.tick();assert.ok(m.inputBuffer.has(ps[0].id));
 system.currentTick++;m.tick();assert.equal(currentClip(a.entity),'special_leaf_burst');
 assert.equal(a.leafCooldownRemaining,28);
 a.resetForRound(-.6);assert.equal(a.leafCooldownRemaining,0);
});

test('toward plus 7 selects SA2 using captured input on either side and after a side switch',()=>{
 for(const side of [0,1] as const)for(const switched of [false,true])for(const toward of [false,true]){
  const {a,b,m,ps}=matchPair(),caster=side===0?a:b,p=ps[side];
  if(switched){a.placePerformance(.6);b.placePerformance(-.6);system.currentTick++;m.tick()}
  caster.meter=3;const direction=caster.facing*(toward?1:-1);
  p.inputInfo.getMovementVector=()=>({x:-direction,y:0});handleSkillSelection(p,6);
  p.inputInfo.getMovementVector=()=>({x:0,y:0});m.tick();
  assert.equal(caster.lastSuperTier,toward?2:1);assert.equal(caster.feetY,ARENA_FLOOR_Y);
 }
 const {a,m,ps}=matchPair();a.meter=3;ps[0].inputInfo.getMovementVector=()=>({x:-1,y:-1});
 handleSkillSelection(ps[0],6);m.tick();assert.equal(a.lastSuperTier,3);
});

test('dive hit leaves a real light follow-up window without excessive pushback',()=>{
 for(const side of [0,1] as const){
  const {a,b,m,ps}=matchPair(),diver=side===0?a:b,victim=side===0?b:a;
  diver.placePerformance(diver.axisPosition,3);diver.prepareInput(emptyIntent());diver.useSkill(5);m.onSkillAccepted(side,5);
  for(let i=0;i<25&&victim.hp===MAX_HP;i++){system.currentTick++;m.tick()}
  assert.equal(victim.hp,MAX_HP-800);
  system.currentTick++;noteSkillPress(ps[side].id,1);m.tick();
  for(let i=0;i<25&&victim.hp===MAX_HP-800;i++){system.currentTick++;m.tick()}
  assert.equal(victim.hp,MAX_HP-1100,'light follows dive in the same normal-start combo');
 }
});

test('SA3 first-confirm tick respects an existing enemy attack and wakeup immunity',()=>{
 for(const side of [0,1] as const)for(const slot of [1,4] as const){
  const {a,b,m}=matchPair(),caster=side===0?a:b,victim=side===0?b:a;
  caster.meter=3;caster.useSkill(6,3);m.onSkillAccepted(side,6);
  // The opening now lasts 27 game ticks; stage an existing move to become active
  // on that first actionable pursuit tick (jab startup 1 tick, throw 7 ticks).
  const firstTravelTick=27;
  while(system.currentTick<firstTravelTick-(slot===1?1:7)){system.currentTick++;m.tick()}
  // Enemy jab / throw becomes active on the first eligible close-range pursuit tick.
  assert.ok(victim.useSkill(slot));
  while(system.currentTick<firstTravelTick-1){system.currentTick++;m.tick();assert.ok(m.super3,'enemy move must not resolve before pursuit')}
  system.currentTick++;m.tick();
  assert.equal(m.super3,undefined);
  if(slot===1){assert.equal(caster.hp,MAX_HP-300);assert.equal(caster.state,'hit');assert.ok(caster.isBusy);assert.equal(victim.isPerforming,false)}
  else {
   assert.ok(m.throwPair);assert.equal(caster.hp,MAX_HP);
   for(let i=0;i<40&&caster.hp===MAX_HP;i++){system.currentTick++;m.tick()}
   assert.equal(caster.hp,MAX_HP-1200);
  }
 }
 const {a,b,m}=matchPair();a.meter=3;a.useSkill(6,3);m.onSkillAccepted(0,6);
 m.super3.time=113;b.grantInvulnerability(4);system.currentTick++;m.tick();
 assert.equal(m.super3,undefined);assert.equal(b.isPerforming,false);assert.equal(b.hp,MAX_HP);
});

test('only SA3 pursuit runs at half previous speed; SA1/SA2 and paired performance keep their rates',()=>{
 for(const side of [0,1] as const)for(const tier of [1,2,3] as const){
  const {a,b,m}=matchPair(),caster=side===0?a:b,victim=side===0?b:a;
  if(tier===3){caster.placePerformance(-caster.facing*3);victim.placePerformance(caster.facing*3)}
  caster.meter=tier;caster.useSkill(6,tier);m.onSkillAccepted(side,6);
  let confirmedAt=0, sawTravel=false;
  for(let i=0;i<60;i++){
   const before=clipElapsed(caster.entity), pursuit=m.super3?.time;
   system.currentTick++;m.tick();
   if(tier===1&&before>=14/3&&before<19/3){
    assert.ok(Math.abs(clipElapsed(caster.entity)-before-1.5)<1e-8);sawTravel=true;
   }
   if(tier===3&&pursuit>=69&&m.super3?.stage===0){
    assert.ok(Math.abs(m.super3.time-pursuit-2.625)<1e-8);sawTravel=true;
   }
   if(victim.hp<MAX_HP || m.super2 || m.super3?.stage>0){confirmedAt=system.currentTick;break}
  }
  assert.ok(confirmedAt>0&&confirmedAt<({1:15,2:19,3:45}[tier]),`tier ${tier}: ${confirmedAt}`);
  if(tier!==2)assert.ok(sawTravel);
  if(tier===3)assert.ok(confirmedAt>=23&&confirmedAt<40,'nearby targets no longer wait for the deadline');
  const source=clipElapsed(caster.entity);
  if(tier!==1){system.currentTick++;m.tick();assert.ok(Math.abs(clipElapsed(caster.entity)-source-1)<1e-8)}
 }
});

test('SA1 cannot hit remote targets and must really arrive at its pearl endpoint before punching',()=>{
 for(const side of [0,1] as const)for(const gap of [2.4,3.2,4,4.4,8]){
  const {a,b,m}=matchPair(),caster=side===0?a:b,victim=side===0?b:a,face=caster.facing;
  caster.placePerformance(0);victim.placePerformance(face*gap);
  caster.meter=1;caster.useSkill(6,1);m.onSkillAccepted(side,6);
  let hidden=false,damage=0;
  const original=m.onHit.bind(m);m.onHit=(hit:any)=>{
   if(hit.attacker===caster){
    damage+=hit.damage;assert.ok(hidden);
    assert.ok(Math.abs(caster.axisPosition-face*Math.min(2.5,gap-1.1))<1e-8);
    assert.ok(caster.distanceTo(victim)<=1.65,'punch is local to the actual arrival');
   }
   original(hit);
  };
  for(let i=0;i<70;i++){
   system.currentTick++;m.tick();
   if(caster.entity!.getProperty('bearcade:allstars_opacity')===0)hidden=true;
  }
  assert.ok(hidden);assert.ok(caster.axisPosition*face>1.2,'actual entity must advance, not only its pearl');
  assert.equal(damage,gap<=4?2000:0);
  assert.equal(victim.hp,MAX_HP-damage);
  if(gap>4){assert.equal(victim.isDown,false);assert.equal(victim.meter,0)}
 }
 const {a,b,m}=matchPair();a.meter=1;a.useSkill(6,1);m.onSkillAccepted(0,6);
 // Native teleport failure must not fall back to dealing a stationary punch.
 a.entity!.teleport=()=>{throw new Error('simulated teleport failure')};
 for(let i=0;i<50;i++){system.currentTick++;m.tick()}
 assert.equal(b.hp,MAX_HP);assert.equal(b.isDown,false);
});

test('both seats block all 27 normal clips by move height, including stance changes after startup',()=>{
 for(const side of [0,1] as const)for(const stance of ['stand','crouch','air'] as const)
 for(const slot of [1,2,3] as const)for(const stage of [1,2,3])for(const crouch of [false,true]){
  const {a,b}=pair(),attacker=side===0?a:b,victim=side===0?b:a;
  attacker.stance=stance;
  for(let i=1;i<stage;i++)(attacker as any).resolveSkillClip(slot,1);
  assert.ok(attacker.useSkill(slot));
  const name=`attack_${stance}_${['light','medium','heavy'][slot-1]}${stage===1?'':'_'+stage}`;
  assert.equal(currentClip(attacker.entity),name);
  victim.prepareInput({...emptyIntent(),guard:true,crouch});
  const receive=victim.receiveHit.bind(victim);let result:any;
  victim.receiveHit=(...args:any[])=>result=receive(...args as [Fighter,any,any]);
  // A move's height survives the attacker changing stance before contact.
  attacker.stance=stance==='crouch'?'stand':'crouch';
  for(let i=0;i<20&&!result;i++){system.currentTick++;attacker.advancePresentation();attacker.tick(emptyIntent(),victim,true)}
  assert.ok(result,name);
  const blocked=stance==='stand'||(stance==='crouch'?crouch:!crouch);
  assert.equal(result.blocked,blocked,`${name} P${side+1} crouchGuard=${crouch}`);
  assert.equal(result.damage,blocked?SKILLS[slot].guardChipDamage:SKILLS[slot].damage);
  assert.equal(currentClip(victim.entity),blocked?`guard_hit_${crouch?'crouch':'stand'}`:slot===3&&!crouch?'hit_stand_heavy':`hit_${crouch?'crouch':'stand'}`);
 }
});

test('rise and standing wave allow either guard; dive needs standing guard and throw bypasses both',()=>{
 for(const side of [0,1] as const)for(const kind of ['wave','rise','dive','throw'] as const)for(const crouch of [false,true]){
  const {a,b,m}=matchPair(),attacker=side===0?a:b,victim=side===0?b:a;
  m.intentFor=(s:number)=>s===victim.side?{...emptyIntent(),guard:true,crouch}:emptyIntent();
  if(kind==='wave'){attacker.placePerformance(-attacker.facing*3);victim.placePerformance(attacker.facing*2)}
  if(kind==='dive')attacker.placePerformance(attacker.axisPosition,3);
  attacker.prepareInput({...emptyIntent(),crouch:kind==='rise'});
  assert.ok(attacker.useSkill(kind==='throw'?4:5));m.onSkillAccepted(side,kind==='throw'?4:5);
  if(kind==='wave')m.applySkillVfx(side,5);
  let hit:any;const original=m.onHit.bind(m);m.onHit=(info:any)=>{hit=info;original(info)};
  for(let i=0;i<45&&!hit;i++){system.currentTick++;m.tick()}
  assert.ok(hit,`${kind} P${side+1} crouchGuard=${crouch}`);
  assert.equal(hit.blocked,kind==='throw'?false:kind==='dive'?!crouch:true);
  if(kind==='throw')assert.equal(hit.capture,'throw');
 }
});

test('SA3 confirms on first entry into capture range, once per tick, then plays the entire first punch',()=>{
 for(const side of [0,1] as const)for(const gap of [1.2,6]){
  const {a,b,m}=matchPair(),caster=side===0?a:b,victim=side===0?b:a,face=caster.facing;
  caster.placePerformance(0);victim.placePerformance(face*gap);
  caster.meter=3;caster.useSkill(6,3);m.onSkillAccepted(side,6);
  let beforeConfirm=0;
  for(let i=0;i<45&&m.super3.stage===0;i++){
   const from=caster.axisPosition;beforeConfirm=m.super3.time;
   system.currentTick++;m.tick();
   if(m.super3.stage===0){assert.ok(Math.abs(caster.axisPosition-from)<=0.550001);assert.equal(victim.isPerforming,false)}
  }
  assert.equal(m.super3.stage,1);assert.ok(beforeConfirm<105);
  assert.equal(m.super3.time,114);assert.equal(clipElapsed(caster.entity),0);assert.equal(clipElapsed(victim.entity),0);
  assert.equal(victim.hp,MAX_HP);assert.ok(m.super3InputLocked(victim.side));
  for(let i=0;i<17;i++){system.currentTick++;m.tick();assert.equal(victim.hp,MAX_HP)}
  system.currentTick++;m.tick();assert.equal(victim.hp,MAX_HP-500);
 }
});

test('SA3 early confirmation preserves airborne evasion, down-state protection and wakeup immunity',()=>{
 for(const kind of ['air','down','invulnerable'] as const){
  const {a,b,m}=matchPair();a.meter=3;a.useSkill(6,3);m.onSkillAccepted(0,6);
  while(m.super3.time<66){system.currentTick++;m.tick()}
  if(kind==='air')b.placePerformance(b.axisPosition,20);
  if(kind==='down')b.settlePerformanceDown(true);
  if(kind==='invulnerable')b.grantInvulnerability(40);
  for(let i=0;i<25&&m.super3;i++){system.currentTick++;m.tick();if(m.super3)assert.equal(m.super3.stage,0)}
  assert.equal(m.super3,undefined);assert.equal(b.hp,MAX_HP);assert.equal(b.isPerforming,false);
  assert.ok(m.pearlReturn);
 }
});

test('SA1 smoothly frames the punch in both views, holds impact, and returns for knockback or interruption',()=>{
 for(const side of [0,1] as const)for(const outcome of ['hit','block','miss','interrupt','ko'] as const){
  const {a,b,m,ps}=matchPair(),caster=side===0?a:b,victim=side===0?b:a,face=caster.facing;
  caster.placePerformance(0);victim.placePerformance(face*(outcome==='miss'?8:3.2));
  delete m.updateCameras;
  const calls:any[][]=[[],[]],fovs:any[][]=[[],[]];
  ps.forEach((p:any,i:number)=>{
   p.camera.setCamera=(_id:string,o:any)=>calls[i].push({tick:system.currentTick,...o});
   p.camera.setFov=(o:any)=>fovs[i].push({tick:system.currentTick,...o});
   m.cameras.set(p.id,new SideCamera(p,{axis:'x'}));
  });
  m.updateCameras();calls.forEach(list=>list.splice(0));fovs.forEach(list=>list.splice(0));
  if(outcome==='block')m.intentFor=(s:number)=>s===victim.side?{...emptyIntent(),guard:true}:emptyIntent();
  if(outcome==='ko')victim.hp=1;
  caster.meter=1;caster.useSkill(6,1);m.onSkillAccepted(side,6);
  let impactSeen=false,returnedWhileDown=false,projected=false;
  for(let i=0;i<70;i++){
   if(outcome==='interrupt'&&i===9){const hit=caster.receiveHit(victim,1);m.onHit(hit)}
   system.currentTick++;m.tick();
   if(i===0){
    for(let seat=0;seat<2;seat++){
     assert.equal(calls[seat][0].easeOptions.easeTime,.25);
     assert.equal(fovs[seat][0].easeOptions.easeTime,.25);
     assert.equal(fovs[seat][0].fov,54);
    }
   }
   if(i>0&&i<5)assert.equal(calls[0].length,1,'initial smooth entry must not be overwritten');
   const t=clipElapsed(caster.entity)*3;
   if(currentClip(caster.entity)==='super_1'&&t>=19&&t<=27&&outcome!=='miss'&&outcome!=='interrupt'){
    const pose=lastCameraPose(ps[0].id)!,yaw=pose.yaw*Math.PI/180,pitch=pose.pitch*Math.PI/180;
    const forward=[-Math.sin(yaw)*Math.cos(pitch),-Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
    const up=[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),Math.cos(yaw)*Math.sin(pitch)],right=[-Math.cos(yaw),0,-Math.sin(yaw)];
    if(m.phase==='fight')for(const f of [caster,victim])for(const which of ['head','torso'] as const){
     const p=bodyPoint(f,which),v=[p.x-pose.pos.x,p.y-pose.pos.y,p.z-pose.pos.z];
     const dot=(axis:number[])=>v.reduce((sum,n,j)=>sum+n*axis[j]!,0),depth=dot(forward),half=depth*Math.tan(pose.fov*Math.PI/360);
     assert.ok(depth>0&&Math.abs(dot(up)/half)<.95&&Math.abs(dot(right)/(half*16/9))<.95,`${outcome} P${side+1} t${t} ${which}`);
     projected=true;
    }
   }
   if(victim.hp<MAX_HP&&m.phase==='fight'&&caster.inHitstop){impactSeen=true;assert.equal(lastCameraPose(ps[0].id)!.fov,54)}
   if(outcome==='hit'&&victim.isDown&&lastCameraPose(ps[0].id)!.fov===62)returnedWhileDown=true;
  }
  assert.deepEqual(calls[0],calls[1]);assert.deepEqual(fovs[0],fovs[1]);
  if(outcome==='hit'){assert.ok(projected&&impactSeen&&returnedWhileDown);assert.equal(victim.hp,MAX_HP-2000)}
  if(outcome==='miss'||outcome==='interrupt')assert.equal(victim.hp,MAX_HP);
  if(outcome==='ko')assert.equal(victim.hp,0);
  else {assert.equal(m.super1CameraCaster,undefined);assert.equal(lastCameraPose(ps[0].id)!.fov,62)}
 }
});

test('SA1 defense is sampled during displacement; late guard cannot stop the slow charge',()=>{
 for(const late of [false,true] as const){
  const {a,b,m}=matchPair();a.placePerformance(-1.4);b.placePerformance(1.4);
  m.intentFor=()=>late
    ? (clipElapsed(a.entity)*3>=20?{...emptyIntent(),guard:true}:emptyIntent())
    : {...emptyIntent(),guard:true};
  a.meter=1;assert.ok(a.useSkill(6,1));m.onSkillAccepted(0,6);
  let blocked:any;
  const original=m.onHit.bind(m);m.onHit=(hit:any)=>{if(hit.attacker===a)blocked=hit;original(hit)};
  for(let i=0;i<40&&blocked===undefined;i++){system.currentTick++;m.tick()}
  assert.ok(blocked);
  assert.equal(blocked.blocked,!late);
  assert.equal(b.hp,late?MAX_HP-2000:MAX_HP-SKILLS[6].guardChipDamage);
 }
});

test('shared combo scaling follows normal, light and heavy starters and clamps long combos',()=>{
 const cases=[
  ['normal',[100,100,80,70,60,50,40,30,20,10,10,10]],
  ['light',[100,80,70,60,50,40,30,20,10,10,10,10]],
  ['heavy',[100,80,64,56,48,40,32,24,16,8,8,8]],
 ] as const;
 for(const [starter,expected] of cases){
  const combo=new DamageCombo();
  const damage=expected.map((_,i)=>combo.confirm('attacker',i===0?starter:'normal',[100])[0]);
  assert.deepEqual(damage,[...expected]);
  assert.deepEqual(combo.confirm('different-attacker','normal',[100]),[100]);
  combo.reset();assert.deepEqual(combo.confirm('different-attacker','normal',[100]),[100]);
 }
});

test('every stance and every normal attack stage uses the new base damage',()=>{
 for(const slot of [1,2,3] as const)for(const stance of ['stand','crouch','air'] as const)for(const stage of [1,2,3]){
  const {a,b}=pair();a.stance=stance;
  const strength=slot===1?'light':slot===2?'medium':'heavy';
  playClip(a.entity,`attack_${stance}_${strength}${stage===1?'':'_'+stage}`,{force:true});
  const hit=b.receiveHit(a,slot);
  assert.equal(MAX_HP,10000);assert.equal(hit.damage,[300,600,850][slot-1]);
  assert.equal(b.hp,10000-hit.damage);
 }
});

test('normal hits scale in Fighter and combo recovery resets before either tick ordering',()=>{
 for(const opener of [1,2,3] as const){
  const {a,b}=pair();
  assert.equal(b.receiveHit(a,opener).damage,[300,600,850][opener-1]);
  assert.equal(b.receiveHit(a,2).damage,opener===2?600:480);
  assert.equal(b.receiveHit(a,2).damage,opener===1?420:opener===2?480:384);
  // Reach the first actionable tick without relying on b.tick running first.
  system.currentTick=(b as any).busyUntilTick;
  assert.equal(b.receiveHit(a,2).damage,600);
  step(a,b,50);assert.equal(b.receiveHit(a,1).damage,300);
  b.resetForRound(.6);assert.equal(b.hp,10000);assert.equal(b.receiveHit(a,2).damage,600);
 }
});

test('guard, invulnerability and throw tech do not leave damage scaling on the next combo',()=>{
 const {a,b}=pair();
 b.prepareInput({...emptyIntent(),guard:true});assert.ok(b.receiveHit(a,1).blocked);
 step(a,b,20);assert.equal(b.receiveHit(a,2).damage,600);
 b.resetForRound(.6);b.grantInvulnerability(2);assert.ok(b.receiveHit(a,1).blocked);
 system.currentTick+=2;assert.equal(b.receiveHit(a,2).damage,600);
 const capture=b.receiveHit(a,4);assert.equal(capture.capture,'throw');
 b.resolveThrowTech(a,system.currentTick);step(a,b,7);
 assert.equal(b.receiveHit(a,2).damage,600);
});

test('rise and dive use their own damage at real move contact on either side',()=>{
 for(const side of [0,1])for(const kind of ['rise','dive']){
  const {a,b}=pair(),caster=side===0?a:b,victim=side===0?b:a;
  if(kind==='rise')caster.prepareInput({...emptyIntent(),crouch:true});
  else {caster.placePerformance(caster.axisPosition,6);victim.placePerformance(victim.axisPosition,6);caster.prepareInput(emptyIntent())}
  assert.ok(caster.useSkill(5));
  let damage=0;
  for(let i=0;i<35&&damage===0;i++){
   system.currentTick++;caster.advancePresentation();victim.advancePresentation();
   const hit=caster.tick(emptyIntent(),victim,true);if(hit)damage=hit.damage;
   victim.tick(emptyIntent(),caster,true);
  }
  assert.equal(damage,kind==='rise'?1400:800);
 }
});

test('standalone one meter super deals 2000 and knocks the target down',()=>{
 const {a,b,m}=matchPair();a.meter=1;assert.ok(a.useSkill(6,1));m.onSkillAccepted(0,6);
 for(let i=0;i<100&&b.hp===10000;i++){system.currentTick++;m.tick()}
 assert.equal(b.hp,8000);assert.ok(b.isDown);
});

test('supers honor whole-move damage floors even after a heavy starter',()=>{
 for(const [base,floor,expected] of [[2000,30,600],[2800,40,1120],[4000,50,2000],[4500,50,2250]]){
  const combo=new DamageCombo();
  for(let i=0;i<12;i++)combo.confirm('p1',i===0?'heavy':'normal',[100]);
  assert.deepEqual(combo.confirm('p1','normal',[base],floor),[expected]);
 }
 const combo=new DamageCombo();combo.confirm('p1','heavy',[850]);
 combo.confirm('p1','normal',[600]);
 // An uneven split tests rounding once for the whole move, including its final remainder.
 const scaled=combo.confirm('p1','normal',[333,667,3000],50);
 assert.deepEqual(scaled,[213,426,1921]);assert.equal(scaled.reduce((a,b)=>a+b,0),2560);
});

test('throw and super 2 preserve capture-time scaling until their real impact',()=>{
 for(const slot of [4,6] as const){
  const {a,b,m}=matchPair();a.meter=2;assert.ok(a.useSkill(slot,2));
  b.receiveHit(a,1);
  const before=b.hp,hit=b.receiveHit(a,slot,slot===6?{victimClip:'super_2_victim'}:undefined);
  assert.equal(hit.damage,0);assert.equal(hit.deferredDamage,slot===4?960:2240);m.onHit(hit);
  for(let i=0;i<180&&(m.throwPair||m.super2);i++){system.currentTick++;m.tick()}
  assert.equal(before-b.hp,slot===4?960:2240);assert.ok(b.isDown);
 }
});

test('deep combo floors reach live SA1, SA2, SA3 and CA damage paths',()=>{
 for(const variant of ['sa1','sa2','sa3','ca']){
  const {a,b,m}=matchPair();
  // Exercise a long hit sequence without the current five-hit knockdown rule,
  // so future characters and multi-hit moves use this same universal floor.
  for(let i=0;i<10;i++)b.receiveHit(a,i===0?3:2,{victimClip:'hit_stand'});
  const before=b.hp;
  if(variant==='sa1'||variant==='sa2'){
   a.lastSuperTier=variant==='sa1'?1:2;
   const hit=b.receiveHit(a,6,{victimClip:variant==='sa1'?'super_1_victim':'super_2_victim'});
   if(variant==='sa1')assert.equal(hit.damage,600);
   else {
    assert.equal(hit.deferredDamage,1120);m.onHit(hit);
    // The normal animation drives the delayed impact even after the old 50-tick timeout.
    playClip(a.entity,'super_2',{force:true});
    for(let i=0;i<100&&m.super2;i++){system.currentTick++;m.tick()}
    assert.equal(before-b.hp,1120);
   }
  }else{
   a.hp=variant==='ca'?2500:10000;a.meter=3;a.useSkill(6,3);m.onSkillAccepted(0,6);
   // Confirm while still in hitstun, then run the full >8s paired performance.
   m.super3.time=SUPER_3_CONFIRM_AUTHOR_TICK;m.tickSuper3();
   assert.ok(m.super3.stage>0);
   const observed:number[]=[],original=m.onHit.bind(m);m.onHit=(hit:any)=>{observed.push(hit.damage);original(hit)};
   for(let i=0;i<450&&m.super3;i++){system.currentTick++;m.tick()}
   assert.deepEqual(observed,[250,150,150,175,175,175,175,variant==='ca'?1000:750]);
   assert.equal(before-b.hp,variant==='ca'?2250:2000);
  }
 }
});

test('poll/event consume once; same skill can be pressed again after return to slot zero',()=>{
 const {ps}=pair(),p=ps[0];p.selectedSlotIndex=1;assert.equal(pollSkillPress(p)?.slot,1);assert.equal(consumeSkillPress(p.id),undefined);
 assert.equal(resetSkillSlot(p),false);system.currentTick++;assert.ok(resetSkillSlot(p));system.currentTick++;noteSkillPress(p.id,1);assert.equal(consumeSkillPress(p.id)?.slot,1);assert.equal(pollSkillPress(p),undefined);
 clearSkillPresses([p.id]);
});
test('room cleanup does not remove another room input or props',()=>{
 const {ps,d}=pair(),other=dimension();noteSkillPress(ps[1].id,2);clearSkillPresses([ps[0].id]);assert.equal(consumeSkillPress(ps[1].id)?.slot,2);
 const p=spawnPearl(d,{x:0,y:0,z:0})!,q=spawnPearl(other,{x:0,y:0,z:0})!;despawnAllProps(d.id);assert.equal(p.isValid,false);assert.equal(q.isValid,true);
});
test('crouch + skill selects crouch clip; stale queued idle cannot replace attack',()=>{
 const {a,b}=pair();a.prepareInput({...emptyIntent(),crouch:true,guard:true});queueClip(`allstars:${a.player.id}:0`,'idle_stand',1);
 assert.ok(a.useSkill(1));assert.equal(currentClip(a.entity),'attack_crouch_light');step(a,b,1);assert.equal(currentClip(a.entity),'attack_crouch_light');
});
test('successful defense adds a small amount of meter instead of draining it',()=>{
 const {a,b}=pair();b.prepareInput({...emptyIntent(),guard:true});
 b.meter=1;const info=b.receiveHit(a,1);
 assert.equal(info.blocked,true);assert.ok(b.meter>1);assert.ok(b.meter<=3);
});
test('three repeated attacks progress through group, interruption resets chain',()=>{
 const {a,b}=pair();b.placePerformance(15);
 for(const id of ['attack_stand_light','attack_stand_light_2','attack_stand_light_3']){assert.ok(a.useSkill(1));assert.equal(currentClip(a.entity),id);while(a.isBusy)step(a,b);}
 a.receiveHit(b,1);step(a,b,40);assert.ok(a.useSkill(1));assert.equal(currentClip(a.entity),'attack_stand_light');
});
test('super requires and consumes the selected meter tier while preserving fractional remainder',()=>{
 const {a}=pair();a.meter=1.75;assert.equal(a.useSkill(6,2),false);assert.equal(a.meter,1.75);
 assert.ok(a.useSkill(6,1));assert.equal(a.meter,0.75);
});
test('slot 7 chooses the commanded super on both sides, even at full meter; W does not jump first',()=>{
 for(const side of [0,1])for(const tier of [1,2,3] as const){
  const {a,b,m,ps}=matchPair(),caster=side===0?a:b,p=ps[side];caster.meter=3;
  p.inputInfo.getMovementVector=()=>({x:0,y:tier===2?1:tier===3?-1:0});
  p.selectedSlotIndex=6;handleSkillSelection(p,6);m.tick();
  assert.equal(caster.lastSuperTier,tier);assert.equal(caster.meter,3-tier);
  assert.equal(currentClip(caster.entity),tier===3?'super_3_start':'super_'+tier);
  assert.equal(caster.feetY,ARENA_FLOOR_Y);
  system.currentTick++;m.tick();assert.equal(p.selectedSlotIndex,0);
 }
});

test('super tiers reject insufficient meter without downgrading, then spend the selected tier',()=>{
 for(const tier of [1,2,3] as const){
  const {a,m,ps}=matchPair(),p=ps[0];a.meter=tier-.25;
  p.inputInfo.getMovementVector=()=>({x:0,y:tier===2?1:tier===3?-1:0});
  p.selectedSlotIndex=6;handleSkillSelection(p,6);m.tick();
  assert.equal(a.lastSuperTier,undefined);assert.equal(a.meter,tier-.25);
  assert.ok(!currentClip(a.entity)?.startsWith('super_'));assert.equal(a.feetY,ARENA_FLOOR_Y);
  system.currentTick++;m.tick();assert.equal(p.selectedSlotIndex,0);
 }
 const {a}=pair();a.meter=2.4;assert.ok(a.useSkill(6,2));assert.ok(Math.abs(a.meter-0.4)<1e-9);
});

test('hotbar event captures the direction before W/S is released, without consuming dash edges',()=>{
 for(const tier of [2,3] as const){
  const {a,m,ps}=matchPair(),p=ps[0];a.meter=3;
  p.inputInfo.getMovementVector=()=>({x:0,y:tier===2?1:-1});handleSkillSelection(p,6);
  p.inputInfo.getMovementVector=()=>({x:0,y:0});system.currentTick++;m.tick();
  assert.equal(a.lastSuperTier,tier);
 }
 const {ps}=pair(),p=ps[0];
 p.inputInfo.getMovementVector=()=>({x:-1,y:0});deriveIntent(p,1);
 system.currentTick++;p.inputInfo.getMovementVector=()=>({x:0,y:0});deriveIntent(p,1);
 system.currentTick++;p.inputInfo.getMovementVector=()=>({x:-1,y:0});
 handleSkillSelection(p,6);assert.equal(deriveIntent(p,1).dash,1);
});

test('poll fallback and button fallback select the same directional super tiers',()=>{
 for(const tier of [1,2,3] as const){
  const {a,m,ps}=matchPair(),p=ps[0];a.meter=3;
  p.inputInfo.getMovementVector=()=>({x:0,y:tier===2?1:tier===3?-1:0});
  p.selectedSlotIndex=6;m.tick();assert.equal(a.lastSuperTier,tier);
 }
 const {ps}=pair(),p=ps[0];
 p.inputInfo.getButtonState=(button:string)=>button==='Jump'?'Pressed':'Released';assert.equal(readSuperTier(p),2);
 p.inputInfo.getButtonState=(button:string)=>button==='Sneak'?'Pressed':'Released';assert.equal(readSuperTier(p),3);
});

test('buffered W/S super keeps its chosen tier after the modifier is released',()=>{
 for(const tier of [2,3] as const){
  const {a,b,m,ps}=matchPair(),p=ps[0];a.meter=3;b.placePerformance(15);
  assert.ok(a.useSkill(1));system.currentTick++;
  p.inputInfo.getMovementVector=()=>({x:0,y:tier===2?1:-1});handleSkillSelection(p,6);m.tick();
  assert.equal(m.inputBuffer.get(p.id)?.superTier,tier);
  p.inputInfo.getMovementVector=()=>({x:0,y:0});
  for(let i=0;i<10&&a.lastSuperTier===undefined;i++){system.currentTick++;m.tick()}
  assert.equal(a.lastSuperTier,tier);assert.equal(a.meter,3-tier);
 }
});

test('hotbar return waits past the event and retries even when server reads 0 but client remains selected',()=>{
 const {ps}=pair(),p=ps[0];let serverSlot=6,clientSlot=6;const writes:number[]=[];
 Object.defineProperty(p,'selectedSlotIndex',{configurable:true,get:()=>serverSlot,set:(slot:number)=>{
  assert.ok(system.currentTick>0,'native setter must not run in the selection event tick');
  serverSlot=slot;clientSlot=slot;writes.push(system.currentTick);
 }});
 handleSkillSelection(p,6);assert.equal(consumeSkillPress(p.id)?.slot,6);
 assert.equal(resetSkillSlot(p),false);assert.equal(clientSlot,6);
 serverSlot=0;
 system.currentTick=1;assert.ok(resetSkillSlot(p));assert.equal(clientSlot,0);
 handleSkillSelection(p,0);assert.equal(consumeSkillPress(p.id),undefined);
 clientSlot=6;system.currentTick=2;assert.ok(resetSkillSlot(p));assert.equal(clientSlot,0);
 system.currentTick=3;assert.ok(resetSkillSlot(p));system.currentTick=4;assert.equal(resetSkillSlot(p),false);
 assert.deepEqual(writes,[1,2,3]);
 serverSlot=6;clientSlot=6;handleSkillSelection(p,6);assert.equal(consumeSkillPress(p.id)?.slot,6);
 system.currentTick=5;assert.ok(resetSkillSlot(p));assert.equal(clientSlot,0);
});

test('hotbar return retries a rejected write, cancels on cleanup, and leaves unrelated slots alone',()=>{
 const {ps}=pair(),p=ps[0],q=ps[1];let selected=1,fail=true;const warnings:any[]=[];
 Object.defineProperty(p,'selectedSlotIndex',{get:()=>selected,set:(slot:number)=>{if(fail)throw new Error('restricted');selected=slot;}});
 handleSkillSelection(p,1);q.selectedSlotIndex=2;handleSkillSelection(q,2);
 const warn=console.warn;console.warn=(...args:any[])=>{warnings.push(args)};
 try{
  system.currentTick=1;assert.equal(resetSkillSlot(p),false);assert.equal(warnings.length,1);
  fail=false;system.currentTick=2;assert.ok(resetSkillSlot(p));assert.equal(selected,0);
  clearSkillPresses([p.id]);system.currentTick=3;assert.equal(resetSkillSlot(p),false);
  assert.ok(resetSkillSlot(q));assert.equal(q.selectedSlotIndex,0);
  q.selectedSlotIndex=8;system.currentTick++;assert.equal(resetSkillSlot(q),false);assert.equal(q.selectedSlotIndex,8);
 }finally{console.warn=warn}
});

test('all six skill keys return during locked phases, including when presentation throws',()=>{
 const {m,ps}=matchPair(),p=ps[0];m.phase='countdown';m.phaseUntilTick=1000;
 m.log=()=>{};m.tickSceneProps=()=>{throw new Error('test presentation failure')};
 for(const slot of [1,2,3,4,5,6]){
  p.selectedSlotIndex=slot;handleSkillSelection(p,slot);m.tick();assert.equal(p.selectedSlotIndex,slot);
  system.currentTick++;m.tick();assert.equal(p.selectedSlotIndex,0);
  system.currentTick++;
 }
 assert.equal(consumeSkillPress(p.id),undefined);
});

test('last countdown-tick selection is discarded even with polling only and deferred return',()=>{
 const {a,m,ps}=matchPair(),p=ps[0];m.phase='countdown';m.phaseUntilTick=1;
 p.selectedSlotIndex=1;m.tick();assert.equal(p.selectedSlotIndex,1);
 system.currentTick++;m.tick();assert.equal(m.phase,'fight');assert.equal(p.selectedSlotIndex,0);
 system.currentTick++;m.tick();assert.equal(currentClip(a.entity),'idle_stand');
});

test('release freeze pauses both animation clocks and active deadlines',()=>{
 const {a,b,m}=matchPair();a.meter=1;assert.ok(a.useSkill(6));m.onSkillAccepted(0,6);
 const before=(a as any).activeMove.startTick;
 for(let i=0;i<4;i++){system.currentTick++;m.tick();assert.equal(clipElapsed(a.entity),0);assert.equal(clipElapsed(b.entity),0);}
 assert.ok((a as any).activeMove.startTick>before);assert.equal(b.hp,MAX_HP);
});
test('hitstop pauses source time, then a real 0.1 clock advances one tick in ten',()=>{
 const {a,b}=pair();a.useSkill(3);a.applyHitstop(4);step(a,b,2);assert.equal(clipElapsed(a.entity),0);
 (a as any).hitstopUntilTick=0;for(let i=0;i<10;i++){system.currentTick++;a.advancePresentation(false,.1)}assert.ok(Math.abs(clipElapsed(a.entity)-1)<1e-6);
});
test('two sequential intros each play a full 66 ticks, then wait for the countdown',()=>{
 const {a,b,m}=matchPair();m.phase='intro';m.cinematicIntro=true;m.phaseUntilTick=132;
 m.tick();assert.equal(currentClip(a.entity),'intro');assert.equal(currentClip(b.entity),'idle_stand');
 for(let i=0;i<66;i++){system.currentTick++;m.tick()}assert.equal(currentClip(b.entity),'intro');assert.equal(currentClip(a.entity),'idle_stand');
 for(let i=0;i<66;i++){system.currentTick++;m.tick()}assert.equal(m.phase,'countdown');assert.equal(currentClip(b.entity),'idle_stand');
 for(let i=0;i<60;i++){system.currentTick++;m.tick()}assert.equal(m.phase,'fight');assert.equal(m.roundStartTick,192);
});

test('each round displays 3/2/1 for 20 ticks, rejects early input, then starts the round clock',()=>{
 const {a,b,m,ps}=matchPair();
 delete m.pushHud;delete m.updateCameras;
 ps.forEach((p:any)=>m.cameras.set(p.id,new SideCamera(p,{axis:'x'})));
 m.round=2;m.setupRound();
 const start=system.currentTick,positions=[a.axisPosition,b.axisPosition];
 const shapes=()=>[...(world.primitiveShapesManager as any).texts].filter((s:any)=>s.visibleTo?.includes(ps[0]));
 for(let elapsed=0;elapsed<60;elapsed++){
  system.currentTick=start+elapsed;
  if(elapsed%20===0){noteSkillPress(ps[0].id,1);ps[0].selectedSlotIndex=1;}m.tick();
  assert.equal(m.phase,'countdown');assert.equal(currentClip(a.entity),'idle_stand');
  assert.deepEqual([a.axisPosition,b.axisPosition],positions);assert.equal(ps[0].selectedSlotIndex,elapsed%20===0?1:0);
  const center=shapes()[3];
  assert.ok(center?.text.includes(String(3-Math.floor(elapsed/20))));
 }
 system.currentTick=start+60;m.tick();assert.equal(m.phase,'fight');assert.equal(m.roundStartTick,start+60);
 assert.ok(shapes()[3]?.text.includes('开打!'));
 for(let i=0;i<16;i++){system.currentTick++;m.tick()}
 assert.equal(currentClip(a.entity),'idle_stand');assert.ok(!shapes()[2]?.text.includes('开打!'));
 hud.clear(ps);assert.equal(shapes().length,0);
});

test('holding down alone takes a normal crouching hit instead of auto-blocking',()=>{
 const {a,b,m,ps}=matchPair();ps[1].inputInfo.getMovementVector=()=>({x:0,y:-1});
 assert.ok(a.useSkill(1));
 for(let i=0;i<8&&b.hp===MAX_HP;i++){system.currentTick++;m.tick()}
 assert.equal(b.hp,MAX_HP-SKILLS[1].damage);assert.equal(currentClip(b.entity),'hit_crouch');
});

test('down-back still crouch-blocks on both sides, while the sneak fallback alone does not',()=>{
 for(const facing of [1,-1] as const){
  const {a,b,ps}=pair();ps[1].inputInfo.getMovementVector=()=>({x:facing,y:-1});
  const intent=deriveIntent(ps[1],facing,'x');assert.ok(intent.crouch);assert.ok(intent.guard);
  b.prepareInput(intent);const hit=b.receiveHit(a,1);assert.ok(hit.blocked);assert.equal(b.hp,MAX_HP);
  assert.equal(currentClip(b.entity),'guard_hit_crouch');
  const thrown=b.receiveHit(a,4);assert.equal(thrown.blocked,false);
  ps[1].inputInfo.getMovementVector=()=>({x:0,y:0});
  ps[1].inputInfo.getButtonState=(key:string)=>key==='Sneak'?'Pressed':'Released';
  const sneak=deriveIntent(ps[1],facing,'x');assert.ok(sneak.crouch);assert.equal(sneak.guard,false);
 }
});

test('dash presentation is binary visible/hidden and restores after the blink',()=>{
 const {a,b}=pair();playClip(a.entity,'dash_forward',{force:true});
 const samples=[];
 for(let i=0;i<7;i++){system.currentTick++;a.advancePresentation();samples.push(a.entity!.getProperty('bearcade:allstars_opacity'))}
 assert.ok(samples.every(v=>v===0||v===1));assert.ok(samples.includes(0));assert.equal(samples.at(-1),1);
 a.receiveHit(b,1);assert.equal(a.entity!.getProperty('bearcade:allstars_opacity'),1);
});

test('fighter and afterimage keep original binary-alpha skins through all visibility states',()=>{
 const {PNG}=createRequire(import.meta.url)('pngjs');const root='AllStars-灯塔全明星/resource-pack/';
 const client=JSON.parse(readFileSync(root+'entity/chunye.entity.json','utf8'))['minecraft:client_entity'].description;
 const ghost=JSON.parse(readFileSync(root+'entity/allstars_afterimage.entity.json','utf8'))['minecraft:client_entity'].description;
 const controllers=JSON.parse(readFileSync(root+'render_controllers/allstars.render_controllers.json','utf8')).render_controllers;
 assert.deepEqual(client.textures,{default:'textures/entity/chunye',blue:'textures/entity/chunye_blue'});
 assert.deepEqual(ghost.textures,client.textures);assert.deepEqual(client.materials,{default:'entity_alphatest'});
 for(const [skin,suffix] of [['default',''],['blue','_blue']]){
  const base=PNG.sync.read(readFileSync(root+client.textures[skin]+'.png'));
  const rc=controllers['controller.render.bearcade_allstars_fighter'+suffix];
  assert.equal(rc.color,undefined);assert.equal(rc.arrays,undefined);
  assert.deepEqual(rc.textures,['Texture.'+skin]);
  assert.equal(rc.part_visibility[0]['*'],"query.property('bearcade:allstars_opacity') > 0.01");
  for(let i=3;i<base.data.length;i+=4)assert.ok(base.data[i]===0||base.data[i]===255);
 }
 assert.deepEqual(allstarsRenderErrors(root),[]);
});

test('seat TextPrimitives follow animated heads and keep fixed colors in both views',()=>{
 const {a,b,ps}=pair();hud.refreshSeatMarkers(ps,[a,b]);
 const shapes=[...(world.primitiveShapesManager as any).texts].filter((s:any)=>s.attachedTo===a.entity||s.attachedTo===b.entity);
 assert.equal(shapes.length,2);assert.equal(shapes[0].text,'§b§l1P');assert.equal(shapes[1].text,'§c§l2P');
 assert.deepEqual(shapes[0].visibleTo,ps);assert.deepEqual(shapes[1].visibleTo,ps);
 assert.equal((a.entity as any).nameTag,'');
 playClip(a.entity,'idle_crouch',{force:true});hud.refreshSeatMarkers(ps,[a,b]);
 const top=bodyPoint(a,'head');assert.ok(Math.abs(shapes[0].location.y-(top.y-a.location.y+.18))<1e-8);
 assert.ok(shapes[0].location.y<shapes[1].location.y,'crouched head label follows the actual lower head');
 a.entity!.setProperty('bearcade:allstars_opacity',0);hud.refreshSeatMarkers(ps,[a,b]);assert.equal(shapes[0].scale,0);
 assert.deepEqual(shapes[0].visibleTo,ps,'an empty visibleTo list would leak to every player');
 a.entity!.setProperty('bearcade:allstars_opacity',1);hud.refreshSeatMarkers(ps,[a,b]);assert.equal(shapes[0].scale,.8);
 hud.clear(ps);assert.ok(shapes.every(s=>!(world.primitiveShapesManager as any).texts.has(s)));
});

test('meter HUD shows integer stocks and only the progress toward the next stock',()=>{
 assert.equal(hud.meterText(0),'0气 [----------] 0%');
 assert.equal(hud.meterText(.5),'0气 [=====-----] 50%');
 assert.equal(hud.meterText(1),'1气 [----------] 0%');
 assert.equal(hud.meterText(1.2),'1气 [==--------] 20%');
 assert.equal(hud.meterText(2.99),'2气 [=========-] 99%');
 assert.equal(hud.meterText(3),'3气 [==========] MAX');
 const {a,b}=pair(),state=hud.stateFrom([a,b],1,1980,[0,0],'fight');
 state.fighters[0].meter=1.5;assert.ok(hud.buildHudText(state).includes('1气 [=====-----] 50%'));
});
test('low health turns HP bars yellow, while meter bars turn yellow only at three meter',()=>{
 const {a,b}=pair(),state=hud.stateFrom([a,b],1,1000,[0,0],'fight');
 state.fighters[0].hp=2000;state.fighters[0].meter=2.99;
 state.fighters[1].hp=2500;state.fighters[1].meter=3;
 const lines=hud.buildHudText(state).split('\n');
 assert.match(lines[1],/^§e/);assert.match(lines[2],/^§e/);
 assert.match(lines[3],/^§b/);assert.match(lines[3],/§e/);
});
test('HUD does not repeat the round label when phase text already contains it',()=>{
 const {a,b}=pair();
 const text=hud.buildHudText(hud.stateFrom([a,b],2,1980,[1,0],'§6第 2 局'));
 assert.equal((text.match(/第 2 局/g) ?? []).length,1);
});

test('intro controller line omits segment counters',()=>{
 const {m}=matchPair();m.cinematicIntro=true;m.introSegment=0;
 const line=(m as any).introCastLine();
 assert.match(line,/操控/);assert.doesNotMatch(line,/1\/2|2\/2|开场 1|开场 2/);
 assert.match(line,/§b1P/);
});
test('HUD keeps P1 blue and P2 red in shared TextPrimitive text for either viewpoint',()=>{
 const {a,b,ps}=pair();
 const show=(side:0|1)=>{
  new SideCamera(ps[side],{axis:'x'}).update([a,b]);
  hud.refresh(ps,hud.stateFrom([a,b],1,1000,[0,0],'fight'),()=>side);
  return [...(world.primitiveShapesManager as any).texts].find((s:any)=>s.visibleTo?.includes(ps[0]))?.text as string;
 };
 const first=show(0),second=show(1);
 assert.equal(first,second);
 assert.match(first,/^10000 §b/);assert.match(first,/§c/);
 const state=hud.stateFrom([a,b],1,1000,[0,0],'fight');
 assert.match(hud.buildHudTextFor(ps[0],state,0),/§b§l>/);
 assert.match(hud.buildHudTextFor(ps[1],state,1),/§c§l>/);
 hud.clear(ps);
});

test('HUD text binds to a transparent follow anchor instead of jumping absolute positions',()=>{
 const {a,b,ps,d}=pair();new SideCamera(ps[0],{axis:'x'}).update([a,b]);
 const anchor=d.spawnEntity('bearcade:allstars_afterimage',{x:0,y:1,z:0});
 anchor.setProperty('bearcade:allstars_opacity',0);
 hud.refresh(ps,hud.stateFrom([a,b],1,1000,[0,0],'fight'),()=>0,anchor);
 const shapes=[...(world.primitiveShapesManager as any).texts].filter((s:any)=>s.visibleTo?.includes(ps[0]));
 assert.equal(shapes.length,4);assert.ok(shapes.every((s:any)=>s.attachedTo===anchor));
 assert.notDeepEqual(shapes[0].location,shapes[3].location,'HP and center keep separate local offsets');
 hud.clear(ps);anchor.remove();
});

for(const [name,spawn] of [['pearl',spawnPearl],['command block',spawnCommandBlock]] as const)
test(`${name} scale grows, follows freeze/slow time, shrinks once and cleans only its own room`,()=>{
 const d=dimension(),other=dimension(),p=spawn(d,{x:0,y:0,z:0})!,q=spawn(other,{x:0,y:0,z:0})!;
 assert.equal(p.getProperty('bearcade:prop_scale'),.001);
 advanceProps(d.id,1);const small=Number(p.getProperty('bearcade:prop_scale'));assert.ok(small>.001&&small<1);
 advanceProps(d.id,0);assert.equal(p.getProperty('bearcade:prop_scale'),small);
 for(let i=0;i<10;i++)advanceProps(d.id,.1);
 assert.ok(Number(p.getProperty('bearcade:prop_scale'))>small);assert.ok(Number(p.getProperty('bearcade:prop_scale'))<1);
 advanceProps(d.id,1);assert.equal(p.getProperty('bearcade:prop_scale'),1);
 dismissProp(p);advanceProps(d.id,1);const shrinking=Number(p.getProperty('bearcade:prop_scale'));assert.ok(shrinking>0&&shrinking<1);
 dismissProp(p);advanceProps(d.id,2);assert.equal(p.isValid,false);assert.equal(q.isValid,true);
 dismissProp(q);despawnAllProps(other.id);assert.equal(q.isValid,false);
});

test('native pearl and cage animations reference declared float properties and isolated geometry',()=>{
 const root='AllStars-灯塔全明星/',read=(p:string)=>JSON.parse(readFileSync(root+p,'utf8'));
 const anim=read('resource-pack/animations/allstars_props.animation.json').animations;
 const pearl=read('entities/allstars_pearl.json')['minecraft:entity'];
 assert.ok(pearl.description.properties['bearcade:prop_scale'].client_sync);
 const pearlClient=read('resource-pack/entity/allstars_pearl.entity.json')['minecraft:client_entity'].description;
 assert.equal(pearlClient.scripts.scale,"query.property('bearcade:prop_scale')");
 assert.equal(pearlClient.scripts.animate,undefined);assert.equal(pearlClient.animations,undefined);
 assert.equal(anim['animation.bearcade_allstars.pearl_scale'],undefined);
 const block=read('entities/allstars_command_block.json')['minecraft:entity'];
 assert.equal(block.components['minecraft:scale'].value,1.1);
 assert.ok(block.description.properties['bearcade:prop_scale'].client_sync);
 assert.deepEqual(entityFloatTokenErrors(readFileSync(root+'entities/allstars_command_block.json','utf8')),[]);
 const blockClient=read('resource-pack/entity/allstars_command_block.entity.json')['minecraft:client_entity'].description;
 assert.equal(blockClient.scripts.scale,"query.property('bearcade:prop_scale')");
 const cage=read('entities/allstars_command_cage.json')['minecraft:entity'];
 assert.equal(cage.components['minecraft:physics'].has_collision,false);
 assert.deepEqual(entityFloatTokenErrors(readFileSync(root+'entities/allstars_command_cage.json','utf8')),[]);
 const geometry=read('resource-pack/models/entity/allstars_command_cage.geo.json')['minecraft:geometry'][0];
 assert.equal(geometry.bones[0].cubes.length,12);
 const pose=anim['animation.bearcade_allstars.command_cage'].bones.Cage;
 assert.equal(pose.scale.length,3);assert.equal(pose.rotation.length,3);
});

test('super 2 cage exists only after capture, follows the victim, freezes and clears after impact',()=>{
 const {a,b,m,d}=matchPair();a.meter=2;a.useSkill(6,2);m.onSkillAccepted(0,6);
 for(let i=0;i<100&&!m.super2;i++){system.currentTick++;m.tick();if(!m.super2)assert.ok(!d.entities.some((e:any)=>e.typeId==='bearcade:allstars_command_cage'))}
 const cage=m.sceneProps.get('super2Cage');assert.ok(cage?.isValid);assert.deepEqual(cage.location,b.location);
 const time=cage.getProperty('bearcade:cage_time');a.applyHitstop(4);b.applyHitstop(4);system.currentTick++;m.tick();assert.equal(cage.getProperty('bearcade:cage_time'),time);
 for(let i=0;i<100&&clipElapsed(a.entity)*3<141;i++){system.currentTick++;m.tick()}
 assert.equal(cage.isValid,false);assert.equal(m.sceneProps.has('super2Cage'),false);
});

test('blocked or missed super 2 never creates a victim cage',()=>{
 for(const blocked of [true,false]){
  const {a,b,m,d}=matchPair();if(!blocked){a.placePerformance(-15);b.placePerformance(15);}
  m.intentFor=(side:number)=>blocked&&side===1?{...emptyIntent(),guard:true}:emptyIntent();
  a.meter=2;a.useSkill(6,2);m.onSkillAccepted(0,6);
  for(let i=0;i<65;i++){system.currentTick++;m.tick()}
  assert.ok(!d.entities.some((e:any)=>e.typeId==='bearcade:allstars_command_cage'));
 }
});
test('airborne knockdown never starts getup before physical landing; KO remains down',()=>{
 const {a,b}=pair();b.placePerformance(1,12);b.receiveHit(a,5,{launch:true} as any);
 for(let i=0;i<20;i++){step(a,b);if(b.feetY>ARENA_FLOOR_Y+.1)assert.notEqual(currentClip(b.entity),'getup')}
 b.playDown();step(a,b,150);assert.equal(currentClip(b.entity),'idle_down');assert.ok(b.isDown);
});
test('getup grants a short wakeup invulnerability window',()=>{
 const {a,b}=pair();
 for(let i=0;i<5;i++)a.receiveHit(b,1);
 assert.ok(a.isDown);
 let observed=false;
 for(let i=0;i<80;i++){
  const wasDown=a.isDown;step(a,b);
  if(wasDown&&!a.isDown){observed=true;assert.ok(a.isInvulnerable);break;}
 }
 assert.ok(observed);
});
test('super 2 captures without damage, strikes at 124 author ticks and ends down',()=>{
 const {a,b,m}=matchPair();a.meter=2;a.useSkill(6,2);m.onSkillAccepted(0,6);
 for(let i=0;i<100&&!m.super2;i++){system.currentTick++;m.tick()}
 assert.ok(m.super2);assert.equal(b.hp,MAX_HP);
 for(let i=0;i<160&&m.super2;i++){system.currentTick++;m.tick()}
 assert.equal(b.hp,7200);assert.ok(b.isDown);assert.equal(a.isPerforming,false);
});
for(const side of [0,1] as const)for(const low of [false,true])test(`super 3 P${side+1} ${low?'low':'normal'} resolves all damage and updates the native HUD`,()=>{
 const {a,b,m,ps}=matchPair(),caster=side===0?a:b,victim=side===0?b:a;
 delete m.pushHud;delete m.updateCameras;
 ps.forEach((p:any)=>m.cameras.set(p.id,new SideCamera(p,{axis:'x'})));
 caster.hp=low?MAX_HP*.25:MAX_HP;caster.meter=3;caster.useSkill(6,3);m.onSkillAccepted(side,6);
 let hits=0,finalSeen=false;const observedDamage:number[]=[],observedHp:number[]=[],original=m.onHit.bind(m);
 m.onHit=(h:any)=>{hits++;observedDamage.push(h.damage);observedHp.push(victim.hp);original(h)};
 for(let i=0;i<400&&m.super3;i++){
  system.currentTick++;m.tick();
  if(currentClip(caster.entity)===(low?'super_3_low_finish':'super_3_finish')){finalSeen=true;assert.ok(caster.isPerforming)}
 }
 const remaining=low?5500:6000;
 assert.deepEqual(observedDamage,[500,300,300,350,350,350,350,low?2000:1500]);
 assert.deepEqual(observedHp,[9500,9200,8900,8550,8200,7850,7500,remaining]);
 assert.ok(finalSeen);assert.equal(hits,8);assert.equal(victim.hp,remaining);assert.ok(victim.isDown);assert.equal(caster.isPerforming,false);
 const texts=[...(world.primitiveShapesManager as any).texts].filter((s:any)=>s.visibleTo?.includes(ps[0]));
 const hp=texts[0].text as string;assert.ok(side===0?hp.endsWith(' '+remaining):hp.startsWith(remaining+' '),hp);
 hud.clear(ps);
});
test('KO super preserves final pair through slow motion and loser never gets up',()=>{
 const {a,b,m}=matchPair();b.hp=5;a.meter=3;a.useSkill(6,3);m.onSkillAccepted(0,6);
 let sawSlow=false;for(let i=0;i<500&&m.phase!=='roundEnd';i++){system.currentTick++;m.tick();if(m.phase==='ko'){sawSlow=true;assert.notEqual(currentClip(b.entity),'getup')}}
 assert.ok(sawSlow);assert.equal(m.phase,'roundEnd');assert.ok(b.isDown);
});

test('SA3 opening hides only the opponent until the camera and controls return, with a slight longer windup',()=>{
 for(const side of [0,1] as const)for(const low of [false,true]){
  const {a,b,m,ps}=matchPair(),caster=side===0?a:b,victim=side===0?b:a;
  ps.forEach((p:any)=>m.cameras.set(p.id,new SideCamera(p,{axis:ARENA_AXIS})));
  let movement=true;
  ps[victim.side].inputPermissions.setPermissionCategory=(_category:any,allowed:boolean)=>{movement=allowed};
  caster.placePerformance(0);victim.placePerformance(caster.facing*12);
  if(low)caster.hp=2500;
  caster.meter=3;assert.ok(caster.useSkill(6,3));m.onSkillAccepted(side,6);
  assert.equal(victim.entity!.getProperty('bearcade:allstars_opacity'),0);
  assert.equal(movement,false);
  let loweredUntil=0,raisedAt=0,travelAt=0;
  for(let i=1;i<=30;i++){
   system.currentTick++;m.tick();
   assert.ok(m.super3);assert.equal(m.super3.stage,0);
   const t=m.super3.time;
   if(!loweredUntil&&t>=25)loweredUntil=i;
   if(!raisedAt&&t>=30)raisedAt=i;
   assert.equal(m.roundStartTick,system.currentTick,'extra presentation time must not consume round seconds');
   hud.refreshSeatMarkers(ps,[a,b]);
   const marker=[...(world.primitiveShapesManager as any).texts].find((s:any)=>s.attachedTo===victim.entity);
   assert.ok(marker);
   if(t<69){
    assert.equal(victim.entity!.getProperty('bearcade:allstars_opacity'),0);
    assert.equal(marker.scale,0);assert.equal(movement,false);
    assert.equal(m.super3CameraShot,'front');
    assert.equal(caster.axisPosition,0);assert.equal(caster.entity!.getProperty('bearcade:allstars_opacity'),1);
    assert.ok(Math.abs(clipElapsed(caster.entity)*3-t)<1e-8,'body and prop clock must stay aligned');
   }else{
    travelAt=i;assert.equal(victim.entity!.getProperty('bearcade:allstars_opacity'),1);
    assert.equal(marker.scale,.8);assert.equal(movement,true);assert.equal(m.super3CameraShot,'teleport');
    assert.ok(Math.abs(caster.axisPosition)<=.550001);break;
   }
  }
  assert.equal(travelAt,27,'opening should grow from 23 to 27 game ticks (only +0.2 s)');
  assert.ok(loweredUntil>=10&&loweredUntil<=11);assert.ok(raisedAt-loweredUntil<=2,'head snap stays quick');
  noteSkillPress(ps[victim.side].id,1);system.currentTick++;m.tick();
  assert.equal(currentClip(victim.entity),'attack_stand_light');
  hud.clear(ps);
 }
});

test('SA3 opening visibility is restored on interruption, reset and early finish',()=>{
 for(const side of [0,1] as const)for(const ending of ['hit','finish','reset','clear'] as const){
  const {a,b,m,ps}=matchPair(),caster=side===0?a:b,victim=side===0?b:a;
  let movement=true;ps[victim.side].inputPermissions.setPermissionCategory=(_c:any,on:boolean)=>{movement=on};
  caster.meter=3;caster.useSkill(6,3);m.onSkillAccepted(side,6);
  for(let i=0;i<4;i++){system.currentTick++;m.tick();assert.equal(victim.entity!.getProperty('bearcade:allstars_opacity'),0)}
  if(ending==='hit')m.onHit(caster.receiveHit(victim,1));
  else if(ending==='finish')m.finishSuper3();
  else if(ending==='reset')m.setupRound();
  else m.clearPresentationState();
  assert.equal(m.super3,undefined);assert.equal(movement,true);
  assert.equal(victim.entity!.getProperty('bearcade:allstars_opacity'),1);
  victim.advancePresentation();assert.equal(victim.entity!.getProperty('bearcade:allstars_opacity'),1);
 }
});

test('SA3 KO round victory faces the camera from the first bow frame on either side',()=>{
 for(const side of [0,1] as const)for(const low of [false,true]){
  const {a,b,m,ps}=matchPair(),caster=side===0?a:b,victim=side===0?b:a;
  ps.forEach((p:any)=>m.cameras.set(p.id,new SideCamera(p,{axis:ARENA_AXIS})));
  if(low)caster.hp=2500;victim.hp=1;caster.meter=3;caster.useSkill(6,3);m.onSkillAccepted(side,6);
  for(let i=0;i<650&&m.phase==='fight';i++){system.currentTick++;m.tick()}
  assert.equal(m.phase,'ko');
  for(let i=0;i<250&&m.phase==='ko';i++){system.currentTick++;m.tick()}
  assert.equal(m.phase,'roundEnd');
  for(let i=0;i<40&&caster.waitingForVictory;i++){system.currentTick++;m.tick()}
  assert.equal(currentClip(caster.entity),'victory_round');
  for(let i=0;i<75;i++){
   const yaw=caster.entity!.getRotation().y*Math.PI/180;
   for(const player of ps){
    const camera=lastCameraPose(player.id)!;
    const dx=camera.pos.x-caster.location.x,dz=camera.pos.z-caster.location.z;
    const front=(-Math.sin(yaw)*dx+Math.cos(yaw)*dz)/Math.hypot(dx,dz);
    assert.ok(front>.9,`P${side+1} ${low?'CA':'SA3'} bow must face camera (dot=${front})`);
   }
   assert.equal(victim.isOnStage,false);
   system.currentTick++;m.tick();
  }
  assert.equal(currentClip(caster.entity),'victory_round_idle');hud.clear(ps);
 }
});
test('cinematic timer pauses through a super release and super 3 never KOs before its final contact',()=>{
 const {a,b,m}=matchPair();
 a.meter=3;a.useSkill(6,3);m.onSkillAccepted(0,6);
 for(let i=0;i<25;i++){system.currentTick++;m.tick();assert.equal((m as any).roundStartTick,system.currentTick)}
 b.hp=5;
 let sawEarlyKo=false;
 for(let i=0;i<300&&m.super3;i++){
  system.currentTick++;m.tick();
  if(m.super3 && (m.super3 as any).hits<8 && b.hp<=0)sawEarlyKo=true;
 }
 assert.equal(sawEarlyKo,false);
 assert.equal(b.hp,0);
});
test('super 3 startup locks the opponent, protects the caster briefly, then remains interruptible',()=>{
 const {a,b,m,ps}=matchPair();a.meter=3;a.useSkill(6,3);m.onSkillAccepted(0,6);assert.equal(b.isPerforming,false);
 // 对手的快捷栏输入在聚珠阶段被丢弃，且同一 tick 不会获得移动控制。
 noteSkillPress(ps[1].id,1);m.tick();assert.ok(m.super3);assert.equal(b.axisPosition,0.6);
 // 极短无敌帧内的攻击不应打断三气。
 const protectedHit=a.receiveHit(b,1);assert.equal(protectedHit.blocked,true);assert.equal(a.hp,MAX_HP);assert.ok(m.super3);
 // 窗口结束后仍可被普通攻击打断，三气进入失败收招。
 system.currentTick+=4;const hit=a.receiveHit(b,1);assert.equal(hit.damage,SKILLS[1].damage);
 system.currentTick++;m.tick();assert.equal(m.super3,undefined);assert.equal(a.hp,MAX_HP-SKILLS[1].damage);
});
test('super 3 is canceled when a normal hit arrives on the first-confirm tick',()=>{
 const {a,b,m}=matchPair();a.meter=3;a.useSkill(6,3);m.onSkillAccepted(0,6);
 const plan=(m as any).super3;assert.ok(plan);
 // tickSuper3() may already have switched to the paired confirm segment before
 // the fighters process their active windows in this same game tick.
 system.currentTick=4;plan.time=SUPER_3_CONFIRM_AUTHOR_TICK;plan.stage=1;plan.hits=0;
 const hit=a.receiveHit(b,1);(m as any).onHit(hit);
 assert.equal(hit.blocked,false);assert.equal(a.hp,MAX_HP-SKILLS[1].damage);
 assert.equal((m as any).super3,undefined);
});
test('super 3 is canceled by a throw on the first-confirm tick',()=>{
 const {a,b,m}=matchPair();a.meter=3;a.useSkill(6,3);m.onSkillAccepted(0,6);
 const plan=(m as any).super3;assert.ok(plan);
 system.currentTick=4;plan.time=SUPER_3_CONFIRM_AUTHOR_TICK;plan.stage=1;plan.hits=0;
 const hit=a.receiveHit(b,4);(m as any).onHit(hit);
 assert.equal(hit.blocked,false);assert.equal(hit.damage,0);
 assert.equal((m as any).super3,undefined);
 assert.ok((m as any).throwPair,'the incoming throw still owns its normal paired timeline');
 for(let i=0;i<40&&(m as any).throwPair;i++){system.currentTick++;m.tick()}
 assert.ok(a.isDown,'the incoming throw still settles into its normal knockdown flow');
});
test('super 3 confirmation has a short guard-break window',()=>{
 const {a,b,m}=matchPair();a.meter=3;a.useSkill(6,3);m.onSkillAccepted(0,6);
 // 对手一直保持防御；首击确认的短窗口应穿过 guard，进入配对演出。
 m.intentFor=(side:number)=>side===1?{...emptyIntent(),guard:true}:emptyIntent();
 for(let i=0;i<50&&m.super3?.stage===0;i++){system.currentTick++;m.tick()}
 assert.ok(m.super3);assert.ok((m.super3 as any).stage>=1);assert.equal(b.isPerforming,true);
});
test('throw capture defers damage; early tech finishes in 6 ticks and deals no damage',()=>{
 const {a,b,m,ps}=matchPair();a.useSkill(4);
 for(let i=0;i<7;i++){system.currentTick++;m.tick()}
 assert.ok(m.throwPair);assert.equal(b.hp,MAX_HP);
 system.currentTick++;noteSkillPress(ps[1].id,4);m.tick();assert.equal(m.throwPair,undefined);
 assert.equal(currentClip(a.entity),'throw_tech_cast');assert.equal(currentClip(b.entity),'throw_tech_victim');
 for(let i=0;i<6;i++){system.currentTick++;m.tick()}
 assert.equal(a.isBusy,false);assert.equal(b.isBusy,false);assert.equal(b.hp,MAX_HP);
});
test('throw lands at 1.4 seconds, late tech cannot escape, getup completes at 2.6 seconds',()=>{
 const {a,b,m,ps}=matchPair();a.useSkill(4);
 for(let i=0;i<10;i++){system.currentTick++;m.tick()}
 noteSkillPress(ps[1].id,4);system.currentTick++;m.tick();assert.ok(m.throwPair);
 while(system.currentTick<28){system.currentTick++;m.tick()}
 assert.equal(b.hp,MAX_HP-SKILLS[4].damage);assert.ok(b.isDown);
 while(system.currentTick<52){system.currentTick++;m.tick()}
 assert.equal(b.isDown,false);assert.equal(currentClip(b.entity),'idle_stand');
});
test('throw pair keeps caster and victim on one visible timeline through impact',()=>{
 const {a,b,m}=matchPair();a.useSkill(4);
 let captured=false;
 for(let i=0;i<20&&!captured;i++){
  system.currentTick++;m.tick();captured=!!m.throwPair;
 }
 assert.ok(captured);
 while(m.throwPair && !(m.throwPair as any).struck){
  system.currentTick++;m.tick();
  if(m.throwPair && !(m.throwPair as any).struck){
   assert.equal(clipElapsed(a.entity),clipElapsed(b.entity),'throw animations must share the same source progress');
  }
 }
 assert.ok(b.isDown);assert.equal(b.hp,MAX_HP-SKILLS[4].damage);
});
test('jump startup survives until startup lock ends, then uses rising loop',()=>{
 const {a,b}=pair();a.tick({...emptyIntent(),jump:true},b,true);assert.equal(currentClip(a.entity),'jump_start');step(a,b,JUMP_STARTUP_TICKS);assert.equal(currentClip(a.entity),'air_rise');
});
test('dive loops for real altitude; targets outside local contact range are not hit',()=>{
 const {a,b}=pair();a.placePerformance(-1,30);a.prepareInput(emptyIntent());b.placePerformance(15);a.useSkill(5);
 step(a,b,30);assert.equal(b.hp,MAX_HP);assert.equal(currentClip(a.entity),'leaf_dive_loop');
 for(let i=0;i<200&&a.feetY>ARENA_FLOOR_Y;i++)step(a,b);
 assert.notEqual(currentClip(a.entity),'leaf_dive_loop');
});

test('rise and dive emit leaves along actual movement on either side, without a standing wave',()=>{
 for(const side of [0,1] as const)for(const kind of ['rise','dive']){
  const {a,b,m,d}=matchPair(),caster=side===0?a:b,other=side===0?b:a;
  resetVfxThrottle();const emitted:any[]=[];
  d.spawnParticle=(id:string,at:any,variables:any)=>emitted.push({id,at,values:variables.values});
  caster.placePerformance(side===0?-6:6,kind==='dive'?12:0);other.placePerformance(side===0?12:-12);
  caster.prepareInput({...emptyIntent(),crouch:kind==='rise'});
  assert.ok(caster.useSkill(5));m.applySkillVfx(side,5);
  assert.equal(emitted.length,0,'startup must not emit the horizontal standing projectile');
  let samples=0;
  for(let i=0;i<16;i++){
   const from={...caster.location},start=emitted.length;
   system.currentTick++;m.tick();
   const to=caster.location,dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z;
   const length=Math.hypot(dx,dy,dz);
   for(const e of emitted.slice(start).filter(e=>e.id==='green_beret:leaf_rise_stream'||e.id==='green_beret:leaf_mobility')){
    const dir=e.values['variable.dir'];samples++;
    assert.ok(length>0);assert.ok(Math.abs(dir.x-dx/length)<1e-9);
    assert.ok(Math.abs(dir.y-dy/length)<1e-9);assert.ok(Math.abs(dir.z-dz/length)<1e-9);
    assert.ok(kind==='rise'?dir.y>0:dir.y<0);
    assert.ok(dir[ARENA_AXIS]*(side===0?1:-1)>0);
    assert.ok(e.values['variable.speed']>0&&e.values['variable.life']>0);
    if(kind==='rise')assert.ok(e.at.y>=ARENA_FLOOR_Y&&e.at.y<ARENA_FLOOR_Y+0.2,'rise replenishes just above ground');
   }
  }
  assert.ok(samples>=3,'movement keeps replenishing leaves');
  assert.ok(!emitted.some(e=>e.id==='green_beret:leaf_flight'));
  const count=emitted.length;m.superFreeze={side:0,untilTick:system.currentTick+3,castId:m.castId};
  system.currentTick++;m.tick();assert.equal(emitted.length,count,'frozen movement emits no new trail');
 }
});

test('dive covers more horizontal ground and stops forward travel as soon as it hits',()=>{
 for(const side of [0,1] as const){
  const {a,b}=pair(),caster=side===0?a:b,other=side===0?b:a;
  const facing=side===0?1:-1;caster.placePerformance(-8*facing,12);other.placePerformance(12*facing);
  caster.prepareInput(emptyIntent());assert.ok(caster.useSkill(5));
  step(a,b,5);const start=caster.axisPosition;step(a,b,4);
  assert.ok(Math.abs(Math.abs(caster.axisPosition-start)-1.92)<1e-8,'four moving ticks cover 1.92 blocks (previously 1.28)');
  other.placePerformance(caster.axisPosition+facing*1.4,caster.feetY-ARENA_FLOOR_Y);
  step(a,b);assert.ok(other.hp<MAX_HP);assert.equal(currentClip(caster.entity),'leaf_dive_hit');
  const hitAxis=caster.axisPosition;other.placePerformance(12*facing);
  step(a,b,4);assert.equal(caster.axisPosition,hitAxis,'hit recovery must stop horizontal dive');
 }
});

test('airborne round and match winners land before victory and keep the full results interval',()=>{
 for(const final of [false,true])for(const velocity of [0.3,-0.5]){
  const {a,b,m}=matchPair();a.placePerformance(-4,150);a.velocityY=velocity;
  if(final)m.score=[1,0];m.endRound(0,'KO');
  const phase=final?'matchEnd':'roundEnd',clip=final?'victory_match':'victory_round';
  const duration=final?MATCH_END_TICKS:ROUND_END_TICKS;
  assert.equal(m.phase,phase);assert.equal(currentClip(a.entity),'air_fall');
  let previous=a.feetY,landSeen=false;
  for(let i=0;i<220&&a.waitingForVictory;i++){
   system.currentTick++;m.tick();assert.equal(m.phase,phase,'results must wait even past original deadline');
   assert.ok(a.feetY<=previous+1e-9,'winner descends instead of continuing to float up');previous=a.feetY;
   if(a.feetY>ARENA_FLOOR_Y)assert.equal(currentClip(a.entity),'air_fall');
   if(currentClip(a.entity)==='jump_land'){landSeen=true;assert.equal(a.feetY,ARENA_FLOOR_Y)}
  }
  assert.ok(landSeen);assert.equal(a.waitingForVictory,false);assert.equal(currentClip(a.entity),clip);
  assert.equal(a.feetY,ARENA_FLOOR_Y);assert.equal(m.phaseUntilTick-system.currentTick,duration);
  for(let i=0;i<(final?134:71);i++){system.currentTick++;m.tick()}
  assert.equal(currentClip(a.entity),clip+'_idle');assert.equal(m.phase,phase);assert.ok(b.isDown);
 }
});

test('resetting a round cancels an unfinished victory landing',()=>{
 const {a}=pair();a.placePerformance(-4,8);a.playVictory(false);assert.ok(a.waitingForVictory);
 a.resetForRound(-4);assert.equal(a.waitingForVictory,false);assert.equal(currentClip(a.entity),'idle_stand');
 for(let i=0;i<10;i++){system.currentTick++;a.advancePresentation();a.tickPresentation()}
 assert.equal(currentClip(a.entity),'idle_stand');
});
test('out-of-range three gas uses ordinary whiff, never paired victim, retains delayed pearl return',()=>{
 const {a,b,m}=matchPair();a.meter=3;b.placePerformance(15);a.useSkill(6,3);m.onSkillAccepted(0,6);
 for(let i=0;i<50&&m.super3;i++){system.currentTick++;m.tick()}
 assert.equal(m.super3,undefined);assert.ok(m.pearlReturn);assert.ok(!currentClip(b.entity)?.includes('victim'));
 for(let i=0;i<80;i++){system.currentTick++;m.tick()}
 assert.equal(m.pearlReturn,undefined);
});
test('match victory skips round bow; end pose and props survive the animation transition',()=>{
 const {a,b,m}=matchPair();m.score=[1,0];m.endRound(0,'test');assert.equal(m.phase,'matchEnd');assert.equal(currentClip(a.entity),'victory_match');
 for(let i=0;i<134;i++){system.currentTick++;m.tick()}
 assert.equal(currentClip(a.entity),'victory_match_idle');assert.ok(b.isDown);assert.ok(m.sceneProps.size>0);
});
test('property playback preserves all 86 authored bone tracks and declares every prop in BP/RP',()=>{
 const root='AllStars-灯塔全明星/';const read=(p:string)=>JSON.parse(readFileSync(root+p,'utf8'));
 const clips=read('resource-pack/animations/chunye.animation.json').animations,names=Object.keys(clips).sort();
 assert.equal(names.length,86);
 assert.equal(createHash('sha256').update(JSON.stringify(names.map(n=>clips[n].bones))).digest('hex'),'7d1617b0cb4a5f8e8d2e99490e3e48aa00cbb3f6ba2b746bc15dc44fbe4ae840');
 const client=read('resource-pack/entity/chunye.entity.json')['minecraft:client_entity'].description;
 assert.equal(client.scripts.animate.length,86);
 names.forEach((name,i)=>{assert.equal(clips[name].anim_time_update,"query.property('bearcade:allstars_time')");assert.equal(Object.values(client.scripts.animate[i])[0],`query.property('bearcade:allstars_clip') == ${i}`)});
 for(const prop of ['pearl','command_block','afterimage']){
  const bp=read(`entities/allstars_${prop}.json`)['minecraft:entity'];
  const rp=read(`resource-pack/entity/allstars_${prop}.entity.json`)['minecraft:client_entity'].description;
  assert.equal(bp.description.identifier,rp.identifier);assert.equal(bp.components['minecraft:damage_sensor'].triggers.deals_damage,'no');
  assert.equal(bp.components['minecraft:physics'].has_gravity,false);
 }
});
test('room cleanup before fighters spawn cannot fall back to clearing all rooms',()=>{
 const {m,d}=matchPair();const prop=spawnPearl(d,{x:0,y:0,z:0})!;
 m.fighters=undefined;m.clearPresentationState();assert.equal(prop.isValid,true);
});
test('standing wave waits for release and travels; after-release hit survives caster recovery',()=>{
 const {a,b,m}=matchPair();a.placePerformance(-5);b.placePerformance(8);a.useSkill(5);m.onSkillAccepted(0,5);m.applySkillVfx(0,5);
 for(let i=0;i<20;i++){system.currentTick++;m.tick();assert.equal(b.hp,MAX_HP)}
 assert.equal(a.isBusy,false);assert.ok(m.waves.some((w:any)=>w.released));
 for(let i=0;i<30;i++){system.currentTick++;m.tick()}
 assert.equal(b.hp,MAX_HP-SKILLS[5].damage);assert.equal(m.waves.length,0);
});
test('standing wave and rise use narrowed logical hitboxes',()=>{
 // 18 格外的地面目标已经超过普通波逻辑射程。
 {
  const {a,b,m}=matchPair();a.placePerformance(-10);b.placePerformance(8);b.beginPerformance(Number.MAX_SAFE_INTEGER);
  a.useSkill(5);m.onSkillAccepted(0,5);m.applySkillVfx(0,5);
  for(let i=0;i<60;i++){system.currentTick++;m.tick()}
  assert.equal(b.hp,MAX_HP);
 }
 // 目标高出地面 1.1 格时，普通波的窄垂直窗口允许跳过。
 {
  const {a,b,m}=matchPair();a.placePerformance(-5);b.placePerformance(8,1.1);b.beginPerformance(Number.MAX_SAFE_INTEGER);
  a.useSkill(5);m.onSkillAccepted(0,5);m.applySkillVfx(0,5);
  for(let i=0;i<60;i++){system.currentTick++;m.tick()}
  assert.equal(b.hp,MAX_HP);
 }
 // 升龙的地面判定不再沿用 2.4 格水平范围，远处目标不应被挑中。
 {
  const {a,b,m}=matchPair();a.placePerformance(-0.6);b.placePerformance(3,0);
  a.prepareInput({...emptyIntent(),crouch:true});assert.ok(a.useSkill(5));
  for(let i=0;i<30;i++){system.currentTick++;m.tick()}
 assert.equal(b.hp,MAX_HP);
 }
});
test('blocked standing wave ends its flight particle at the defender',()=>{
 const {a,b,m,d}=matchPair();a.placePerformance(-5);b.placePerformance(2);m.intentFor=(side:number)=>side===1?{...emptyIntent(),guard:true}:emptyIntent();
 const emitted:any[]=[];d.spawnParticle=(id:string,_at:any,variables:any)=>emitted.push({id,values:variables.values});resetVfxThrottle();
 a.useSkill(5);m.onSkillAccepted(0,5);m.applySkillVfx(0,5);
 for(let i=0;i<60&&m.waves.length;i++){system.currentTick++;m.tick()}
 assert.equal(b.hp,MAX_HP,'guard still prevents damage');assert.equal(m.waves.length,0,'blocked wave is consumed at the defender');
 const flight=emitted.find(e=>e.id==='green_beret:leaf_flight');assert.ok(flight);
 assert.ok(Math.abs(flight.values['variable.range']-a.distanceTo(b))<1e-9,'particle lifetime ends at defender distance');
});
test('opposing standing waves shorten both flight particles and emit a two-way clash',()=>{
 const {a,b,m,d}=matchPair();a.placePerformance(-5);b.placePerformance(5);
 const emitted:any[]=[];d.spawnParticle=(id:string,at:any,variables:any)=>emitted.push({id,at,values:variables.values});resetVfxThrottle();
 assert.ok(a.useSkill(5));assert.ok(b.useSkill(5));m.onSkillAccepted(0,5);m.onSkillAccepted(1,5);m.applySkillVfx(0,5);m.applySkillVfx(1,5);
 for(let i=0;i<80&&m.waves.length;i++){system.currentTick++;m.tick()}
 assert.equal(m.waves.length,0);
 const flights=emitted.filter(e=>e.id==='green_beret:leaf_flight');
 assert.ok(flights.length>=2,'both sides should emit a bounded flight');
 assert.ok(flights.every(e=>Math.abs(Number(e.values['variable.range'])-5)<1e-9));
 assert.ok(emitted.filter(e=>e.id==='green_beret:leaf_end').length>=2,'clash has both impact directions');
 assert.ok(emitted.some(e=>e.id==='green_beret:pearl_pop'),'clash has a center pop');
});
test('interruption before wave release cancels it',()=>{
 const {a,b,m}=matchPair();a.useSkill(5);m.applySkillVfx(0,5);a.receiveHit(b,1);
 for(let i=0;i<15;i++){system.currentTick++;m.tick()}
 assert.equal(m.waves.length,0);assert.equal(b.hp,MAX_HP);
});

test('target-client compatibility guard catches the previous prop animation and texture selector patterns',()=>{
 const bad={
  animations:{'animation.test':{bones:{Pearl:{scale:"query.property('bearcade:prop_scale')"}}}},
  render_controllers:{'controller.render.test':{textures:["query.variant ? Texture.one : Texture.two"]}},
 };
 assert.equal(renderCompatibilityErrors(bad).length,2);
 assert.deepEqual(allstarsRenderErrors('AllStars-灯塔全明星/resource-pack'),[]);
});

test('cage expressions preserve source tilt, impact compression and final retirement',()=>{
 const root='AllStars-灯塔全明星/resource-pack/';
 const pose=JSON.parse(readFileSync(root+'animations/allstars_props.animation.json','utf8')).animations['animation.bearcade_allstars.command_cage'].bones.Cage;
 const evaluate=(expression:any,time:number)=>{
  if(typeof expression==='number')return expression;
  const source=expression.replaceAll("query.property('bearcade:cage_time')",'time').replaceAll('math.clamp','clamp').replaceAll('math.max','Math.max');
  return Function('time','clamp','return '+source)(time,(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n)));
 };
 const scale=(time:number)=>pose.scale.map((v:any)=>evaluate(v,time));
 assert.deepEqual(scale(.6),[1,1,1]);
 const impact=scale(124/60);
 assert.ok(Math.abs(impact[0]-.37)<.0001);assert.ok(Math.abs(impact[1]-.8)<.0001);
 assert.ok(Math.abs(evaluate(pose.rotation[2],84/60)+6.875)<.0001);
 assert.ok(scale(140/60).every((v:number)=>v<=.001));
});

test('native hotbar refresh follows logical return and restores visibility on the next tick',()=>{
 const {ps}=pair(),p=ps[0];const calls:any[]=[];const hidden=new Set<any>();
 p.onScreenDisplay.getHiddenHudElements=()=>[...hidden];
 p.onScreenDisplay.setHudVisibility=(mode:any,elements:any[])=>{
  calls.push([system.currentTick,mode,elements]);
  for(const e of elements)if(mode===HudVisibility.Hide)hidden.add(e);else hidden.delete(e);
 };
 p.selectedSlotIndex=1;handleSkillSelection(p,1);consumeSkillPress(p.id);
 for(let i=1;i<=3;i++){system.currentTick=i;assert.ok(resetSkillSlot(p))}
 assert.equal(p.selectedSlotIndex,0);assert.deepEqual([...hidden],[HudElement.Hotbar]);
 assert.deepEqual(calls,[[3,HudVisibility.Hide,[HudElement.Hotbar]]]);
 system.currentTick=4;assert.equal(resetSkillSlot(p),false);assert.equal(hidden.size,0);
 assert.deepEqual(calls[1],[4,HudVisibility.Reset,[HudElement.Hotbar]]);
});

test('hotbar refresh cleanup restores only its own player and preserves an already-hidden HUD',()=>{
 const {ps}=pair(),hidden=ps.map(()=>new Set<any>()),calls:any[]=[];
 ps.forEach((p:any,i:number)=>{
  p.onScreenDisplay.getHiddenHudElements=()=>[...hidden[i]];
  p.onScreenDisplay.setHudVisibility=(mode:any,elements:any[])=>{
   calls.push([i,mode,elements]);for(const e of elements)if(mode===HudVisibility.Hide)hidden[i].add(e);else hidden[i].delete(e);
  };
  p.selectedSlotIndex=1;handleSkillSelection(p,1);
 });
 hidden[1].add(HudElement.Hotbar);hidden[1].add(HudElement.Health);
 for(let i=1;i<=3;i++){system.currentTick=i;ps.forEach((p:any)=>resetSkillSlot(p))}
 assert.equal(calls.length,1);clearSkillPresses([ps[0].id]);assert.equal(hidden[0].size,0);
 assert.deepEqual([...hidden[1]],[HudElement.Hotbar,HudElement.Health]);
 assert.ok(calls.every(call=>call[0]===0&&call[2].length===1&&call[2][0]===HudElement.Hotbar));
});

test('super hit mobility emission supplies the right vector required by its particle definition',()=>{
 const {a,b,d}=pair();resetVfxThrottle();const emitted:any[]=[];
 d.spawnParticle=(id:string,_at:any,variables:any)=>emitted.push({id,values:variables.values});
 applySuperHitBurst(b,a);
 const mobility=emitted.find(e=>e.id==='green_beret:leaf_mobility');assert.ok(mobility);
 const right=mobility.values['variable.right'];
 assert.ok(right && [right.x,right.y,right.z].every(Number.isFinite));
 assert.ok(Math.abs(Math.hypot(right.x,right.y,right.z)-1)<1e-9);
 assert.ok(mobility.values['variable.dir']);assert.ok(mobility.values['variable.life']>0);
});

test('TextPrimitive HUD keeps its original four shapes and only changes text',()=>{
 const {a,b,ps}=pair();new SideCamera(ps[0],{axis:'x'}).update([a,b]);
 hud.refresh(ps,hud.stateFrom([a,b],1,1000,[0,0],'fight'),()=>0);
 const shapes=[...(world.primitiveShapesManager as any).texts].filter((s:any)=>s.visibleTo?.includes(ps[0]));
 assert.equal(shapes.length,4);
 assert.ok(shapes.slice(0,3).every((s:any)=>s.scale===hud.HUD_SCALE));
 assert.equal(shapes[3].scale,hud.HUD_SCALE*3);
 assert.ok(shapes.slice(0,3).every((s:any)=>s.backgroundColorOverride?.alpha===0.45));
 assert.equal(shapes[3].backgroundColorOverride?.alpha,0);
 b.hp=7400;hud.refresh(ps,hud.stateFrom([a,b],1,1000,[0,0],'fight'),()=>0);
 assert.equal(shapes.length,4);assert.ok(shapes[0].text.endsWith(' 7400'));
 hud.clear(ps);
});

test('intro moves controller information to actionbar and hides all four HUD shapes',()=>{
 const {a,b,ps}=pair();new SideCamera(ps[0],{axis:'x'}).update([a,b]);
 const messages:string[]=[];ps.forEach((p:any)=>p.onScreenDisplay.setActionBar=(s:string)=>messages.push(s));
 const state=hud.stateFrom([a,b],1,132,[0,0],'§b1P §fAlice§r 操控「春叶」');
 state.introOnly=true;state.centerText='3';
 hud.refresh(ps,state,()=>0);
 const shapes=[...(world.primitiveShapesManager as any).texts].filter((s:any)=>s.visibleTo?.includes(ps[0]));
 assert.equal(shapes.length,4);
 assert.equal(shapes[0].text,'');assert.equal(shapes[1].text,'');
 assert.equal(shapes[2].text,'');assert.equal(shapes[3].text,'');
 assert.ok(shapes.every((s:any)=>s.scale===0&&s.backgroundColorOverride.alpha===0));
 assert.equal(messages.length,2);assert.ok(messages.every(s=>s==='§b1P §fAlice§r 操控「春叶」'));
 hud.clear(ps);
});

test('intro pearl is dismissed at the end of each close-up and leaves no entity behind',()=>{
 const {a,b,m,d}=matchPair();
 m.phase='intro';m.cinematicIntro=true;m.phaseUntilTick=132;
 for(let i=0;i<138;i++){system.currentTick=i;m.tick()}
 assert.equal(d.entities.some((e:any)=>e.typeId==='bearcade:allstars_prop_pearl'&&e.isValid),false);
});

test('super 2 command block grows and shrinks on the match clock, including failed capture cleanup',()=>{
 for(const blocked of [false,true]){
  const {a,b,m,d}=matchPair();a.meter=2;a.useSkill(6,2);m.onSkillAccepted(0,6);
  if(blocked)m.intentFor=(side:number)=>side===1?{...emptyIntent(),guard:true}:emptyIntent();
  let block:any,growing=false,full=false,shrinking=false;
  for(let i=0;i<110;i++){
   system.currentTick++;m.tick();
   block??=d.entities.find((e:any)=>e.typeId==='bearcade:allstars_prop_command_block');
   if(!block?.isValid)continue;
   const scale=Number(block.getProperty('bearcade:prop_scale'));
   if(scale===1)full=true;
   else if(scale>.001&&scale<1){if(full)shrinking=true;else growing=true}
  }
  assert.ok(block);assert.ok(growing&&full&&shrinking);assert.equal(block.isValid,false);
  if(blocked)assert.equal(b.hp,MAX_HP-SKILLS[6].guardChipDamage);
 }
});
