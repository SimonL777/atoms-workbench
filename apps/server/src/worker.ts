import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Run, Snapshot } from '@atoms/shared';
import { config, modelReady, persistenceReady } from './config.ts';
import { checked, db } from './db.ts';
import { model, type ChatMessage, brainstormTools, buildTools } from './model.ts';
import { build, type BuildResult } from './sandbox.ts';
import { safeFile, sourceHash, redactError } from './guards.ts';
import { template } from './template.ts';
type Task = Run & { context:ChatMessage[]; files:Record<string,string>; lease_owner:string };
const workerId = randomUUID();
const root = fileURLToPath(new URL('../../../',import.meta.url));
const skillRoot = `${root}references/superpowers-v7/skills/`;
const pause = (ms:number) => new Promise(resolve => setTimeout(resolve,ms));

async function execute(task:Task) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(),config.timeout);
  let files = { ...template,...task.files }; let context = task.context; let lastBuild:BuildResult | undefined; let builds = 0;
  const update = async (values:Record<string,unknown>) => {
    const data = checked(await db().from('runs').update(values).eq('id',task.id).eq('status','running').eq('lease_owner',workerId).select('id'));
    if (!data.length) { controller.abort(); throw new Error('Run lease lost'); }
  };
  const heartbeat = setInterval(() => { void update({ heartbeat_at:new Date().toISOString() }).catch(() => controller.abort()); },10_000);
  const event = async (kind:string,summary:string) => {
    await update({ phase:summary,heartbeat_at:new Date().toISOString() });
    checked(await db().from('run_events').insert({ project_id:task.project_id,run_id:task.id,kind,summary:redactError(summary) }).select('id'));
  };
  const message = async (content:string,kind='text',metadata:Record<string,unknown>={}) => {
    checked(await db().from('messages').insert({ project_id:task.project_id,run_id:task.id,role:'assistant',kind,content,metadata }).select('id'));
  };
  try {
    if (!context.length) {
      const project = checked(await db().from('projects').select('*').eq('id',task.project_id).single());
      if (Object.keys(task.files).length && task.base_version_id !== project.current_version_id) throw new Error('项目版本已变化，请在当前版本上发起新的修改。');
      task.base_version_id = project.current_version_id;
      if (project.current_version_id && !Object.keys(task.files).length) {
        const version = checked(await db().from('project_versions').select('artifact_path').eq('id',project.current_version_id).single());
        const artifact = await db().storage.from('project-artifacts').download(version.artifact_path);
        if (artifact.error || !artifact.data) throw new Error('基准版本读取失败。');
        files = (JSON.parse(await artifact.data.text()) as Snapshot).files;
      }
      const specs = checked(await db().from('spec_versions').select('*').eq('project_id',task.project_id).order('created_at',{ascending:false}).limit(1));
      const history = checked(await db().from('messages').select('role,content').eq('project_id',task.project_id).order('created_at',{ascending:false}).limit(12)).reverse();
      const skill = await readFile(`${skillRoot}${task.kind === 'brainstorm' ? 'brainstorming' : 'writing-plans'}/SKILL.md`,'utf8');
      const policy = task.kind === 'brainstorm'
        ? 'You are the requirement partner in a web workbench. Ask through ask_user_question, exactly one at a time, no requirement questionnaire. Use the supplied context rather than repeating settled questions. When enough is clear, call save_spec with a concise complete Markdown requirement brief. The UI will let the user confirm it. Do not create projects or use local servers. If the user explicitly wants to skip questions, include clear assumptions in the brief. Existing platform authorization and tool boundaries take precedence over the upstream workflow.'
        : 'You are the engineer in a web workbench. The user has authorized implementation. Use the writing-plans principles to call save_plan with a concise plan, then implement through file tools. You must run_build and fix errors before publish. Only React, React DOM and lucide-react are installed. Do not change dependencies or config. All code is src/. Keep src/atom-data.ts unchanged; import atomData from it for persisted user records (list,put,remove). Use atomData.id() for record IDs; crypto.randomUUID is unavailable in the opaque preview origin. No localStorage, network fetch, dynamic imports or external script/CDN dependencies. Build an attractive complete interactive app with helpful empty states and error handling. Use the current source for modifications. No fresh approval ceremony or additional execution skill is needed; our platform executor is selected. Never claim success before publish passes.';
      context = [{ role:'system',content:`${policy}\n\nUpstream skill (environment-specific instructions are adapted above):\n${skill}` },{ role:'user',content:`Project request: ${project.description}\nLatest requirement brief: ${specs[0]?.content || 'Direct build; infer sensible defaults.'}\nRecent conversation:\n${JSON.stringify(history)}\nCurrent file names: ${Object.keys(files).join(', ')}\nCurrent request: ${task.input}` }];
      await update({ context,files,base_version_id:task.base_version_id });
    }
    await event('started',task.kind === 'brainstorm' ? '理解你的想法' : '准备开发工作区');
    for (let step=0;step<config.maxSteps;step++) {
      if (controller.signal.aborted) throw new Error('任务已停止或超过执行时限。');
      const answer = await model(context,task.kind === 'brainstorm' ? brainstormTools : buildTools,controller.signal);
      context.push(answer);
      if (answer.content) await message(answer.content.slice(0,12000));
      const calls = answer.tool_calls || [];
      if (!calls.length) { context.push({ role:'user',content:'Continue using the available tools. For clarification, ask_user_question or save_spec. For development, verify with run_build and finish with publish.' }); await update({context,files}); continue; }
      const asks = calls.filter(call => call.function.name === 'ask_user_question');
      if (asks.length && calls.length !== 1) {
        for (const call of calls) context.push({role:'tool',tool_call_id:call.id,content:'ask_user_question must be the only tool call in this response. Please try one question only.'});
        await update({context,files}); continue;
      }
      for (const call of calls) {
        let result:unknown;
        try {
          const allowed = task.kind === 'brainstorm' ? brainstormTools : buildTools;
          if (!allowed.some(tool=>tool.function.name===call.function.name)) throw new Error('Tool unavailable in this phase');
          const args = JSON.parse(call.function.arguments) as Record<string,unknown>;
          switch (call.function.name) {
            case 'ask_user_question': {
              if (task.kind !== 'brainstorm') throw new Error('Question tool unavailable');
              const value = z.object({question:z.string().min(1).max(1200),options:z.array(z.string().max(200)).max(4).optional()}).parse(args);
              const question = { id:randomUUID(),text:value.question,options:value.options,tool_call_id:call.id };
              await event('question','等待你的回答'); await message(value.question,'question',{question});
              await update({status:'waiting_for_user',question,context,files}); return;
            }
            case 'save_spec': {
              if (task.kind !== 'brainstorm') throw new Error('Spec tool unavailable');
              const {content} = z.object({content:z.string().min(60).max(16000)}).parse(args);
              const spec = checked(await db().from('spec_versions').insert({project_id:task.project_id,content}).select('id').single());
              await event('spec','需求简报已准备好'); await message(content,'spec',{spec_id:spec.id});
              await update({status:'succeeded',phase:'等待确认需求',finished_at:new Date().toISOString(),context,files}); return;
            }
            case 'save_plan': {
              const {content} = z.object({content:z.string().min(10).max(8000)}).parse(args);
              await update({plan:content}); await message(content); await event('plan','开发计划已整理'); result={ok:true}; break;
            }
            case 'list_files': result={files:Object.keys(files)}; break;
            case 'read_file': { const {path}=z.object({path:z.string()}).parse(args); if (!(path in files)) throw new Error('File not found'); result={content:files[path]}; await event('read',`读取 ${path}`); break; }
            case 'write_file': {
              const {path,content}=z.object({path:z.string(),content:z.string().max(120000)}).parse(args); safeFile(path);
              if (Object.keys(files).length > 80 && !(path in files)) throw new Error('Project file limit reached');
              files[path]=content; lastBuild=undefined; await update({files}); await event('write',`修改 ${path}`); result={ok:true}; break;
            }
            case 'run_build': {
              if (++builds>3) throw new Error('构建修复次数已达到上限。');
              await event('build','运行类型检查与隔离构建'); lastBuild=await build(files,controller.signal);
              await event(lastBuild.ok ? 'checked':'build_error',lastBuild.ok ? '类型检查与构建通过':'构建失败，准备修复');
              result={ok:lastBuild.ok,log:lastBuild.log}; break;
            }
            case 'publish': {
              const {summary}=z.object({summary:z.string().min(1).max(1000)}).parse(args);
              if (!lastBuild?.ok || lastBuild.hash!==sourceHash(files) || !lastBuild.html) throw new Error('Current source must pass run_build before publish');
              await event('artifact','保存源码与预览产物');
              const versionId=randomUUID(); const artifactPath=`${task.project_id}/${versionId}/snapshot.json`;
              const snapshot:Snapshot={files,html:lastBuild.html,summary};
              const uploaded=await db().storage.from('project-artifacts').upload(artifactPath,JSON.stringify(snapshot),{contentType:'application/json',upsert:false});
              if (uploaded.error) throw new Error('产物保存失败，请重试保存。');
              checked(await db().rpc('publish_version',{target_run:task.id,target_worker:workerId,version_id:versionId,blob_path:artifactPath,version_summary:summary,results:{typecheck:true,build:true,source_hash:lastBuild.hash,skill_commit:'bb92a77741419a4ab5f06e711a283343f1ada0c3'}}));
              await message(summary,'version',{version_id:versionId});
              checked(await db().from('run_events').insert({project_id:task.project_id,run_id:task.id,kind:'published',summary:'新版本已交付'}).select('id')); return;
            }
            default: throw new Error('Tool unavailable');
          }
        } catch (error) { if (controller.signal.aborted) throw error; result={error:redactError((error as Error).message)}; }
        context.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)}); await update({context,files});
      }
    }
    throw new Error('任务达到执行步数上限，请缩小范围后重试。');
  } catch (error) {
    const detail=redactError(controller.signal.aborted ? '任务已停止或超过执行时限。' : (error as Error).message);
    const result=await db().from('runs').update({status:'failed',error:detail,files,phase:'需要处理',finished_at:new Date().toISOString()}).eq('id',task.id).eq('status','running').eq('lease_owner',workerId).select('id');
    if (result.data?.length) { await message(detail,'error'); checked(await db().from('run_events').insert({project_id:task.project_id,run_id:task.id,kind:'failed',summary:detail}).select('id')); }
  } finally { clearTimeout(timeout); clearInterval(heartbeat); }
}
if (!persistenceReady || !modelReady) { console.error('Worker requires Supabase and model configuration. Fill .env.local before starting.'); process.exit(1); }
console.log('Agent Worker ready.');
while (true) {
  try { const tasks=checked(await db().rpc('claim_run',{worker:workerId})) as Task[]; if (tasks[0]) await execute(tasks[0]); else await pause(2000); }
  catch { console.error('Worker could not claim a task; retrying.'); await pause(5000); }
}
