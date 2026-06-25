import {
  buildAbsoluteUrl,
  buildMetaDescription,
  boolFromUnknown,
  CATEGORIES,
  clampText,
  daysFromNow,
  escapeHtml,
  formatMoney,
  getClientIp,
  hashToken,
  hoursFromNow,
  HttpError,
  ipAllowed,
  json,
  LISTING_TYPES,
  listingStateLabel,
  minutesFromNow,
  normalizeEmail,
  normalizePhone,
  normalizeString,
  nowIso,
  parseAllowedIps,
  parseImageData,
  parseListSearchParams,
  randomToken,
  readJsonBody,
  safeFilename,
  sha256Hex,
  signSession,
  slugify,
  text,
  timingSafeEqual,
  toPositiveFloat,
  toPositiveInt,
  toPrettyDate,
  totpVerify,
  verifySession,
  tokenHint
} from './lib';

type ListingRow = {
  id: string;
  slug: string;
  status: string;
  moderation_status: string;
  moderation_reason: string | null;
  moderation_score: number | null;
  moderation_model: string | null;
  report_count: number;
  report_score: number | null;
  report_status: string | null;
  type: string;
  category: string;
  title: string;
  description: string;
  price_cents: number;
  currency: string;
  city: string;
  contact_name: string | null;
  contact_email: string;
  contact_phone: string | null;
  contact_consent: number;
  image_base64: string | null;
  image_mime: string | null;
  owner_email: string;
  owner_email_normalized: string;
  owner_token_hash: string;
  owner_token_hint: string;
  verification_token_hash: string | null;
  approval_token_hash: string | null;
  verification_expires_at: string | null;
  approval_expires_at: string | null;
  verified_at: string | null;
  approved_at: string | null;
  published_at: string | null;
  expires_at: string | null;
  reminder_sent_at: string | null;
  deleted_at: string | null;
  deleted_reason: string | null;
  archived_at: string | null;
  archived_reason: string | null;
  featured_at: string | null;
  featured_until: string | null;
  featured_reason: string | null;
  version: number;
  created_from_ip: string | null;
  updated_from_ip: string | null;
  created_at: string;
  updated_at: string;
};

type TokenRow = {
  id: string;
  listing_id: string | null;
  purpose: string;
  token_hash: string;
  token_hint: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  meta_json: string | null;
};

type AdminSessionRow = {
  id: string;
  token_hash: string;
  username: string;
  ip_address: string;
  mfa_verified_at: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
};

type ListingTimelineItem = {
  kind: 'event' | 'archive' | 'revision';
  label: string;
  source?: string | null;
  reason?: string | null;
  version?: number | null;
  created_at: string;
  details?: unknown;
};

type ModerationResponse = {
  results?: Array<{
    flagged?: boolean;
    categories?: Record<string, boolean>;
    category_scores?: Record<string, number>;
  }>;
};

type Env = {
  DB: D1Database;
  APP_ENV?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODERATION_MODEL?: string;
  NTFY_TOPIC_URL?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  E2E_TURNSTILE_BYPASS_TOKEN?: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  ADMIN_TOTP_SECRET: string;
  ADMIN_ALLOWED_IPS?: string;
  ADMIN_SESSION_SECRET: string;
  ADMIN_SESSION_TTL_HOURS?: string;
  SITE_NAME?: string;
  SITE_BASE_URL?: string;
  PUBLIC_API_BASE_URL?: string;
  MAX_ACTIVE_LISTINGS_PER_EMAIL?: string;
  MAX_LISTINGS_PER_EMAIL_PER_7D?: string;
  MAX_IMAGE_BYTES?: string;
  REPORTS_AUTO_ARCHIVE_THRESHOLD?: string;
  REMINDER_DAYS_BEFORE_EXPIRY?: string;
};

const DEFAULTS = {
  siteName: 'Sprzedam Kłodzko',
  siteBaseUrl: 'https://sprzedam.klodzko.pl',
  apiBaseUrl: '/api',
  moderationModel: 'omni-moderation-latest',
  maxActivePerEmail: 5,
  maxPer7d: 10,
  maxImageBytes: 750_000,
  reportThreshold: 3,
  reminderDays: 3,
  sessionTtlHours: 12
};

function cfg(env: Env) {
  return {
    siteName: env.SITE_NAME || DEFAULTS.siteName,
    siteBaseUrl: env.SITE_BASE_URL || DEFAULTS.siteBaseUrl,
    apiBaseUrl: env.PUBLIC_API_BASE_URL || DEFAULTS.apiBaseUrl,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : '',
    moderationModel: env.OPENAI_MODERATION_MODEL || DEFAULTS.moderationModel,
    maxActivePerEmail: toPositiveInt(env.MAX_ACTIVE_LISTINGS_PER_EMAIL, DEFAULTS.maxActivePerEmail, 1, 100),
    maxPer7d: toPositiveInt(env.MAX_LISTINGS_PER_EMAIL_PER_7D, DEFAULTS.maxPer7d, 1, 100),
    maxImageBytes: toPositiveInt(env.MAX_IMAGE_BYTES, DEFAULTS.maxImageBytes, 50_000, 2_000_000),
    reportThreshold: toPositiveInt(env.REPORTS_AUTO_ARCHIVE_THRESHOLD, DEFAULTS.reportThreshold, 1, 50),
    reminderDays: toPositiveInt(env.REMINDER_DAYS_BEFORE_EXPIRY, DEFAULTS.reminderDays, 1, 30),
    sessionTtlHours: toPositiveInt(env.ADMIN_SESSION_TTL_HOURS, DEFAULTS.sessionTtlHours, 1, 72)
  };
}

function imageUploadJsonLimit(env: Env) {
  return cfg(env).maxImageBytes * 2 + 32_000;
}

function parseJsonSafe(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const THROTTLES = {
  listingCreate: { limit: 5, windowMinutes: 60 },
  reportCreate: { limit: 20, windowMinutes: 60 },
  adminLogin: { limit: 10, windowMinutes: 10 }
} as const;

function corsHeaders(origin = '*') {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, x-requested-with',
    'access-control-max-age': '86400'
  };
}

function baseHeaders(extra: HeadersInit = {}) {
  return new Headers({
    'cache-control': 'no-store',
    ...extra
  });
}

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return json({ ok: false, error: error.message }, { status: error.status });
  }
  console.error(JSON.stringify({ level: 'error', message: 'Unhandled error', error: String(error) }));
  return json({ ok: false, error: 'Wewnętrzny błąd serwera' }, { status: 500 });
}

