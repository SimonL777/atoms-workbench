# Atoms Workbench

An open-source agent workspace that turns a conversation into an interactive web app.

**Clarify → plan → write code → build → preview → iterate.**

需求共创、真实代码生成与可交互预览。使用 Supabase 管理注册登录和持久化，复用 Superpowers 的需求访谈与计划流程。

## Features

- Email registration, login, confirmation and password recovery with Supabase Auth.
- Guided requirements discovery: one question at a time, free-text answers and optional choices.
- Real agent tools: read/write source, isolated TypeScript/Vite builds, bounded repair and version delivery.
- Conversation, requirement, preview, source and version panels.
- Private Supabase project storage and owner-scoped records for generated apps.
- Durable task checkpoints, cancel/retry, per-project serialization and reconnecting event streams.
- GitHub Actions CI, automatic web preview deployment and manual production server deployment.
- Three clearly marked interactive examples that work without cloud credentials.

The examples are prepared fixtures. They do not call a model, use Supabase or imply a successful live deployment.

## Quick start

Requirements: Node.js 22.12+ (24 recommended), npm, Docker for generated project builds.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:5173`. Without credentials, explore the three example applications.

For real projects:

1. Create a dedicated Supabase project and run `supabase/migrations/202610120001_workbench.sql` once.
2. Fill `.env.local` with the Supabase URL, publishable key and server-only service-role key.
3. Set `MODEL_BASE_URL`, `MODEL_API_KEY` and `MODEL_NAME` for a compatible chat-completions model with tool calling.
4. Add local and production URLs to Supabase Auth's Site URL / Redirect URLs. Enable email confirmation and configure SMTP for your environment.
5. Build the sandbox, then start the Worker:

```bash
docker build -t atoms-sandbox:local deploy/sandbox
npm run worker
```

Supabase credentials and model keys belong in local environment files or deployment secrets. Only a Supabase publishable/anon key may reach the browser. The UI reports incomplete configuration explicitly.

## Architecture

React/Vite workspace → Node.js API → Supabase Auth/Postgres/Storage.

A separate Worker calls the model and runs generated React/Vite code in a non-root, resource-limited container with no network or platform credentials. The Worker is trusted and needs Docker access; generated code never gets that access.

Built output is inlined in an opaque-origin `sandbox="allow-scripts allow-forms"` iframe. Generated apps use a narrow `atomData` postMessage bridge for project-scoped records. The bridge checks the iframe source; authenticated owner checks remain on the API. The generated app cannot read the workbench's login session.

Code versions are immutable. Restoring a code version does not roll back business records.

## Verification

```bash
npm run typecheck
npm test
npm run build
node --import tsx scripts/test-sandbox.mjs
npm run test:database
npm run test:e2e
```

See [deployment and live verification](docs/deployment.md) for required server secrets, Auth setup and a real model build check.

The CI browser tests exercise the local example UI. Production verification separately checks Supabase login, actual model execution, build delivery, artifact readback and records persistence. Those are separate evidence boundaries.

## Skills and license

The Worker loads the pinned Superpowers v7 `brainstorming` or `writing-plans` skill with web-specific tool adapters. It does not install global hooks. Attribution and the original MIT license are included in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

MIT. Independent community project; see the third-party notices for upstream attribution.
