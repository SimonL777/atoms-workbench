import { createHash } from 'node:crypto';
import { posix } from 'node:path';
export function safeFile(path: string) {
  if (!path || path.includes('\\') || path.includes('\0') || posix.normalize(path) !== path || path.startsWith('/') || path.split('/').includes('..')) throw new Error('Unsafe file path');
  if (!/^src\/[\w./-]+\.(tsx?|jsx?|css|json)$/.test(path) || path.split('/').some(part => part.startsWith('.'))) throw new Error('Only project source files can be changed');
  if (path === 'src/atom-data.ts') throw new Error('The data bridge is managed by the platform');
  return path;
}
export function sourceHash(files: Record<string, string>) {
  return createHash('sha256').update(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
}
export function inlinePreview(js: string, css: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
export function redactError(text: string) {
  return text.replace(/(?:Bearer\s+)[A-Za-z0-9_.-]+/gi, 'Bearer [redacted]')
    .replace(/(?:sk-|sb_secret_)[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .slice(0, 6000);
}
