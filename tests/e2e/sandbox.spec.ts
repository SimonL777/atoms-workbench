import {test,expect} from '@playwright/test';
import {existsSync,readFileSync} from 'node:fs';
test('container-built React artifact runs in an opaque iframe and uses the managed data bridge',async({page})=>{
 test.skip(!existsSync('.artifacts/sandbox-preview.html'),'Run the container build fixture first.');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const html=readFileSync('.artifacts/sandbox-preview.html','utf8');
 await page.setContent(`<script>
 const records={};window.addEventListener('message',event=>{
  if(event.source!==document.querySelector('iframe').contentWindow||event.data?.type!=='atom:records')return;
  const {id,operation,record_id,data}=event.data;if(operation==='put')records[record_id]=data;
  event.source.postMessage({type:'atom:result',id,result:Object.entries(records).map(([record_id,data])=>({record_id,data}))},'*');
 });</script><iframe title="Built app" sandbox="allow-scripts allow-forms" srcdoc="${html.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"></iframe>`);
 const app=page.frameLocator('iframe');await expect(app.getByRole('heading',{name:'Sandbox notes'})).toBeVisible();
 await app.getByLabel('Note').fill('Container artifact works');await app.getByRole('button',{name:'Add note'}).click();
 await expect(app.getByText('Container artifact works',{exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});