function withCors(response: Response, origin = '*') {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

function maybeWithCors(request: Request, response: Response) {
  const origin = request.headers.get('origin') || '*';
  return withCors(response, origin);
}

function requestPath(request: Request) {
  return new URL(request.url).pathname;
}

function isApiRoute(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isAdminApiRoute(pathname: string) {
  return pathname.startsWith('/api/admin/');
}

function adminAllowed(request: Request, env: Env) {
  const allowed = parseAllowedIps(env.ADMIN_ALLOWED_IPS);
  return ipAllowed(getClientIp(request), allowed);
}

async function logEvent(env: Env, data: {
  eventType: string;
  actorType: string;
  actorId?: string | null;
  listingId?: string | null;
  reportId?: string | null;
  details?: Record<string, unknown>;
}) {
  await env.DB.prepare(
    `INSERT INTO event_logs (id, event_type, actor_type, actor_id, listing_id, report_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      data.eventType,
      data.actorType,
      data.actorId || null,
      data.listingId || null,
      data.reportId || null,
      data.details ? JSON.stringify(data.details) : null,
      nowIso()
    )
    .run();
}

async function logAdmin(env: Env, data: {
  adminUsername: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ipAddress?: string | null;
  details?: Record<string, unknown>;
}) {
  await env.DB.prepare(
    `INSERT INTO admin_logs (id, admin_username, action, target_type, target_id, ip_address, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      data.adminUsername,
      data.action,
      data.targetType || null,
      data.targetId || null,
      data.ipAddress || null,
      data.details ? JSON.stringify(data.details) : null,
      nowIso()
    )
    .run();
}

async function logModeration(env: Env, data: {
  listingId: string;
  jobId?: string | null;
  decision: string;
  reason?: string | null;
  model?: string | null;
  raw?: unknown;
}) {
  await env.DB.prepare(
    `INSERT INTO moderation_logs (id, listing_id, job_id, decision, reason, model, raw_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      data.listingId,
      data.jobId || null,
      data.decision,
      data.reason || null,
      data.model || null,
      data.raw ? JSON.stringify(data.raw) : null,
      nowIso()
    )
    .run();
}

async function logReport(env: Env, data: {
  reportId: string;
  listingId: string;
  decision: string;
  reason?: string | null;
  model?: string | null;
  raw?: unknown;
}) {
  await env.DB.prepare(
    `INSERT INTO report_logs (id, report_id, listing_id, decision, reason, model, raw_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      data.reportId,
      data.listingId,
      data.decision,
      data.reason || null,
      data.model || null,
      data.raw ? JSON.stringify(data.raw) : null,
      nowIso()
    )
    .run();
}

async function updatePublisherLimits(env: Env, emailNormalized: string) {
  const now = nowIso();
  const since7 = daysFromNow(-7);
  const since30 = daysFromNow(-30);
  const active = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM listings
     WHERE owner_email_normalized = ? AND status = 'approved' AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`
  )
    .bind(emailNormalized, now)
    .first<{ count: number }>();
  const published7d = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM listings
     WHERE owner_email_normalized = ? AND created_at >= ? AND deleted_at IS NULL`
  )
    .bind(emailNormalized, since7)
    .first<{ count: number }>();
  const published30d = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM listings
     WHERE owner_email_normalized = ? AND created_at >= ? AND deleted_at IS NULL`
  )
    .bind(emailNormalized, since30)
    .first<{ count: number }>();

  const existing = await env.DB.prepare(
    `SELECT email_normalized FROM publisher_limits WHERE email_normalized = ?`
  )
    .bind(emailNormalized)
    .first<{ email_normalized: string }>();

  if (existing) {
    await env.DB.prepare(
      `UPDATE publisher_limits
       SET active_listings_count = ?, published_7d_count = ?, published_30d_count = ?, last_published_at = ?, updated_at = ?
       WHERE email_normalized = ?`
    )
      .bind(
        active?.count || 0,
        published7d?.count || 0,
        published30d?.count || 0,
        now,
        now,
        emailNormalized
      )
      .run();
    return;
  }

  await env.DB.prepare(
    `INSERT INTO publisher_limits (email_normalized, active_listings_count, published_7d_count, published_30d_count, last_published_at, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      emailNormalized,
      active?.count || 0,
      published7d?.count || 0,
      published30d?.count || 0,
      now,
      now,
      now
    )
    .run();
}

async function getPublisherLimits(env: Env, emailNormalized: string) {
  return await env.DB.prepare(
    `SELECT * FROM publisher_limits WHERE email_normalized = ?`
  )
    .bind(emailNormalized)
    .first();
}

function throttleWindowStart(windowMinutes: number) {
  const sizeMs = windowMinutes * 60 * 1000;
  return new Date(Math.floor(Date.now() / sizeMs) * sizeMs).toISOString();
}

async function touchThrottle(env: Env, scope: string, key: string, windowMinutes: number) {
  const now = nowIso();
  const windowStart = throttleWindowStart(windowMinutes);
  await env.DB.prepare(
    `INSERT INTO request_throttle_counters (scope, throttle_key, window_start, request_count, last_seen_at, created_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(scope, throttle_key, window_start)
     DO UPDATE SET request_count = request_count + 1, last_seen_at = excluded.last_seen_at`
  )
    .bind(scope, key, windowStart, now, now)
    .run();
  return windowStart;
}

async function checkThrottle(
  env: Env,
  scope: string,
  key: string,
  limit: number,
  windowMinutes: number,
  message: string
) {
  const windowStart = await touchThrottle(env, scope, key, windowMinutes);
  const row = await env.DB.prepare(
    `SELECT request_count AS count FROM request_throttle_counters
     WHERE scope = ? AND throttle_key = ? AND window_start = ? LIMIT 1`
  )
    .bind(scope, key, windowStart)
    .first<{ count: number }>();
  if ((row?.count || 0) > limit) {
    throw new HttpError(429, message);
  }
}

async function pruneThrottleCounters(env: Env) {
  await env.DB.prepare(
    `DELETE FROM request_throttle_counters WHERE last_seen_at < ?`
  )
    .bind(daysFromNow(-7))
    .run();
}

function listingBaseSelect() {
  return `
    id, slug, status, moderation_status, moderation_reason, moderation_score, moderation_model,
    report_count, report_score, report_status, type, category, title, description, price_cents, currency, city,
    contact_name, contact_email, contact_phone, contact_consent, image_base64, image_mime,
    owner_email, owner_email_normalized, owner_token_hash, owner_token_hint, verification_token_hash,
    approval_token_hash, verification_expires_at, approval_expires_at, verified_at, approved_at, published_at,
    expires_at, reminder_sent_at, deleted_at, deleted_reason, archived_at, archived_reason,
    featured_at, featured_until, featured_reason, version,
    created_from_ip, updated_from_ip, created_at, updated_at
  `;
}

async function fetchListingByIdOrSlug(env: Env, value: string) {
  return await env.DB.prepare(`SELECT ${listingBaseSelect()} FROM listings WHERE id = ? OR slug = ? LIMIT 1`)
    .bind(value, value)
    .first<ListingRow>();
}

async function fetchListingByTokenPurpose(env: Env, token: string, purpose: 'manage_listing' | 'extend_listing') {
  const tokenHash = await sha256Hex(token);
  const tokenRow = await env.DB.prepare(
    `SELECT * FROM tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? LIMIT 1`
  )
    .bind(tokenHash, purpose, nowIso())
    .first<TokenRow>();
  if (!tokenRow?.listing_id) return null;
  const listing = await env.DB.prepare(`SELECT ${listingBaseSelect()} FROM listings WHERE id = ? LIMIT 1`)
    .bind(tokenRow.listing_id)
    .first<ListingRow>();
  return { tokenRow, listing };
}

async function fetchListingByOwnerToken(env: Env, token: string) {
  return fetchListingByTokenPurpose(env, token, 'manage_listing');
}

async function createToken(env: Env, listingId: string, purpose: TokenRow['purpose'], ttlHours: number, meta: Record<string, unknown> = {}) {
  const token = randomToken(32);
  const tokenHash = await hashToken(token);
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO tokens (id, listing_id, purpose, token_hash, token_hint, expires_at, used_at, created_at, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      listingId,
      purpose,
      tokenHash,
      tokenHint(token),
      hoursFromNow(ttlHours),
      now,
      Object.keys(meta).length ? JSON.stringify(meta) : null
    )
    .run();
  return token;
}

async function consumeToken(env: Env, token: string, purpose: TokenRow['purpose']) {
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT * FROM tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? LIMIT 1`
  )
    .bind(tokenHash, purpose, nowIso())
    .first<TokenRow>();
  if (!row) return null;
  await env.DB.prepare(`UPDATE tokens SET used_at = ? WHERE id = ?`).bind(nowIso(), row.id).run();
  return row;
}

async function queueModerationJob(env: Env, listingId: string, jobType: 'listing' | 'report' | 'reminder' | 'expiry', payload: Record<string, unknown>, reportId?: string | null) {
  const now = nowIso();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO moderation_jobs (id, listing_id, report_id, job_type, status, attempts, run_after, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`
  )
    .bind(id, listingId, reportId || null, jobType, now, JSON.stringify(payload), now, now)
    .run();
  return id;
}

async function notifyNtfy(env: Env, title: string, message: string) {
  if (!env.NTFY_TOPIC_URL) return;
  const response = await fetch(env.NTFY_TOPIC_URL, {
    method: 'POST',
    headers: {
      title,
      priority: '3'
    },
    body: message
  });
  if (!response.ok) {
    throw new Error(`ntfy error ${response.status}: ${await response.text()}`);
  }
}

async function verifyTurnstileIfConfigured(env: Env, token: string, ipAddress: string) {
  if (!env.TURNSTILE_SECRET_KEY) return;
  if (env.APP_ENV !== 'prod' && env.E2E_TURNSTILE_BYPASS_TOKEN && timingSafeEqual(token, env.E2E_TURNSTILE_BYPASS_TOKEN)) {
    return;
  }
  if (!token) {
    throw new HttpError(400, 'Potwierdź weryfikację anty-bot');
  }

  const form = new FormData();
  form.set('secret', env.TURNSTILE_SECRET_KEY);
  form.set('response', token);
  if (ipAddress) {
    form.set('remoteip', ipAddress);
  }

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form
  });
  if (!response.ok) {
    throw new Error(`Turnstile error ${response.status}: ${await response.text()}`);
  }
  const data = await response.json() as { success?: boolean; 'error-codes'?: string[] };
  if (!data.success) {
    throw new HttpError(403, 'Weryfikacja anty-bot nie powiodła się');
  }
}

async function submitListingModeration(env: Env, listing: ListingRow, jobId?: string | null) {
  const payload = {
    model: env.OPENAI_MODERATION_MODEL || DEFAULTS.moderationModel,
    input: [
      {
        type: 'text',
        text: [
          `Tytuł: ${listing.title}`,
          `Kategoria: ${listing.category}`,
          `Typ: ${listing.type}`,
          `Cena: ${formatMoney(listing.price_cents, listing.currency)}`,
          `Opis: ${listing.description}`,
          `Kontakt: ${listing.contact_email}${listing.contact_phone ? `, ${listing.contact_phone}` : ''}`,
          listing.image_base64 ? 'Obraz: tak' : 'Obraz: nie'
        ].join('\n')
      }
    ]
  };

  if (listing.image_base64) {
    (payload.input as Array<Record<string, unknown>>).push({
      type: 'image_url',
      image_url: { url: `data:${listing.image_mime || 'image/jpeg'};base64,${listing.image_base64}` }
    });
  }

  const response = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`OpenAI moderation error ${response.status}: ${await response.text()}`);
  }
  const data = await response.json() as ModerationResponse;
  const result = data.results?.[0];
  const categories = result?.categories || {};
  const scores = result?.category_scores || {};
  const flagged = Boolean(result?.flagged);
  const maxScore = Math.max(...Object.values(scores).map((value) => Number(value) || 0), 0);
  const decision = flagged || maxScore >= 0.5 ? 'rejected' : 'approved';
  const reason = flagged ? 'OpenAI moderation flagged listing content' : 'Content is acceptable';
  await logModeration(env, {
    listingId: listing.id,
    jobId,
    decision,
    reason,
    model: env.OPENAI_MODERATION_MODEL || DEFAULTS.moderationModel,
    raw: { categories, scores, flagged }
  });
  return {
    decision,
    reason,
    flagged,
    score: maxScore,
    raw: data
  };
}

async function submitReportModeration(
  env: Env,
  listing: ListingRow,
  report: { reason: string; details: string | null },
  reportId: string,
  jobId?: string | null
) {
  const response = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: env.OPENAI_MODERATION_MODEL || DEFAULTS.moderationModel,
      input: [
        {
          type: 'text',
          text: [
            `Zgłoszenie ogłoszenia ${listing.id}`,
            `Powód: ${report.reason}`,
            `Szczegóły: ${report.details || ''}`,
            `Tytuł ogłoszenia: ${listing.title}`,
            `Opis ogłoszenia: ${listing.description}`
          ].join('\n')
        }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`OpenAI report moderation error ${response.status}: ${await response.text()}`);
  }
  const data = await response.json() as ModerationResponse;
  const result = data.results?.[0];
  const scores = result?.category_scores || {};
  const flagged = Boolean(result?.flagged);
  const score = Math.max(...Object.values(scores).map((value) => Number(value) || 0), 0);
  const decision = flagged || score >= 0.5 ? 'archive' : 'keep';
  await logReport(env, {
    reportId,
    listingId: listing.id,
    decision,
    reason: flagged ? 'OpenAI flagged report content' : 'Report content acceptable',
    model: env.OPENAI_MODERATION_MODEL || DEFAULTS.moderationModel,
    raw: { flagged, score, scores }
  });
  return { decision, score, raw: data };
}

function listingToPublicJson(listing: ListingRow) {
  return {
    id: listing.id,
    slug: listing.slug,
    status: listing.status,
    type: listing.type,
    category: listing.category,
    title: listing.title,
    description: listing.description,
    price_cents: listing.price_cents,
    currency: listing.currency,
    city: listing.city,
    contact_name: listing.contact_name,
    contact_email: listing.contact_email,
    contact_phone: listing.contact_phone,
    image_base64: listing.image_base64,
    image_mime: listing.image_mime,
    report_count: listing.report_count,
    is_featured: Boolean(listing.featured_until && new Date(listing.featured_until).getTime() > Date.now()),
    featured_until: listing.featured_until,
    created_at: listing.created_at,
    approved_at: listing.approved_at,
    expires_at: listing.expires_at,
    reminder_sent_at: listing.reminder_sent_at,
    updated_at: listing.updated_at
  };
}

