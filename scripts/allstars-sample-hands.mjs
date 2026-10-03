// Offline bone attachment sampling: avoids a live Blockbench dependency at runtime.
import {readFileSync,writeFileSync} from 'node:fs';
const base='AllStars-灯塔全明星';
const geo=JSON.parse(readFileSync(`${base}/resource-pack/models/entity/chunye.geo.json`,'utf8'))['minecraft:geometry'][0];
const bones=new Map(geo.bones.map(b=>[b.name,b]));
const animations=JSON.parse(readFileSync(`${base}/resource-pack/animations/chunye.animation.json`,'utf8')).animations;
function sample(track,t,otherwise){
  if(!track)return otherwise;
  if(Array.isArray(track))return track;
  const entries=Object.entries(track).map(([k,v])=>[Number(k),v]).sort((a,b)=>a[0]-b[0]);
  const keys=entries.map(e=>e[0]);
  let i=0;while(i<keys.length-1&&keys[i+1]<=t)i++;
  const a=keys[i],b=keys[Math.min(i+1,keys.length-1)];
  const v=x=>Array.isArray(x)?x:(x.post??x.pre);
  const x=v(entries[i][1]),y=v(entries[Math.min(i+1,keys.length-1)][1]),u=b===a?0:Math.max(0,Math.min(1,(t-a)/(b-a)));
  return x.map((n,j)=>Number(n)+(Number(y[j])-Number(n))*u);
}
function point(animation,name,t){
  let b=bones.get(name),p=[...b.pivot];p[1]-=1.5;
  while(b){
    const ch=animation.bones[b.name]??{},pos=sample(ch.position,t,[0,0,0]),r=sample(ch.rotation,t,[0,0,0]);
    const scale=sample(ch.scale,t,[1,1,1]),pivot=b.pivot??[0,0,0];
    let [x,y,z]=p.map((v,i)=>(v-pivot[i])*scale[i]);
    // Bedrock's bone rotation convention (X/Y signs differ from exported model space).
    const angles=[-(r[0]+(b.rotation?.[0]??0)),-(r[1]+(b.rotation?.[1]??0)),r[2]+(b.rotation?.[2]??0)].map(v=>v*Math.PI/180);
    let c=Math.cos(angles[0]),s=Math.sin(angles[0]);[y,z]=[y*c-z*s,y*s+z*c];
    c=Math.cos(angles[1]);s=Math.sin(angles[1]);[x,z]=[x*c+z*s,-x*s+z*c];
    c=Math.cos(angles[2]);s=Math.sin(angles[2]);[x,y]=[x*c-y*s,x*s+y*c];
    p=[x,y,z].map((v,i)=>v+pivot[i]+pos[i]);b=bones.get(b.parent);
  }
  return p.map(v=>Math.round(v*10000)/10000);
}
const result={};
for(const [name,a] of Object.entries(animations)){
  const id=name.replace('animation.green_beret.','');
  if(!/^(intro|dash_|super_|leaf_|victory_match)/.test(id)||id.includes('victim'))continue;
  const frames=[];
  for(let t=0;t<=Math.ceil(a.animation_length*20);t++)frames.push([point(a,'RightHand',t/20),point(a,'LeftHand',t/20)]);
  result[id]=frames;
}
writeFileSync(`${base}/src/data/hand-anchors.json`,JSON.stringify(result)+'\n');
console.log(`AllStars: sampled hand attachments for ${Object.keys(result).length} clips`);
