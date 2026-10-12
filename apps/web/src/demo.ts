import type { Project, ProjectDetail, Snapshot } from '@atoms/shared';
export const demos = [
  {
    id: 'demo-tasks',
    name: 'Task Garden',
    description: '清晰、轻盈的个人任务管理',
    category: '效率工具',
    color: 'sage',
    prompt: '做一个个人任务管理工具，支持新增、完成、筛选和完成率统计。',
    icon: 'tasks',
  },
  {
    id: 'demo-reading',
    name: 'Orbit Library',
    description: '把值得读的内容留在一起',
    category: '个人空间',
    color: 'lavender',
    prompt: '做一个阅读收藏应用，可以添加文章、标记已读，并按分类筛选。',
    icon: 'reading',
  },
  {
    id: 'demo-focus',
    name: 'Still / Focus',
    description: '为重要的事，留一段专注时间',
    category: '生活方式',
    color: 'peach',
    prompt: '做一个有专注计时、每日目标和轻柔视觉的番茄钟应用。',
    icon: 'focus',
  },
];
export const demoProjects: Project[] = demos.map((item) => ({
  id: item.id,
  owner_id: 'demo',
  name: item.name,
  description: item.description,
  mode: 'build',
  current_version_id: `${item.id}-v1`,
  created_at: '2026-10-12T00:00:00Z',
  updated_at: '2026-10-12T00:00:00Z',
}));
export function demoDetail(id: string): ProjectDetail {
  const project = demoProjects.find((p) => p.id === id)!;
  return {
    project,
    messages: [
      {
        id: 'm1',
        project_id: id,
        run_id: null,
        role: 'user',
        kind: 'text',
        content: demos.find((d) => d.id === id)!.prompt,
        metadata: {},
        created_at: project.created_at,
      },
      {
        id: 'm2',
        project_id: id,
        run_id: null,
        role: 'assistant',
        kind: 'text',
        content:
          '这是一个预先准备的示例项目。你可以体验预览、代码和版本面板；真实的需求共创与应用生成需要登录并连接模型服务。',
        metadata: {},
        created_at: project.created_at,
      },
      {
        id: 'm3',
        project_id: id,
        run_id: null,
        role: 'assistant',
        kind: 'version',
        content: '示例已就绪，试着操作右侧的应用。演示数据仅保存在当前浏览器。',
        metadata: { version_id: `${id}-v1` },
        created_at: project.created_at,
      },
    ],
    specs: [
      {
        id: 'spec-demo',
        project_id: id,
        content: `# ${project.name}\n\n## 目标\n${project.description}。\n\n## 核心体验\n${demos.find((d) => d.id === id)!.prompt}\n\n## 数据\n这是静态示例，示例操作保存在本地浏览器。真实项目使用 Supabase 持久化。\n\n## 验收\n主要操作可交互、状态变化有反馈，桌面与手机尺寸可用。`,
        confirmed_at: project.created_at,
        created_at: project.created_at,
      },
    ],
    runs: [],
    versions: [
      {
        id: `${id}-v1`,
        project_id: id,
        run_id: 'demo',
        parent_id: null,
        summary: '可交互示例 · 预先准备',
        artifact_path: '',
        checks: { demo: true },
        created_at: project.created_at,
      },
    ],
    events: [],
  };
}
export function demoSnapshot(id: string): Snapshot {
  const focus = id === 'demo-focus';
  const reading = id === 'demo-reading';
  const title = reading ? 'Orbit' : focus ? 'Still.' : 'Task Garden';
  const css = `*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;color:#253c30;background:${reading ? '#faf8ff' : focus ? '#faf4ec' : '#f5f9f5'}}button,input{font:inherit}button{cursor:pointer}main{max-width:750px;margin:auto;padding:48px 36px}header{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#789181}h1{font-size:38px;letter-spacing:-1.8px;margin:34px 0 10px}p{color:#819087;font-size:14px}section{display:flex;gap:12px;margin:32px 0}.stat{flex:1;background:#ffffffaa;border:1px solid #e5ece5;border-radius:18px;padding:20px;font-size:12px;color:#7a8d80}.stat b{display:block;font-size:28px;color:#345d43;margin-top:8px}form{display:flex;gap:10px;margin:26px 0}input{min-width:0;flex:1;padding:14px;border:1px solid #dce5dc;border-radius:12px;background:white}button{border:0;border-radius:10px;background:#345d43;color:white;padding:12px 16px}.filters{display:flex;gap:8px;margin:24px 0}.filters button{background:white;color:#617369;font-size:12px}.filters button.active{background:#345d43;color:white}.item{display:flex;align-items:center;gap:12px;background:white;border:1px solid #e5ece5;padding:18px;border-radius:12px;margin:10px 0}.item label{flex:1}.item input{flex:0;width:18px;height:18px}.item.done label{color:#97a398;text-decoration:line-through}.item small{color:#859888}.item .delete{background:transparent;color:#9ca69f;padding:2px 8px}.note{font-size:11px;color:#91a294;margin-top:30px}.timer{font-size:90px;text-align:center;font-weight:300;letter-spacing:-5px;padding:35px 0}.center{text-align:center}.empty{padding:35px;text-align:center;color:#839587}.error{color:#ad4c45;font-size:12px}@media(max-width:500px){main{padding:30px 20px}h1{font-size:30px}.stat{padding:14px}.timer{font-size:70px}}`;
  const js = focus
    ? `let secs=25*60,running=false,timer;const display=document.querySelector('#time');function render(){display.textContent=String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0');document.querySelector('#start').textContent=running?'暂停专注':'开始专注'}document.querySelector('#start').onclick=()=>{running=!running;if(running){timer=setInterval(()=>{if(secs>0)secs--;else{running=false;clearInterval(timer)}render()},1000)}else clearInterval(timer);render()};document.querySelector('#reset').onclick=()=>{running=false;clearInterval(timer);secs=1500;render()};render();`
    : `let items=[],filter='all';const key='${reading ? 'reading' : 'tasks'}';let seq=0;function api(operation,record_id,data){return new Promise((resolve,reject)=>{const rid='r'+(++seq);function listener(e){if(e.source===parent&&e.data?.type==='atom:result'&&e.data.id===rid){window.removeEventListener('message',listener);e.data.error?reject(new Error(e.data.error)):resolve(e.data.result)}}window.addEventListener('message',listener);parent.postMessage({type:'atom:records',id:rid,operation,collection:key,record_id,data},'*')})}function render(){document.querySelector('#total').textContent=items.length;document.querySelector('#done').textContent=items.filter(x=>x.done).length;document.querySelector('#rate').textContent=(items.length?Math.round(items.filter(x=>x.done).length/items.length*100):0)+'%';const list=document.querySelector('#list');list.replaceChildren();const selected=items.filter(x=>filter==='all'||(filter==='done'?x.done:!x.done));if(!selected.length){const p=document.createElement('p');p.className='empty';p.textContent='${reading ? '这里还没有内容，收藏第一篇文章吧。' : '给今天安排一件小事吧。'}';list.append(p)}selected.forEach(item=>{const row=document.createElement('div');row.className='item'+(item.done?' done':'');const box=document.createElement('input');box.type='checkbox';box.checked=item.done;box.onchange=async()=>{item.done=box.checked;await api('put',item.id,item);render()};const label=document.createElement('label');label.textContent=item.text;const del=document.createElement('button');del.className='delete';del.textContent='×';del.onclick=async()=>{await api('delete',item.id);items=items.filter(x=>x.id!==item.id);render()};row.append(box,label,del);list.append(row)})}document.querySelector('form').onsubmit=async e=>{e.preventDefault();const field=document.querySelector('#input');if(!field.value.trim())return;const item={id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),text:field.value.trim(),done:false};try{await api('put',item.id,item);items.push(item);field.value='';render()}catch(err){document.querySelector('#error').textContent=err.message}};document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));render()});api('list').then(async rows=>{items=rows.map(x=>({...x.data,id:x.record_id}));if(!items.length){items=[{id:'seed1',text:'${reading ? '阅读：设计一个让人愿意使用的产品' : '梳理本周最重要的三件事'}',done:false},{id:'seed2',text:'${reading ? '收藏：Agent 产品的设计笔记' : '留出半小时，做一点自己喜欢的事'}',done:true}];for(const x of items)await api('put',x.id,x)}render()});`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>${css}</style></head><body><main><header><b>✳ ${title}</b><span>YOUR PERSONAL SPACE</span></header><h1>${reading ? '好内容，值得慢慢读。' : focus ? '此刻，只做一件事。' : '让今天，轻一点。'}</h1><p>${reading ? '收藏灵感，保持好奇。' : focus ? '给重要的事情，一段不被打扰的时间。' : '把想做的事放在这里，一件一件完成。'}</p>${focus ? '<div class="timer" id="time"></div><div class="center"><button id="start">开始专注</button> <button id="reset">重新开始</button></div><section><div class="stat">本次专注<b>25 分钟</b></div><div class="stat">休息时间<b>5 分钟</b></div></section>' : '<section><div class="stat">全部' + (reading ? '收藏' : '任务') + '<b id="total">0</b></div><div class="stat">已经' + (reading ? '读完' : '完成') + '<b id="done">0</b></div><div class="stat">完成率<b id="rate">0%</b></div></section><form><input id="input" aria-label="' + (reading ? '收藏文章' : '新增任务') + '" placeholder="' + (reading ? '输入文章标题，留给之后的自己' : '接下来，想做什么？') + '" maxlength="200"><button>添加</button></form><div class="filters"><button class="active" data-filter="all">全部</button><button data-filter="pending">' + (reading ? '待读' : '进行中') + '</button><button data-filter="done">' + (reading ? '已读' : '已完成') + '</button></div><div id="list"></div><p id="error" class="error"></p>'}<p class="note">Atoms Workbench · 可交互示例 · 数据仅保存在当前浏览器</p></main><script>${js}</script></body></html>`;
  return { html, summary: '预先准备的示例', files: { 'index.html': html, 'styles.css': css } };
}
