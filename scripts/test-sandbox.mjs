import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { build } = await import('../apps/server/src/sandbox.ts');
const { template } = await import('../apps/server/src/template.ts');
const controller = new AbortController();
const fixture = {
  ...template,
  'src/App.tsx': `import {useEffect,useState,type FormEvent} from 'react';
import {atomData} from './atom-data';
export default function App(){
 const [text,setText]=useState('');const [items,setItems]=useState<{record_id:string;data:Record<string,unknown>}[]>([]);
 const [error,setError]=useState('');
 useEffect(()=>{atomData.list('notes').then(setItems).catch(e=>setError(e.message));},[]);
 async function add(e:FormEvent){e.preventDefault();try{await atomData.put('notes',atomData.id(),{text});setItems(await atomData.list('notes'));setText('');}catch(e){setError((e as Error).message);}}
 return <main><h1>Sandbox notes</h1><form onSubmit={add}><input aria-label="Note" value={text} onChange={e=>setText(e.target.value)}/><button>Add note</button></form>{items.map(item=><p key={item.record_id}>{String(item.data.text)}</p>)}<p role="status">{error}</p></main>;
}`,
};
const good = await build(fixture, controller.signal);
assert.equal(good.ok, true, good.log);
assert.ok(good.html.includes('root'));
assert.ok(good.hash);
await mkdir('.artifacts', { recursive: true });
await writeFile('.artifacts/sandbox-preview.html', good.html);
const bad = await build(
  {
    ...template,
    'src/App.tsx':
      'export default function App(){ const value: number = "invalid"; return <h1>{value}</h1>; }',
  },
  controller.signal,
);
assert.equal(bad.ok, false);
assert.ok(bad.log.includes('error TS'));
console.log(
  JSON.stringify({ sandbox_build: true, type_error_detected: true, preview_artifact: true }),
);
