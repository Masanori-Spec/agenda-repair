import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
for (const dir of ['src','scripts','tests']) for (const file of readdirSync(dir)) if (/\.(m?js)$/.test(file)) {
  const result=spawnSync(process.execPath,['--check',`${dir}/${file}`],{stdio:'inherit'});
  if(result.status!==0) process.exit(result.status??1);
}
console.log('Syntax checks passed');
