// Rebuild camera/landmark tables from the archived, reviewed previews. No live
// Blockbench changes, runtime dependency, or edits to the 86 bone tracks.
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createBoneSampler} from './allstars-bone-sampler.mjs';
import {resolveWorkflowRoot} from './allstars-source-paths.mjs';
const root='AllStars-灯塔全明星';
const workflow=resolveWorkflowRoot(process.argv[2]);
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const preview=v=>read(path.join(workflow,'characters/green_beret/previews',v,'preview_manifest.json'));
const superPreview=preview('v039'), victoryPreview=preview('v043');
const superScenes=read(root+'/src/data/super3-scenes.json');
for(const variant of ['normal','low']) {
  const frames=new Map(superPreview.variants[variant].modes.cinema.map(f=>[f.t,f]));
  for(const frame of superScenes[variant]) frame.camera=frames.get(frame.t).camera;
}
writeFileSync(root+'/src/data/super3-scenes.json',JSON.stringify(superScenes)+'\n');
const victoryScenes=read(root+'/src/data/victory-scenes.json');
for(const frame of victoryScenes) {
  const source=victoryPreview.frames.cinema.victory_match[frame.t];
  frame.camera=source.camera;
  frame.pearls=source.pearls.map(p=>({kind:p.kind,key:p.index===undefined?p.kind:`scatter-${p.index}`,world:p.world,alpha:p.alpha}));
}
writeFileSync(root+'/src/data/victory-scenes.json',JSON.stringify(victoryScenes)+'\n');
const geometry=read(root+'/resource-pack/models/entity/chunye.geo.json')['minecraft:geometry'][0];
const animations=read(root+'/resource-pack/animations/chunye.animation.json').animations;
const point=createBoneSampler(geometry), landmarks={};
for(const [name,a] of Object.entries(animations)) {
  landmarks[name.replace('animation.green_beret.','')]=Array.from({length:Math.ceil(a.animation_length*20)+1},(_,i)=>[
    point(a,'Head',i/20,[0,7,0]), point(a,'UpperBody',i/20,[0,6,0]),
  ]);
}
writeFileSync(root+'/src/data/body-landmarks.json',JSON.stringify(landmarks)+'\n');
console.log('AllStars: source preview cameras and 86 head/torso landmark tracks sampled');
