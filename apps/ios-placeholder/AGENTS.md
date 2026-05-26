# HappiE SwiftUI iPad Agent Guide

This guide is for agents building the future HappiE iPad app. HappiE is a private family video library for kids, controlled by parents. Do not build a public video platform, social feed, comments, public profiles, sharing, recommendations, or creator tools.

## Product Scope

Build a SwiftUI iPad client for children to watch and download parent-approved videos from the Rust API.

Primary users:

- Parent/admin: signs in, registers the device, selects the child profile, unlocks protected settings with a parent PIN when that API exists.
- Child: browses assigned videos, watches videos, downloads permitted videos for offline use, resumes progress.

The iPad app must not talk directly to Postgres, Redis, R2, MinIO, or Cloudflare. All reads, writes, storage URLs, sync manifests, and auth flows must go through the Rust API.

## Architecture

Use a small, testable SwiftUI architecture:

- `HappiEApp`: app entry, dependency setup.
- `AppState`: signed-in state, selected child profile, registered device, connectivity, sync status.
- `APIClient`: typed HTTP client for the Rust API.
- `AuthStore`: access token, refresh token, expiry handling, Keychain persistence.
- `DeviceStore`: registered device id and selected child id, Keychain or protected app storage.
- `LibraryStore`: assigned videos, asset versions, local file paths, manifest expiry.
- `DownloadManager`: URLSession background downloads, quota enforcement, retry and cleanup.
- `PlaybackViewModel`: AVPlayer state, signed playback URL refresh, watch progress sync.
- `Persistence`: SwiftData or SQLite for video metadata, manifests, download state, and progress.

Prefer clear feature folders:

```text
HappiE/
  App/
  API/
  Auth/
  Device/
  Library/
  Downloads/
  Playback/
  Settings/
  DesignSystem/
  Persistence/
```

## Visual Design

The app should feel calm, legible, and kid-friendly without becoming a toy UI. Parents should trust it; children should navigate it easily.

Use a light theme by default. Avoid dark blue/slate dashboards, purple gradients, beige-heavy palettes, glassmorphism, decorative blobs, or marketing-page hero sections.

Suggested color tokens, aligned with the admin app:

```swift
enum HappiEColor {
    // Use asset catalog colors with these OKLCH targets converted to Display P3 or sRGB.
    // Background: oklch(96% 0.008 235)
    // Panel:      oklch(98% 0.006 235)
    // Ink:        oklch(23% 0.025 235)
    // Muted:      oklch(52% 0.025 235)
    // Accent:     oklch(55% 0.17 170)
    // Warning:    oklch(63% 0.16 55)
}
```

Practical SwiftUI palette names:

- `Background`: softly tinted near-white.
- `Panel`: cards/sheets, very light cool neutral.
- `Ink`: primary text and important icons.
- `Muted`: secondary labels.
- `Accent`: primary actions, selected child, download-ready state.
- `Warning`: parent-only warnings, expired manifests, storage quota warnings.

Use system typography:

- Large title only for top-level child home screens.
- Compact headings inside panels and settings.
- Minimum body size should remain readable for children.
- Do not scale fonts with screen width.

Interaction guidelines:

- Use large, stable video tiles with thumbnail, title, duration, and downloaded state.
- Keep parent controls behind an explicit parent area or PIN unlock.
- Avoid nested cards.
- Use familiar SF Symbols for download, play, pause, refresh, settings, lock, child profile, and storage.
- Do not show technical text to children. Technical errors belong in parent/admin settings.

## Auth Pattern

Current backend supports admin login and refresh tokens:

- `POST /auth/login`
- `POST /auth/refresh`
- `GET /me`

Implementation requirements:

- Store access and refresh tokens in Keychain.
- Treat access tokens as short-lived.
- Refresh automatically on `401` once, then retry the original request.
- If refresh fails, return to parent login.
- Never log tokens, signed URLs, passwords, or refresh token values.
- Do not store parent password.
- Future parent PIN support should unlock local parent controls and, when backend endpoints exist, verify/update `parent_pin_hash` through the API.

Recommended client flow:

1. Parent signs in with email/password.
2. Store `access_token` and `refresh_token` in Keychain.
3. Call `GET /me`.
4. Register or load this iPad device.
5. Select child profile.
6. Sync assigned library.

## API Base URL

Use configurable API environments:

- Local simulator: `http://localhost:18080`
- Local physical iPad: use the Mac LAN IP, for example `http://192.168.1.20:18080`
- Production: HTTPS API origin only.

Do not hardcode production secrets or tokens in the app.

## Core API Endpoints

Use these existing endpoints.

Auth:

- `POST /auth/login`
- `POST /auth/refresh`
- `GET /me`

Children:

- `GET /children`
- `GET /children/:id/library`

Device:

- `POST /devices/register`
- `POST /devices/:id/sync`

Playback and downloads:

- `GET /videos/:id/playback-url`
- `GET /videos/:id/download-manifest`
- `POST /watch-progress`

Uploads/imports/admin-only endpoints exist but should not be exposed to children:

- `POST /uploads/direct` (admin-only, stores optimized MP4 plus thumbnail, not the original)
- `POST /imports/youtube/search`
- `POST /imports/youtube/url`
- `GET /imports/:id`
- `POST /imports/:id/cancel`

## Expected Models

Mirror backend JSON defensively. Dates are ISO 8601 strings.

