import { homedir } from 'node:os';
import { join } from 'node:path';
export const config = {
  port: Number(process.env.PORT || 8787),
  origin: process.env.APP_ORIGIN || 'http://localhost:5173',
  supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  publicKey:
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  modelUrl: process.env.MODEL_BASE_URL || '',
  modelKey: process.env.MODEL_API_KEY || '',
  model: process.env.MODEL_NAME || '',
  sandboxImage: process.env.SANDBOX_IMAGE || 'atoms-sandbox:local',
  sandboxRoot: process.env.SANDBOX_ROOT || '',
  projectRoot:
    process.env.PROJECT_FILES_ROOT || join(homedir(), '.local', 'share', 'atoms-workbench'),
  maxSteps: Number(process.env.MAX_RUN_STEPS || 32),
  timeout: Number(process.env.RUN_TIMEOUT_MS || 300_000),
  demo: process.env.ALLOW_DEMO !== 'false',
  build: process.env.BUILD_SHA || 'development',
};
// /api/config is public. Reject elevated keys before the server can expose them.
let elevatedPublicKey = config.publicKey.startsWith('sb_secret_');
if (config.publicKey.startsWith('eyJ')) {
  try {
    const payload = JSON.parse(Buffer.from(config.publicKey.split('.')[1], 'base64url').toString());
    elevatedPublicKey ||= payload.role === 'service_role';
  } catch {
    // The Auth provider will reject malformed publishable keys; never log their value.
  }
}
if (elevatedPublicKey)
  throw new Error('SUPABASE_PUBLISHABLE_KEY must be a publishable or anon key.');
export const persistenceReady = Boolean(
  config.supabaseUrl && config.publicKey && config.serviceKey,
);
export const modelReady = Boolean(config.modelUrl && config.modelKey && config.model);
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
