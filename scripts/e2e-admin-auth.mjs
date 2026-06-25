import { createHmac } from 'node:crypto';

const baseUrl = process.env.E2E_BASE_URL;
const username = process.env.E2E_ADMIN_USERNAME || process.env.ADMIN_USERNAME || 'admin-e2e';
const password = process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'admin-e2e-password';
const totpSecret = process.env.E2E_ADMIN_TOTP_SECRET || process.env.ADMIN_TOTP_SECRET || 'JBSWY3DPEHPK3PXP';

if (!baseUrl) {
  console.error('Missing E2E_BASE_URL.');
  console.error('Example: E2E_BASE_URL=http://127.0.0.1:8787 npm run e2e:admin');
  process.exit(2);
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function absolute(path) {
  return new URL(path, baseUrl).toString();
}

function base32Decode(secret) {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const output = [];
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
  return Buffer.from(output);
}

function totpGenerate(secret, timestamp = Date.now(), stepSeconds = 30, digits = 6) {
  const timeStep = Math.floor(timestamp / 1000 / stepSeconds);
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(timeStep / 2 ** 32), 0);
  counter.writeUInt32BE(timeStep >>> 0, 4);
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

async function requestJson(path, init = {}) {
  const response = await fetch(absolute(path), {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.headers || {})
    }
  });
  const body = await response.text();
  const payload = JSON.parse(body || '{}');
  return { response, payload };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieFrom(response) {
  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/sprzedam_admin=[^;]+/);
  return match?.[0] || '';
}

const badLogin = await requestJson('/api/admin/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password, mfa: '000000' })
});
assert(badLogin.response.status === 401, `Expected bad MFA to fail with 401, got ${badLogin.response.status}`);
console.log('OK bad MFA rejected');

const login = await requestJson('/api/admin/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password, mfa: totpGenerate(totpSecret) })
});
assert(login.response.status === 200 && login.payload.ok === true, `Admin login failed: ${login.response.status} ${JSON.stringify(login.payload)}`);
const cookie = cookieFrom(login.response);
assert(cookie, 'Missing admin session cookie');
console.log('OK admin login with MFA');

const me = await requestJson('/api/admin/me', { headers: { cookie } });
assert(me.response.status === 200 && me.payload.user?.username === username, `Admin me failed: ${me.response.status} ${JSON.stringify(me.payload)}`);
console.log('OK admin session me');

const dashboard = await requestJson('/api/admin/dashboard', { headers: { cookie } });
assert(dashboard.response.status === 200 && dashboard.payload.ok === true && dashboard.payload.data, `Dashboard failed: ${dashboard.response.status}`);
console.log('OK admin dashboard');

const listings = await requestJson('/api/admin/listings?limit=5', { headers: { cookie } });
assert(listings.response.status === 200 && Array.isArray(listings.payload.items), `Admin listings failed: ${listings.response.status}`);
if (listings.payload.items.length) {
  const item = listings.payload.items[0];
  assert('contact_email' in item && 'owner_email_normalized' in item, 'Admin listings are missing contact context');
}
console.log('OK admin listings contact context');

const sessions = await requestJson('/api/admin/sessions', { headers: { cookie } });
assert(sessions.response.status === 200 && Array.isArray(sessions.payload.items), `Sessions failed: ${sessions.response.status}`);
assert(sessions.payload.items.some((item) => item.current), 'Current admin session not marked');
console.log('OK admin sessions');

const logout = await requestJson('/api/admin/logout', { method: 'POST', headers: { cookie } });
assert(logout.response.status === 200 && logout.payload.ok === true, `Logout failed: ${logout.response.status}`);
console.log('OK admin logout');

const afterLogout = await requestJson('/api/admin/me', { headers: { cookie } });
assert(afterLogout.response.status === 401, `Expected session to be revoked after logout, got ${afterLogout.response.status}`);
console.log('OK admin session revoked');