function listingToPublicSummaryJson(listing: ListingRow) {
  const item = listingToPublicJson(listing) as Record<string, unknown>;
  delete item.contact_name;
  delete item.contact_email;
  delete item.contact_phone;
  return item;
}

function listingPublicationStatus(env: Env, listing: ListingRow) {
  const publicUrl = buildAbsoluteUrl(cfg(env).siteBaseUrl, `/ogloszenie/${listing.slug}`);
  if (listing.status === 'approved') {
    return {
      state: 'live',
      label: 'Opublikowane',
      tone: 'ok',
      summary: 'Ogłoszenie jest widoczne publicznie.',
      detail: listing.expires_at ? `Publikacja wygasa ${toPrettyDate(listing.expires_at)}.` : 'Publikacja nie ma ustawionej daty wygaśnięcia.',
      next_steps: ['Możesz udostępnić link publiczny.', 'Możesz edytować ogłoszenie, ale po edycji wróci do moderacji.', 'Przedłuż ogłoszenie przed wygaśnięciem.'],
      public_url: publicUrl,
      can_edit: true,
      can_extend: true
    };
  }
  if (listing.status === 'pending' && !listing.verified_at) {
    return {
      state: 'needs_verification',
      label: 'Wymaga potwierdzenia',
      tone: 'warn',
      summary: 'Ogłoszenie jest zapisane, ale nie trafiło jeszcze do moderacji.',
      detail: 'Użyj linku weryfikacyjnego, który pokazaliśmy po dodaniu ogłoszenia.',
      next_steps: ['Otwórz link weryfikacyjny zapisany po dodaniu ogłoszenia.', 'Po potwierdzeniu ogłoszenie automatycznie trafi do moderacji.'],
      public_url: null,
      can_edit: false,
      can_extend: false
    };
  }
  if (listing.status === 'pending') {
    return {
      state: 'moderation',
      label: 'W moderacji',
      tone: 'warn',
      summary: 'Ogłoszenie czeka na automatyczną lub ręczną moderację.',
      detail: listing.moderation_reason || 'Po akceptacji zostanie opublikowane automatycznie.',
      next_steps: ['Nie musisz nic robić.', 'Odśwież ten ekran za chwilę, żeby sprawdzić wynik.', 'Jeśli edytowałeś ogłoszenie, nowa wersja też przechodzi moderację.'],
      public_url: null,
      can_edit: false,
      can_extend: false
    };
  }
  if (listing.status === 'rejected') {
    return {
      state: 'rejected',
      label: 'Odrzucone',
      tone: 'bad',
      summary: 'Ogłoszenie nie zostało opublikowane.',
      detail: listing.moderation_reason || listing.archived_reason || 'Moderacja odrzuciła treść ogłoszenia.',
      next_steps: ['Sprawdź powód odrzucenia.', 'Dodaj nowe ogłoszenie z poprawioną treścią, jeśli chcesz spróbować ponownie.'],
      public_url: null,
      can_edit: false,
      can_extend: false
    };
  }
  if (listing.status === 'expired') {
    return {
      state: 'expired',
      label: 'Wygasłe',
      tone: 'warn',
      summary: 'Ogłoszenie nie jest już widoczne publicznie.',
      detail: listing.expires_at ? `Wygasło ${toPrettyDate(listing.expires_at)}.` : 'Termin publikacji minął.',
      next_steps: ['Użyj przycisku przedłużenia, jeśli chcesz ponownie opublikować ogłoszenie.'],
      public_url: null,
      can_edit: false,
      can_extend: false
    };
  }
  return {
    state: 'archived',
    label: 'Archiwum',
    tone: 'bad',
    summary: 'Ogłoszenie jest zarchiwizowane i nie jest widoczne publicznie.',
    detail: listing.deleted_reason || listing.archived_reason || 'Ogłoszenie zostało zdjęte z publikacji.',
    next_steps: ['Jeśli chcesz wystawić ofertę ponownie, dodaj nowe ogłoszenie.'],
    public_url: null,
    can_edit: false,
    can_extend: false
  };
}

async function countRecentByEmail(env: Env, emailNormalized: string, days: number) {
  const since = daysFromNow(-days);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM listings WHERE owner_email_normalized = ? AND created_at >= ? AND deleted_at IS NULL`
  )
    .bind(emailNormalized, since)
    .first<{ count: number }>();
  return row?.count || 0;
}

async function countActiveByEmail(env: Env, emailNormalized: string) {
  const now = nowIso();
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM listings WHERE owner_email_normalized = ? AND status = 'approved' AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`
  )
    .bind(emailNormalized, now)
    .first<{ count: number }>();
  return row?.count || 0;
}

async function createArchiveSnapshot(env: Env, listing: ListingRow, reason: string, source: string) {
  const snapshot = JSON.stringify(listing);
  await env.DB.prepare(
    `INSERT INTO listing_archives (id, listing_id, version, snapshot_json, reason, source, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), listing.id, listing.version, snapshot, reason, source, nowIso())
    .run();
}

async function createRevisionSnapshot(env: Env, listing: ListingRow, reason: string) {
  await env.DB.prepare(
    `INSERT INTO listing_revisions (id, listing_id, version, snapshot_json, archived_reason, archived_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), listing.id, listing.version, JSON.stringify(listing), reason, nowIso(), nowIso())
    .run();
}

async function fetchListingTimeline(env: Env, listingId: string, includeSnapshots = false) {
  const events = await env.DB.prepare(
    `SELECT event_type, actor_type, actor_id, details_json, created_at
     FROM event_logs
     WHERE listing_id = ?
     ORDER BY created_at DESC
     LIMIT 60`
  )
    .bind(listingId)
    .all<{ event_type: string; actor_type: string; actor_id: string | null; details_json: string | null; created_at: string }>();

  const timeline: ListingTimelineItem[] = (events.results || []).map((event) => ({
    kind: 'event',
    label: event.event_type,
    source: event.actor_type,
    reason: event.actor_id,
    created_at: event.created_at,
    details: parseJsonSafe(event.details_json)
  }));

  if (includeSnapshots) {
    const [archives, revisions] = await Promise.all([
      env.DB.prepare(
        `SELECT version, reason, source, archived_at
         FROM listing_archives
         WHERE listing_id = ?
         ORDER BY archived_at DESC
         LIMIT 30`
      ).bind(listingId).all<{ version: number; reason: string | null; source: string | null; archived_at: string }>(),
      env.DB.prepare(
        `SELECT version, archived_reason, archived_at, created_at
         FROM listing_revisions
         WHERE listing_id = ?
         ORDER BY created_at DESC
         LIMIT 30`
      ).bind(listingId).all<{ version: number; archived_reason: string | null; archived_at: string; created_at: string }>()
    ]);

    for (const archive of archives.results || []) {
      timeline.push({
        kind: 'archive',
        label: 'snapshot.archived',
        source: archive.source,
        reason: archive.reason,
        version: archive.version,
        created_at: archive.archived_at
      });
    }
    for (const revision of revisions.results || []) {
      timeline.push({
        kind: 'revision',
        label: 'snapshot.revision',
        reason: revision.archived_reason,
        version: revision.version,
        created_at: revision.created_at || revision.archived_at
      });
    }
  }

  return timeline.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function setListingStatus(env: Env, listingId: string, status: ListingRow['status'], extra: Record<string, unknown> = {}) {
  const fields = Object.keys(extra);
  const sql = [`UPDATE listings SET status = ?`];
  const values: unknown[] = [status];
  for (const field of fields) {
    sql.push(`${field} = ?`);
    values.push((extra as Record<string, unknown>)[field]);
  }
  sql.push('updated_at = ?');
  values.push(nowIso());
  sql.push('WHERE id = ?');
  values.push(listingId);
  await env.DB.prepare(sql.join(', ').replace(', WHERE', ' WHERE')).bind(...values).run();
}

async function getAdminSession(request: Request, env: Env) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)sprzedam_admin=([^;]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  const tokenHash = await sha256Hex(`${env.ADMIN_SESSION_SECRET}:${token}`);
  const session = await env.DB.prepare(
    `SELECT * FROM admin_sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1`
  )
    .bind(tokenHash, nowIso())
    .first<AdminSessionRow>();
  if (!session) return null;
  await env.DB.prepare(`UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?`).bind(nowIso(), session.id).run();
  return session;
}

async function requireAdminSession(request: Request, env: Env) {
  if (!adminAllowed(request, env)) {
    throw new HttpError(403, 'Dostęp administracyjny jest ograniczony do dozwolonego IP lub sieci');
  }
  const session = await getAdminSession(request, env);
  if (!session) {
    throw new HttpError(401, 'Wymagane logowanie administratora');
  }
  return session;
}

function setAdminCookie(token: string, ttlHours: number, secure = true) {
  return `sprzedam_admin=${encodeURIComponent(token)}; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Path=/; Max-Age=${ttlHours * 3600}`;
}

async function createAdminSession(env: Env, username: string, ip: string, ttlHours: number) {
  const token = randomToken(48);
  const tokenHash = await sha256Hex(`${env.ADMIN_SESSION_SECRET}:${token}`);
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO admin_sessions (id, token_hash, username, ip_address, mfa_verified_at, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      tokenHash,
      username,
      ip,
      now,
      hoursFromNow(ttlHours),
      now,
      now
    )
    .run();
  return token;
}

async function authenticateAdmin(request: Request, env: Env, body: Record<string, unknown>) {
  if (!adminAllowed(request, env)) {
    throw new HttpError(403, 'Dostęp administracyjny jest ograniczony do dozwolonego IP lub sieci');
  }
  const username = normalizeString(body.username);
  const password = normalizeString(body.password);
  const mfa = normalizeString(body.mfa || body.totp || body.code);
  if (!username || !password || !mfa) {
    throw new HttpError(400, 'Brak wymaganych danych logowania');
  }
  if (!timingSafeEqual(username, env.ADMIN_USERNAME)) {
    throw new HttpError(401, 'Nieprawidłowe dane logowania');
  }
  if (!timingSafeEqual(password, env.ADMIN_PASSWORD)) {
    throw new HttpError(401, 'Nieprawidłowe dane logowania');
  }
  const okMfa = await totpVerify(env.ADMIN_TOTP_SECRET, mfa);
  if (!okMfa) {
    throw new HttpError(401, 'Nieprawidłowy kod MFA');
  }
  const ttlHours = toPositiveInt(env.ADMIN_SESSION_TTL_HOURS, DEFAULTS.sessionTtlHours, 1, 72);
  return createAdminSession(env, username, getClientIp(request), ttlHours);
}

