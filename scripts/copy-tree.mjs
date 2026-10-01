// Node 24 fs.cpSync can fail with errno 0 on this Windows Unicode workspace.
// Buffered file IO avoids that native copy/unlink path and preserves binary assets.
import {lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
export function copyTree(source,destination,options={}) {
  if(options.filter && !options.filter(source,destination))return;
  const info=lstatSync(source);
  if(info.isSymbolicLink())throw new Error(`Package source must be a regular file/directory: ${source}`);
  if(info.isDirectory()){
    mkdirSync(destination,{recursive:true});
    for(const name of readdirSync(source))copyTree(path.join(source,name),path.join(destination,name),options);
  } else {
    mkdirSync(path.dirname(destination),{recursive:true});
    writeFileSync(destination,readFileSync(source));
  }
}
