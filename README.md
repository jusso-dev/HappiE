# HappiE

<p align="center">
  <img src="docs/assets/happie-app-icon.png" alt="HappiE app icon" width="128" height="128">
</p>

HappiE is a private, parent-controlled family video library for kids. It is not a public YouTube clone. Parents can upload videos, create child profiles, assign approved videos, and prepare an iPad client to stream or download optimized videos for offline viewing.

## Public Release Status

This repository is designed to be safe to publish without local secrets. Keep these rules intact:

- Never commit `.env`, object-storage credentials, database dumps, uploaded media, or local Docker volumes.
- Use `.env.example` as the only committed environment template.
- Treat the Docker Compose defaults as local-development values only.
- Keep the API and admin UI on a trusted LAN. HappiE intentionally has no application-level authentication and must not be exposed to the public internet.

## Architecture

- `services/api`: Rust Axum API. This is the authoritative layer for business rules, storage signing, metadata, imports, and sync.
- `apps/admin-web`: Next.js App Router admin UI. It only calls the HappiE API.
- `apps/import-worker`: TypeScript worker using `yt-dlp` and FFmpeg inside Docker.
- `apps/ios-placeholder`: SwiftUI readiness notes. The iPad app is not implemented yet.
- `infra/migrations`: SQLx Postgres migrations.
- `packages/shared`: shared TypeScript status/priority types.

## Local Setup

```bash
cp .env.example .env
docker compose up --build
```

Services:

- Admin UI: http://localhost:5500
- HappiE API: http://localhost:18080
- OpenAPI docs: http://localhost:18080/docs
- MinIO console: http://localhost:9001 (`minioadmin` / `minioadmin`)

HappiE is LAN-local and does not have a login screen. Open the admin UI directly after the services start. Keep object-storage and database credentials private, and do not commit `.env`.

## Admin Workflows

1. Create one child profile per child at `/children`.
2. Upload a private video at `/videos/new`.
3. Open a video detail page, approve it, and assign it to one or more child profiles.
4. Import user-supplied YouTube content from `/imports/youtube`.
5. Add a trusted YouTube channel or playlist at `/imports/sources` to poll it automatically.
6. Watch import progress at `/imports`.

The admin UI displays a legal warning for YouTube imports: users are responsible for having the right to download, store, and import content, and for complying with platform terms and copyright law.

YouTube search is a review flow. A search first returns video titles, channels, durations, and thumbnails. The parent selects the wanted results, then starts those imports explicitly.

### Trusted video sources

Trusted sources poll a YouTube channel or playlist on a five-field UTC cron schedule. Each poll remembers the newest observed YouTube video ID and queues only unseen uploads. Duplicate checks also prevent a video already in the library or import queue from being added twice.

Automatic approval is explicit per source. Enable it only when every upload from that channel is suitable for the children who receive it. A source can also import approved videos without assigning them, or assign each new video to selected child profiles with a chosen download priority. Pausing or deleting a source does not remove videos already imported.

### Members-only YouTube videos

Members-only videos require cookies from a YouTube account that can play the video in the browser. Any Google account works for public videos, but a members-only video requires that exact account to hold the relevant channel membership. A dedicated account is a sensible choice if you do not want to use a personal account. Do not paste a raw `Cookie` header into the command or commit cookies to this repository.

HappiE intentionally does not collect Google credentials or embed a Google sign-in screen. A Google OAuth token is not a substitute for the authenticated browser session that `yt-dlp` needs for members-only playback. The local, read-only cookie file keeps that session material outside the app database and can be removed at any time to revoke access.

1. Open a single private or incognito browser window and sign in to the entitled YouTube account.
2. In that same tab, open `https://www.youtube.com/robots.txt`.
3. Export only the `youtube.com` cookies in Netscape cookie-file format to `secrets/youtube-cookies.txt`, then close the private window. The first line must be `# Netscape HTTP Cookie File` or `# HTTP Cookie File`.
4. Set this in the local `.env`:

   ```dotenv
   YTDLP_COOKIES_FILE=/run/secrets/happie/youtube-cookies.txt
   ```

5. Recreate the worker so it receives the setting:

   ```bash
   docker compose up -d --build --force-recreate import-worker
   ```

The `secrets` directory is mounted read-only into the worker and ignored by Git. Treat the cookie file like a password. YouTube may invalidate it, in which case repeat the export with a fresh private session. Using an account with `yt-dlp` can also carry account suspension risk, so keep request volume modest.

## Storage