async function markTokenUsed(env: Env, tokenHash: string) {
  await env.DB.prepare(`UPDATE tokens SET used_at = ? WHERE token_hash = ?`).bind(nowIso(), tokenHash).run();
}

async function sendNtFYNewListing(env: Env, listing: ListingRow) {
  await notifyNtfy(env, `Nowe ogłoszenie: ${listing.title}`, `${listing.type} / ${listing.category} / ${formatMoney(listing.price_cents, listing.currency)}`);
}

async function processModerationJobs(env: Env) {
  const jobs = await env.DB.prepare(
    `SELECT * FROM moderation_jobs WHERE status = 'pending' AND run_after <= ? ORDER BY created_at ASC LIMIT 10`
  )
    .bind(nowIso())
    .all<{
      id: string;
      listing_id: string;
      report_id: string | null;
      job_type: string;
      payload_json: string;
      attempts: number;
    }>();

  for (const job of jobs.results || []) {
    await env.DB.prepare(`UPDATE moderation_jobs SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ?`)
      .bind(nowIso(), job.id)
      .run();

    const listing = await env.DB.prepare(`SELECT ${listingBaseSelect()} FROM listings WHERE id = ? LIMIT 1`)
      .bind(job.listing_id)
      .first<ListingRow>();
    if (!listing) {
      await env.DB.prepare(`UPDATE moderation_jobs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`)
        .bind('Listing not found', nowIso(), job.id)
        .run();
      continue;
    }

    try {
      if (job.job_type === 'listing') {
        const result = await submitListingModeration(env, listing, job.id);
        if (result.decision === 'approved') {
          await env.DB.prepare(
            `UPDATE listings
             SET status = 'approved', moderation_status = 'approved', moderation_reason = ?, moderation_score = ?, moderation_model = ?, approved_at = ?, published_at = ?, expires_at = ?, updated_at = ?
             WHERE id = ?`
          )
            .bind(
              result.reason,
              result.score,
              env.OPENAI_MODERATION_MODEL || DEFAULTS.moderationModel,
              nowIso(),
              nowIso(),
              daysFromNow(30),
              nowIso(),
              listing.id
            )
            .run();
          await updatePublisherLimits(env, listing.owner_email_normalized);
          await logEvent(env, { eventType: 'listing.moderation.approved', actorType: 'system', listingId: listing.id, details: { reason: result.reason } });
        } else {
          await createArchiveSnapshot(env, listing, result.reason, 'moderation');
          await env.DB.prepare(
            `UPDATE listings
             SET status = 'rejected', moderation_status = 'rejected', moderation_reason = ?, moderation_score = ?, moderation_model = ?, archived_at = ?, archived_reason = ?, deleted_at = ?, deleted_reason = ?, updated_at = ?
             WHERE id = ?`
          )
            .bind(
              result.reason,
              result.score,
              env.OPENAI_MODERATION_MODEL || DEFAULTS.moderationModel,
              nowIso(),
              result.reason,
              nowIso(),
              result.reason,
              nowIso(),
              listing.id
            )
            .run();
          await logEvent(env, { eventType: 'listing.moderation.rejected', actorType: 'system', listingId: listing.id, details: { reason: result.reason } });
        }
      }

      if (job.job_type === 'report') {
        const report = await env.DB.prepare(`SELECT * FROM listing_reports WHERE id = ? LIMIT 1`)
          .bind(job.report_id)
          .first<{ id: string; reason: string; details: string | null }>();
        if (report) {
          const result = await submitReportModeration(env, listing, { reason: report.reason, details: report.details }, report.id, job.id);
          const shouldArchive = result.decision === 'archive' || listing.report_count >= cfg(env).reportThreshold;
          if (shouldArchive) {
            await createArchiveSnapshot(env, listing, 'Auto-archived after reports', 'report');
            await env.DB.prepare(
              `UPDATE listings
               SET status = 'archived', report_status = 'archived', archived_at = ?, archived_reason = ?, deleted_at = ?, deleted_reason = ?, updated_at = ?
               WHERE id = ?`
            )
              .bind(nowIso(), 'Auto-archived after reports', nowIso(), 'Auto-archived after reports', nowIso(), listing.id)
              .run();
          } else {
            await env.DB.prepare(`UPDATE listings SET report_status = 'reviewed', updated_at = ? WHERE id = ?`)
              .bind(nowIso(), listing.id)
              .run();
          }
          await env.DB.prepare(
            `UPDATE listing_reports SET status = 'processed', processed_at = ?, resolved_at = ?, ai_flagged = ?, ai_score = ?, ai_reason = ? WHERE id = ?`
          )
            .bind(nowIso(), nowIso(), result.decision === 'archive' ? 1 : 0, result.score, result.decision, report.id)
            .run();
          await logEvent(env, { eventType: 'listing.report.processed', actorType: 'system', listingId: listing.id, reportId: report.id, details: { decision: result.decision, score: result.score } });
        }
      }

      if (job.job_type === 'reminder') {
        await env.DB.prepare(`UPDATE listings SET reminder_sent_at = ?, updated_at = ? WHERE id = ?`)
          .bind(nowIso(), nowIso(), listing.id)
          .run();
        await notifyNtfy(env, 'Przypomnienie o wygaśnięciu ogłoszenia', `${listing.title} wygaśnie wkrótce. Sprawdź panel zarządzania lub panel admina.`);
      }

      if (job.job_type === 'expiry') {
        await env.DB.prepare(
          `UPDATE listings SET status = 'expired', updated_at = ?, archived_at = ?, archived_reason = ? WHERE id = ? AND status = 'approved'`
        )
          .bind(nowIso(), nowIso(), 'System expiry', listing.id)
          .run();
      }

      await env.DB.prepare(`UPDATE moderation_jobs SET status = 'done', result_json = ?, updated_at = ? WHERE id = ?`)
        .bind(JSON.stringify({ ok: true }), nowIso(), job.id)
        .run();
    } catch (error) {
      if (job.job_type === 'reminder') {
        await env.DB.prepare(`UPDATE listings SET reminder_sent_at = NULL, updated_at = ? WHERE id = ?`)
          .bind(nowIso(), listing.id)
          .run();
      }
      await env.DB.prepare(
        `UPDATE moderation_jobs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`
      )
        .bind(String(error), nowIso(), job.id)
        .run();
    }
  }
}

async function processExpiryAndReminders(env: Env) {
  const cfgValue = cfg(env);
  const now = nowIso();
  const reminderCutoff = daysFromNow(cfgValue.reminderDays);
  const reminders = await env.DB.prepare(
    `SELECT ${listingBaseSelect()} FROM listings
     WHERE status = 'approved' AND deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ? AND expires_at > ? AND reminder_sent_at IS NULL
     ORDER BY expires_at ASC LIMIT 20`
  )
    .bind(reminderCutoff, now)
    .all<ListingRow>();

  for (const listing of reminders.results || []) {
    await env.DB.prepare(`UPDATE listings SET reminder_sent_at = ?, updated_at = ? WHERE id = ?`)
      .bind(nowIso(), nowIso(), listing.id)
      .run();
    await queueModerationJob(env, listing.id, 'reminder', { listingId: listing.id });
  }

  const expiring = await env.DB.prepare(
    `SELECT ${listingBaseSelect()} FROM listings
     WHERE status = 'approved' AND deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?
     ORDER BY expires_at ASC LIMIT 20`
  )
    .bind(now)
    .all<ListingRow>();

  for (const listing of expiring.results || []) {
    await queueModerationJob(env, listing.id, 'expiry', { listingId: listing.id });
  }
}

async function handlePublicList(request: Request, env: Env) {
  const url = new URL(request.url);
  const { q, category, type, minPriceCents, maxPriceCents, sort, page, limit } = parseListSearchParams(url);
  const featuredOnly = url.searchParams.get('featured') === '1' || url.searchParams.get('featured') === 'true';
  const now = nowIso();
  const offset = (page - 1) * limit;
  const where: string[] = [
    `status = 'approved'`,
    `deleted_at IS NULL`,
    `(expires_at IS NULL OR expires_at > ?)`
  ];
  const binds: unknown[] = [now];
  if (category && CATEGORIES.includes(category as typeof CATEGORIES[number])) {
    where.push('category = ?');
    binds.push(category);
  }
  if (type && LISTING_TYPES.includes(type as typeof LISTING_TYPES[number])) {
    where.push('type = ?');
    binds.push(type);
  }
  if (q) {
    where.push('(LOWER(title) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))');
    binds.push(`%${q}%`, `%${q}%`);
  }
  if (Number.isFinite(minPriceCents)) {
    where.push('price_cents >= ?');
    binds.push(minPriceCents);
  }
  if (Number.isFinite(maxPriceCents)) {
    where.push('price_cents <= ?');
    binds.push(maxPriceCents);
  }
  if (featuredOnly) {
    where.push('featured_until IS NOT NULL AND featured_until > ?');
    binds.push(now);
  }
  const orderBy = {
    newest: 'CASE WHEN featured_until IS NOT NULL AND featured_until > ? THEN 0 ELSE 1 END ASC, featured_until DESC, approved_at DESC, created_at DESC',
    oldest: 'approved_at ASC, created_at ASC',
    price_asc: 'CASE WHEN featured_until IS NOT NULL AND featured_until > ? THEN 0 ELSE 1 END ASC, price_cents ASC, approved_at DESC',
    price_desc: 'CASE WHEN featured_until IS NOT NULL AND featured_until > ? THEN 0 ELSE 1 END ASC, price_cents DESC, approved_at DESC'
  }[sort] || 'approved_at DESC, created_at DESC';
  const orderBinds = orderBy.includes('?') ? [now] : [];
  const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM listings WHERE ${where.join(' AND ')}`).bind(...binds).first<{ count: number }>();
  const rows = await env.DB.prepare(
    `SELECT ${listingBaseSelect()} FROM listings WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  )
    .bind(...binds, ...orderBinds, limit, offset)
    .all<ListingRow>();

  return json({
    ok: true,
    page,
    limit,
    sort,
    total: total?.count || 0,
    items: (rows.results || []).map(listingToPublicSummaryJson)
  });
}

async function handlePublicDetail(env: Env, identifier: string) {
  const listing = await fetchListingByIdOrSlug(env, identifier);
  if (!listing || listing.status !== 'approved' || listing.deleted_at || (listing.expires_at && new Date(listing.expires_at).getTime() <= Date.now())) {
    throw new HttpError(404, 'Ogłoszenie nie zostało znalezione');
  }
  return json({ ok: true, item: listingToPublicJson(listing) });
}

