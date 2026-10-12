# Deployment and live verification

## Web preview on GitHub Pages

`Deploy web preview` runs after CI succeeds on main. Configure the repository's Pages source as **GitHub Actions**.

The default deployment is the frontend with explicit prepared examples. It is not a production Agent backend. Optional repository variables:

- `VITE_API_URL`: HTTPS URL of your deployed backend.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`: public Auth configuration, useful if the frontend is hosted independently.

Never use service-role, secret or model keys as `VITE_*` variables. Actions validates the production bundle and checks entry asset availability after deployment.

## Full deployment on a Docker server

Use a dedicated Linux server with Docker Compose, at least 2 CPU / 4 GB RAM, ports 80/443 open and a domain pointing to it. The deployment user must be able to use Docker and write `/srv/atoms-workbench` and `/var/lib/atoms-builds`.

Apply the supplied migration to the dedicated Supabase project once before deploying. The workflow does not silently apply database migrations.

Create the `production` GitHub environment. Configure:

| Secret / variable | Purpose |
| --- | --- |
| `DEPLOY_HOST`, `DEPLOY_USER`, optional `DEPLOY_PORT` | SSH destination |
| `DEPLOY_SSH_KEY` | Deployment key; least-privilege server account |
| `DEPLOY_KNOWN_HOSTS` | Verified server host key, not a runtime guessed key |
| `SERVER_ENV` | Multiline server configuration below |
| `VERIFY_AUTH_EMAIL`, `VERIFY_AUTH_PASSWORD` | Dedicated confirmed test account for real acceptance |
| Variable `PRODUCTION_URL` | Public HTTPS application URL |

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
RUN_TIMEOUT_MS=300000
MAX_RUN_STEPS=32
```

Configure the production Site URL and redirect allowlist in Supabase Auth. Registration may require email confirmation. Verify with a dedicated real mailbox and SMTP; a login check alone does not verify email delivery or signup.

Run **Deploy production server** manually. It checks the source, ships the exact Git revision, builds server and sandbox images, starts API/Worker/web, verifies revision and runs a real acceptance task. Its server script can restore the previous release when the initial health check fails. If later functional acceptance fails, inspect the report and explicitly redeploy the known good revision; it does not claim the deployment passed.

The trusted Worker has access to the Docker socket. Its child build containers do not. This deployment model targets a dedicated host; a multi-tenant public service needs stronger workload isolation and abuse controls.

## Live acceptance

```bash
VERIFY_URL=https://your-domain.example npm run verify:online
```

Supply dedicated test account credentials through the environment. The command fails if configuration is incomplete and writes a sanitized report under ignored `.artifacts/`.

Checks: frontend reachability, API readiness/revision, actual Supabase login, real model-created project, container build delivery, private artifact readback and Supabase record write/read/delete.

It creates a synthetic acceptance project and model usage may incur provider charges. No email, password, token, raw model output or internal task logs are printed in the report.

After that, use the browser to verify the actual product loop: registration confirmation, login, a guided question, requirement confirmation, generated app interaction, a follow-up modification and refresh persistence. Record these separately from API checks.
