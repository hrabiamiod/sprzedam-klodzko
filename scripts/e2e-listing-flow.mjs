import { spawnSync } from 'node:child_process';

const baseUrl = process.env.E2E_BASE_URL;
const turnstileToken = process.env.E2E_TURNSTILE_TOKEN;
const approveWithWrangler = process.env.E2E_APPROVE_WITH_WRANGLER === '1';
const wranglerDatabase = process.env.E2E_WRANGLER_D1_NAME || 'sprzedam-klodzko-db-dev';
const wranglerEnv = process.env.E2E_WRANGLER_ENV || 'dev';

if (!baseUrl || !turnstileToken) {
  console.error('Missing E2E_BASE_URL or E2E_TURNSTILE_TOKEN.');
  console.error('Example: E2E_BASE_URL=http://127.0.0.1:8787 E2E_TURNSTILE_TOKEN=dev-bypass npm run e2e:listing');
  process.exit(2);
}

function absolute(path) {
  return new URL(path, baseUrl).toString();
}

async function requestJson(pathOrUrl, init) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : absolute(pathOrUrl);
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.headers || {})
    }
  });
  const body = await response.text();
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`Expected JSON from ${url}, got ${response.status}: ${body.slice(0, 200)}`);
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(`Request failed ${response.status} ${url}: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertUuid(value, message) {
  assert(/^[0-9a-f-]{36}$/i.test(value || ''), message);
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function approveListingLocally(listingId) {
  assertUuid(listingId, 'Refusing local approval for non-UUID listing id');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const command = [
    `UPDATE listings SET`,
    `status = 'approved',`,
    `moderation_status = 'approved',`,
    `moderation_reason = 'E2E local approval',`,
    `approved_at = ${sqlQuote(now.toISOString())},`,
    `published_at = ${sqlQuote(now.toISOString())},`,
    `expires_at = ${sqlQuote(expiresAt.toISOString())},`,
    `updated_at = ${sqlQuote(now.toISOString())}`,
    `WHERE id = ${sqlQuote(listingId)}`
  ].join(' ');
  const result = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', wranglerDatabase, '--env', wranglerEnv, '--local', '--command', command],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(`Local D1 approval failed: ${result.stderr || result.stdout}`);
  }
}

const suffix = Date.now().toString(36);
const createPayload = {
  title: `E2E test ${suffix}`,
  type: 'sprzedam',
  category: 'Inne',
  description: 'Automatyczny test pełnego flow dodawania ogłoszenia w środowisku testowym.',
  price: '12.34',
  contact_name: 'E2E',
  contact_email: `e2e-${suffix}@example.invalid`,
  contact_phone: '',
  city: 'Kłodzko',
  contact_consent: true,
  turnstile_token: turnstileToken
};

const created = await requestJson('/api/listings', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(createPayload)
});

assert(created.listing?.id, 'Missing listing id after create');
assert(created.links?.verify, 'Missing verify link after create');
assert(created.links?.manage, 'Missing manage link after create');
console.log(`OK created listing ${created.listing.id}`);

const verified = await requestJson(created.links.verify);
assert(verified.ok === true, 'Verification did not return ok=true');
console.log('OK verified listing');

const manageUrl = new URL(created.links.manage);
const manageToken = manageUrl.searchParams.get('token');
assert(manageToken, 'Missing manage token');

const managed = await requestJson(`/api/manage/${encodeURIComponent(manageToken)}`);
assert(managed.listing?.id === created.listing.id, 'Manage fetch returned different listing');
assert(managed.publication_status?.state, 'Missing publication_status');
assert(managed.publication_status.state !== 'needs_verification', 'Listing still requires verification after verify');
assert(Array.isArray(managed.timeline), 'Missing timeline');
console.log(`OK owner status: ${managed.publication_status.state}`);

if (approveWithWrangler) {
  approveListingLocally(created.listing.id);
  console.log('OK locally approved listing');

  const approved = await requestJson(`/api/manage/${encodeURIComponent(manageToken)}`);
  assert(approved.publication_status?.state === 'live', `Expected live status after local approval, got ${approved.publication_status?.state}`);
  assert(approved.publication_status?.can_edit === true, 'Approved listing is not editable');
  assert(approved.publication_status?.can_extend === true, 'Approved listing is not extendable');
  console.log('OK owner live status');

  const extended = await requestJson(`/api/manage/${encodeURIComponent(manageToken)}/extend`, { method: 'POST' });
  assert(extended.ok === true && extended.expires_at, 'Extend did not return expires_at');
  console.log('OK extended listing');

  const editedTitle = `${createPayload.title} edited`;
  const edited = await requestJson(`/api/manage/${encodeURIComponent(manageToken)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...createPayload,
      title: editedTitle,
      description: `${createPayload.description} Edycja sprawdza powrót ogłoszenia do moderacji.`
    })
  });
  assert(edited.ok === true, 'Edit did not return ok=true');
  console.log('OK edited listing');

  const afterEdit = await requestJson(`/api/manage/${encodeURIComponent(manageToken)}`);
  assert(afterEdit.listing?.title === editedTitle, 'Edited listing title was not persisted');
  assert(afterEdit.publication_status?.state === 'moderation', `Expected moderation after edit, got ${afterEdit.publication_status?.state}`);
  assert((afterEdit.timeline || []).some((item) => item.label === 'listing.updated'), 'Timeline is missing listing.updated');
  console.log('OK edit returned listing to moderation');
}

const deleted = await requestJson(`/api/manage/${encodeURIComponent(manageToken)}`, { method: 'DELETE' });
assert(deleted.ok === true, 'Delete did not return ok=true');
console.log('OK deleted listing');

const archived = await requestJson(`/api/manage/${encodeURIComponent(manageToken)}`);
assert(archived.publication_status?.state === 'archived', 'Listing was not archived after delete');
console.log('OK archived status after delete');
