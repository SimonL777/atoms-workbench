# Deployment and live verification

## Web preview on GitHub Pages

`Deploy web preview` runs after CI succeeds on main. Configure the repository's Pages source as **GitHub Actions**.

The default deployment is the frontend with explicit prepared examples. It is not a production Agent backend. Optional repository variables:

- `VITE_API_URL`: HTTPS URL of your deployed backend.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`: public Auth configuration, useful if the frontend is hosted independently.

Setting `VITE_API_URL` connects the complete workbench to that API: account-owned project lists, conversations, requirement answers, versions, source downloads, previews and follow-up development. `VITE_STATIC_PREVIEW` only enables a fallback when no backend is connected; it does not remove these features. Restrict the API's `APP_ORIGIN` to the frontend origin (for this Pages site: `https://simonl777.github.io`, without the repository path). Add the exact site URL to Supabase Auth's redirect allowlist as well.

The API and Worker must use the same Supabase project and the same project-files directory. To keep existing locally generated projects available, connect to the host that owns their files, or migrate that directory before changing hosts. Publishing the frontend does not upload project source or model credentials. A frontend hosted on HTTPS needs a reachable HTTPS API; a desktop-hosted API requires an HTTPS tunnel and must stay running while the site is used. A persistent server and stable domain are preferable for a lasting deployment.

When a backend URL is configured, deployment verifies its health, public configuration, matching Supabase project and authenticated CORS support. These checks do not call a model or create a project. Online acceptance still tests Auth only; all development features remain available to users.

Never use service-role, secret or model keys as `VITE_*` variables. Set the server-only `AUTH_TEST_SUPABASE_SECRET` repository secret for the dedicated demo project. When Auth variables are configured, Actions creates a synthetic signup account using an admin-generated confirmation link (no mail), confirms it through the public Auth API, tests real UI login/refresh/logout and checks the registration form, then deletes that marked test account. Traces, screenshots and videos are disabled for Auth tests. SMTP delivery and public email signup still require a separate receiving-mailbox check.

## Full deployment on a Docker server

Use a dedicated Linux server with Docker Compose, at least 2 CPU / 4 GB RAM, ports 80/443 open and a domain pointing to it. The deployment user must be able to use Docker and write `/srv/atoms-workbench` and `/var/lib/atoms-builds`.

Apply the supplied migration to the dedicated Supabase project once before deploying. The workflow does not silently apply database migrations.

Create the `production` GitHub environment. Configure:

| Secret / variable                                              | Purpose                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| `DEPLOY_HOST`, `DEPLOY_USER`, optional `DEPLOY_PORT`           | SSH destination                                                      |
| `DEPLOY_SSH_KEY`                                               | Deployment key; least-privilege server account                       |
| `DEPLOY_KNOWN_HOSTS`                                           | Verified server host key, not a runtime guessed key                  |
| `SERVER_ENV`                                                   | Multiline server configuration below                                 |
| `AUTH_TEST_SUPABASE_SECRET`                                    | Server-only demo Supabase key for synthetic Auth acceptance accounts |
| Variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Public Auth configuration for acceptance                             |
| Variable `PRODUCTION_URL`                                      | Public HTTPS application URL                                         |

`SERVER_ENV` must contain:

```dotenv
APP_DOMAIN=your-domain.example
APP_ORIGIN=https://your-domain.example
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MODEL_BASE_URL=
MODEL_API_KEY=
MODEL_NAME=
ALLOW_DEMO=false
RUN_TIMEOUT_MS=1800000
MAX_RUN_STEPS=128
MAX_BUILD_ATTEMPTS=10
BUILD_TIMEOUT_MS=300000
SANDBOX_MEMORY_MB=2048
SANDBOX_CPUS=2
```

Execution defaults are 30 minutes per active task segment, 128 model rounds and 10 builds. Each build has 5 minutes, 2 CPU, 2 GB memory and 512 processes. Waiting for a requirement answer releases the Worker and resets the active-segment timer on resume. Source capacity is 200 files, 500,000 characters per file and 128 MB per local checkpoint/version. All thresholds can be set through the server environment; see `.env.example`. Restart the API and Worker after changing them. Supabase heartbeat expiry still fences stale Workers after 90 seconds; increasing a task's duration does not extend an abandoned lease.

Configure the production Site URL and redirect allowlist in Supabase Auth. Registration may require email confirmation. Verify with a dedicated real mailbox and SMTP; a login check alone does not verify email delivery or signup.

Run **Deploy production server** manually. It checks the source, ships the exact Git revision, builds server and sandbox images, starts API/Worker/web, verifies revision and runs Auth acceptance. Online acceptance does not start model tasks. Its server script can restore the previous release when the initial health check fails. If later functional acceptance fails, inspect the report and explicitly redeploy the known good revision; it does not claim the deployment passed.

API and Worker run with the same UID (1000). A one-shot initialization service owns the project volume and build directory for that UID. The deployment script adds the Docker socket's group to the Worker. For manual Compose use, export `DOCKER_SOCKET_GID=$(stat -c '%g' /var/run/docker.sock)` on Linux. Project versions and checkpoints live in the `project_files` volume; back it up together with Supabase Postgres. Do not remove this volume between deployments.

The trusted Worker has access to the Docker socket. Its child build containers do not. This deployment model targets a dedicated host; a multi-tenant public service needs stronger workload isolation and abuse controls.

## Local full-flow acceptance

```bash
AUTH_FIXTURE_PATH=.runtime/registration-fixture.json npm run test:auth
npm run test:live
```

Start `npm run dev` and `npm run worker` after applying the schema and configuring the model. Use a dedicated confirmed account stored in the ignored, mode-0600 fixture file. The live browser test requires real services and fails when they are not ready. It writes a sanitized report under ignored `.artifacts/` and leaves the generated acceptance project available to inspect.

Checks: UI login, guided question/answer, requirement confirmation, real model-created project, container build, iframe note creation and refresh, follow-up search functionality, Supabase metadata/records and local source/version/checkpoint readback.

It creates an acceptance project and uses the configured model. No email, password, token, raw model output or internal task logs are printed in the report. The optional API-only `VERIFY_URL=http://localhost:5173 npm run verify:online` check uses `VERIFY_AUTH_EMAIL` and `VERIFY_AUTH_PASSWORD` from the environment; it is separate from the UI full-flow test.

Verify real public signup and the confirmation email using a receiving mailbox before deployment. The synthetic CI account confirms API behavior and avoids sending registration mail on every build.
