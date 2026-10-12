import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
test('unconfigured API exposes readiness without credentials and rejects project access',async()=>{
  const port=21000+Math.floor(Math.random()*15000);
  const child=spawn(process.execPath,['--import','tsx','apps/server/src/api.ts'],{env:{...process.env,PORT:String(port),SUPABASE_URL:'',VITE_SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',VITE_SUPABASE_PUBLISHABLE_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',MODEL_API_KEY:'',MODEL_BASE_URL:'',MODEL_NAME:''},stdio:'ignore'});
  try{
    let ready=false;for(let i=0;i<50;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok){ready=true;break;}}catch{}await pause(100);}
    assert.ok(ready,'API must start without cloud credentials for setup');
    const response=await fetch(`http://127.0.0.1:${port}/api/config`);const config=await response.json();
    assert.equal(config.configured,false);assert.equal(config.modelReady,false);assert.equal(config.supabaseKey,'');
    assert.deepEqual(Object.keys(config).sort(),['build','configured','demoEnabled','modelReady','supabaseKey','supabaseUrl'].sort());
    assert.equal(response.headers.get('cache-control'),'no-store');
    const projects=await fetch(`http://127.0.0.1:${port}/api/projects`);
    assert.equal(projects.status,401);assert.equal((await projects.json()).error,'请先登录。');
  }finally{child.kill('SIGTERM');}
});
