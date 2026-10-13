import { homedir } from 'node:os';
import { join } from 'node:path';
function capacity(name: string, fallback: number, integer = true) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value)))
    throw new Error(`${name} must be a positive ${integer ? 'integer' : 'number'}.`);
  return value;
}
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
  maxSteps: capacity('MAX_RUN_STEPS', 128),
  timeout: capacity('RUN_TIMEOUT_MS', 1_800_000),
  maxBuilds: capacity('MAX_BUILD_ATTEMPTS', 10),
  buildTimeout: capacity('BUILD_TIMEOUT_MS', 300_000),
  sandboxMemoryMb: capacity('SANDBOX_MEMORY_MB', 2048),
  sandboxCpus: capacity('SANDBOX_CPUS', 2, false),
  sandboxPids: capacity('SANDBOX_PIDS_LIMIT', 512),
  sandboxWorkMb: capacity('SANDBOX_WORK_MB', 1024),
  sandboxTmpMb: capacity('SANDBOX_TMP_MB', 256),
  maxProjectFiles: capacity('MAX_PROJECT_FILES', 200),
  maxFileChars: capacity('MAX_SOURCE_FILE_CHARS', 500_000),
  maxArtifactBytes: capacity('MAX_LOCAL_ARTIFACT_BYTES', 128 * 1024 * 1024),
  maxJsBytes: capacity('MAX_PREVIEW_JS_BYTES', 20 * 1024 * 1024),
  maxCssBytes: capacity('MAX_PREVIEW_CSS_BYTES', 5 * 1024 * 1024),
  apiRateLimit: capacity('API_REQUESTS_PER_MINUTE', 300),
  apiBodyLimit: capacity('API_BODY_LIMIT_BYTES', 2 * 1024 * 1024),
  demo: process.env.ALLOW_DEMO !== 'false',
  build: process.env.BUILD_SHA || 'development',
};
// Safe operational metadata: never include credentials or provider configuration.
export const executionLimits = {
  runTimeoutMs: config.timeout,
  maxModelRounds: config.maxSteps,
  maxBuildAttempts: config.maxBuilds,
  buildTimeoutMs: config.buildTimeout,
  sandboxMemoryMb: config.sandboxMemoryMb,
  sandboxCpus: config.sandboxCpus,
  sandboxPids: config.sandboxPids,
  maxProjectFiles: config.maxProjectFiles,
  maxSourceFileChars: config.maxFileChars,
  maxLocalArtifactBytes: config.maxArtifactBytes,
  apiRequestsPerMinute: config.apiRateLimit,
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
