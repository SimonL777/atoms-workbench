import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { safeFile, inlinePreview, sourceHash, redactError } from '../src/guards.ts';
test('file boundary rejects traversal, config writes and managed data helper', () => {
  for (const path of [
    '../.env',
    'src/../.env',
    '/tmp/x.ts',
    'src\\App.tsx',
    'src/.secret.ts',
    'src/atom-data.ts',
    'package.json',
  ])
    assert.throws(() => safeFile(path), Error, path);
  assert.equal(safeFile('src/components/Tasks.tsx'), 'src/components/Tasks.tsx');
});
test('preview escaping prevents generated strings from closing a script or style', () => {
  const html = inlinePreview(
    'const s="</script><script>steal()</script>";',
    '/* </style><script>steal()</script> */',
  );
  // Test the dangerous literal alone, rather than executing any generated app.
  const literal = inlinePreview('const s="</script><script>steal()</script>";', '');
  assert.ok(!html.includes('</style><script>steal()'));
  const payload = literal.slice(literal.indexOf('<script>') + 8, literal.lastIndexOf('</script>'));
  assert.equal(runInNewContext(payload + 's;'), '</script><script>steal()</script>');
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(html.includes('<\\/script>'));
  assert.ok(html.includes('<\\/style>'));
});
test('source hash is stable across order and invalidates after an edit', () => {
  assert.equal(sourceHash({ b: '2', a: '1' }), sourceHash({ a: '1', b: '2' }));
  assert.notEqual(sourceHash({ a: '1' }), sourceHash({ a: 'changed' }));
});
test('error output masks reusable credentials', () => {
  const example = 'Bearer ' + 'private'.repeat(8);
  const key = 'sk-' + 'example'.repeat(8);
  assert.ok(!redactError(example + ' ' + key).includes('example'));
  assert.ok(redactError('x'.repeat(10000)).length <= 6000);
});
