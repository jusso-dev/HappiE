CREATE TABLE video_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'youtube' CHECK (provider IN ('youtube')),
  source_url TEXT NOT NULL,
  cron_schedule TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  auto_approve BOOLEAN NOT NULL DEFAULT true,
  download_priority TEXT NOT NULL DEFAULT 'normal' CHECK (download_priority IN ('required', 'normal', 'optional')),
  max_videos_per_poll INT NOT NULL DEFAULT 10 CHECK (max_videos_per_poll BETWEEN 1 AND 50),
  last_seen_external_id TEXT,
  last_polled_at TIMESTAMPTZ,
  next_poll_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, source_url)
);

CREATE INDEX idx_video_sources_due
  ON video_sources(next_poll_at)
  WHERE enabled = true;

CREATE TABLE video_source_assignments (
  video_source_id UUID NOT NULL REFERENCES video_sources(id) ON DELETE CASCADE,
  child_profile_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  PRIMARY KEY(video_source_id, child_profile_id)
);
