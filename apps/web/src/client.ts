import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PublicConfig, Project, ProjectDetail, Snapshot } from '@atoms/shared';
const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/,'');
export let auth:SupabaseClient | undefined;
export async function getConfig():Promise<PublicConfig> {
  let config:PublicConfig;
  try { const res=await fetch(`${apiBase}/api/config`,{signal:AbortSignal.timeout(8000)}); if (!res.ok) throw new Error(); config=await res.json(); }
  catch { config={supabaseUrl:import.meta.env.VITE_SUPABASE_URL || '',supabaseKey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',demoEnabled:import.meta.env.VITE_DEMO_MODE === 'true',configured:false,modelReady:false,build:'static'}; }
  if (config.supabaseUrl && config.supabaseKey) {
    if (config.supabaseKey.startsWith('sb_secret_')) throw new Error('浏览器配置包含服务端密钥，请移除后重新构建。');
    if (config.supabaseKey.startsWith('eyJ')) { try { const payload=JSON.parse(atob(config.supabaseKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); if (payload.role === 'service_role') throw new Error('SERVICE_ROLE'); } catch(error) { if ((error as Error).message === 'SERVICE_ROLE') throw new Error('浏览器只能配置 Supabase publishable/anon key。'); } }
    auth=createClient(config.supabaseUrl,config.supabaseKey,{auth:{flowType:'pkce'}});
  }
  return config;
}
export async function request<T>(path:string,body?:unknown,method?:string):Promise<T> {
  const {data}=auth ? await auth.auth.getSession() : {data:{session:null}};
  const response=await fetch(`${apiBase}/api${path}`,{method:method || (body ? 'POST':'GET'),headers:{'Content-Type':'application/json',...(data.session ? {Authorization:`Bearer ${data.session.access_token}`} : {})},...(body ? {body:JSON.stringify(body)} : {})});
  const result=await response.json(); if (!response.ok) throw new Error(result.error || '请求未完成。'); return result;
}
export const listProjects=()=>request<Project[]>('/projects');
export const detail=(id:string)=>request<ProjectDetail>(`/projects/${id}`);
export const snapshot=(id:string,version:string)=>request<Snapshot>(`/projects/${id}/versions/${version}`);
export async function listen(id:string,onEvent:()=>void,signal:AbortSignal) {
  let cursor=0;
  while (!signal.aborted) {
    try {
      const {data}=await auth!.auth.getSession();
      if (!data.session) return;
      const response=await fetch(`${apiBase}/api/projects/${id}/events?after=${cursor}`,{headers:{Authorization:`Bearer ${data.session.access_token}`},signal});
      if (!response.ok || !response.body) throw new Error();
      const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer='';
      while (!signal.aborted) {
        const {done,value}=await reader.read(); if(done) break; buffer+=decoder.decode(value,{stream:true});
        const parts=buffer.split('\n\n');buffer=parts.pop() || '';
        for(const part of parts){const line=part.split('\n').find(item=>item.startsWith('data: '));if(line){const event=JSON.parse(line.slice(6));cursor=event.id;onEvent();}}
      }
    } catch { if(signal.aborted) return; }
    await new Promise<void>(resolve=>{ const timer=setTimeout(resolve,3000);signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true}); });
  }
}
