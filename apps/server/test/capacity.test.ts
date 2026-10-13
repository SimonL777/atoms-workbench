import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('capacity settings reject invalid timers and permit fractional CPU shares', () => {
  const source =
    'const {executionLimits}=await import("./apps/server/src/config.ts"); console.log(JSON.stringify(executionLimits));';
  for (const value of ['-1', '0', 'NaN', 'Infinity']) {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', source],
      {
        env: { ...process.env, RUN_TIMEOUT_MS: value },
        encoding: 'utf8',
        timeout: 5000,
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /RUN_TIMEOUT_MS must be a positive integer/);
  }
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', source],
    {
      env: { ...process.env, RUN_TIMEOUT_MS: '1800000', MAX_RUN_STEPS: '128', SANDBOX_CPUS: '1.5' },
      encoding: 'utf8',
      timeout: 5000,
    },
  );
  assert.equal(result.status, 0);
  const limits = JSON.parse(result.stdout);
  assert.equal(limits.runTimeoutMs, 1800000);
  assert.equal(limits.maxModelRounds, 128);
  assert.equal(limits.sandboxCpus, 1.5);
});

test('a stalled build obeys its configured timeout and reports the specific cause', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atoms-build-timeout-'));
  try {
    const bin = join(directory, 'bin');
    await mkdir(bin);
    // Substitute only this child process's Docker executable; no real container is started.
    await writeFile(
      join(bin, 'docker'),
      '#!/usr/bin/env node\nif(process.argv[2]==="rm")process.exit(0);setInterval(()=>{},1000);\n',
      { mode: 0o700 },
    );
    const source =
      'const {build}=await import("./apps/server/src/sandbox.ts"); const {template}=await import("./apps/server/src/template.ts"); const result=await build(template,new AbortController().signal); console.log(JSON.stringify({ok:result.ok,log:result.log}));';
    const started = Date.now();
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', source],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          SANDBOX_ROOT: join(directory, 'builds'),
          BUILD_TIMEOUT_MS: '100',
        },
        encoding: 'utf8',
        timeout: 5000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const build = JSON.parse(result.stdout);
    assert.equal(build.ok, false);
    assert.match(build.log, /隔离构建超过.*BUILD_TIMEOUT_MS/);
    assert.ok(Date.now() - started < 5000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
