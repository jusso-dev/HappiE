# Docker Notes

## Local development

`docker-compose.yml` builds the `dev` Dockerfile targets with bind-mounted source (hot reload). Local storage is Postgres + MinIO; production can point the same S3-compatible configuration at Cloudflare R2.

MinIO console:

- URL: http://localhost:9001
- User: `minioadmin`
- Password: `minioadmin`

## Homelab deployment (pull-based)

Pushing to `main` triggers `.github/workflows/build-push.yml`, which builds and pushes four amd64 images to GHCR:

- `ghcr.io/jusso-dev/happie-api`
- `ghcr.io/jusso-dev/happie-admin-web`
- `ghcr.io/jusso-dev/happie-import-worker`
- `ghcr.io/jusso-dev/happie-mcp`

Each is tagged `latest` and with the commit SHA.

### One-time GitHub setup

Set the repository **variable** `NEXT_PUBLIC_API_BASE_URL` (Settings → Secrets and variables → Actions → Variables) to the API URL browsers on your network will use, e.g. `http://192.168.1.50:18080`. It is baked into the admin web bundle at build time; without it the admin UI calls `http://localhost:18080`, which only works when browsing from the homelab host itself.

### One-time homelab setup

```sh
# only needed if the GitHub repo is private
docker login ghcr.io -u <github-user>   # password: a PAT with read:packages

# copy docker-compose.prod.yml (and optionally a .env) to the server, then
docker compose -f docker-compose.prod.yml up -d
```

### Updates

Watchtower runs inside the stack, polls GHCR every 5 minutes (override with `WATCHTOWER_INTERVAL_SECONDS`), and pulls + restarts only the labelled Happie services (so Postgres/MinIO are never touched). When adding a service or changing Compose, copy the updated Compose file to the host and run Compose there. Push to `main`, wait for the workflow, and the homelab updates itself. To force an immediate update:

```sh
docker compose -f docker-compose.prod.yml pull happie-api admin-web import-worker happie-mcp
docker compose -f docker-compose.prod.yml up -d
```

### MCP access

The stateless Streamable HTTP endpoint is `http://<host>:18081/mcp`. It has full administrative access and no application authentication, so anyone who can reach the port can use its tools. Do not expose it publicly. Production Compose defaults to loopback; set `MCP_BIND_ADDRESS` to the host's LAN address or use a deployment overlay to bind it on the LAN. Tools cover child profiles, videos and uploads, assignments, imports, YouTube searches and scheduled sources, categories, and storage. Uploads accept base64 content, require substantial client and server memory, and are limited to a 256 MiB JSON request (roughly 192 MiB of file data); `MCP_MAX_REQUEST_BYTES` can override that limit in the MCP service environment. Search is asynchronous: call `youtube_search`, then `get_import` until results are available, then `import_search_results`.
