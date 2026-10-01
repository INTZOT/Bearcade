import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
mkdirSync('dist/tests',{recursive:true});
await build({entryPoints:['AllStars-灯塔全明星/tests/runtime.test.ts'],bundle:true,platform:'node',format:'esm',outfile:'dist/tests/allstars.test.mjs',plugins:[{name:'bedrock-mock',setup(b){b.onResolve({filter:/^@minecraft\/(server|server-ui)$/},()=>({path:path.resolve('AllStars-灯塔全明星/tests/server.mock.mjs')}));}}]});
await import(pathToFileURL(path.resolve('dist/tests/allstars.test.mjs')).href);
