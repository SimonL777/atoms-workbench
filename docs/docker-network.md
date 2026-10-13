# Docker image downloads

If Docker Hub metadata requests time out, use the Docker Official Images published on [Amazon ECR Public](https://www.docker.com/press-release/docker-official-images-available-amazon-elastic-container-registry/). This switches the registry explicitly and requires no Docker daemon restart.

Add these non-secret settings to `.env.local` (or the server's environment file):

```dotenv
SANDBOX_NODE_IMAGE=public.ecr.aws/docker/library/node:24-alpine
SERVER_NODE_IMAGE=public.ecr.aws/docker/library/node:24-bookworm-slim
DOCKER_CLI_IMAGE=public.ecr.aws/docker/library/docker:29-cli
WEB_RUNTIME_IMAGE=public.ecr.aws/docker/library/caddy:2-alpine
```

For Compose, include `--env-file` so these build arguments are interpolated:

```bash
docker compose --env-file .env.local -f deploy/compose.yml build sandbox-image api web
```

For a local Colima Compose Worker, set the socket group from the Linux VM before starting it: `export DOCKER_SOCKET_GID=$(colima ssh -- stat -c '%g' /var/run/docker.sock)`. The production deployment script detects this group on Linux automatically.

For the locally running API/Worker, build the sandbox separately:

```bash
docker build --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:24-alpine -t atoms-sandbox:local deploy/sandbox
```

This ECR namespace includes a path prefix; it is not a drop-in Docker Hub `registry-mirrors` endpoint. If you have a trusted mirror or HTTP proxy, [Colima documents its daemon mirror/proxy settings](https://colima.run/docs/configuration/). That change normally requires restarting Colima; finish or stop active Agent builds first. A host shell proxy alone does not configure the Docker daemon inside Colima. Keep private proxy credentials outside Git and build arguments.

Local sandbox builds have no network access. Once their image is present, every Agent build reuses the installed dependencies without downloading an image or npm packages again.
