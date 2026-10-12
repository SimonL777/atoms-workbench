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
  maxSteps: Number(process.env.MAX_RUN_STEPS || 32),
  timeout: Number(process.env.RUN_TIMEOUT_MS || 300_000),
  demo: process.env.ALLOW_DEMO !== 'false',
  build: process.env.BUILD_SHA || 'development',
};
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
