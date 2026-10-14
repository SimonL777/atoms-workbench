# Atoms Workbench

An open-source agent workspace that turns a conversation into an interactive web app.

**Clarify → plan → write code → build → preview → iterate.**

需求共创、真实代码生成与可交互预览。使用 Supabase 管理注册登录和持久化，复用 Superpowers 的需求访谈与计划流程。

## Features

- Email registration, login, confirmation and password recovery with Supabase Auth.
- Per-user model settings with server-side AES-256-GCM encryption and write-only API keys.
- Guided requirements discovery: one question at a time, free-text answers and optional choices.
- Real agent tools: read/write source, isolated TypeScript/Vite builds, bounded repair and version delivery.
- Conversation, requirement, preview, source and version panels.
- Supabase project metadata and owner-scoped business records for generated apps.
- Local project sources, immutable previews and checkpoints in per-user directories.
- Durable task checkpoints, cancel/retry, per-project serialization and reconnecting event streams.
- GitHub Actions CI, automatic web preview deployment and manual production server deployment.
- Three clearly marked interactive examples that work without cloud credentials.

The examples are prepared fixtures. They do not call a model, use Supabase or imply a successful live deployment.

## Quick start

Requirements: Node.js 22.12+ (24 recommended), npm, Docker for generated project builds.

If Docker Hub times out, see [alternate image sources](docs/docker-network.md).

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:5173`. Without credentials, explore the three example applications.

For real projects:

1. Create a dedicated Supabase project and apply the SQL files in `supabase/migrations/` in filename order. Existing installations only need unapplied migrations.
2. Fill `.env.local` with the Supabase URL, publishable key and server-only service-role key.
3. Generate `MODEL_CONFIG_ENCRYPTION_KEY` once with `openssl rand -base64 32` and store it in `.env.local`. API and Worker must share this server-only key.
4. Add local and production URLs to Supabase Auth's Site URL / Redirect URLs. Enable email confirmation and configure SMTP for your environment.
5. Build the sandbox, then start the Worker:

```bash
docker build -t atoms-sandbox:local deploy/sandbox
npm run worker
```

Sign in, then enter your model Base URL, model ID and API key in **模型配置**. The provider must support OpenAI-compatible `/chat/completions` and tool calling. Each account must configure its own model; there is no fallback to a shared server model. Saving settings does not call the provider. The API key is write-only: leave it blank when editing to retain it, or enter a new key to replace it. You can delete the configuration from this dialog.

The full configuration is encrypted before it reaches `user_model_configs`. Browsers cannot read or write that table directly, including their own ciphertext. Only the authenticated owner's API can return the endpoint/model summary; the API key stays server-side. The master key never belongs in Supabase, Git or `VITE_*` variables. Back it up separately: losing it requires users to re-enter their configuration. HTTPS is required for remote providers, private addresses and redirects are blocked; trusted local installations can explicitly enable `MODEL_ALLOW_PRIVATE_ENDPOINTS=true`.

## Architecture

React/Vite workspace → Node.js API → Supabase Auth/Postgres + local project files.

Supabase stores accounts, conversations, requirement briefs, task state, version metadata and generated-app records. Source files, built previews and model execution checkpoints stay under `PROJECT_FILES_ROOT` (default `~/.local/share/atoms-workbench`), isolated as `users/<user-id>/projects/<project-id>/`. Back up both Postgres and this local directory. API and Worker must share it on the same host; Docker Compose provides a persistent volume.

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

The regular CI browser tests exercise the prepared examples. Configured deployments run real Supabase login, session persistence, logout and registration-form checks with a synthetic confirmed account. Real email signup and confirmation are verified separately with a receiving mailbox. Local full-flow acceptance also calls the model, builds a project, checks preview interactions and verifies an iteration; deployment acceptance does not call a model.

## Skills and license

The Worker loads the pinned Superpowers v7 `brainstorming` or `writing-plans` skill with web-specific tool adapters. It does not install global hooks. Attribution and the original MIT license are included in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

MIT. Independent community project; see the third-party notices for upstream attribution.