async function handlePublicConfig(env: Env) {
  const cfgValue = cfg(env);
  return json({
    ok: true,
    config: {
      siteName: cfgValue.siteName,
      siteBaseUrl: cfgValue.siteBaseUrl,
      apiBase: cfgValue.apiBaseUrl,
      city: 'Kłodzko',
      turnstileSiteKey: cfgValue.turnstileSiteKey
    }
  });
}

async function handlePublicStats(env: Env) {
  const now = nowIso();
  const activeWhere = `status = 'approved' AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`;
  const [total, categories, types, latest] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM listings WHERE ${activeWhere}`).bind(now).first<{ count: number }>(),
    env.DB.prepare(`SELECT category, COUNT(*) AS count FROM listings WHERE ${activeWhere} GROUP BY category`).bind(now).all<{ category: string; count: number }>(),
    env.DB.prepare(`SELECT type, COUNT(*) AS count FROM listings WHERE ${activeWhere} GROUP BY type`).bind(now).all<{ type: string; count: number }>(),
    env.DB.prepare(`SELECT approved_at, created_at FROM listings WHERE ${activeWhere} ORDER BY approved_at DESC, created_at DESC LIMIT 1`).bind(now).first<{ approved_at: string | null; created_at: string }>()
  ]);

  const byCategory = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  for (const row of categories.results || []) {
    byCategory[row.category] = row.count;
  }
  const byType = Object.fromEntries(LISTING_TYPES.map((type) => [type, 0]));
  for (const row of types.results || []) {
    byType[row.type] = row.count;
  }

  return json({
    ok: true,
    total_active: total?.count || 0,
    by_category: byCategory,
    by_type: byType,
    latest_approved_at: latest?.approved_at || latest?.created_at || null,
    generated_at: now
  });
}

async function handleCreateListing(request: Request, env: Env) {
  const body = await readJsonBody<Record<string, unknown>>(request, imageUploadJsonLimit(env));
  const cfgValue = cfg(env);
  const clientIp = getClientIp(request);
  const title = normalizeString(body.title);
  const description = normalizeString(body.description);
  const category = normalizeString(body.category);
  const type = normalizeString(body.type);
  const contactEmail = normalizeEmail(normalizeString(body.contact_email));
  const contactName = normalizeString(body.contact_name);
  const contactPhone = normalizePhone(normalizeString(body.contact_phone));
  const city = normalizeString(body.city) || 'Kłodzko';
  const consent = boolFromUnknown(body.contact_consent);
  const priceCents = toPositiveInt(body.price_cents ?? Math.round(toPositiveFloat(body.price, 0) * 100), 0, 0, 1_000_000_000);
  const currency = normalizeString(body.currency) || 'PLN';
  const ownerEmail = normalizeEmail(normalizeString(body.owner_email || contactEmail));
  const maxImageBytes = cfgValue.maxImageBytes;
  const image = parseImageData(body.image_data, maxImageBytes);

  if (!title || title.length < 3) throw new HttpError(400, 'Tytuł jest wymagany');
  if (!description || description.length < 20) throw new HttpError(400, 'Opis jest zbyt krótki');
  if (!CATEGORIES.includes(category as typeof CATEGORIES[number])) throw new HttpError(400, 'Nieprawidłowa kategoria');
  if (!LISTING_TYPES.includes(type as typeof LISTING_TYPES[number])) throw new HttpError(400, 'Nieprawidłowy typ ogłoszenia');
  if (!contactEmail || !contactEmail.includes('@')) throw new HttpError(400, 'Nieprawidłowy adres e-mail');
  if (!consent) throw new HttpError(400, 'Wymagana zgoda na przetwarzanie danych osobowych');

  await checkThrottle(
    env,
    'listing.create.ip',
    clientIp,
    THROTTLES.listingCreate.limit,
    THROTTLES.listingCreate.windowMinutes,
    'Zbyt wiele prób dodawania ogłoszeń z tego adresu IP. Spróbuj później.'
  );

  const turnstileToken = normalizeString(body.turnstile_token || body['cf-turnstile-response']);
  await verifyTurnstileIfConfigured(env, turnstileToken, clientIp);

  const activeCount = await countActiveByEmail(env, ownerEmail);
  const recent7d = await countRecentByEmail(env, ownerEmail, 7);
  if (activeCount >= cfgValue.maxActivePerEmail) {
    throw new HttpError(429, 'Przekroczono limit aktywnych ogłoszeń');
  }
  if (recent7d >= cfgValue.maxPer7d) {
    throw new HttpError(429, 'Przekroczono limit ogłoszeń w ostatnich 7 dniach');
  }

  const id = crypto.randomUUID();
  const titleSlug = `${slugify(title)}-${id.slice(0, 8)}`;
  const ownerToken = randomToken(32);
  const verifyToken = randomToken(32);
  const manageToken = randomToken(32);
  const now = nowIso();
  const verificationExpiresAt = hoursFromNow(72);

  await env.DB.prepare(
    `INSERT INTO listings (
      id, slug, status, moderation_status, moderation_reason, moderation_score, moderation_model, report_count, report_score, report_status,
      type, category, title, description, price_cents, currency, city, contact_name, contact_email, contact_phone, contact_consent,
      image_base64, image_mime, owner_email, owner_email_normalized, owner_token_hash, owner_token_hint, verification_token_hash,
      approval_token_hash, verification_expires_at, approval_expires_at, verified_at, approved_at, published_at, expires_at,
      reminder_sent_at, deleted_at, deleted_reason, archived_at, archived_reason, version, created_from_ip, updated_from_ip,
      created_at, updated_at
    ) VALUES (
      ?, ?, 'pending', 'queued', NULL, NULL, NULL, 0, NULL, NULL,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      NULL, ?, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, 1, ?, ?,
      ?, ?
    )`
  )
    .bind(
      id,
      titleSlug,
      type,
      category,
      title,
      description,
      priceCents,
      currency,
      city,
      contactName || null,
      contactEmail,
      contactPhone || null,
      consent ? 1 : 0,
      image?.base64 || null,
      image?.mime || null,
      ownerEmail,
      ownerEmail,
      await sha256Hex(ownerToken),
      tokenHint(ownerToken),
      await hashToken(verifyToken),
      verificationExpiresAt,
      getClientIp(request),
      getClientIp(request),
      now,
      now
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO tokens (id, listing_id, purpose, token_hash, token_hint, expires_at, used_at, created_at, meta_json)
     VALUES (?, ?, 'verify_email', ?, ?, ?, NULL, ?, ?), (?, ?, 'manage_listing', ?, ?, ?, NULL, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      id,
      await hashToken(verifyToken),
      tokenHint(verifyToken),
      verificationExpiresAt,
      now,
      JSON.stringify({ type: 'verify' }),
      crypto.randomUUID(),
      id,
      await hashToken(manageToken),
      tokenHint(manageToken),
      daysFromNow(365),
      now,
      JSON.stringify({ type: 'manage' })
    )
    .run();

  const listingRow = await fetchListingByIdOrSlug(env, id);
  if (!listingRow) throw new HttpError(500, 'Nie udało się utworzyć ogłoszenia');

  await updatePublisherLimits(env, ownerEmail);
  try {
    await sendNtFYNewListing(env, listingRow);
  } catch (error) {
    console.error(JSON.stringify({ level: 'warn', message: 'New listing notification failed', listing_id: listingRow.id, error: String(error) }));
  }
  await logEvent(env, {
    eventType: 'listing.created',
    actorType: 'publisher',
    actorId: ownerEmail,
    listingId: listingRow.id,
    details: { title: listingRow.title, category: listingRow.category, type: listingRow.type }
  });

  const verifyUrl = new URL(`/api/listings/${listingRow.id}/verify?token=${encodeURIComponent(verifyToken)}`, new URL(request.url).origin).toString();
  const manageUrl = buildAbsoluteUrl(cfgValue.siteBaseUrl, `/manage?token=${encodeURIComponent(manageToken)}`);

  return json({
    ok: true,
    message: 'Ogłoszenie dodane. Zapisz link weryfikacyjny i link zarządzania.',
    listing: listingToPublicJson(listingRow),
    links: {
      verify: verifyUrl,
      manage: manageUrl
    }
  }, { status: 201 });
}

async function handleVerifyListing(env: Env, listingId: string, url: URL) {
  const token = url.searchParams.get('token') || '';
  if (!token) throw new HttpError(400, 'Brak tokenu');
  const tokenHash = await hashToken(token);
  const tokenRow = await env.DB.prepare(
    `SELECT * FROM tokens WHERE token_hash = ? AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > ? LIMIT 1`
  )
    .bind(tokenHash, nowIso())
    .first<TokenRow>();
  if (!tokenRow || tokenRow.listing_id !== listingId) {
    throw new HttpError(400, 'Token weryfikacyjny jest nieprawidłowy');
  }
  await markTokenUsed(env, tokenHash);
  await env.DB.prepare(
    `UPDATE listings SET verified_at = ?, moderation_status = 'queued', updated_at = ? WHERE id = ?`
  )
    .bind(nowIso(), nowIso(), listingId)
    .run();
  await queueModerationJob(env, listingId, 'listing', { listingId });
  await logEvent(env, { eventType: 'listing.verified', actorType: 'publisher', listingId, details: { token_hint: tokenRow.token_hint } });
  return json({
    ok: true,
    message: 'Link został potwierdzony. Ogłoszenie trafiło do moderacji.'
  });
}

async function handleApproveListing(env: Env, listingId: string, url: URL) {
  const token = url.searchParams.get('token') || '';
  if (!token) throw new HttpError(400, 'Brak tokenu');
  const tokenHash = await hashToken(token);
  const tokenRow = await env.DB.prepare(
    `SELECT * FROM tokens WHERE token_hash = ? AND purpose = 'approve_publish' AND used_at IS NULL AND expires_at > ? LIMIT 1`
  )
    .bind(tokenHash, nowIso())
    .first<TokenRow>();
  if (!tokenRow || tokenRow.listing_id !== listingId) {
    throw new HttpError(400, 'Token publikacji jest nieprawidłowy');
  }
  const listing = await fetchListingByIdOrSlug(env, listingId);
  if (!listing) throw new HttpError(404, 'Ogłoszenie nie zostało znalezione');
  if (listing.status !== 'pending' || listing.moderation_status !== 'approved') {
    throw new HttpError(409, 'Ogłoszenie nie jest gotowe do publikacji');
  }
  await markTokenUsed(env, tokenHash);
  await env.DB.prepare(
    `UPDATE listings SET status = 'approved', approved_at = ?, published_at = ?, expires_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(nowIso(), nowIso(), daysFromNow(30), nowIso(), listingId)
    .run();
  await updatePublisherLimits(env, listing.owner_email_normalized);
  await logEvent(env, { eventType: 'listing.approved', actorType: 'publisher', listingId, details: { token_hint: tokenRow.token_hint } });
  return json({ ok: true, message: 'Ogłoszenie zostało opublikowane.' });
}

