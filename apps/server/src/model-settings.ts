import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ModelSettings } from '@atoms/shared';
import { config, HttpError, modelReady } from './config.ts';
import { db } from './db.ts';
import { validateModelUrl } from './model-transport.ts';

const clean = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const fields = { baseUrl: clean.max(2048), modelName: clean.max(200), apiKey: clean.max(8192) };
export const modelSettingsInput = z
  .object({ ...fields, apiKey: fields.apiKey.optional() })
  .strict();
const connectionSchema = z.object(fields).strict();
export type ModelConnection = z.infer<typeof connectionSchema>;

function encryptionKey() {
  if (!modelReady) throw new HttpError(503, '模型配置加密服务尚未就绪，请联系管理员。');
  return Buffer.from(config.modelEncryptionKey, 'base64');
}
// Bind ciphertext to the user and purpose. A copied row cannot be decrypted for another user.
export function encryptModelConfig(userId: string, value: ModelConnection): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(`atoms:user-model:v1:${userId}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', nonce, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}
export function decryptModelConfig(userId: string, value: string): ModelConnection {
  const key = encryptionKey();
  try {
    const [version, iv, tag, data, extra] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !data || extra) throw new Error();
    const nonce = Buffer.from(iv, 'base64url');
    const authTag = Buffer.from(tag, 'base64url');
    if (nonce.length !== 12 || authTag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(Buffer.from(`atoms:user-model:v1:${userId}`));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]);
    return connectionSchema.parse(JSON.parse(plaintext.toString('utf8')));
  } catch {
    throw new HttpError(
      503,
      '已保存的模型配置无法解密，请联系管理员检查加密密钥，或重新填写完整配置。',
    );
  }
}
async function row(userId: string) {
  encryptionKey();
  const result = await db()
    .from('user_model_configs')
    .select('encrypted_config,updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (result.error)
    throw new HttpError(503, '模型配置数据服务未就绪，请确认已应用模型配置数据库迁移。');
  return result.data as { encrypted_config: string; updated_at: string } | null;
}
function summary(value: ModelConnection, updatedAt: string): ModelSettings {
  return {
    configured: true,
    baseUrl: value.baseUrl,
    modelName: value.modelName,
    apiKeyConfigured: true,
    updatedAt,
  };
}
export async function getModelSettings(userId: string): Promise<ModelSettings> {
  const saved = await row(userId);
  return saved
    ? summary(decryptModelConfig(userId, saved.encrypted_config), saved.updated_at)
    : { configured: false, baseUrl: '', modelName: '', apiKeyConfigured: false, updatedAt: null };
}
export async function requireUserModel(userId: string): Promise<ModelConnection> {
  const saved = await row(userId);
  if (!saved) throw new HttpError(428, '请先在模型配置中填写你的模型地址、名称和 API Key。');
  return decryptModelConfig(userId, saved.encrypted_config);
}
export async function saveModelSettings(userId: string, body: unknown): Promise<ModelSettings> {
  encryptionKey();
  const input = modelSettingsInput.parse(body);
  const baseUrl = validateModelUrl(input.baseUrl).toString().replace(/\/$/, '');
  // Supplying a new key also permits recovery from an old/unavailable encryption key.
  const apiKey = input.apiKey || (await requireUserModel(userId)).apiKey;
  const value = { baseUrl, modelName: input.modelName, apiKey };
  const updatedAt = new Date().toISOString();
  const result = await db()
    .from('user_model_configs')
    .upsert({
      user_id: userId,
      encrypted_config: encryptModelConfig(userId, value),
      updated_at: updatedAt,
    });
  if (result.error) throw new HttpError(503, '模型配置保存失败，请确认数据库迁移已应用后重试。');
  return summary(value, updatedAt);
}
export async function deleteModelSettings(userId: string) {
  encryptionKey();
  const result = await db().from('user_model_configs').delete().eq('user_id', userId);
  if (result.error) throw new HttpError(503, '模型配置删除失败，请稍后重试。');
  return { ok: true };
}
