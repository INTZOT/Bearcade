import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { stringifyBedrockEntity } from './bedrock-entity-json.mjs';

/** Native Bedrock prop channels; independent from the 86 authored body clips. */
export function buildPropAnimations(root) {
  const read = path => JSON.parse(readFileSync(`${root}/${path}`, 'utf8'));
  const write = (path, data) => writeFileSync(`${root}/${path}`, stringifyBedrockEntity(data)+'\n');
  for (const prop of ['pearl', 'command_block']) {
    const definition = read(`entities/allstars_${prop}.json`);
    definition['minecraft:entity'].description.properties = {
      'bearcade:prop_scale': {type:'float', range:[0,1], default:0.001, client_sync:true},
    };
    write(`entities/allstars_${prop}.json`, definition);
    const client = read(`resource-pack/entity/allstars_${prop}.entity.json`);
    const propClient = client['minecraft:client_entity'].description;
    delete propClient.animations;
    propClient.min_engine_version = '1.21.90';
    // Vanilla client entities use scripts.scale; pearl already passed client review.
    propClient.scripts = {scale:"query.property('bearcade:prop_scale')"};
    write(`resource-pack/entity/allstars_${prop}.entity.json`, client);
  }

  const cage = read('entities/allstars_command_block.json');
  const bp = cage['minecraft:entity'];
  bp.description.identifier = 'bearcade:allstars_command_cage';
  bp.description.properties = {
    'bearcade:cage_time': {type:'float', range:[0,3], default:0, client_sync:true},
  };
  bp.components['minecraft:scale'] = {value:1};
  bp.components['minecraft:collision_box'] = {width:0, height:0};
  write('entities/allstars_command_cage.json', cage);
  write('resource-pack/entity/allstars_command_cage.entity.json', {
    format_version:'1.10.0', 'minecraft:client_entity':{description:{
      identifier:bp.description.identifier, min_engine_version:'1.21.90', materials:{default:'entity_alphatest'},
      textures:{default:'textures/entity/allstars_command_cage',impact:'textures/entity/allstars_command_cage_impact'},
      geometry:{default:'geometry.bearcade_allstars.command_cage'},
      animations:{pose:'animation.bearcade_allstars.command_cage'}, scripts:{animate:['pose']},
      render_controllers:['controller.render.bearcade_allstars_cage'],
    }},
  });

  // v034 preview: half-width 7, half-height 19, center at y=23 model units.
  // Real depth replaces the HTML reference's projected back rectangle.
  const cubes = [], thickness = 0.35;
  const uv = Object.fromEntries(['north','south','east','west','up','down'].map(face=>[face,{uv:[0,0],uv_size:[1,1]}]));
  const edge = (origin,size) => cubes.push({origin,size,uv});
  for (const x of [-7,7]) for (const z of [-6,6]) edge([x-thickness/2,4,z-thickness/2],[thickness,38,thickness]);
  for (const y of [4,42]) for (const z of [-6,6]) edge([-7,y-thickness/2,z-thickness/2],[14,thickness,thickness]);
  for (const x of [-7,7]) for (const y of [4,42]) edge([x-thickness/2,y-thickness/2,-6],[thickness,thickness,12]);
  write('resource-pack/models/entity/allstars_command_cage.geo.json', {
    format_version:'1.12.0', 'minecraft:geometry':[{description:{
      identifier:'geometry.bearcade_allstars.command_cage',texture_width:1,texture_height:1,
      visible_bounds_width:4,visible_bounds_height:4,visible_bounds_offset:[0,1.5,0],
    },bones:[{name:'Cage',pivot:[0,23,0],cubes}]}],
  });
  for (const [suffix,color] of [['',[255,200,152,255]],['_impact',[243,255,232,255]]]) {
    writeFileSync(`${root}/resource-pack/textures/entity/allstars_command_cage${suffix}.png`,PNG.sync.write({width:1,height:1,data:Buffer.from(color)}));
  }
  const time = "query.property('bearcade:cage_time')";
  const crush = `math.clamp((${time} - 1.966667) / 0.1, 0, 1)`;
  const retire = `math.max(0.001, 1 - math.clamp((${time} - 2.166667) / 0.166666, 0, 1))`;
  write('resource-pack/animations/allstars_props.animation.json', {
    format_version:'1.8.0',animations:{
      'animation.bearcade_allstars.command_cage':{
        loop:true,
        bones:{Cage:{
          rotation:[0,0,`-6.875 * math.clamp((${time} - 0.866667) / 0.533333, 0, 1)`],
          scale:[`(1 - 0.63 * ${crush}) * ${retire}`,`(1 - 0.2 * ${crush}) * ${retire}`,`(1 - 0.63 * ${crush}) * ${retire}`],
        }},
      },
    },
  });
  write('resource-pack/render_controllers/allstars_cage.render_controllers.json', {
    format_version:'1.10.0',render_controllers:{'controller.render.bearcade_allstars_cage':{
      geometry:'Geometry.default',materials:[{'*':'Material.default'}],
      arrays:{textures:{'Array.cage_colors':['Texture.default','Texture.impact']}},
      textures:["Array.cage_colors[query.property('bearcade:cage_time') >= 2.016667]"],
      part_visibility:[{'*':"query.property('bearcade:cage_time') >= 0.6 && query.property('bearcade:cage_time') < 2.333334"}],
    }},
  });
}
