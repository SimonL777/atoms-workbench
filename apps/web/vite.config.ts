import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', '');
  const publicKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  let elevated = publicKey.startsWith('sb_secret_');
  if (publicKey.startsWith('eyJ')) {
    try {
      elevated ||=
        JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString()).role ===
        'service_role';
    } catch {
      /* Invalid keys are rejected by Supabase; never print their values. */
    }
  }
  if (elevated) throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable or anon key.');
  return {
    plugins: [
      react(),
      {
        name: 'build-revision',
        transformIndexHtml: () => [
          {
            tag: 'meta',
            attrs: { name: 'atoms-build', content: env.VITE_BUILD_SHA || 'development' },
          },
        ],
      },
    ],
    envDir: '../..',
    base: env.VITE_BASE_PATH || '/',
    server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  };
});
