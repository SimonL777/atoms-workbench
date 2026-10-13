import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFileStore } from '../src/file-store.ts';
import { template } from '../src/template.ts';
test('local versions are immutable, checkpoints recover and users remain separated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atoms-store-test-'));
  const store = createFileStore(root);
  const owner = randomUUID(),
    other = randomUUID(),
    project = randomUUID(),
    version = randomUUID(),
    run = randomUUID();
  const snapshot = { files: template, html: '<h1>Preview</h1>', summary: 'First' };
  try {
    const path = await store.saveVersion(owner, project, version, snapshot);
    assert.match(path, /^local:/);
    assert.deepEqual(await store.loadVersion(owner, project, version), snapshot);
    assert.equal(
      await readFile(
        join(
          root,
          'users',
          owner,
          'projects',
          project,
          'versions',
          version,
          'source',
          'src/App.tsx',
        ),
        'utf8',
      ),
      template['src/App.tsx'],
    );
    await assert.rejects(store.loadVersion(other, project, version));
    await assert.rejects(store.saveVersion(owner, project, version, snapshot));
    const checkpoint = { files: template, context: [], baseVersionId: version };
    await store.saveCheckpoint(owner, project, run, checkpoint);
    assert.deepEqual(await store.loadCheckpoint(owner, project, run), checkpoint);
    const info = await stat(
      join(root, 'users', owner, 'projects', project, 'runs', run, 'checkpoint.json'),
    );
    assert.equal(info.mode & 0o777, 0o600);
    await assert.rejects(store.loadVersion('../escape', project, version));
    await mkdir(join(root, 'users', other));
    await symlink(join(root, 'users', owner, 'projects'), join(root, 'users', other, 'projects'));
    await assert.rejects(store.loadVersion(other, project, version), /Unsafe/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
