import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
process.env.MODEL_CONFIG_ENCRYPTION_KEY = randomBytes(32).toString('base64');
const { config } = await import('../src/config.ts');
const { encryptModelConfig, decryptModelConfig, modelSettingsInput } =
  await import('../src/model-settings.ts');
const { isPublicAddress, validateModelUrl } = await import('../src/model-transport.ts');
const { model } = await import('../src/model.ts');
const connection = {
  baseUrl: 'https://example.com/v1',
  modelName: 'test-model',
  apiKey: 'synthetic-secret-key',
};
test('all model fields encrypt with unique nonces; tampering, wrong user and wrong key fail closed', () => {
  const a = encryptModelConfig('owner-a', connection);
  const b = encryptModelConfig('owner-a', connection);
  assert.notEqual(a, b);
  for (const field of Object.values(connection)) assert.ok(!a.includes(field));
  assert.deepEqual(decryptModelConfig('owner-a', a), connection);
  assert.throws(() => decryptModelConfig('owner-b', a), /无法解密/);
  const parts = a.split('.');
  for (const i of [1, 2, 3]) {
    const mutated = [...parts];
    const bytes = Buffer.from(mutated[i], 'base64url');
    bytes[0] ^= 1;
    mutated[i] = bytes.toString('base64url');
    assert.throws(() => decryptModelConfig('owner-a', mutated.join('.')), /无法解密/);
  }
  const key = config.modelEncryptionKey;
  try {
    config.modelEncryptionKey = randomBytes(32).toString('base64');
    assert.throws(() => decryptModelConfig('owner-a', a), /无法解密/);
  } finally {
    config.modelEncryptionKey = key;
  }
});
test('configuration rejects owner overrides and credential header injection', () => {
  assert.equal(modelSettingsInput.safeParse(connection).success, true);
  for (const invalid of [
    { ...connection, user_id: 'other-owner' },
    { ...connection, apiKey: 'abc\nHeader: stolen' },
    { ...connection, apiKey: '' },
  ])
    assert.equal(modelSettingsInput.safeParse(invalid).success, false);
});
test('model transport rejects private IPv4/IPv6, insecure URLs and URL-carried credentials', () => {
  config.allowPrivateModels = false;
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.168.1.1',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  for (const url of [
    'http://example.com/v1',
    'https://127.0.0.1/v1',
    'https://[::1]/v1',
    'https://localhost/v1',
    'https://key@example.com/v1',
    'https://example.com/v1?key=abc',
    'https://example.com/v1/chat/completions',
  ])
    assert.throws(() => validateModelUrl(url));
  assert.equal(validateModelUrl(connection.baseUrl).href, connection.baseUrl);
});
test('actual HTTP model calls use each explicit user connection and never follow redirects or expose provider errors', async () => {
  config.allowPrivateModels = true;
  const seen: { authorization: string | undefined; model: string }[] = [];
  let redirectTargetHits = 0;
  const server = createServer(async (req, res) => {
    let content = '';
    for await (const chunk of req) content += chunk;
    if (req.url === '/redirect/chat/completions') {
      res.writeHead(302, { location: '/stolen' });
      res.end();
      return;
    }
    if (req.url === '/stolen') {
      redirectTargetHits++;
      res.end();
      return;
    }
    if (req.url === '/error/chat/completions') {
      res.writeHead(401);
      res.end('echo-private-provider-secret');
      return;
    }
    seen.push({ authorization: req.headers.authorization, model: JSON.parse(content).model });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const id of ['A', 'B']) {
      const answer = await model(
        { baseUrl: `${baseUrl}/v1`, modelName: `model-${id}`, apiKey: `key-${id}` },
        [],
        [],
        AbortSignal.timeout(5000),
      );
      assert.equal(answer.content, 'ok');
    }
    assert.deepEqual(seen, [
      { authorization: 'Bearer key-A', model: 'model-A' },
      { authorization: 'Bearer key-B', model: 'model-B' },
    ]);
    await assert.rejects(
      model({ ...connection, baseUrl: `${baseUrl}/redirect` }, [], [], AbortSignal.timeout(5000)),
      /连接失败/,
    );
    assert.equal(redirectTargetHits, 0);
    await assert.rejects(
      model({ ...connection, baseUrl: `${baseUrl}/error` }, [], [], AbortSignal.timeout(5000)),
      (error: Error) =>
        error.message.includes('HTTP 401') && !error.message.includes('echo-private'),
    );
  } finally {
    config.allowPrivateModels = false;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
