import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import { config, HttpError, modelReady, persistenceReady } from './config.ts';
import { checked, db, owner } from './db.ts';
import type { Run, Snapshot } from '@atoms/shared';
const uuid = z.string().uuid();
const input = z.string().trim().min(1).max(12000);
const params = z.object({ id: uuid });
const server = Fastify({ logger: { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] }, bodyLimit: 256_000 });
await server.register(cors, { origin: config.origin.split(','), methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type','Authorization'] });
await server.register(rateLimit, { max: 90, timeWindow: '1 minute' });
server.setErrorHandler((error, _req, reply) => {
  const status = error instanceof ZodError ? 400 : (error as HttpError).statusCode || 500;
  reply.code(status).send({ error: error instanceof ZodError ? '请求参数无效。' : status < 500 || status === 503 ? (error as Error).message : '请求未完成，请稍后重试。' });
});
server.addHook('onSend', async (_req, reply) => { reply.header('Cache-Control', 'no-store'); reply.header('X-Content-Type-Options','nosniff'); });
server.get('/api/health', async () => ({ ok: true, build: config.build, persistence: persistenceReady, model: modelReady }));
server.get('/api/config', async () => ({ supabaseUrl: config.supabaseUrl, supabaseKey: config.publicKey, configured: persistenceReady, modelReady, demoEnabled: config.demo, build: config.build }));

async function user(request: { headers: Record<string, unknown> }) {
  const auth = request.headers.authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) throw new HttpError(401, '请先登录。');
  const { data, error } = await db().auth.getUser(auth.slice(7));
  if (error || !data.user) throw new HttpError(401, '登录已过期，请重新登录。');
  return data.user;
}
server.get('/api/projects', async req => {
  const actor = await user(req);
  return checked(await db().from('projects').select('*').eq('owner_id', actor.id).order('updated_at', { ascending: false }).limit(100));
});
async function startRun(projectId: string, body: { input: string; kind: 'brainstorm' | 'build'; request_id: string; spec_id?: string | null }) {
  if (!modelReady) throw new HttpError(503, '模型服务尚未配置。');
  const previous = checked(await db().from('runs').select('*').eq('project_id', projectId).eq('request_id', body.request_id));
  if (previous[0]) return previous[0];
  const project = checked(await db().from('projects').select('*').eq('id', projectId).single());
  const run = checked(await db().from('runs').insert({ project_id: projectId, ...body, base_version_id: project.current_version_id }).select('*').single());
  checked(await db().from('messages').insert({ project_id: projectId, run_id: run.id, role: 'user', content: body.input }).select('id'));
  return run;
}
server.post('/api/projects', async req => {
  const actor = await user(req);
  if (!modelReady) throw new HttpError(503, '模型服务尚未配置。');
  const body = z.object({ input, mode: z.enum(['brainstorm','build']), request_id: uuid }).parse(req.body);
  // The client keeps both IDs stable across network retries.
  const old = await db().from('projects').select('*').eq('id', body.request_id).eq('owner_id', actor.id).maybeSingle();
  if (old.error) throw new HttpError(503, '数据服务暂时不可用。');
  const project = old.data || checked(await db().from('projects').insert({ id: body.request_id, owner_id: actor.id, name: body.input.slice(0,36), description: body.input, mode: body.mode }).select('*').single());
  await startRun(project.id, { input: body.input, kind: body.mode, request_id: body.request_id });
  return project;
});
server.get('/api/projects/:id', async req => {
  const actor = await user(req); const { id } = params.parse(req.params); const project = await owner(id, actor.id);
  const tables = ['messages','spec_versions','runs','project_versions','run_events'] as const;
  const results = await Promise.all(tables.map(table => db().from(table).select(table === 'runs' ? 'id,project_id,kind,input,status,phase,question,error,base_version_id,spec_id,created_at' : '*').eq('project_id',id).order(table === 'run_events' ? 'id' : 'created_at', { ascending: false }).limit(table === 'run_events' ? 200 : 100)));
  const [messages,specs,runs,versions,events] = results.map(checked);
  return { project, messages: messages.reverse(), specs, runs, versions, events: events.reverse() };
});
server.post('/api/projects/:id/messages', async req => {
  const actor = await user(req); const { id } = params.parse(req.params); const project = await owner(id, actor.id);
  const body = z.object({ input, request_id: uuid }).parse(req.body);
  const pending = checked(await db().from('runs').select('id').eq('project_id',id).eq('status','waiting_for_user'));
  if (pending.length) throw new HttpError(409, '请先回答当前问题，或停止本次任务。');
  const specs = checked(await db().from('spec_versions').select('confirmed_at').eq('project_id',id).order('created_at',{ascending:false}).limit(1));
  const kind = project.mode === 'brainstorm' && !project.current_version_id && !specs[0]?.confirmed_at ? 'brainstorm' : 'build';
  return startRun(id, { ...body, kind });
});
server.post('/api/projects/:id/confirm', async req => {
  const actor = await user(req); const { id } = params.parse(req.params); await owner(id, actor.id);
  const body = z.object({ spec_id: uuid, request_id: uuid }).parse(req.body);
  const latest = checked(await db().from('spec_versions').select('*').eq('project_id',id).order('created_at',{ ascending:false }).limit(1));
  if (latest[0]?.id !== body.spec_id) throw new HttpError(409,'需求已更新，请确认最新版本。');
  checked(await db().from('spec_versions').update({ confirmed_at:new Date().toISOString() }).eq('id',body.spec_id).eq('project_id',id).select('id'));
  return startRun(id, { input:'按照已确认的需求简报开发第一版。', kind:'build', ...body });
});
server.post('/api/runs/:id/answer', async req => {
  const actor = await user(req); const { id } = params.parse(req.params);
  const run = checked(await db().from('runs').select('*').eq('id',id).single()); const project = await owner(run.project_id, actor.id);
  const body = z.object({ answer: input, question_id: uuid }).parse(req.body);
  if (run.status !== 'waiting_for_user' || run.question?.id !== body.question_id) throw new HttpError(409, '该问题已回答或已过期。');
  const context = [...run.context, { role:'tool', tool_call_id:run.question.tool_call_id, content:body.answer }];
  const updated = checked(await db().from('runs').update({ status:'queued',question:null,context,phase:'继续整理需求' }).eq('id',id).eq('status','waiting_for_user').select('id'));
  if (!updated.length) throw new HttpError(409,'该问题已回答。');
  checked(await db().from('messages').insert({ project_id:run.project_id,run_id:id,role:'user',content:body.answer }).select('id'));
  return { ok:true };
});
server.post('/api/runs/:id/cancel', async req => {
  const actor = await user(req); const { id } = params.parse(req.params);
  const run = checked(await db().from('runs').select('project_id').eq('id',id).single()); await owner(run.project_id, actor.id);
  checked(await db().from('runs').update({ status:'cancelled',question:null,finished_at:new Date().toISOString() }).eq('id',id).in('status',['queued','running','waiting_for_user']).select('id'));
  return { ok:true };
});
server.post('/api/runs/:id/retry', async req => {
  const actor = await user(req); const { id } = params.parse(req.params);
  const run = checked(await db().from('runs').select('*').eq('id',id).single()); const project = await owner(run.project_id, actor.id);
  const body = z.object({ request_id:uuid }).parse(req.body);
  if (!['failed','interrupted','cancelled'].includes(run.status)) throw new HttpError(409,'该任务无需重试。');
  const existing = checked(await db().from('runs').select('*').eq('project_id',run.project_id).eq('request_id',body.request_id));
  if (existing[0]) return existing[0];
  // Reuse safe file checkpoints, not partially completed external tool calls.
  if (run.base_version_id !== project.current_version_id) throw new HttpError(409,'项目版本已变化，请在当前版本上重新描述修改。');
  return checked(await db().from('runs').insert({ project_id:run.project_id,request_id:body.request_id,kind:run.kind,input:run.input,spec_id:run.spec_id,files:run.files,base_version_id:run.base_version_id }).select('*').single());
});
server.get('/api/projects/:id/versions/:version', async req => {
  const actor = await user(req); const { id,version } = z.object({ id:uuid,version:uuid }).parse(req.params); await owner(id,actor.id);
  const item = checked(await db().from('project_versions').select('*').eq('id',version).eq('project_id',id).single());
  const blob = await db().storage.from('project-artifacts').download(item.artifact_path);
  if (blob.error || !blob.data) throw new HttpError(503,'版本产物读取失败。');
  return JSON.parse(await blob.data.text()) as Snapshot;
});
server.post('/api/projects/:id/restore', async req => {
  const actor = await user(req); const { id } = params.parse(req.params); await owner(id,actor.id);
  const { version_id } = z.object({ version_id:uuid }).parse(req.body);
  checked(await db().rpc('restore_version',{ target_project:id,target_version:version_id }));
  return { ok:true };
});
server.post('/api/projects/:id/records', async req => {
  const actor = await user(req); const { id } = params.parse(req.params); await owner(id,actor.id);
  const body = z.object({ collection:z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),operation:z.enum(['list','put','delete']),record_id:z.string().min(1).max(100).optional(),data:z.record(z.string(),z.unknown()).optional() }).parse(req.body);
  if (body.operation === 'list') return checked(await db().from('app_records').select('record_id,data').eq('project_id',id).eq('collection',body.collection).limit(1000));
  if (!body.record_id) throw new HttpError(400,'记录 ID 缺失。');
  if (body.operation === 'put') { if (!body.data) throw new HttpError(400,'记录数据缺失。'); return checked(await db().from('app_records').upsert({ project_id:id,collection:body.collection,record_id:body.record_id,data:body.data,updated_at:new Date().toISOString() }).select('record_id,data')); }
  return checked(await db().from('app_records').delete().eq('project_id',id).eq('collection',body.collection).eq('record_id',body.record_id).select('record_id'));
});
server.get('/api/projects/:id/events', async (req,reply) => {
  const actor = await user(req); const { id } = params.parse(req.params); await owner(id,actor.id);
  const query = z.object({ after:z.coerce.number().int().nonnegative().default(0) }).parse(req.query); let cursor = query.after;
  reply.hijack(); reply.raw.writeHead(200,{ 'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive',...(config.origin.split(',').includes(req.headers.origin || '') ? { 'Access-Control-Allow-Origin':req.headers.origin! } : {}) });
  let closed = false; reply.raw.on('close',() => { closed = true; }); const end = Date.now()+55_000;
  while (!closed && Date.now() < end) {
    const { data,error } = await db().from('run_events').select('*').eq('project_id',id).gt('id',cursor).order('id').limit(100);
    if (error) break;
    for (const event of data || []) { cursor = event.id; reply.raw.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`); }
    reply.raw.write(': heartbeat\n\n'); await new Promise(resolve => setTimeout(resolve,2000));
  }
  reply.raw.end();
});
await server.listen({ port:config.port,host:'0.0.0.0' });
