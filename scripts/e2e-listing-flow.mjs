const baseUrl = process.env.E2E_BASE_URL;
const turnstileToken = process.env.E2E_TURNSTILE_TOKEN;

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
  const response = await fetch(url, init);
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

const deleted = await requestJson(`/api/manage/${encodeURIComponent(manageToken)}`, { method: 'DELETE' });
assert(deleted.ok === true, 'Delete did not return ok=true');
console.log('OK deleted listing');

const archived = await requestJson(`/api/manage/${encodeURIComponent(manageToken)}`);
assert(archived.publication_status?.state === 'archived', 'Listing was not archived after delete');
console.log('OK archived status after delete');
