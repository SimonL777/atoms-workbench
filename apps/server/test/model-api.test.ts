import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
process.env.MODEL_CONFIG_ENCRYPTION_KEY = randomBytes(32).toString('base64');
const { decryptModelConfig } = await import('../src/model-settings.ts');
const ownerA = '00000000-0000-4000-8000-000000000001';
const ownerB = '00000000-0000-4000-8000-000000000002';
const projectId = '10000000-0000-4000-8000-000000000001';
const waitingId = '20000000-0000-4000-8000-000000000001';
const failedId = '20000000-0000-4000-8000-000000000002';
const questionId = '30000000-0000-4000-8000-000000000001';

test('authenticated settings API isolates users, stores only ciphertext, preserves keys and gates every model task path', async () => {
  const rows = new Map<string, { user_id: string; encrypted_config: string; updated_at: string }>();
  const writes: string[] = [];
  const mock = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname === '/auth/v1/user') {
      const id =
        req.headers.authorization === 'Bearer token-A'
          ? ownerA
          : req.headers.authorization === 'Bearer token-B'
            ? ownerB
            : null;
      res.statusCode = id ? 200 : 401;
      res.end(
        JSON.stringify(
          id ? { id, aud: 'authenticated', role: 'authenticated' } : { message: 'invalid token' },
        ),
      );
      return;
    }
    const table = url.pathname.split('/').pop();
    const userId = url.searchParams.get('user_id')?.replace(/^eq\./, '');
    let result: unknown[] = [];
    if (table === 'user_model_configs') {
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const record = JSON.parse(body);
        rows.set(record.user_id, record);
      } else if (req.method === 'DELETE') rows.delete(userId!);
      else result = userId && rows.has(userId) ? [rows.get(userId)] : [];
    } else {
      if (req.method !== 'GET') writes.push(table!);
      if (table === 'projects')
        result = [
          { id: projectId, owner_id: ownerA, current_version_id: null, mode: 'build' },
        ].filter(
          (item) =>
            !url.searchParams.has('owner_id') ||
            url.searchParams.get('owner_id') === `eq.${item.owner_id}`,
        );
      if (table === 'runs' && url.searchParams.has('id')) {
        const id = url.searchParams.get('id')!.replace(/^eq\./, '');
        result = [
          {
            id,
            project_id: projectId,
            status: id === waitingId ? 'waiting_for_user' : 'failed',
            question: { id: questionId },
            base_version_id: null,
          },
        ];
      }
    }
    res.end(
      JSON.stringify(
        req.headers.accept?.includes('application/vnd.pgrst.object') ? result[0] || null : result,
      ),
    );
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const databaseUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  const port = 22000 + Math.floor(Math.random() * 12000);
  let logs = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/api.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: databaseUrl,
      SUPABASE_PUBLISHABLE_KEY: 'test-public',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  const api = async (actor: string | null, path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(actor ? { Authorization: `Bearer token-${actor}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000),
    });
    return {
      status: response.status,
      data: await response.json(),
      cache: response.headers.get('cache-control'),
    };
  };
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try {
        if ((await api(null, '/health')).status === 200) {
          ready = true;
          break;
        }
      } catch {}
      await pause(100);
    }
    assert.ok(ready);
    for (const method of ['GET', 'PUT', 'DELETE'])
      assert.equal(
        (await api(null, '/model-config', method, method === 'PUT' ? {} : undefined)).status,
        401,
      );
    const valueA = {
      baseUrl: 'https://example.com/v1',
      modelName: 'model-A',
      apiKey: 'synthetic-A-private-key',
    };
    assert.equal(
      (await api('A', '/model-config', 'PUT', { ...valueA, user_id: ownerB })).status,
      400,
    );
    assert.equal((await api('A', '/model-config', 'PUT', valueA)).status, 200);
    assert.ok(!JSON.stringify(rows.get(ownerA)).includes(valueA.apiKey));
    assert.deepEqual(decryptModelConfig(ownerA, rows.get(ownerA)!.encrypted_config), valueA);
    const summary = await api('A', '/model-config');
    assert.equal(summary.cache, 'no-store');
    assert.equal(summary.data.apiKey, undefined);
    assert.equal(summary.data.modelName, 'model-A');
    assert.equal((await api('B', '/model-config')).data.configured, false);
    assert.equal(
      (await api('A', '/model-config', 'PUT', { baseUrl: valueA.baseUrl, modelName: 'renamed' }))
        .status,
      200,
    );
    assert.equal(
      decryptModelConfig(ownerA, rows.get(ownerA)!.encrypted_config).apiKey,
      valueA.apiKey,
    );
    const valueB = { ...valueA, modelName: 'model-B', apiKey: 'synthetic-B-private-key' };
    assert.equal((await api('B', '/model-config', 'PUT', valueB)).status, 200);
    assert.equal((await api('A', '/model-config', 'DELETE')).status, 200);
    assert.equal((await api('B', '/model-config')).data.modelName, 'model-B');
    assert.equal((await api('A', '/model-config')).data.configured, false);
    assert.equal(
      (await api('A', '/model-config', 'PUT', { baseUrl: valueA.baseUrl, modelName: 'no-key' }))
        .status,
      428,
    );
    const requestId = '40000000-0000-4000-8000-000000000001';
    for (const [path, body] of [
      ['/projects', { input: 'Build', mode: 'build', request_id: requestId }],
      [`/projects/${projectId}/messages`, { input: 'Edit', request_id: requestId }],
      [`/projects/${projectId}/confirm`, { spec_id: requestId, request_id: requestId }],
      [`/runs/${waitingId}/answer`, { answer: 'Answer', question_id: questionId }],
      [`/runs/${failedId}/retry`, { request_id: requestId }],
    ] as const)
      assert.equal((await api('A', path, 'POST', body)).status, 428, path);
    assert.deepEqual(writes, [], 'No task or confirmation mutations before model configuration');
    assert.equal(
      (
        await api('B', `/projects/${projectId}/messages`, 'POST', {
          input: 'Edit',
          request_id: requestId,
        })
      ).status,
      404,
    );
    await pause(50);
    for (const secret of [valueA.apiKey, valueB.apiKey, process.env.MODEL_CONFIG_ENCRYPTION_KEY!])
      assert.ok(!logs.includes(secret));
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => mock.close(() => resolve()));
  }
});