```swift
struct TokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String
}

struct ChildProfile: Identifiable, Decodable {
    let id: UUID
    let name: String
    let avatarColor: String?
    let birthYear: Int?
    let storageQuotaMb: Int
}

struct SyncManifest: Decodable {
    let deviceId: UUID
    let childProfileId: UUID
    let storageQuotaMb: Int
    let expiresAt: Date
    let videos: [ManifestVideo]
    let remove: [UUID]
}

struct ManifestVideo: Identifiable, Decodable {
    let id: UUID
    let title: String
    let description: String
    let durationSeconds: Int?
    let downloadPriority: DownloadPriority
    let expiresAt: Date?
    let assets: [ManifestAsset]
}

struct ManifestAsset: Identifiable, Decodable {
    let id: UUID
    let kind: AssetKind
    let quality: String?
    let version: Int
    let url: URL
}

enum DownloadPriority: String, Decodable {
    case required
    case normal
    case optional
}

enum AssetKind: String, Decodable {
    case mp4
    case hls
    case thumbnail
}
```

Use `JSONDecoder.keyDecodingStrategy = .convertFromSnakeCase`.

## Device Registration

Register the iPad once per install:

`POST /devices/register`

Request shape:

```json
{
  "child_profile_id": null,
  "name": "Family iPad",
  "platform": "ios",
  "storage_quota_mb": 8192
}
```

Persist returned device id. If the selected child changes, update support may need a backend endpoint later. Until then, register with the selected child profile when possible.

## Child Selection

Parent selects one child profile for the device. Show a parent-facing child picker after login and before the child library.

Acceptance behavior:

- A child sees only videos returned by that child’s library or sync manifest.
- Do not cache or display another child’s videos after switching profiles unless the parent explicitly switches and syncs.
- On switch, reconcile local downloads with the new manifest and remove unassigned files.

## Library Sync

Primary sync endpoint:

`POST /devices/:id/sync`

Use this to get:

- Assigned videos.
- Latest asset versions.
- Short-lived signed download URLs.
- Thumbnail URLs.
- Manifest expiry.
- Remove list.
- Device storage quota metadata.
- Per-video download priority: `required`, `normal`, `optional`.

Sync rules:

- Sync on app launch.
- Sync when app returns to foreground.
- Sync after parent changes selected child.
- Sync before starting offline downloads if the manifest is expired or near expiry.
- Store manifest metadata locally, but treat signed URLs as temporary.
- Never persist signed URLs longer than needed; refresh manifests instead.
- Only download optimized `mp4` video assets and thumbnails. Do not download or retain source/original video files.

## Offline Download Rules

Use `URLSessionConfiguration.background` for resilient downloads.

Download priorities:

- `required`: download automatically when on Wi-Fi and quota permits.
- `normal`: offer download and allow parent setting for auto-download.
- `optional`: stream-first; download only when explicitly requested.

Storage rules:

- Enforce `storageQuotaMb` from the sync manifest.
- Prefer keeping `required` videos, then recent `normal`, then explicitly saved `optional`.
- Remove files listed in `remove`.
- Remove files for expired assignments.
- If an asset version changes, download the new asset before deleting the old one when quota permits.
- Keep thumbnails small and cacheable.

Use file protection appropriate for family media. Avoid iCloud backup for downloaded video files by setting the excluded-from-backup resource value.

## Playback

Use AVKit/AVPlayer.

Online playback:

1. Request `GET /videos/:id/playback-url`.
2. Play the signed URL.
3. If playback fails due to expiry, request a fresh URL and retry once.

Offline playback:

1. Prefer local MP4 asset if downloaded and current version.
2. Fall back to online playback if available.
3. Show a simple unavailable state if offline and not downloaded.

HLS:

- The backend is structured for future HLS assets.
- Implement asset selection so `hls` can be preferred later without rewriting playback.

## Watch Progress

Call `POST /watch-progress`:

- Every 15 to 30 seconds during playback.
- On pause.
- On app background.
- On playback completion.

Request shape:

```json
{
  "child_profile_id": "uuid",
  "video_id": "uuid",
  "device_id": "uuid",
  "position_seconds": 123,
  "completed": false
}
```

Queue progress locally when offline and flush after connectivity returns.

## Parent Area

The child app should include a parent-only area for:

- Login/logout.
- Device registration status.
- Child profile selection.
- Storage quota and downloaded videos.
- Manual sync.
- API environment in debug builds.
- Legal/import note: YouTube imports are user-supplied content controlled in the admin UI; the iPad app must not provide YouTube search/import.

When parent PIN endpoints are implemented, require PIN for parent area access after initial login.

## Error Handling

Child-facing errors should be short and nontechnical:

- “This video is not available offline.”
- “Ask a parent to sync HappiE.”
- “Download needs more space.”

Parent-facing diagnostics can include:

- API status.
- Last sync time.
- Manifest expiry.
- Download failures.
- Device id.

Never show raw tokens, signed URLs, stack traces, or storage keys.

## Testing Expectations

Add tests around:

- Token refresh and retry on `401`.
- JSON decoding for sync manifests.
- Download priority ordering.
- Quota eviction logic.
- Remove-list cleanup.
- Watch progress offline queue.

Use mocked `URLProtocol` or an injected HTTP transport for API tests.

## Current Backend Gaps To Respect

Do not invent client-only behavior that conflicts with the API.

Known follow-ups:

- Dedicated child/device auth may replace admin JWTs for the iPad.
- Parent PIN management endpoints are not implemented yet.
- Device child-profile update endpoint is not implemented yet.
- HLS processing is planned but not active.
- Direct upload processing is basic; upload/import administration belongs in the web admin app.

Build the Swift app so these can be added without rewriting the core client.
