import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, lstat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.ts';
import { inlinePreview, redactError, safeFile, sourceHash } from './guards.ts';
import { DATA_BRIDGE } from './template.ts';
export type BuildResult = { ok: boolean; log: string; html?: string; hash: string };
export async function build(
  files: Record<string, string>,
  signal: AbortSignal,
): Promise<BuildResult> {
  const directory =
    config.sandboxRoot ||
    (process.platform === 'darwin' ? join(homedir(), '.cache', 'atoms-builds') : tmpdir());
  await mkdir(directory, { recursive: true });
  const base = await mkdtemp(join(directory, 'atoms-'));
  const source = join(base, 'input');
  const out = join(base, 'output');
  const name = `atoms-build-${randomUUID()}`;
  try {
    await mkdir(source);
    await mkdir(out);
    await chmod(base, 0o755);
    await chmod(out, 0o777);
    for (const [path, content] of Object.entries(files)) {
      if (path !== 'src/atom-data.ts') safeFile(path);
      else if (content !== DATA_BRIDGE) throw new Error('Data bridge was modified');
      await mkdir(join(source, path, '..'), { recursive: true });
      await writeFile(join(source, path), content);
    }
    const hash = sourceHash(files);
    const result = await new Promise<{ code: number; log: string }>((resolve, reject) => {
      const child = spawn(
        'docker',
        [
          'run',
          '--rm',
          '--name',
          name,
          '--network',
          'none',
          '--memory',
          `${config.sandboxMemoryMb}m`,
          '--cpus',
          String(config.sandboxCpus),
          '--pids-limit',
          String(config.sandboxPids),
          '--read-only',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          '--user',
          '1000:1000',
          '--tmpfs',
          `/work:rw,size=${config.sandboxWorkMb * 1024 * 1024},uid=1000,gid=1000`,
          '--tmpfs',
          `/tmp:rw,size=${config.sandboxTmpMb * 1024 * 1024},uid=1000,gid=1000`,
          '-v',
          `${source}:/input:ro`,
          '-v',
          `${out}:/output:rw`,
          config.sandboxImage,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let log = '';
      const collect = (chunk: Buffer) => {
        log = (log + chunk.toString()).slice(-12000);
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      const abort = () => {
        spawn('docker', ['rm', '-f', name], { stdio: 'ignore' }).on('error', () => {});
        child.kill('SIGTERM');
      };
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        abort();
      }, config.buildTimeout);
      signal.addEventListener('abort', abort, { once: true });
      child.on('error', (error) => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        resolve({
          code: timedOut ? 124 : (code ?? 1),
          log: timedOut
            ? `隔离构建超过 ${Math.ceil(config.buildTimeout / 60_000)} 分钟，请重试或调整 BUILD_TIMEOUT_MS。`
            : redactError(log),
        });
      });
      if (signal.aborted) abort();
    });
    if (signal.aborted) throw new Error('任务已停止。');
    if (result.code !== 0) return { ok: false, log: result.log || '隔离构建未完成。', hash };
    const scriptPath = join(out, 'app.js');
    const stylePath = join(out, 'app.css');
    if (!(await lstat(scriptPath)).isFile() || (await lstat(scriptPath)).isSymbolicLink())
      throw new Error('Invalid build artifact');
    const js = await readFile(scriptPath, 'utf8');
    let css = '';
    try {
      const info = await lstat(stylePath);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid CSS artifact');
      css = await readFile(stylePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (Buffer.byteLength(js) > config.maxJsBytes || Buffer.byteLength(css) > config.maxCssBytes)
      throw new Error('Build artifact exceeds limit');
    return { ok: true, log: result.log, html: inlinePreview(js, css), hash };
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
