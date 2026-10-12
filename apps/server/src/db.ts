import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, HttpError, persistenceReady } from './config.ts';
let database: SupabaseClient | undefined;
export function db() {
  if (!persistenceReady) throw new HttpError(503, 'Supabase 尚未配置，请连接服务后再使用真实项目。');
  return database ??= createClient(config.supabaseUrl, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function checked<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error || result.data == null) throw new HttpError(503, '数据服务暂时不可用，请稍后重试。');
  return result.data as NonNullable<T>;
}
export async function owner(projectId: string, userId: string) {
  const { data, error } = await db().from('projects').select('*').eq('id', projectId).eq('owner_id', userId).maybeSingle();
  if (error) throw new HttpError(503, '数据服务暂时不可用。');
  if (!data) throw new HttpError(404, '项目不存在。');
  return data;
}
