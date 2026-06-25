const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const LISTING_TYPES = ['sprzedam', 'kupię', 'oddam', 'szukam'] as const;
export const CATEGORIES = ['Elektronika', 'Meble', 'Auto', 'Ubrania', 'Usługi', 'Inne'] as const;

export type ListingType = (typeof LISTING_TYPES)[number];
export type ListingCategory = (typeof CATEGORIES)[number];

export function nowIso() {
  return new Date().toISOString();
}

export function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

export function slugify(input: string) {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function formatMoney(cents: number, currency = 'PLN') {
  const value = (cents || 0) / 100;
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2
  }).format(value);
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function text(body: string, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'text/plain; charset=utf-8');
  return new Response(body, { ...init, headers });
}

export async function readJsonBody<T>(request: Request, maxBytes = 64_000): Promise<T> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new HttpError(413, 'Payload too large');
  }
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Nieprawidłowy JSON');
  }
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function toPositiveInt(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.trunc(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

export function toPositiveFloat(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return parsed < 0 ? 0 : parsed;
}

export function boolFromUnknown(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }
  return false;
}

export function getHeader(request: Request, name: string) {
  return request.headers.get(name) || '';
}

export function getClientIp(request: Request) {
  return getHeader(request, 'cf-connecting-ip') || getHeader(request, 'x-forwarded-for').split(',')[0]?.trim() || '0.0.0.0';
}

function base64url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '==='.slice((normalized.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(value));
  return bytesToHex(new Uint8Array(signature));
}

export function timingSafeEqual(a: string, b: string) {
  const left = textEncoder.encode(a);
  const right = textEncoder.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }
  return diff === 0;
}

export function randomToken(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export function tokenHint(token: string) {
  return token.slice(-6);
}

export async function hashToken(token: string, pepper = '') {
  return sha256Hex(`${pepper}::${token}`);
}

export async function signSession(payload: Record<string, unknown>, secret: string) {
  const body = base64url(textEncoder.encode(JSON.stringify(payload)));
  const signature = await hmacSha256Hex(secret, body);
  return `${body}.${signature}`;
}

export async function verifySession<T extends Record<string, unknown>>(token: string, secret: string) {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  const expected = await hmacSha256Hex(secret, body);
  if (!timingSafeEqual(expected, signature)) return null;
  try {
    const payload = JSON.parse(textDecoder.decode(base64urlDecode(body))) as T;
    return payload;
  } catch {
    return null;
  }
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(secret: string) {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

function counterBuffer(timeStep: number) {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  const high = Math.floor(timeStep / 2 ** 32);
  const low = timeStep >>> 0;
  view.setUint32(0, high);
  view.setUint32(4, low);
  return buffer;
}

export async function totpGenerate(secret: string, timestamp = Date.now(), stepSeconds = 30, digits = 6) {
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const timeStep = Math.floor(timestamp / 1000 / stepSeconds);
  const signature = await crypto.subtle.sign('HMAC', key, counterBuffer(timeStep));
  const bytes = new Uint8Array(signature);
  const offset = bytes[bytes.length - 1] & 0x0f;
  const code =
    ((bytes[offset] & 0x7f) << 24) |
    ((bytes[offset + 1] & 0xff) << 16) |
    ((bytes[offset + 2] & 0xff) << 8) |
    (bytes[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

export async function totpVerify(secret: string, code: string, window = 1, stepSeconds = 30) {
  const cleanCode = code.trim().replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanCode)) return false;
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = await totpGenerate(secret, Date.now() + offset * stepSeconds * 1000, stepSeconds);
    if (timingSafeEqual(candidate, cleanCode)) return true;
  }
  return false;
}

export function parseAllowedIps(raw: string | undefined) {
  return (raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function ipv4ToInt(ip: string) {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0);
}

export function ipAllowed(ip: string, allowedValues: string[]) {
  if (allowedValues.length === 0) return true;
  if (allowedValues.includes(ip)) return true;

  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) {
    return false;
  }

  for (const item of allowedValues) {
    if (!item.includes('/')) continue;
    const [cidrIp, bitsRaw] = item.split('/');
    const bits = Number.parseInt(bitsRaw, 10);
    const cidrInt = ipv4ToInt(cidrIp);
    if (cidrInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
    if ((ipInt & mask) === (cidrInt & mask)) return true;
  }

  return false;
}

export function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function buildAbsoluteUrl(baseUrl: string | undefined, path: string) {
  const base = new URL(baseUrl || 'https://sprzedam.klodzko.pl');
  return new URL(path, base).toString();
}

export function parseListSearchParams(url: URL) {
  return {
    q: url.searchParams.get('q') || '',
    category: url.searchParams.get('category') || '',
    type: url.searchParams.get('type') || '',
    page: Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1),
    limit: Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '12', 10) || 12))
  };
}

export function toPrettyDate(value: string | null | undefined) {
  if (!value) return '';
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function stripHtml(input: string) {
  return input.replace(/<[^>]+>/g, ' ');
}

export function clampText(input: string, max = 180) {
  const clean = input.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

export function normalizePhone(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function parseImageData(input: unknown, maxBytes: number) {
  if (typeof input !== 'string' || !input) return null;
  if (!input.startsWith('data:')) {
    throw new HttpError(400, 'Zdjęcie musi być przekazane jako data URL');
  }
  if (input.length > maxBytes * 2) {
    throw new HttpError(413, 'Zdjęcie jest zbyt duże');
  }
  const match = input.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new HttpError(400, 'Nieprawidłowy format zdjęcia');
  }
  const mime = match[1];
  const base64 = match[2];
  return { mime, base64 };
}

export function listingStateLabel(status: string) {
  switch (status) {
    case 'pending':
      return 'Oczekuje';
    case 'approved':
      return 'Aktywne';
    case 'rejected':
      return 'Odrzucone';
    case 'expired':
      return 'Wygasłe';
    case 'archived':
      return 'Archiwalne';
    default:
      return status;
  }
}

export function buildMetaDescription(title: string, description: string) {
  return clampText(`${title}. ${stripHtml(description)}`, 160);
}

