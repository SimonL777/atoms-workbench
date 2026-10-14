import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectDetail, Snapshot } from '@atoms/shared';

test('real local Agent completes guided requirements, a notes app and an iteration', async ({
  page,
}) => {
  const fixture = JSON.parse(
    await readFile(
      process.env.AUTH_FIXTURE_PATH || '.runtime/registration-fixture.json',
      'utf8',
    ),
  );
  const publicClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: true },
    },
  );
  const report: {
    checked_at: string;
    full_flow: boolean;
    project_id?: string;
    version_ids: string[];
    checks: string[];
  } = {
    checked_at: new Date().toISOString(),
    full_flow: false,
    version_ids: [],
    checks: [],
  };
  const mark = (name: string) => {
    if (!report.checks.includes(name)) report.checks.push(name);
    console.log(`Verified: ${name}`);
  };
  const apiRoot = 'http://127.0.0.1:8787/api';
  async function api<T>(path: string): Promise<T> {
    const { data } = await publicClient.auth.getSession();
    const response = await fetch(`${apiRoot}${path}`, {
      headers: { Authorization: `Bearer ${data.session?.access_token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Acceptance API request failed (${response.status}).`);
    return response.json();
  }
  const localRoot =
    process.env.PROJECT_FILES_ROOT || join(homedir(), '.local/share/atoms-workbench');
  let projectId: string;
  const item = () => api<ProjectDetail>(`/projects/${projectId}`);
  async function waitFor(predicate: (detail: ProjectDetail) => boolean) {
    const deadline = Date.now() + Number(process.env.RUN_TIMEOUT_MS || 1_800_000) + 60_000;
    while (Date.now() < deadline) {
      const detail = await item();
      if (['failed', 'interrupted', 'cancelled'].includes(detail.runs[0]?.status))
        throw new Error(
          `Agent task ${detail.runs[0].status}; inspect the private project task details.`,
        );
      if (predicate(detail)) return detail;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('Agent stage timed out.');
  }
  try {
    const config = await (await fetch(`${apiRoot}/config`)).json();
    expect(
      config.configured && config.modelReady,
      'Supabase schema and model must be ready',
    ).toBe(true);
    const { data: login, error } = await publicClient.auth.signInWithPassword({
      email: fixture.email,
      password: fixture.password,
    });
    expect(
      !error && !!login.user?.email_confirmed_at,
      'Real confirmed account must log in',
    ).toBe(true);
    if (!process.env.MODEL_BASE_URL || !process.env.MODEL_NAME || !process.env.MODEL_API_KEY)
      throw new Error('Local full-flow acceptance requires model inputs for the test user.');
    const settings = await fetch(`${apiRoot}/model-config`, {
      method: 'PUT',
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${login.session!.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        baseUrl: process.env.MODEL_BASE_URL,
        modelName: process.env.MODEL_NAME,
        apiKey: process.env.MODEL_API_KEY,
      }),
    });
    expect(settings.ok(), 'Test user model must be saved through the authenticated API').toBe(
      true,
    );
    mark('user_model_configured');
    await page.goto('/');
    await page.getByRole('button', { name: '登录 / 注册' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('邮箱', { exact: true }).fill(fixture.email);
    try {
      await modal.getByLabel('密码', { exact: true }).fill(fixture.password);
    } catch {
      throw new Error('Could not fill login password.');
    }
    await modal.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByText('个人账户', { exact: true })).toBeVisible();
    mark('confirmed_account_ui_login');

    if (process.env.LIVE_PROJECT_ID) {
      projectId = process.env.LIVE_PROJECT_ID;
      const saved = await item();
      expect(saved.project.owner_id === fixture.user_id).toBe(true);
      const previous = JSON.parse(await readFile('.artifacts/local-full-flow.json', 'utf8'));
      expect(
        previous.project_id === projectId,
        'Resume only the previously verified project',
      ).toBe(true);
      report.project_id = projectId;
      report.checks = [...new Set<string>(previous.checks)];
      report.version_ids = previous.version_ids;
      console.log(
        'Resuming saved acceptance project; previously completed stages are retained.',
      );
    } else {
      const name = `Acceptance Notes ${randomUUID().slice(0, 8)}`;
      await page
        .getByLabel('项目需求')
        .fill(
          `${name}. Build a small personal notes app. First ask exactly one question about preferred visual style, then prepare the brief after my answer. Requirements are already decided: English labels, one text input labelled Note, a button named Add note, each note has a button with accessible name Delete note, and persisted records in the notes collection through atomData. Keep it small and attractive. No extra features in the first version.`,
        );
      await page.getByRole('button', { name: '需求共创', exact: true }).click();
      const created = page.waitForResponse(
        (res) => res.url().endsWith('/api/projects') && res.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '开始创建项目' }).click();
      const creation = await created;
      expect(creation.ok(), 'Project creation must succeed').toBe(true);
      projectId = (await creation.json()).id;
      report.project_id = projectId;
      let questions = 0;
      const answered = new Set<string>();
      while (true) {
        const detail = await waitFor(
          (d) => d.runs[0]?.status === 'waiting_for_user' || !!d.specs[0],
        );
        if (detail.specs[0]) break;
        const run = detail.runs[0];
        if (++questions > 6 || !run.question || answered.has(run.question.id))
          throw new Error('Clarification did not progress.');
        answered.add(run.question.id);
        const checkpoint = JSON.parse(
          await readFile(
            join(
              localRoot,
              'users',
              fixture.user_id,
              'projects',
              projectId,
              'runs',
              run.id,
              'checkpoint.json',
            ),
            'utf8',
          ),
        );
        expect(
          checkpoint.context.length > 0,
          'Question must have a recoverable local checkpoint',
        ).toBe(true);
        await expect(page.locator('.question-card')).toBeVisible();
        await page
          .getByLabel('对话输入')
          .fill(
            'Use a soft green and cream design. Single user, no categories or sharing. The requirements above are final; use sensible defaults for anything else. Please save the brief now without more questions.',
          );
        const resumed = page.waitForResponse((res) =>
          res.url().endsWith(`/runs/${run.id}/answer`),
        );
        await page.getByRole('button', { name: '发送消息' }).click();
        expect((await resumed).ok(), 'Question answer must resume the same run').toBe(true);
      }
      expect(questions > 0, 'Guided requirements must ask a real question').toBe(true);
      mark('guided_question_local_checkpoint_and_resume');
      await waitFor((d) => d.runs[0]?.status === 'succeeded' && !!d.specs[0]);
      await page.getByRole('button', { name: '确认需求并开始开发' }).click();
    }
    let detail = await waitFor(
      (d) => !!d.project.current_version_id && d.runs[0]?.status === 'succeeded',
    );
    const firstVersion = report.version_ids[0] || detail.project.current_version_id!;
    if (!report.version_ids.includes(firstVersion)) report.version_ids.push(firstVersion);
    expect(detail.specs[0].confirmed_at !== null).toBe(true);
    expect(detail.versions[0].checks.typecheck && detail.versions[0].checks.build).toBe(true);
    mark('requirement_confirmation_model_build_and_first_version');
    // Opening the saved project also recovers from a Vite development-server restart.
    await page
      .locator('.project-list')
      .getByRole('button', { name: detail.project.name, exact: true })
      .click();
    await page.getByRole('button', { name: '预览', exact: true }).click();
    const app = page.frameLocator('iframe[title="应用预览"]');
    const note = `Persisted note ${randomUUID().slice(0, 8)}`;
    await app.getByLabel('Note', { exact: true }).fill(note);
    await app.getByRole('button', { name: 'Add note', exact: true }).click();
    await expect(app.getByText(note, { exact: true })).toBeVisible();
    const { data: records, error: recordsError } = await publicClient
      .from('app_records')
      .select('data')
      .eq('project_id', projectId)
      .eq('collection', 'notes');
    expect(
      !recordsError && !!records?.some((r) => Object.values(r.data).includes(note)),
      'Preview must store a real Supabase record',
    ).toBe(true);
    await page.getByRole('button', { name: '刷新预览' }).click();
    await expect(app.getByText(note, { exact: true })).toBeVisible();
    mark('iframe_interaction_supabase_record_and_preview_refresh');

    if (detail.project.current_version_id === firstVersion) {
      await page
        .getByLabel('对话输入')
        .fill(
          'Add a search text input with accessible label Search notes to filter notes by their text, case-insensitively. Keep all existing records and the Note, Add note and Delete note controls. Keep the current design and do not add other features.',
        );
      const sent = page.waitForResponse((res) =>
        res.url().endsWith(`/projects/${projectId}/messages`),
      );
      await page.getByRole('button', { name: '发送消息' }).click();
      expect((await sent).ok()).toBe(true);
      detail = await waitFor(
        (d) =>
          !!d.project.current_version_id &&
          d.project.current_version_id !== firstVersion &&
          d.runs[0]?.status === 'succeeded',
      );
    }
    const secondVersion = detail.project.current_version_id!;
    if (!report.version_ids.includes(secondVersion)) report.version_ids.push(secondVersion);
    expect(
      detail.versions[0].parent_id === firstVersion,
      'Iteration must use the first version',
    ).toBe(true);
    await expect(app.getByLabel('Search notes', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(app.getByText(note, { exact: true })).toBeVisible();
    await app.getByLabel('Search notes', { exact: true }).fill('no-matching-note-xyz');
    await expect(app.getByText(note, { exact: true })).not.toBeVisible();
    await app.getByLabel('Search notes', { exact: true }).fill('');
    await expect(app.getByText(note, { exact: true })).toBeVisible();
    mark('follow_up_version_preserves_records_and_search_works');

    await page.reload();
    await expect(page.getByText('个人账户', { exact: true })).toBeVisible();
    await page
      .locator('.project-list')
      .getByRole('button', { name: detail.project.name, exact: true })
      .click();
    await expect(app.getByLabel('Search notes', { exact: true })).toBeVisible();
    await expect(app.getByText(note, { exact: true })).toBeVisible();
    mark('page_refresh_restores_login_project_version_and_records');
    await app
      .locator('li')
      .filter({ has: app.getByText(note, { exact: true }) })
      .getByRole('button', { name: 'Delete note', exact: true })
      .click();
    await expect(app.getByText(note, { exact: true })).not.toBeVisible();
    const deleted = await publicClient
      .from('app_records')
      .select('data')
      .eq('project_id', projectId)
      .eq('collection', 'notes');
    expect(
      !deleted.error && !!deleted.data?.every((r) => !Object.values(r.data).includes(note)),
      'Delete must remove the Supabase record',
    ).toBe(true);
    mark('iframe_delete_removes_supabase_record');
    for (const version of report.version_ids) {
      const base = join(
        localRoot,
        'users',
        fixture.user_id,
        'projects',
        projectId,
        'versions',
        version,
      );
      const local = JSON.parse(
        await readFile(join(base, 'snapshot.json'), 'utf8'),
      ) as Snapshot;
      const readback = await api<Snapshot>(`/projects/${projectId}/versions/${version}`);
      expect(
        JSON.stringify(local) === JSON.stringify(readback),
        'API must read the saved local version',
      ).toBe(true);
      expect(
        (await readFile(join(base, 'source', 'src/App.tsx'), 'utf8')) ===
          local.files['src/App.tsx'],
      ).toBe(true);
      expect((await readFile(join(base, 'preview.html'), 'utf8')) === local.html).toBe(true);
      expect((await stat(join(base, 'snapshot.json'))).mode & 0o777).toBe(0o600);
    }
    const { data: projects, error: projectError } = await publicClient
      .from('projects')
      .select('id,current_version_id')
      .eq('id', projectId);
    expect(!projectError && projects?.[0]?.current_version_id === secondVersion).toBe(true);
    expect(detail.versions.every((v) => v.artifact_path.startsWith('local:'))).toBe(true);
    mark('supabase_metadata_and_two_private_local_source_versions');
    await page.locator('.project-panel').screenshot({ path: '.artifacts/live-preview.png' });
    report.full_flow = true;
  } finally {
    await mkdir('.artifacts', { recursive: true });
    await writeFile('.artifacts/local-full-flow.json', JSON.stringify(report, null, 2) + '\n');
    await publicClient.auth.signOut({ scope: 'local' });
  }
});
