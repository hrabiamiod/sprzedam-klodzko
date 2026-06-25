PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'expired', 'archived')),
  moderation_status TEXT NOT NULL DEFAULT 'queued',
  moderation_reason TEXT,
  moderation_score REAL,
  moderation_model TEXT,
  report_count INTEGER NOT NULL DEFAULT 0,
  report_score REAL,
  report_status TEXT,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PLN',
  city TEXT NOT NULL DEFAULT 'Kłodzko',
  contact_name TEXT,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  contact_consent INTEGER NOT NULL DEFAULT 0,
  image_base64 TEXT,
  image_mime TEXT,
  owner_email TEXT NOT NULL,
  owner_email_normalized TEXT NOT NULL,
  owner_token_hash TEXT NOT NULL,
  owner_token_hint TEXT NOT NULL,
  verification_token_hash TEXT,
  approval_token_hash TEXT,
  verification_expires_at TEXT,
  approval_expires_at TEXT,
  verified_at TEXT,
  approved_at TEXT,
  published_at TEXT,
  expires_at TEXT,
  reminder_sent_at TEXT,
  deleted_at TEXT,
  deleted_reason TEXT,
  archived_at TEXT,
  archived_reason TEXT,
  featured_at TEXT,
  featured_until TEXT,
  featured_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_from_ip TEXT,
  updated_from_ip TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listings_status_created_at ON listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_status_expires_at ON listings(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_listings_owner_email ON listings(owner_email_normalized, status);
CREATE INDEX IF NOT EXISTS idx_listings_category_type ON listings(category, type);
CREATE INDEX IF NOT EXISTS idx_listings_featured_until ON listings(featured_until DESC);
CREATE INDEX IF NOT EXISTS idx_listings_slug ON listings(slug);

CREATE TABLE IF NOT EXISTS listing_revisions (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  archived_reason TEXT,
  archived_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listing_revisions_listing_id ON listing_revisions(listing_id, version DESC);

CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  listing_id TEXT REFERENCES listings(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('verify_email', 'approve_publish', 'extend_listing', 'manage_listing', 'delete_listing', 'admin_session')),
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_tokens_listing_purpose ON tokens(listing_id, purpose, used_at, expires_at);

CREATE TABLE IF NOT EXISTS listing_reports (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reporter_email TEXT,
  reporter_ip TEXT,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  ai_flagged INTEGER NOT NULL DEFAULT 0,
  ai_score REAL,
  ai_reason TEXT,
  moderation_job_id TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_listing_reports_listing_id ON listing_reports(listing_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_jobs (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  report_id TEXT REFERENCES listing_reports(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL CHECK(job_type IN ('listing', 'report', 'reminder', 'expiry')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  result_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_jobs_status_run_after ON moderation_jobs(status, run_after);
CREATE INDEX IF NOT EXISTS idx_moderation_jobs_listing_id ON moderation_jobs(listing_id, job_type);

CREATE TABLE IF NOT EXISTS moderation_logs (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES moderation_jobs(id) ON DELETE SET NULL,
  decision TEXT NOT NULL,
  reason TEXT,
  model TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_logs_listing_id ON moderation_logs(listing_id, created_at DESC);

CREATE TABLE IF NOT EXISTS report_logs (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES listing_reports(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  reason TEXT,
  model TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_logs_listing_id ON report_logs(listing_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_logs (
  id TEXT PRIMARY KEY,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  ip_address TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS event_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  listing_id TEXT,
  report_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_logs_created_at ON event_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS listing_archives (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  reason TEXT,
  source TEXT NOT NULL,
  archived_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listing_archives_listing_id ON listing_archives(listing_id, archived_at DESC);

CREATE TABLE IF NOT EXISTS publisher_limits (
  email_normalized TEXT PRIMARY KEY,
  active_listings_count INTEGER NOT NULL DEFAULT 0,
  published_7d_count INTEGER NOT NULL DEFAULT 0,
  published_30d_count INTEGER NOT NULL DEFAULT 0,
  last_published_at TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  mfa_verified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS request_throttle_counters (
  scope TEXT NOT NULL,
  throttle_key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, throttle_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_request_throttle_counters_last_seen_at ON request_throttle_counters(last_seen_at DESC);
