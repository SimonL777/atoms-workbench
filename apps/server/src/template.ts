export const DATA_BRIDGE = `type Data = Record<string, unknown>;
let sequence = 0;
function request(operation: string, collection: string, record_id?: string, data?: Data): Promise<any> {
  return new Promise((resolve,reject) => {
    const id = 'atom-' + (++sequence) + '-' + Date.now();
    const timeout = setTimeout(() => { window.removeEventListener('message',handler); reject(new Error('Data request timed out')); },15000);
    function handler(event: MessageEvent) {
      if (event.source !== window.parent || event.data?.type !== 'atom:result' || event.data.id !== id) return;
      clearTimeout(timeout); window.removeEventListener('message',handler);
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result);
    }
    window.addEventListener('message',handler);
    window.parent.postMessage({ type:'atom:records',id,operation,collection,record_id,data },'*');
  });
}
export const atomData = {
  id: () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2,'0')).join(''),
  list: (collection: string) => request('list',collection) as Promise<{record_id:string; data:Data}[]>,
  put: (collection: string,id: string,data: Data) => request('put',collection,id,data),
  remove: (collection: string,id: string) => request('delete',collection,id),
};
`;
export const template: Record<string,string> = {
  'src/main.tsx': `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './styles.css';\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);\n`,
  'src/App.tsx': `export default function App() { return <main><h1>Let's build something.</h1><p>Your app will appear here.</p></main>; }\n`,
  'src/styles.css': `*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;color:#14231b;background:#f8faf9}button,input{font:inherit}button{cursor:pointer}main{padding:48px}\n`,
  'src/atom-data.ts': DATA_BRIDGE,
};
