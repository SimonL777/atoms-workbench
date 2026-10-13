import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const forbidden = files.filter(
  (file) =>
    /^(\.env(?:\.|$)|docs\/(overall-plan|skill-reuse-research)\.md|\.(?:artifacts|runtime)\/)/.test(
      file,
    ) && file !== '.env.example',
);
const secrets = [];
for (const file of files) {
  if (!existsSync(file) || file.endsWith('package-lock.json') || file.endsWith('.png')) continue;
  const text = readFileSync(file, 'utf8');
  if (
    /(?:sk-|sb_secret_)[a-zA-Z0-9_-]{24,}/.test(text) ||
    /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/.test(text) ||
    /deepwisdom\.feishu\.cn\/wiki\//.test(text)
  )
    secrets.push(file);
}
if (forbidden.length || secrets.length) {
  console.error(JSON.stringify({ forbidden, credential_or_private_reference_files: secrets }));
  process.exit(1);
}
console.log(
  `Checked ${files.length} tracked and new public files: no private planning documents or reusable credentials.`,
);
