# Heylo iPad Client Placeholder

The SwiftUI iPad client is intentionally not implemented yet.

Planned flows:

- Device registration: authenticate a parent/admin, call `POST /devices/register`, store the returned device id securely.
- Child selection: fetch authorized child profiles, bind one child profile to the device.
- Library sync: call `POST /devices/:id/sync` to receive assigned videos, latest optimized MP4 asset versions, signed thumbnail/download URLs, expiry, remove list, and quota metadata.
- Playback: call `GET /videos/:id/playback-url` for online playback with short-lived signed URLs.
- Offline: download optimized MP4 assets from the sync manifest before URL expiry and retain only assigned, unexpired videos. Do not store source/original files.
- Progress: periodically call `POST /watch-progress` with child, device, video, position, and completion state.
