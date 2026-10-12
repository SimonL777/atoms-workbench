import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
const name=`atoms-db-test-${randomUUID()}`;
const image=process.env.TEST_POSTGRES_IMAGE || 'postgres:17-alpine';
function docker(args,input){const result=spawnSync('docker',args,{encoding:'utf8',input});if(result.status!==0)throw new Error(result.stderr || result.stdout);return result.stdout;}
try{
 docker(['run','-d','--rm','--name',name,'--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);
 let ready=false;for(let i=0;i<60;i++){if(spawnSync('docker',['exec',name,'pg_isready','-U','postgres'],{stdio:'ignore'}).status===0){ready=true;break;}await pause(500);}
 if(!ready)throw new Error('PostgreSQL fixture did not start.');
 for(const file of ['tests/database/bootstrap.sql','supabase/migrations/202610120001_workbench.sql','tests/database/acceptance.sql']){
  const output=docker(['exec','-i',name,'psql','-v','ON_ERROR_STOP=1','-U','postgres'],readFileSync(file,'utf8'));
  if(file.endsWith('acceptance.sql'))console.log(output.trim());
 }
}finally{spawnSync('docker',['rm','-f',name],{stdio:'ignore'});}
