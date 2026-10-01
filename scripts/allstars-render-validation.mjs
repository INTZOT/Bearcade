import {existsSync,readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';

function documents(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir,{withFileTypes:true}).flatMap(entry => {
    const file=path.join(dir,entry.name);
    return entry.isDirectory() ? documents(file) : entry.name.endsWith('.json') ? [[file,JSON.parse(readFileSync(file,'utf8'))]] : [];
  });
}

// A conservative profile for the actual target client, not a full engine schema.
// Prefer resource arrays to resource-valued ternaries, and explicit XYZ channels.
export function renderCompatibilityErrors(document) {
  const errors=[];
  for (const [name,rc] of Object.entries(document.render_controllers ?? {})) {
    for (const texture of rc.textures ?? []) {
      if (typeof texture!=='string' || !/^(texture\.[a-z0-9_]+|array\.[a-z0-9_]+\[.*\])$/i.test(texture)) {
        errors.push(`${name}: texture selection must use a short-name or indexed array in the target-client profile`);
      }
    }
  }
  for (const [name,animation] of Object.entries(document.animations ?? {})) {
    if (!animation || typeof animation!=='object') continue;
    for (const [bone,channels] of Object.entries(animation.bones ?? {})) {
      for (const key of ['position','rotation','scale']) if (typeof channels[key]==='string') {
        errors.push(`${name}/${bone}.${key}: use an explicit XYZ expression array in the target-client profile`);
      }
    }
  }
  return errors;
}

export function allstarsRenderErrors(root) {
  const errors=[];
  const animations=new Set(),controllers=new Map();
  for (const [file,doc] of [...documents(path.join(root,'animations')),...documents(path.join(root,'render_controllers'))]) {
    errors.push(...renderCompatibilityErrors(doc).map(error=>`${file}: ${error}`));
    for (const name of Object.keys(doc.animations ?? {})) animations.add(name);
    for (const [name,rc] of Object.entries(doc.render_controllers ?? {})) controllers.set(name,rc);
  }
  for (const [file,doc] of documents(path.join(root,'entity'))) {
    const client=doc['minecraft:client_entity']?.description;
    if (!client) continue;
    for (const [shortName,name] of Object.entries(client.animations ?? {})) {
      if (name.startsWith('animation.') && !animations.has(name)) errors.push(`${file}: missing animation ${shortName} -> ${name}`);
    }
    for (const entry of client.scripts?.animate ?? []) for (const name of typeof entry==='string' ? [entry] : Object.keys(entry)) {
      if (!client.animations?.[name]) errors.push(`${file}: scripts.animate uses undeclared ${name}`);
    }
    for (const reference of client.render_controllers ?? []) for (const name of typeof reference==='string' ? [reference] : Object.keys(reference)) {
      if (name==='controller.render.default') continue;
      const rc=controllers.get(name);
      if (!rc) {errors.push(`${file}: missing render controller ${name}`);continue;}
      const resources=JSON.stringify([rc.textures,rc.arrays?.textures]);
      for (const match of resources.matchAll(/Texture\.([a-z0-9_]+)/gi)) {
        const texture=client.textures?.[match[1]];
        if (!texture || !existsSync(path.join(root,texture+'.png'))) errors.push(`${file}: missing texture resource ${match[0]}`);
      }
    }
  }
  return errors;
}
