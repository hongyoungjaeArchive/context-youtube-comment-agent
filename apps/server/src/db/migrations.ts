/** SQLite 스키마 마이그레이션 (docs/08). 순서대로 한 번씩 적용된다. */
export const MIGRATIONS: readonly { readonly version: number; readonly sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE channels (
  channel_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  allowed_for_listing INTEGER NOT NULL DEFAULT 1,
  uploads_playlist_id TEXT
);

CREATE TABLE videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT,
  published_at TEXT NOT NULL,
  view_count INTEGER,
  comment_count INTEGER,
  source TEXT NOT NULL CHECK (source IN ('LIVE','SYNTHETIC')),
  allowed INTEGER NOT NULL,
  fit_json TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX idx_videos_published ON videos(published_at DESC);

CREATE TABLE video_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(video_id),
  meta_hash TEXT NOT NULL,
  source_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (video_id, meta_hash)
);

CREATE TABLE evidence (
  evidence_id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(video_id),
  source_type TEXT NOT NULL CHECK (source_type IN ('TITLE','DESCRIPTION','COMMENT','OPERATOR_QUOTE','TRANSCRIPT')),
  original_excerpt TEXT NOT NULL,
  timestamp_label TEXT,
  verified_by TEXT NOT NULL,
  trust_grade TEXT NOT NULL CHECK (trust_grade IN ('A','B','C','D')),
  text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  removed_at TEXT,
  UNIQUE (video_id, source_type, text_hash)
);
CREATE INDEX idx_evidence_video ON evidence(video_id);

CREATE TABLE brand_facts (
  fact_id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('APPROVED','UNVERIFIED'))
);

CREATE TABLE video_analyses (
  analysis_id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(video_id),
  status TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  evidence_state TEXT NOT NULL,
  core_problem TEXT,
  result_json TEXT,
  model_id TEXT,
  prompt_version TEXT NOT NULL,
  ai_mode TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_analyses_video ON video_analyses(video_id, created_at DESC);

CREATE TABLE comment_candidates (
  candidate_id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES video_analyses(analysis_id),
  strategy TEXT NOT NULL CHECK (strategy IN ('EMPATHY','QUESTION','INFO')),
  rationale TEXT NOT NULL,
  no_fit INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (analysis_id, strategy)
);

CREATE TABLE comment_revisions (
  revision_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES comment_candidates(candidate_id),
  version_no INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  edited_by TEXT NOT NULL CHECK (edited_by IN ('AI','OPERATOR')),
  used_evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (candidate_id, version_no)
);

CREATE TABLE quality_reviews (
  review_id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES comment_revisions(revision_id),
  content_hash TEXT NOT NULL,
  evidence_snapshot_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PASS','FAIL','NEEDS_EVIDENCE')),
  score REAL,
  ratings_json TEXT NOT NULL,
  hard_checks_json TEXT NOT NULL,
  risk_flags_json TEXT NOT NULL,
  improvement TEXT,
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  ai_mode TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_reviews_revision ON quality_reviews(revision_id, created_at DESC);

CREATE TABLE test_targets (
  target_id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  title TEXT,
  owner_channel_id TEXT,
  ownership_verified_at TEXT,
  verification_method TEXT,
  is_fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE browser_profiles (
  profile_id TEXT PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,
  user_data_dir TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  account_label TEXT,
  last_auth_check TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE approvals (
  approval_id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES comment_revisions(revision_id),
  review_id TEXT NOT NULL REFERENCES quality_reviews(review_id),
  content_hash TEXT NOT NULL,
  evidence_snapshot_hash TEXT NOT NULL,
  source_video_id TEXT NOT NULL,
  test_target_id TEXT NOT NULL REFERENCES test_targets(target_id),
  profile_id TEXT NOT NULL REFERENCES browser_profiles(profile_id),
  approved_at TEXT NOT NULL,
  invalidated_at TEXT,
  invalid_reason TEXT
);

CREATE TABLE ai_jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  dependency_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  lease_until TEXT,
  run_after TEXT,
  model_id TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_status ON ai_jobs(status, priority, created_at);

CREATE TABLE ai_job_attempts (
  attempt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ai_jobs(job_id),
  attempt_index INTEGER NOT NULL,
  model_id TEXT,
  error_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE ai_usage (
  usage_id TEXT PRIMARY KEY,
  attempt_id TEXT REFERENCES ai_job_attempts(attempt_id),
  job_type TEXT,
  model_id TEXT NOT NULL,
  ai_mode TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  local_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_usage_date ON ai_usage(local_date);

CREATE TABLE budget_reservations (
  reservation_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  local_date TEXT NOT NULL,
  released_at TEXT
);

CREATE TABLE analysis_cache (
  cache_key TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  data_hash TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE execution_jobs (
  execution_id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL REFERENCES approvals(approval_id),
  target_video_id TEXT NOT NULL,
  source_video_id TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES browser_profiles(profile_id),
  claim_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('REAL_CHROME','FIXTURE')),
  revision_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  verified_at TEXT,
  error_code TEXT,
  error_message TEXT,
  human_resolution TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE posting_claims (
  claim_id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL UNIQUE,
  execution_id TEXT,
  status TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE execution_events (
  event_id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES execution_jobs(execution_id),
  step TEXT NOT NULL,
  result TEXT NOT NULL,
  message TEXT NOT NULL,
  diagnostic_ref TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_exec_events ON execution_events(execution_id, created_at);

CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  execution_id TEXT REFERENCES execution_jobs(execution_id),
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  retention_deadline TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  event_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  metadata_redacted TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_created ON audit_events(created_at DESC);

CREATE TABLE budget_policies (
  policy_id TEXT PRIMARY KEY,
  daily_limit_usd REAL NOT NULL,
  monthly_limit_usd REAL NOT NULL,
  warning_ratio REAL NOT NULL
);

CREATE TABLE daily_usage (
  local_date TEXT PRIMARY KEY,
  submit_attempts_reserved INTEGER NOT NULL DEFAULT 0,
  confirmed_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE eval_runs (
  run_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  prompt_version TEXT,
  ai_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE eval_results (
  result_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES eval_runs(run_id),
  case_id TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  output_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE human_labels (
  label_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  run_id TEXT,
  candidate_strategy TEXT,
  preferred INTEGER NOT NULL DEFAULT 0,
  ratings_json TEXT NOT NULL DEFAULT '{}',
  note TEXT,
  labeler TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `ALTER TABLE ai_usage ADD COLUMN provider TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE ai_usage ADD COLUMN billing TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE ai_usage ADD COLUMN notional_cost REAL NOT NULL DEFAULT 0;`,
  },
  {
    version: 3,
    // 과제 가점 "'연애' 키워드로 뜨기 직전 영상 찾기(초안까지만)": 지정 채널 밖 영상은 초안 전용으로 표시한다.
    sql: `CREATE TABLE trend_videos (
  video_id TEXT PRIMARY KEY REFERENCES videos(video_id),
  keyword TEXT NOT NULL,
  found_at TEXT NOT NULL
);`,
  },
];
