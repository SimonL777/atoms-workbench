import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
process.env.MODEL_CONFIG_ENCRYPTION_KEY = randomBytes(32).toString('base64');
const { encryptModelConfig } = await import('../src/model-settings.ts');
const { createFileStore } = await import('../src/file-store.ts');

test('real Worker process loads each project owner model from encrypted rows without leaking it into checkpoints', async () => {
  const tasks = [1, 2, 3].map((n) => ({
    id: `20000000-0000-4000-8000-00000000000${n}`,
    project_id: `10000000-0000-4000-8000-00000000000${n}`,
    user_id: `00000000-0000-4000-8000-00000000000${n}`,
    kind: 'brainstorm',
    input: 'Clarify a small notes app',
    base_version_id: null,
  }));
  const completed = new Set<string>();
  const failed = new Set<string>();
  const used: { authorization: string | undefined; model: string }[] = [];
  const writes: unknown[] = [];
  const encrypted = new Map<string, string>();
  let claim = 0;
  const mock = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const value = body ? JSON.parse(body) : undefined;
    const url = new URL(req.url!, 'http://fixture');
    let result: unknown = [];
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/chat/completions')) {
      used.push({ authorization: req.headers.authorization, model: value.model });
      result = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'tool-spec',
                  type: 'function',
                  function: {
                    name: 'save_spec',
                    arguments: JSON.stringify({
                      content:
                        '# Notes app\nA small personal notes application with add, delete and search. Data persists per project. Use a clean green design and responsive layout.',
                    }),
                  },
                },
              ],
            },
          },
        ],
      };
    } else if (url.pathname.endsWith('/rpc/claim_run')) {
      result = claim < tasks.length ? [tasks[claim++]] : [];
    } else {
      const table = url.pathname.split('/').pop();
      const id = url.searchParams.get('id')?.replace(/^eq\./, '');
      if (value) writes.push(value);
      if (table === 'projects') {
        const task = tasks.find((item) => item.project_id === id)!;
        result = {
          id,
          owner_id: task.user_id,
          current_version_id: null,
          description: 'Small notes app',
        };
      } else if (table === 'user_model_configs') {
        const userId = url.searchParams.get('user_id')?.replace(/^eq\./, '')!;
        result = encrypted.has(userId)
          ? [{ encrypted_config: encrypted.get(userId), updated_at: new Date().toISOString() }]
          : [];
      } else if (req.method === 'GET') result = [];
      else if (table === 'spec_versions') result = { id: '30000000-0000-4000-8000-000000000001' };
      else result = [{ id: id || 'fixture-id' }];
      if (table === 'runs' && value?.status === 'succeeded') completed.add(id!);
      if (table === 'runs' && value?.status === 'failed') failed.add(id!);
    }
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  for (let i = 0; i < 2; i++)
    encrypted.set(
      tasks[i].user_id,
      encryptModelConfig(tasks[i].user_id, {
        baseUrl: `${baseUrl}/gateway`,
        modelName: `owner-model-${i + 1}`,
        apiKey: `owner-key-${i + 1}`,
      }),
    );
  const root = await mkdtemp(join(tmpdir(), 'atoms-worker-model-'));
  const store = createFileStore(root);
  const missing = tasks[2];
  await store.saveCheckpoint(missing.user_id, missing.project_id, missing.id, {
    files: { 'src/App.tsx': 'Saved source must survive removal of model configuration' },
    context: [{ role: 'user', content: 'Previously saved conversation' }],
    baseVersionId: null,
  });
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/worker.ts'], {
    env: {
      ...process.env,
      SUPABASE_URL: baseUrl,
      SUPABASE_PUBLISHABLE_KEY: 'fixture-public',
      SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
      MODEL_ALLOW_PRIVATE_ENDPOINTS: 'true',
      MODEL_BASE_URL: 'https://shared.invalid',
      MODEL_API_KEY: 'must-never-use-shared',
      MODEL_NAME: 'shared',
      PROJECT_FILES_ROOT: root,
    },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 100 && completed.size + failed.size < 3; i++) await pause(100);
    assert.equal(completed.size, 2);
    assert.ok(failed.has(missing.id), 'Missing owner model fails instead of using shared settings');
    const preserved = await store.loadCheckpoint(missing.user_id, missing.project_id, missing.id);
    assert.equal(
      preserved?.files['src/App.tsx'],
      'Saved source must survive removal of model configuration',
    );
    assert.equal(preserved?.context[0].content, 'Previously saved conversation');
    assert.deepEqual(used, [
      { authorization: 'Bearer owner-key-1', model: 'owner-model-1' },
      { authorization: 'Bearer owner-key-2', model: 'owner-model-2' },
    ]);
    let snapshots = JSON.stringify(writes);
    for (const task of tasks)
      snapshots += await readFile(
        join(
          root,
          'users',
          task.user_id,
          'projects',
          task.project_id,
          'runs',
          task.id,
          'checkpoint.json',
        ),
        'utf8',
      );
    for (const secret of ['owner-key-1', 'owner-key-2', baseUrl, 'must-never-use-shared'])
      assert.ok(!snapshots.includes(secret));
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => mock.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