async function handleManageFetch(env: Env, token: string) {
  const managed = await fetchListingByTokenPurpose(env, token, 'manage_listing') || await fetchListingByTokenPurpose(env, token, 'extend_listing');
  if (!managed?.listing) {
    throw new HttpError(404, 'Ogłoszenie nie zostało znalezione');
  }
  const timeline = await fetchListingTimeline(env, managed.listing.id, false);
  return json({
    ok: true,
    token_purpose: managed.tokenRow.purpose,
    listing: listingToPublicJson(managed.listing),
    publication_status: listingPublicationStatus(env, managed.listing),
    timeline
  });
}

async function handleManageUpdate(request: Request, env: Env, token: string) {
  const managed = await fetchListingByOwnerToken(env, token);
  if (!managed?.listing) {
    throw new HttpError(404, 'Ogłoszenie nie zostało znalezione');
  }
  const body = await readJsonBody<Record<string, unknown>>(request, imageUploadJsonLimit(env));
  const listing = managed.listing;
  if (listing.status !== 'approved') {
    throw new HttpError(409, 'Edycja jest dostępna tylko dla zatwierdzonych ogłoszeń');
  }
  const nextTitle = normalizeString(body.title) || listing.title;
  const nextDescription = normalizeString(body.description) || listing.description;
  const nextCategory = normalizeString(body.category) || listing.category;
  const nextType = normalizeString(body.type) || listing.type;
  const nextContactName = normalizeString(body.contact_name) || listing.contact_name || '';
  const nextContactPhone = normalizePhone(normalizeString(body.contact_phone)) || listing.contact_phone || '';
  const nextContactEmail = normalizeEmail(normalizeString(body.contact_email)) || listing.contact_email;
  const nextCity = normalizeString(body.city) || listing.city;
  const nextPrice = toPositiveInt(body.price_cents ?? Math.round(toPositiveFloat(body.price, listing.price_cents / 100) * 100), listing.price_cents, 0, 1_000_000_000);
  const image = body.image_data ? parseImageData(body.image_data, cfg(env).maxImageBytes) : null;

  if (nextTitle.length < 3) throw new HttpError(400, 'Tytuł jest wymagany');
  if (nextDescription.length < 20) throw new HttpError(400, 'Opis jest zbyt krótki');
  if (!CATEGORIES.includes(nextCategory as typeof CATEGORIES[number])) throw new HttpError(400, 'Nieprawidłowa kategoria');
  if (!LISTING_TYPES.includes(nextType as typeof LISTING_TYPES[number])) throw new HttpError(400, 'Nieprawidłowy typ ogłoszenia');

  await createArchiveSnapshot(env, listing, 'Edit before re-moderation', 'edit');
  await createRevisionSnapshot(env, listing, 'Edit before re-moderation');
  const newVersion = listing.version + 1;
  const nextSlug = `${slugify(nextTitle)}-${listing.id.slice(0, 8)}`;
  await env.DB.prepare(
    `UPDATE listings SET
      slug = ?, status = 'pending', moderation_status = 'queued', moderation_reason = NULL, moderation_score = NULL, moderation_model = NULL,
      approval_token_hash = NULL, approval_expires_at = NULL, approved_at = NULL, published_at = NULL, expires_at = NULL, reminder_sent_at = NULL,
      type = ?, category = ?, title = ?, description = ?, price_cents = ?, city = ?, contact_name = ?, contact_email = ?, contact_phone = ?,
      image_base64 = COALESCE(?, image_base64), image_mime = COALESCE(?, image_mime), version = ?, updated_from_ip = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      nextSlug,
      nextType,
      nextCategory,
      nextTitle,
      nextDescription,
      nextPrice,
      nextCity,
      nextContactName || null,
      nextContactEmail,
      nextContactPhone || null,
      image?.base64 || null,
      image?.mime || null,
      newVersion,
      getClientIp(request),
      nowIso(),
      listing.id
    )
    .run();

  await queueModerationJob(env, listing.id, 'listing', { listingId: listing.id, edited: true, version: newVersion });
  await logEvent(env, { eventType: 'listing.updated', actorType: 'publisher', listingId: listing.id, details: { version: newVersion } });
  return json({ ok: true, message: 'Ogłoszenie zapisane i ponownie skierowane do moderacji.' });
}

async function handleManageDelete(request: Request, env: Env, token: string) {
  const managed = await fetchListingByOwnerToken(env, token);
  if (!managed?.listing) {
    throw new HttpError(404, 'Ogłoszenie nie zostało znalezione');
  }
  const listing = managed.listing;
  await createArchiveSnapshot(env, listing, 'Deleted by owner token', 'delete');
  await env.DB.prepare(
    `UPDATE listings SET status = 'archived', deleted_at = ?, deleted_reason = ?, archived_at = ?, archived_reason = ?, updated_at = ? WHERE id = ?`
  )
    .bind(nowIso(), 'Deleted by owner', nowIso(), 'Deleted by owner', nowIso(), listing.id)
    .run();
  await logEvent(env, { eventType: 'listing.deleted', actorType: 'publisher', listingId: listing.id });
  return json({ ok: true, message: 'Ogłoszenie zostało usunięte.' });
}

async function handleManageExtend(env: Env, token: string) {
  const managed = await fetchListingByTokenPurpose(env, token, 'manage_listing') || await fetchListingByTokenPurpose(env, token, 'extend_listing');
  if (!managed?.listing) {
    throw new HttpError(404, 'Ogłoszenie nie zostało znalezione');
  }
  const listing = managed.listing;
  if (listing.status !== 'approved') {
    throw new HttpError(409, 'Przedłużenie jest dostępne tylko dla aktywnych ogłoszeń');
  }
  if (managed.tokenRow.purpose === 'extend_listing') {
    await consumeToken(env, token, 'extend_listing');
  }
  const expiresAt = listing.expires_at && new Date(listing.expires_at).getTime() > Date.now()
    ? daysFromNow(30)
    : daysFromNow(30);
  await env.DB.prepare(`UPDATE listings SET expires_at = ?, reminder_sent_at = NULL, updated_at = ? WHERE id = ?`)
    .bind(expiresAt, nowIso(), listing.id)
    .run();
  await updatePublisherLimits(env, listing.owner_email_normalized);
  await logEvent(env, { eventType: 'listing.extended', actorType: 'publisher', listingId: listing.id, details: { expiresAt } });
  return json({ ok: true, message: 'Ogłoszenie zostało przedłużone o 30 dni.', expires_at: expiresAt });
}

async function handleReportListing(request: Request, env: Env, listingId: string) {
  const listing = await fetchListingByIdOrSlug(env, listingId);
  if (!listing || listing.status !== 'approved') {
    throw new HttpError(404, 'Ogłoszenie nie zostało znalezione');
  }
  const body = await readJsonBody<Record<string, unknown>>(request);
  const clientIp = getClientIp(request);
  const reason = normalizeString(body.reason);
  const details = normalizeString(body.details);
  if (!reason) {
    throw new HttpError(400, 'Powód zgłoszenia jest wymagany');
  }
  await checkThrottle(
    env,
    'report.create.ip',
    clientIp,
    THROTTLES.reportCreate.limit,
    THROTTLES.reportCreate.windowMinutes,
    'Zbyt wiele zgłoszeń z tego adresu IP. Spróbuj później.'
  );
  const turnstileToken = normalizeString(body.turnstile_token || body['cf-turnstile-response']);
  await verifyTurnstileIfConfigured(env, turnstileToken, clientIp);
  const reportId = crypto.randomUUID();
  const jobId = await queueModerationJob(env, listing.id, 'report', { reason, details }, reportId);
  await env.DB.prepare(
    `INSERT INTO listing_reports (id, listing_id, reporter_email, reporter_ip, reason, details, status, moderation_job_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  )
    .bind(reportId, listing.id, normalizeEmail(normalizeString(body.reporter_email)) || null, getClientIp(request), reason, details || null, jobId, nowIso())
    .run();
  await env.DB.prepare(`UPDATE listings SET report_count = report_count + 1, report_status = 'pending', updated_at = ? WHERE id = ?`)
    .bind(nowIso(), listing.id)
    .run();
  await logEvent(env, { eventType: 'listing.reported', actorType: 'visitor', listingId: listing.id, reportId, details: { reason } });
  await notifyNtfy(env, 'Nowe zgłoszenie ogłoszenia', `${listing.title} - ${reason}`);
  return json({ ok: true, message: 'Zgłoszenie zostało przyjęte do analizy.' }, { status: 202 });
}

async function handleAdminLogin(request: Request, env: Env) {
  const body = await readJsonBody<Record<string, unknown>>(request);
  await checkThrottle(
    env,
    'admin.login.ip',
    getClientIp(request),
    THROTTLES.adminLogin.limit,
    THROTTLES.adminLogin.windowMinutes,
    'Zbyt wiele prób logowania. Spróbuj ponownie później.'
  );
  const token = await authenticateAdmin(request, env, body);
  const ttlHours = toPositiveInt(env.ADMIN_SESSION_TTL_HOURS, DEFAULTS.sessionTtlHours, 1, 72);
  return json({ ok: true, message: 'Zalogowano.' }, {
    headers: {
      'set-cookie': setAdminCookie(token, ttlHours, new URL(request.url).protocol === 'https:')
    }
  });
}

async function handleAdminLogout(request: Request, env: Env) {
  const session = await getAdminSession(request, env);
  if (session) {
    await env.DB.prepare(`DELETE FROM admin_sessions WHERE id = ?`).bind(session.id).run();
  }
  return json({ ok: true }, {
    headers: {
      'set-cookie': `sprzedam_admin=; HttpOnly;${new URL(request.url).protocol === 'https:' ? ' Secure;' : ''} SameSite=Lax; Path=/; Max-Age=0`
    }
  });
}

async function adminDashboard(env: Env) {
  const [pending, reports, totals, active] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM listings WHERE status = 'pending' AND deleted_at IS NULL`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM listing_reports WHERE status = 'pending'`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM listings WHERE deleted_at IS NULL`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM listings WHERE status = 'approved' AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`).bind(nowIso()).first<{ count: number }>()
  ]);
  const rejected = await env.DB.prepare(`SELECT COUNT(*) AS count FROM listings WHERE status = 'rejected'`).first<{ count: number }>();
  const users = await env.DB.prepare(`SELECT COUNT(*) AS count FROM publisher_limits`).first<{ count: number }>();
  return {
    pending: pending?.count || 0,
    reports: reports?.count || 0,
    total_listings: totals?.count || 0,
    active_listings: active?.count || 0,
    rejected: rejected?.count || 0,
    users: users?.count || 0
  };
}

