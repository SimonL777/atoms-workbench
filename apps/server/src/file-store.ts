import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Snapshot } from '@atoms/shared';
import type { ChatMessage } from './model.ts';
import { config } from './config.ts';
import { safeFile } from './guards.ts';
import { DATA_BRIDGE } from './template.ts';

export type Checkpoint = {
  files: Record<string, string>;
  context: ChatMessage[];
  baseVersionId: string | null;
  answeredQuestionId?: string;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function id(value: string) {
  if (!uuid.test(value)) throw new Error('Invalid local project identifier');
  return value;
}

export function createFileStore(root: string) {
  const base = resolve(root);
  const projectPath = (owner: string, project: string) =>
    join(base, 'users', id(owner), 'projects', id(project));
  async function directory(path: string) {
    await mkdir(base, { recursive: true, mode: 0o700 });
    if ((await lstat(base)).isSymbolicLink())
      throw new Error('Local data root must not be a symlink');
    await chmod(base, 0o700);
    const relative = path
      .slice(base.length + 1)
      .split('/')
      .filter(Boolean);
    let current = base;
    for (const component of relative) {
      current = join(current, component);
      await mkdir(current, { mode: 0o700 }).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('Unsafe local data directory');
    }
  }
  async function read<T>(path: string): Promise<T> {
    // Check ancestor directories as well as the final file before opening it.
    let current = base;
    if ((await lstat(base)).isSymbolicLink()) throw new Error('Unsafe local data root');
    for (const component of path
      .slice(base.length + 1)
      .split('/')
      .slice(0, -1)) {
      current = join(current, component);
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('Unsafe local data directory');
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 20_000_000) throw new Error('Invalid local artifact');
      return JSON.parse(await handle.readFile('utf8')) as T;
    } finally {
      await handle.close();
    }
  }
  async function atomic(path: string, value: unknown) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    const content = JSON.stringify(value);
    if (Buffer.byteLength(content) > 20_000_000)
      throw new Error('Local checkpoint exceeds size limit');
    try {
      await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return {
    async loadCheckpoint(owner: string, project: string, run: string) {
      try {
        return await read<Checkpoint>(
          join(projectPath(owner, project), 'runs', id(run), 'checkpoint.json'),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async saveCheckpoint(owner: string, project: string, run: string, checkpoint: Checkpoint) {
      const path = join(projectPath(owner, project), 'runs', id(run));
      await directory(path);
      await atomic(join(path, 'checkpoint.json'), checkpoint);
    },
    async saveVersion(owner: string, project: string, version: string, snapshot: Snapshot) {
      const path = join(projectPath(owner, project), 'versions', id(version));
      await directory(path);
      // Publishing a version is immutable: an existing snapshot is never overwritten.
      const source = join(path, 'source');
      for (const [file, content] of Object.entries(snapshot.files)) {
        if (file === 'src/atom-data.ts') {
          if (content !== DATA_BRIDGE) throw new Error('Managed data bridge changed');
        } else safeFile(file);
        await directory(join(source, file, '..'));
        await writeFile(join(source, file), content, { mode: 0o600, flag: 'wx' });
      }
      await writeFile(join(path, 'preview.html'), snapshot.html, { mode: 0o600, flag: 'wx' });
      await writeFile(join(path, 'snapshot.json'), JSON.stringify(snapshot), {
        mode: 0o600,
        flag: 'wx',
      });
      return `local:${id(owner)}/${id(project)}/${id(version)}`;
    },
    async loadVersion(owner: string, project: string, version: string) {
      return read<Snapshot>(
        join(projectPath(owner, project), 'versions', id(version), 'snapshot.json'),
      );
    },
  };
}
export const fileStore = createFileStore(config.projectRoot);
