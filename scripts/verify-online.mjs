import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.VERIFY_URL?.replace(/\/$/, '');
if (!base) throw new Error('Set VERIFY_URL to the deployment URL.');
const report = { url: base, checked_at: new Date().toISOString(), checks: [], full_flow: false };
async function check(name, fn) {
  try {
    await fn();
    report.checks.push({ name, passed: true });
  } catch (error) {
    report.checks.push({ name, passed: false, error: error.message });
    throw error;
  }
}
let config;
try {
  await check('web_reachable', async () => {
    const response = await fetch(base, { signal: AbortSignal.timeout(20000) });
    if (!response.ok || !(await response.text()).includes('root'))
      throw new Error('Web document unavailable');
  });
  if (process.env.VERIFY_STATIC_ONLY === 'true') {
    await check('static_entry_assets', async () => {
      const html = await (await fetch(base)).text();
      const matches = [...html.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g)].map((m) => m[1]);
      if (!matches.length) throw new Error('No entry assets');
      for (const path of matches) {
        if (!(await fetch(new URL(path, base + '/'))).ok)
          throw new Error('Entry asset unavailable');
      }
    });
  } else {
    await check('api_ready', async () => {
      const response = await fetch(`${base}/api/health`);
      if (!response.ok) throw new Error('API unavailable');
      const health = await response.json();
      if (!health.persistence || !health.model) throw new Error('Cloud configuration incomplete');
      if (process.env.VERIFY_BUILD_SHA && health.build !== process.env.VERIFY_BUILD_SHA)
        throw new Error('Unexpected deployed revision');
    });
    config = await (await fetch(`${base}/api/config`)).json();
    if (!process.env.VERIFY_AUTH_EMAIL || !process.env.VERIFY_AUTH_PASSWORD)
      throw new Error('Full-flow verification requires a dedicated test account.');
    let token;
    await check('supabase_login', async () => {
      const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: config.supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: process.env.VERIFY_AUTH_EMAIL,
          password: process.env.VERIFY_AUTH_PASSWORD,
        }),
      });
      if (!response.ok) throw new Error('Test account login failed');
      token = (await response.json()).access_token;
    });
    const api = async (path, body) => {
      const res = await fetch(`${base}/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) throw new Error(`API ${path.split('/')[1]} failed (${res.status})`);
      return res.json();
    };
    let project;
    await check('project_create', async () => {
      project = await api('/projects', {
        input:
          'Create a minimal attractive personal notes app with add/delete notes and atomData persistence. Use English labels.',
        mode: 'build',
        request_id: crypto.randomUUID(),
      });
    });
    let item;
    await check('agent_build_and_delivery', async () => {
      const deadline = Date.now() + 360000;
      while (Date.now() < deadline) {
        item = await api(`/projects/${project.id}`);
        const run = item.runs[0];
        if (run?.status === 'failed' || run?.status === 'interrupted')
          throw new Error('Agent task failed; inspect private task logs');
        if (item.project.current_version_id) return;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      throw new Error('Agent delivery timed out');
    });
    await check('artifact_readback', async () => {
      const artifact = await api(
        `/projects/${project.id}/versions/${item.project.current_version_id}`,
      );
      if (!artifact.html?.includes('<script>') || !Object.keys(artifact.files || {}).length)
        throw new Error('Missing source or preview');
    });
    await check('supabase_records_roundtrip', async () => {
      await api(`/projects/${project.id}/records`, {
        operation: 'put',
        collection: 'verification',
        record_id: 'acceptance',
        data: { verified: true },
      });
      const records = await api(`/projects/${project.id}/records`, {
        operation: 'list',
        collection: 'verification',
      });
      if (!records.some((r) => r.record_id === 'acceptance' && r.data.verified))
        throw new Error('Record readback failed');
      await api(`/projects/${project.id}/records`, {
        operation: 'delete',
        collection: 'verification',
        record_id: 'acceptance',
      });
    });
    report.full_flow = true;
  }
} finally {
  await mkdir('.artifacts', { recursive: true });
  await writeFile('.artifacts/online-verification.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
