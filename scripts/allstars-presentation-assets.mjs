// Build RP playback controls without changing the 86 authored bone tracks.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {stringifyBedrockEntity} from './bedrock-entity-json.mjs';
import {useOriginalSkins,PROP_SCALES} from './allstars-visual-assets.mjs';
import {buildPropAnimations} from './allstars-prop-assets.mjs';
const root='AllStars-灯塔全明星';
const read=p=>JSON.parse(readFileSync(`${root}/${p}`,'utf8'));
const write=(p,d)=>writeFileSync(`${root}/${p}`,stringifyBedrockEntity(d)+'\n');
const data=read('resource-pack/animations/chunye.animation.json');
const names=Object.keys(data.animations).sort();
const bonesHash=createHash('sha256').update(JSON.stringify(names.map(n=>data.animations[n].bones))).digest('hex');
const bp=read('entities/allstars_chunye.json')['minecraft:entity'];
bp.description.properties={
 'bearcade:allstars_clip':{type:'int',range:[0,85],default:names.indexOf('animation.green_beret.idle_stand'),client_sync:true},
 'bearcade:allstars_time':{type:'float',range:[0,60],default:0,client_sync:true},
 'bearcade:allstars_opacity':{type:'float',range:[0,1],default:1,client_sync:true},
 'bearcade:allstars_blue':{type:'bool',default:false,client_sync:true},
};
bp.components['minecraft:physics']={has_gravity:false,has_collision:true};
write('entities/allstars_chunye.json',{'format_version':'1.21.90','minecraft:entity':bp});
const client=read('resource-pack/entity/chunye.entity.json')['minecraft:client_entity'].description;
client.materials={default:'entity_alphatest'};
useOriginalSkins(root,client);
client.scripts={animate:names.map((name,i)=>({[name.replace('animation.green_beret.','')]:`query.property('bearcade:allstars_clip') == ${i}`}))};
client.render_controllers=[
 {'controller.render.bearcade_allstars_fighter':"!query.property('bearcade:allstars_blue')"},
 {'controller.render.bearcade_allstars_fighter_blue':"query.property('bearcade:allstars_blue')"},
];
write('resource-pack/entity/chunye.entity.json',{'format_version':'1.10.0','minecraft:client_entity':{description:client}});
const ghost=structuredClone(bp);
ghost.description.identifier='bearcade:allstars_afterimage';
ghost.components['minecraft:physics']={has_gravity:false,has_collision:false};
ghost.components['minecraft:collision_box']={width:0,height:0};
ghost.components['minecraft:type_family']={family:['allstars_prop']};
ghost.component_groups['bearcade:prop_driven']={'minecraft:physics':{has_gravity:false,has_collision:false}};
ghost.events['bearcade:prop_driven']={add:{component_groups:['bearcade:prop_driven']}};
write('entities/allstars_afterimage.json',{'format_version':'1.21.90','minecraft:entity':ghost});
write('resource-pack/entity/allstars_afterimage.entity.json',{'format_version':'1.10.0','minecraft:client_entity':{description:{...client,identifier:'bearcade:allstars_afterimage'}}});
for(const name of names){
 const a=data.animations[name];
 // The script owns once/hold/loop semantics. Keep native tracks active even while paused at the endpoint.
 a.loop=true;a.anim_time_update="query.property('bearcade:allstars_time')";
}
write('resource-pack/animations/chunye.animation.json',data);
mkdirSync(`${root}/resource-pack/render_controllers`,{recursive:true});
const base={geometry:'Geometry.default',materials:[{'*':'Material.default'}],textures:['Texture.default']};
const opacity="query.property('bearcade:allstars_opacity')";
write('resource-pack/render_controllers/allstars.render_controllers.json',{
 format_version:'1.10.0',render_controllers:{
  'controller.render.bearcade_allstars_fighter':{
   ...base,
   part_visibility:[{'*':`${opacity} > 0.01`}],
  },
  'controller.render.bearcade_allstars_fighter_blue':{
   ...base, textures:['Texture.blue'],
   part_visibility:[{'*':`${opacity} > 0.01`}],
  },
  'controller.render.bearcade_allstars_prop':base,
 }});
for(const prop of ['pearl','command_block']){
 const path=`resource-pack/entity/allstars_${prop}.entity.json`;
 const d=read(path);d['minecraft:client_entity'].description.render_controllers=['controller.render.bearcade_allstars_prop'];write(path,d);
 const pathB=`entities/allstars_${prop}.json`;const b=read(pathB);
 b['minecraft:entity'].components['minecraft:physics']={has_gravity:false,has_collision:false};
 b['minecraft:entity'].components['minecraft:scale']={value:PROP_SCALES[prop]};write(pathB,b);
}
mkdirSync(`${root}/tests`,{recursive:true});
buildPropAnimations(root);
writeFileSync(`${root}/tests/presentation-assets.json`,JSON.stringify({count:names.length,bone_tracks_sha256:bonesHash,clock:'client-synced source seconds; unchanged authored tracks',client_test:'pending'},null,2)+'\n');
console.log(`AllStars: ${names.length} property-driven clips; bones SHA256 ${bonesHash}`);