async function handleAdminDashboard(request: Request, env: Env) {
  const session = await requireAdminSession(request, env);
  const data = await adminDashboard(env);
  await logAdmin(env, { adminUsername: session.username, action: 'dashboard.view', ipAddress: getClientIp(request) });
  return json({ ok: true, data });
}

async function handleAdminListings(request: Request, env: Env) {
  const session = await requireAdminSession(request, env);
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '25', 10) || 25));
  const clauses = ['1=1'];
  const binds: unknown[] = [];
  if (status) {
    clauses.push('status = ?');
    binds.push(status);
  }
  const rows = await env.DB.prepare(
    `SELECT ${listingBaseSelect()} FROM listings WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  )
    .bind(...binds, limit)
    .all<ListingRow>();
  await logAdmin(env, { adminUsername: session.username, action: 'listings.list', ipAddress: getClientIp(request), details: { status } });
  return json({ ok: true, items: (rows.results || []).map((listing) => ({
    ...listingToPublicJson(listing),
    moderation_reason: listing.moderation_reason,
    moderation_status: listing.moderation_status,
    version: listing.version
  })) });
}

async function handleAdminListingHistory(request: Request, env: Env, listingId: string) {
  const session = await requireAdminSession(request, env);
  const listing = await fetchListingByIdOrSlug(env, listingId);
  if (!listing) throw new HttpError(404, 'Ogłoszenie nie zostało znalezione');
  const timeline = await fetchListingTimeline(env, listing.id, true);
  await logAdmin(env, {
    adminUsername: session.username,
    action: 'listing.history',
    targetType: 'listing',
    targetId: listing.id,
    ipAddress: getClientIp(request)
  });
  return json({
    ok: true,
    listing: {
      ...listingToPublicJson(listing),
      moderation_reason: listing.moderation_reason,
      moderation_status: listing.moderation_status,
      version: listing.version,
      owner_email_normalized: listing.owner_email_normalized
    },
    timeline
  });
}

async function handleAdminReports(request: Request, env: Env) {
  const session = await requireAdminSession(request, env);
  const rows = await env.DB.prepare(
    `SELECT
       r.*,
       l.title,
       l.slug,
       l.status AS listing_status,
       l.report_count AS listing_report_count,
       l.report_status AS listing_report_status,
       l.moderation_reason AS listing_moderation_reason,
       l.contact_email AS listing_contact_email
     FROM listing_reports r
     JOIN listings l ON l.id = r.listing_id
     ORDER BY
       CASE r.status WHEN 'pending' THEN 0 WHEN 'processed' THEN 1 ELSE 2 END,
       r.created_at DESC
     LIMIT 100`
  ).all();
  await logAdmin(env, { adminUsername: session.username, action: 'reports.list', ipAddress: getClientIp(request) });
  return json({ ok: true, items: rows.results || [] });
}

async function handleAdminLogs(request: Request, env: Env) {
  const session = await requireAdminSession(request, env);
  const rows = await env.DB.prepare(
    `SELECT * FROM event_logs ORDER BY created_at DESC LIMIT 100`
  ).all();
  await logAdmin(env, { adminUsername: session.username, action: 'logs.list', ipAddress: getClientIp(request) });
  return json({ ok: true, items: rows.results || [] });
}

async function handleAdminUsers(request: Request, env: Env) {
  const session = await requireAdminSession(request, env);
  const rows = await env.DB.prepare(
    `SELECT * FROM publisher_limits ORDER BY updated_at DESC LIMIT 100`
  ).all();
  await logAdmin(env, { adminUsername: session.username, action: 'users.list', ipAddress: getClientIp(request) });
  return json({ ok: true, items: rows.results || [] });
}

async function handleAdminSystem(request: Request, env: Env) {
  const session = await requireAdminSession(request, env);
  const cfgValue = cfg(env);
  const now = nowIso();
  const [
    pendingListings,
    activeListings,
    pendingReports,
    pendingJobs,
    failedJobs,
    activeSessions,
    latestEvent,
    latestAdminLog
  ] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM listings WHERE status = 'pending' AND deleted_at IS NULL`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM listings WHERE status = 'approved' AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`).bind(now).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM listing_reports WHERE status = 'pending'`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM moderation_jobs WHERE status IN ('pending', 'processing')`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM moderation_jobs WHERE status = 'failed'`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM admin_sessions WHERE expires_at > ?`).bind(now).first<{ count: number }>(),
    env.DB.prepare(`SELECT event_type, created_at FROM event_logs ORDER BY created_at DESC LIMIT 1`).first<{ event_type: string; created_at: string }>(),
    env.DB.prepare(`SELECT action, created_at FROM admin_logs ORDER BY created_at DESC LIMIT 1`).first<{ action: string; created_at: string }>()
  ]);
  const checks = [
    {
      key: 'site',
      label: 'Publiczna domena',
      status: cfgValue.siteBaseUrl.startsWith('https://') ? 'ok' : 'bad',
      detail: cfgValue.siteBaseUrl
    },
    {
      key: 'api',
      label: 'API pod tą samą domeną',
      status: cfgValue.apiBaseUrl === '/api' ? 'ok' : 'warn',
      detail: cfgValue.apiBaseUrl
    },
    {
      key: 'turnstile',
      label: 'Turnstile',
      status: env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? 'ok' : 'bad',
      detail: env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? 'skonfigurowany' : 'brakuje site key albo secret key'
    },
    {
      key: 'moderation',
      label: 'Moderacja OpenAI',
      status: env.OPENAI_API_KEY ? 'ok' : 'warn',
      detail: env.OPENAI_API_KEY ? cfgValue.moderationModel : 'brak OPENAI_API_KEY'
    },
    {
      key: 'ntfy',
      label: 'Powiadomienia ntfy',
      status: env.NTFY_TOPIC_URL ? 'ok' : 'warn',
      detail: env.NTFY_TOPIC_URL ? 'skonfigurowane' : 'brak NTFY_TOPIC_URL'
    },
    {
      key: 'admin_mfa',
      label: 'Admin MFA/TOTP',
      status: env.ADMIN_TOTP_SECRET ? 'ok' : 'bad',
      detail: env.ADMIN_TOTP_SECRET ? 'wymagane przy logowaniu' : 'brak ADMIN_TOTP_SECRET'
    },
    {
      key: 'admin_session',
      label: 'Sekret sesji admina',
      status: env.ADMIN_SESSION_SECRET ? 'ok' : 'bad',
      detail: env.ADMIN_SESSION_SECRET ? `TTL ${cfgValue.sessionTtlHours}h` : 'brak ADMIN_SESSION_SECRET'
    },
    {
      key: 'admin_allowlist',
      label: 'Allowlista IP admina',
      status: env.ADMIN_ALLOWED_IPS ? 'ok' : 'bad',
      detail: env.ADMIN_ALLOWED_IPS ? 'aktywna' : 'brak ADMIN_ALLOWED_IPS'
    },
    {
      key: 'cron',
      label: 'Cron produkcyjny',
      status: env.APP_ENV === 'prod' ? 'ok' : 'warn',
      detail: env.APP_ENV === 'prod' ? 'prod: 0 * * * *' : `środowisko: ${env.APP_ENV || 'unknown'}`
    }
  ];
  await logAdmin(env, { adminUsername: session.username, action: 'system.view', ipAddress: getClientIp(request) });
  return json({
    ok: true,
    generated_at: now,
    environment: env.APP_ENV || 'unknown',
    config: {
      siteName: cfgValue.siteName,
      siteBaseUrl: cfgValue.siteBaseUrl,
      apiBaseUrl: cfgValue.apiBaseUrl,
      moderationModel: cfgValue.moderationModel,
      maxActivePerEmail: cfgValue.maxActivePerEmail,
      maxPer7d: cfgValue.maxPer7d,
      maxImageBytes: cfgValue.maxImageBytes,
      reportThreshold: cfgValue.reportThreshold,
      reminderDays: cfgValue.reminderDays,
      sessionTtlHours: cfgValue.sessionTtlHours,
      throttles: THROTTLES
    },
    checks,
    operations: {
      pendingListings: pendingListings?.count || 0,
      activeListings: activeListings?.count || 0,
      pendingReports: pendingReports?.count || 0,
      pendingJobs: pendingJobs?.count || 0,
      failedJobs: failedJobs?.count || 0,
      activeAdminSessions: activeSessions?.count || 0,
      latestEvent: latestEvent || null,
      latestAdminLog: latestAdminLog || null
    }
  });
}

async function handleAdminSessions(request: Request, env: Env) {
  const session = await requireAdminSession(request, env);
  const rows = await env.DB.prepare(
    `SELECT id, username, ip_address, mfa_verified_at, expires_at, created_at, last_seen_at
     FROM admin_sessions
     WHERE expires_at > ?
     ORDER BY last_seen_at DESC
     LIMIT 50`
  )
    .bind(nowIso())
    .all<Omit<AdminSessionRow, 'token_hash'>>();
  await logAdmin(env, { adminUsername: session.username, action: 'sessions.list', ipAddress: getClientIp(request) });
  return json({
    ok: true,
    items: (rows.results || []).map((row) => ({
      ...row,
      current: row.id === session.id
    }))
  });
}

async function handleAdminRevokeSession(request: Request, env: Env, sessionId: string) {
  const session = await requireAdminSession(request, env);
  if (!sessionId) throw new HttpError(400, 'Brak identyfikatora sesji');
  await env.DB.prepare(`DELETE FROM admin_sessions WHERE id = ?`).bind(sessionId).run();
  const revokedCurrent = sessionId === session.id;
  await logAdmin(env, {
    adminUsername: session.username,
    action: 'session.revoke',
    targetType: 'admin_session',
    targetId: sessionId,
    ipAddress: getClientIp(request),
    details: { revoked_current: revokedCurrent }
  });
  return json({ ok: true, message: 'Sesja została wygaszona.', revoked_current: revokedCurrent });
}

async function handleAdminAction(request: Request, env: Env, listingId: string) {
  const session = await requireAdminSession(request, env);
  const body = await readJsonBody<Record<string, unknown>>(request);
  const action = normalizeString(body.action);
  const reason = normalizeString(body.reason) || 'Admin action';
  const listing = await fetchListingByIdOrSlug(env, listingId);
  if (!listing) throw new HttpError(404, 'Ogłoszenie nie zostało znalezione');

  if (action === 'approve') {
    await env.DB.prepare(`UPDATE listings SET status = 'approved', moderation_status = 'approved', approved_at = ?, published_at = ?, expires_at = ?, updated_at = ? WHERE id = ?`)
      .bind(nowIso(), nowIso(), daysFromNow(30), nowIso(), listing.id)
      .run();
  } else if (action === 'feature') {
    if (listing.status !== 'approved') {
      throw new HttpError(400, 'Wyróżnić można tylko aktywne ogłoszenie');
    }
    await env.DB.prepare(`UPDATE listings SET featured_at = ?, featured_until = ?, featured_reason = ?, updated_at = ? WHERE id = ?`)
      .bind(nowIso(), daysFromNow(7), reason, nowIso(), listing.id)
      .run();
  } else if (action === 'unfeature') {
    await env.DB.prepare(`UPDATE listings SET featured_at = NULL, featured_until = NULL, featured_reason = ?, updated_at = ? WHERE id = ?`)
      .bind(reason, nowIso(), listing.id)
      .run();
  } else if (action === 'reject') {
    await createArchiveSnapshot(env, listing, reason, 'admin');
    await env.DB.prepare(`UPDATE listings SET status = 'rejected', moderation_status = 'rejected', archived_at = ?, archived_reason = ?, deleted_at = ?, deleted_reason = ?, updated_at = ? WHERE id = ?`)
      .bind(nowIso(), reason, nowIso(), reason, nowIso(), listing.id)
      .run();
  } else if (action === 'archive') {
    await createArchiveSnapshot(env, listing, reason, 'admin');
    await env.DB.prepare(`UPDATE listings SET status = 'archived', moderation_status = 'archived', archived_at = ?, archived_reason = ?, deleted_at = ?, deleted_reason = ?, updated_at = ? WHERE id = ?`)
      .bind(nowIso(), reason, nowIso(), reason, nowIso(), listing.id)
      .run();
  } else if (action === 'delete') {
    await createArchiveSnapshot(env, listing, reason, 'admin');
    await env.DB.prepare(`UPDATE listings SET status = 'archived', moderation_status = 'archived', deleted_at = ?, deleted_reason = ?, archived_at = ?, archived_reason = ?, updated_at = ? WHERE id = ?`)
      .bind(nowIso(), reason, nowIso(), reason, nowIso(), listing.id)
      .run();
  } else {
    throw new HttpError(400, 'Nieznana akcja');
  }

  await updatePublisherLimits(env, listing.owner_email_normalized);
  await logAdmin(env, { adminUsername: session.username, action: `listing.${action}`, targetType: 'listing', targetId: listing.id, ipAddress: getClientIp(request), details: { reason } });
  await logEvent(env, { eventType: `admin.listing.${action}`, actorType: 'admin', actorId: session.username, listingId: listing.id, details: { reason } });
  return json({ ok: true, message: 'Akcja wykonana.' });
}

async function handleAdminReportAction(request: Request, env: Env, reportId: string) {
  const session = await requireAdminSession(request, env);
  const body = await readJsonBody<Record<string, unknown>>(request);
  const action = normalizeString(body.action);
  const report = await env.DB.prepare(`SELECT * FROM listing_reports WHERE id = ? LIMIT 1`).bind(reportId).first<{ id: string; reason: string; details: string | null }>();
  if (!report) throw new HttpError(404, 'Zgłoszenie nie zostało znalezione');
  if (action === 'resolve') {
    await env.DB.prepare(`UPDATE listing_reports SET status = 'resolved', resolved_at = ? WHERE id = ?`).bind(nowIso(), reportId).run();
  } else if (action === 'dismiss') {
    await env.DB.prepare(`UPDATE listing_reports SET status = 'dismissed', resolved_at = ? WHERE id = ?`).bind(nowIso(), reportId).run();
  } else {
    throw new HttpError(400, 'Nieznana akcja');
  }
  await logAdmin(env, { adminUsername: session.username, action: `report.${action}`, targetType: 'report', targetId: reportId, ipAddress: getClientIp(request) });
  return json({ ok: true, message: 'Zgłoszenie obsłużone.' });
}

async function handleAdminMe(request: Request, env: Env) {
  const session = await requireAdminSession(request, env);
  return json({
    ok: true,
    user: {
      username: session.username,
      ip_address: session.ip_address,
      expires_at: session.expires_at,
      mfa_verified_at: session.mfa_verified_at
    }
  });
}

function securityHeaders() {
  return {
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()'
  };
}

async function handleApi(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin') || '*') });
  }

  const pathname = url.pathname;
  try {
    if (pathname === '/api/health') {
      return maybeWithCors(request, json({ ok: true, service: env.SITE_NAME || DEFAULTS.siteName, time: nowIso() }));
    }
    if (pathname === '/api/config') {
      return maybeWithCors(request, await handlePublicConfig(env));
    }
    if (pathname === '/api/categories') {
      return maybeWithCors(request, json({ ok: true, categories: CATEGORIES, types: LISTING_TYPES }));
    }
    if (pathname === '/api/stats') {
      return maybeWithCors(request, await handlePublicStats(env));
    }
    if (pathname === '/api/listings' && request.method === 'GET') {
      return maybeWithCors(request, await handlePublicList(request, env));
    }
    if (pathname === '/api/listings' && request.method === 'POST') {
      return maybeWithCors(request, await handleCreateListing(request, env));
    }
    if (pathname.startsWith('/api/listings/') && pathname.endsWith('/verify') && request.method === 'GET') {
      const id = pathname.split('/')[3];
      return maybeWithCors(request, await handleVerifyListing(env, id, url));
    }
    if (pathname.startsWith('/api/listings/') && pathname.endsWith('/approve') && request.method === 'GET') {
      const id = pathname.split('/')[3];
      return maybeWithCors(request, await handleApproveListing(env, id, url));
    }
    if (pathname.startsWith('/api/listings/') && pathname.endsWith('/report') && request.method === 'POST') {
      const id = pathname.split('/')[3];
      return maybeWithCors(request, await handleReportListing(request, env, id));
    }
    if (pathname.startsWith('/api/listings/') && request.method === 'GET') {
      const id = pathname.split('/')[3];
      return maybeWithCors(request, await handlePublicDetail(env, id));
    }
    if (pathname.startsWith('/api/manage/')) {
      const parts = pathname.split('/').filter(Boolean);
      const token = decodeURIComponent(parts[2] || '');
      if (!token) throw new HttpError(400, 'Brak tokenu');
      if (parts.length === 3 && request.method === 'GET') {
        return maybeWithCors(request, await handleManageFetch(env, token));
      }
      if (parts.length === 3 && request.method === 'PUT') {
        return maybeWithCors(request, await handleManageUpdate(request, env, token));
      }
      if (parts.length === 3 && request.method === 'DELETE') {
        return maybeWithCors(request, await handleManageDelete(request, env, token));
      }
      if (parts.length === 4 && parts[3] === 'extend' && request.method === 'POST') {
        return maybeWithCors(request, await handleManageExtend(env, token));
      }
    }
    if (pathname === '/api/admin/login' && request.method === 'POST') {
      return maybeWithCors(request, await handleAdminLogin(request, env));
    }
    if (pathname === '/api/admin/logout' && request.method === 'POST') {
      return maybeWithCors(request, await handleAdminLogout(request, env));
    }
    if (pathname === '/api/admin/me' && request.method === 'GET') {
      return maybeWithCors(request, await handleAdminMe(request, env));
    }
    if (pathname === '/api/admin/dashboard' && request.method === 'GET') {
      return maybeWithCors(request, await handleAdminDashboard(request, env));
    }
    if (pathname === '/api/admin/listings' && request.method === 'GET') {
      return maybeWithCors(request, await handleAdminListings(request, env));
    }
    if (pathname === '/api/admin/reports' && request.method === 'GET') {
      return maybeWithCors(request, await handleAdminReports(request, env));
    }
    if (pathname === '/api/admin/logs' && request.method === 'GET') {
      return maybeWithCors(request, await handleAdminLogs(request, env));
    }
    if (pathname === '/api/admin/users' && request.method === 'GET') {
      return maybeWithCors(request, await handleAdminUsers(request, env));
    }
    if (pathname === '/api/admin/system' && request.method === 'GET') {
      return maybeWithCors(request, await handleAdminSystem(request, env));
    }
    if (pathname === '/api/admin/sessions' && request.method === 'GET') {
      return maybeWithCors(request, await handleAdminSessions(request, env));
    }
    if (pathname.startsWith('/api/admin/sessions/') && request.method === 'DELETE') {
      const sessionId = decodeURIComponent(pathname.split('/').filter(Boolean)[3] || '');
      return maybeWithCors(request, await handleAdminRevokeSession(request, env, sessionId));
    }
    if (pathname.startsWith('/api/admin/listings/') && pathname.endsWith('/history') && request.method === 'GET') {
      const listingId = pathname.split('/')[4];
      return maybeWithCors(request, await handleAdminListingHistory(request, env, listingId));
    }
    if (pathname.startsWith('/api/admin/listings/') && pathname.endsWith('/action') && request.method === 'POST') {
      const listingId = pathname.split('/')[4];
      return maybeWithCors(request, await handleAdminAction(request, env, listingId));
    }
    if (pathname.startsWith('/api/admin/reports/') && pathname.endsWith('/action') && request.method === 'POST') {
      const reportId = pathname.split('/')[4];
      return maybeWithCors(request, await handleAdminReportAction(request, env, reportId));
    }

    throw new HttpError(404, 'Not found');
  } catch (error) {
    return maybeWithCors(request, errorResponse(error));
  } finally {
    ctx.waitUntil(Promise.resolve().then(async () => {
      const requestId = request.headers.get('cf-ray') || crypto.randomUUID();
      console.log(JSON.stringify({
        request_id: requestId,
        method: request.method,
        path: pathname,
        ip: getClientIp(request)
      }));
    }));
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (!isApiRoute(url.pathname)) {
      return new Response('Not Found', { status: 404, headers: baseHeaders(securityHeaders()) });
    }
    return handleApi(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(processModerationJobs(env));
    ctx.waitUntil(processExpiryAndReminders(env));
    ctx.waitUntil(pruneThrottleCounters(env));
  }
};
