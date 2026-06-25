const baseUrl = process.env.SMOKE_BASE_URL || 'https://sprzedam.klodzko.pl';

const checks = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error: error.message || String(error) });
  }
}

async function fetchText(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.text();
  return { response, body };
}

async function expectStatus(path, expectedStatus, init) {
  const { response } = await fetchText(path, init);
  if (response.status !== expectedStatus) {
    throw new Error(`Expected ${expectedStatus}, got ${response.status}`);
  }
}

async function expectHtml(path, expectedText) {
  const { response, body } = await fetchText(path, { redirect: 'manual' });
  if (response.status !== 200) throw new Error(`Expected 200 without redirect, got ${response.status}`);
  if (!body.includes(expectedText)) {
    throw new Error(`Missing expected text "${expectedText}"`);
  }
}

async function expectJson(path, predicate) {
  const { response, body } = await fetchText(path);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 160)}`);
  const payload = JSON.parse(body);
  if (!predicate(payload)) throw new Error(`Unexpected JSON: ${body.slice(0, 240)}`);
}

await check('API health', () => expectJson('/api/health', (payload) => payload.ok === true));
await check('API categories', () => expectJson('/api/categories', (payload) => payload.ok === true && payload.categories?.length >= 6));
await check('API stats', () => expectJson('/api/stats', (payload) => payload.ok === true && typeof payload.total_active === 'number' && payload.by_category));
await check('API listings', () => expectJson('/api/listings?limit=3', (payload) => {
  if (payload.ok !== true || !Array.isArray(payload.items)) return false;
  return payload.items.every((item) => !('contact_email' in item) && !('contact_phone' in item) && !('contact_name' in item));
}));
await check('API listings filters', () => expectJson('/api/listings?limit=3&sort=price_asc&min_price=0&max_price=100000', (payload) => payload.ok === true && payload.sort === 'price_asc' && Array.isArray(payload.items)));
await check('API listing contact is protected', async () => {
  const { response, body } = await fetchText('/api/listings?limit=1');
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 160)}`);
  const listPayload = JSON.parse(body);
  const slug = listPayload.items?.[0]?.slug;
  if (!slug) return;
  const detail = await fetchText(`/api/listings/${encodeURIComponent(slug)}`);
  if (!detail.response.ok) throw new Error(`Detail HTTP ${detail.response.status}: ${detail.body.slice(0, 160)}`);
  const detailPayload = JSON.parse(detail.body);
  const item = detailPayload.item || {};
  if ('contact_email' in item || 'contact_phone' in item || 'contact_name' in item) {
    throw new Error('Public detail API exposed contact fields');
  }
  const contact = await fetchText(`/api/listings/${encodeURIComponent(slug)}/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  const blockedByTurnstile = contact.response.status === 400 && contact.body.includes('weryfikację anty-bot');
  const blockedByRateLimit = contact.response.status === 429 && contact.body.includes('Zbyt wiele prób');
  if (!blockedByTurnstile && !blockedByRateLimit) {
    throw new Error(`Expected protected contact endpoint, got ${contact.response.status}: ${contact.body.slice(0, 160)}`);
  }
});
await check('Homepage', () => expectHtml('/', 'Sprzedam Kłodzko'));
await check('Admin login page', () => expectHtml('/admin/', 'Logowanie administratora'));
await check('Manage page', () => expectHtml('/manage', 'manage-root'));
await check('Category page', () => expectHtml('/kategoria/elektronika', 'category-root'));
await check('Sitemap', () => expectStatus('/sitemap.xml', 200, { redirect: 'manual' }));
await check('Public listing create is blocked without human verification', async () => {
  const { response, body } = await fetchText('/api/listings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Smoke test bez publikacji',
      type: 'sprzedam',
      category: 'Inne',
      description: 'Ten request ma zostać odrzucony przez Turnstile i nie tworzyć ogłoszenia.',
      price: 0,
      contact_name: 'Smoke',
      contact_email: 'smoke@example.invalid',
      city: 'Kłodzko',
      contact_consent: true
    })
  });
  const blockedByTurnstile = response.status === 400 && body.includes('weryfikację anty-bot');
  const blockedByRateLimit = response.status === 429 && body.includes('Zbyt wiele prób');
  if (!blockedByTurnstile && !blockedByRateLimit) {
    throw new Error(`Expected Turnstile 400 or throttle 429, got ${response.status}: ${body.slice(0, 160)}`);
  }
});

for (const result of checks) {
  const marker = result.ok ? 'OK' : 'FAIL';
  console.log(`${marker} ${result.name}${result.ok ? '' : ` - ${result.error}`}`);
}

const failed = checks.filter((result) => !result.ok);
if (failed.length) {
  process.exitCode = 1;
}
