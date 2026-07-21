ALTER TABLE videos
  DROP COLUMN IF EXISTS created_by;

ALTER TABLE import_jobs
  DROP COLUMN IF EXISTS requested_by;

ALTER TABLE devices
  DROP COLUMN IF EXISTS device_token_hash;

ALTER TABLE audit_logs
  DROP COLUMN IF EXISTS actor_user_id,
  ADD COLUMN IF NOT EXISTS actor TEXT NOT NULL DEFAULT 'local_api';

DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