Local development uses MinIO with the same S3-compatible API shape as Cloudflare R2. Production should set:

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_ENDPOINT`

The API stores object keys in Postgres and returns short-lived signed URLs. Raw permanent object storage URLs are not exposed.

For a physical iPad on your LAN, the API and signed storage URLs must be reachable from the device. Set these in `.env` before starting Docker:

```bash
PUBLIC_API_BASE_URL=http://YOUR_LAN_IP:18080
NEXT_PUBLIC_API_BASE_URL=http://YOUR_LAN_IP:18080
R2_ENDPOINT=http://YOUR_LAN_IP:9000
```

## API Notes

Key endpoints:

- `CRUD /children`
- `CRUD /videos`
- `CRUD /categories`
- `POST /videos/:id/assign`
- `DELETE /videos/:id/assign/:childId`
- `GET /children/:id/library`
- `GET /videos/:id/playback-url`
- `GET /videos/:id/download-manifest`
- `POST /devices/register`
- `POST /devices/:id/sync`
- `POST /watch-progress`
- `POST /uploads/direct` (transcodes to optimized MP4 and stores no original)
- `POST /imports/youtube/search`
- `POST /imports/youtube/search/:id/import`
- `POST /imports/youtube/url`
- `CRUD /video-sources`
- `POST /video-sources/:id/poll`
- `GET /imports/:id`
- `POST /imports/:id/cancel`
- `GET /health`

Local import-worker endpoints also operate without credentials:

- `POST /worker/imports/next`
- `POST /worker/imports/:id/status`

## SwiftUI iPad Client

The iPad app lives in the separate `HappiE-App/HappiE` Xcode project. Current client flows:

- Device registration: call `POST /devices/register`.
- Child selection: bind the selected child profile to the device.
- Library sync: call `POST /devices/:id/sync` and persist the manifest.
- Offline downloads: planned next; download signed asset URLs before expiry and remove videos listed in `remove`.
- Playback: use `GET /videos/:id/playback-url` for online streaming.
- Progress sync: planned.

The sync manifest includes assigned videos, optimized MP4 asset versions, signed download URLs, thumbnail assets, file sizes, media dimensions, expiry, device quota metadata, and per-video priority (`required`, `normal`, `optional`). Original source files are not retained for new uploads or imports.

## Media Optimization

New uploads and imports are optimized before storage:

- Stored video asset: H.264 MP4, max 720p by default, AAC audio, fast-start playback.
- Stored image asset: thumbnail/poster.
- Not stored: the source/original video file.
- YouTube imports stream source media through FFmpeg directly into object storage; no source or optimized YouTube video file is written to the worker disk.

Tune defaults with:

- `OPTIMIZED_VIDEO_MAX_HEIGHT` (default `720`)
- `OPTIMIZED_VIDEO_CRF` (default `26`; higher means smaller/lower quality)
- `OPTIMIZED_VIDEO_PRESET` (default `medium`; slower presets reduce size but increase ingestion time)
- `OPTIMIZED_AUDIO_BITRATE` (default `96k`)
- `MAX_CONCURRENT_IMPORTS` (default `2`; number of import jobs processed in parallel)
- `YTDLP_CONCURRENT_FRAGMENTS` (default `4`; parallel fragment downloads per import)

## Development Checks

```bash
cd apps/admin-web && npm run typecheck
cd apps/import-worker && npm run typecheck
cargo check --manifest-path services/api/Cargo.toml
docker compose build
```

Local `cargo` is optional if you use Docker, but it gives faster API checks.

## Local Deployment Boundaries

- No login, bearer token, role gate, or worker token is required. This is intentional for a trusted, offline-first LAN installation.
- Do not publish the API, admin UI, database, or object-storage ports to the public internet.
- API-mediated signed storage URLs.
- Permissive CORS allows the admin UI and local clients to use the API from changing LAN origins without credential headers.
- Audit logs record the `local_api` actor for uploads, imports, edits, assignments, and deletes.
- File type and size validation.

TODO for local product hardening:

- Add parent PIN management endpoints.
- Add HLS generation and adaptive playback.
- Add background processing for direct uploads.
- Add generated typed clients from `/openapi.json`.
- Add offline media download and eviction in the iPad app.
- Add object lifecycle policies and malware scanning for uploads.

## Open Source Hygiene

Before publishing a fork or release:

```bash
find . -name .env -o -name "*.pem" -o -name "*.key" -o -name "*.p12"
rg -n "SECRET|PASSWORD|TOKEN|AWS_|R2_|DATABASE_URL|/Users/|192\\.168\\." -g '!**/node_modules/**' -g '!**/target/**' -g '!**/.next/**'
```

Expected results should be limited to examples, docs, and code reading environment variables.
