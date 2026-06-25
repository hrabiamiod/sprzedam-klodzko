const config = Object.assign({}, window.APP_CONFIG || {});

function api(path) {
  return `${config.apiBase || '/api'}${path}`;
}

async function fetchJson(path, options = {}) {
  const response = await fetch(api(path), {
    credentials: 'include',
    headers: {
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function loadSiteConfig() {
  try {
    const payload = await fetchJson('/config');
    Object.assign(config, payload.config || {});
  } catch {
    // Keep defaults if the public config endpoint is unavailable.
  }
  const node = document.getElementById('site-name');
  if (node) node.textContent = config.siteName || 'Sprzedam Kłodzko';
}

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(cents, currency = 'PLN') {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2
  }).format((cents || 0) / 100);
}

function metricCard(label, value) {
  return `<div class="metric"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;
}

function listingTable(items) {
  return `
    <table>
      <thead>
        <tr>
          <th>Tytuł</th>
          <th>Status</th>
          <th>Kategoria</th>
          <th>Typ</th>
          <th>Cena</th>
          <th>Kontakt</th>
          <th>Akcje</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item) => `
          <tr>
            <td><strong>${esc(item.title)}</strong><br /><span class="status-note">${esc(item.slug)}</span></td>
            <td><span class="tag ${item.status === 'approved' ? 'ok' : item.status === 'rejected' ? 'bad' : ''}">${esc(item.status)}</span></td>
            <td>${esc(item.category)}</td>
            <td>${esc(item.type)}</td>
            <td>${esc(money(item.price_cents, item.currency))}</td>
            <td>${esc(item.contact_email || '')}<br />${esc(item.contact_phone || '')}</td>
            <td>
              <div class="row-actions">
                <button class="button ghost small" data-listing-action="approve" data-id="${esc(item.id)}">Approve</button>
                <button class="button ghost small" data-listing-action="reject" data-id="${esc(item.id)}">Reject</button>
                <button class="button ghost small" data-listing-action="archive" data-id="${esc(item.id)}">Archive</button>
                <button class="button ghost small" data-listing-action="delete" data-id="${esc(item.id)}">Delete</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function reportTable(items) {
  return `
    <table>
      <thead>
        <tr>
          <th>Data</th>
          <th>Ogłoszenie</th>
          <th>Powód</th>
          <th>Status</th>
          <th>Akcje</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item) => `
          <tr>
            <td>${esc(new Date(item.created_at).toLocaleString('pl-PL'))}</td>
            <td>${esc(item.title)}<br /><span class="status-note">${esc(item.slug)}</span></td>
            <td>${esc(item.reason)}</td>
            <td><span class="tag">${esc(item.status)}</span></td>
            <td>
              <div class="row-actions">
                <button class="button ghost small" data-report-action="resolve" data-id="${esc(item.id)}">Resolve</button>
                <button class="button ghost small" data-report-action="dismiss" data-id="${esc(item.id)}">Dismiss</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function userTable(items) {
  return `
    <table>
      <thead>
        <tr>
          <th>E-mail</th>
          <th>Aktywne</th>
          <th>7 dni</th>
          <th>30 dni</th>
          <th>Ostatnia publikacja</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item) => `
          <tr>
            <td>${esc(item.email_normalized)}</td>
            <td>${esc(item.active_listings_count)}</td>
            <td>${esc(item.published_7d_count)}</td>
            <td>${esc(item.published_30d_count)}</td>
            <td>${esc(item.last_published_at || '')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function logTable(items) {
  return `
    <table>
      <thead>
        <tr>
          <th>Data</th>
          <th>Zdarzenie</th>
          <th>Actor</th>
          <th>Listing</th>
          <th>Szczegóły</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item) => `
          <tr>
            <td>${esc(new Date(item.created_at).toLocaleString('pl-PL'))}</td>
            <td>${esc(item.event_type)}</td>
            <td>${esc(item.actor_type)} ${esc(item.actor_id || '')}</td>
            <td>${esc(item.listing_id || '')}</td>
            <td>${esc(item.details_json || '')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function login(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById('login-message');
  const data = new FormData(form);
  try {
    await fetchJson('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: String(data.get('username') || ''),
        password: String(data.get('password') || ''),
        mfa: String(data.get('mfa') || '')
      })
    });
    message.hidden = false;
    message.textContent = 'Zalogowano.';
    await bootstrap();
  } catch (error) {
    message.hidden = false;
    message.textContent = error.message || String(error);
  }
}

async function logout() {
  await fetchJson('/admin/logout', { method: 'POST' });
  window.location.reload();
}

async function loadDashboard() {
  const dashboard = await fetchJson('/admin/dashboard');
  document.getElementById('metrics').innerHTML = [
    metricCard('Oczekujące', dashboard.data.pending),
    metricCard('Raporty', dashboard.data.reports),
    metricCard('Ogółem', dashboard.data.total_listings),
    metricCard('Aktywne', dashboard.data.active_listings),
    metricCard('Odrzucone', dashboard.data.rejected),
    metricCard('Użytkownicy', dashboard.data.users)
  ].join('');
}

async function loadListings() {
  const status = document.getElementById('listing-status-filter').value;
  const payload = await fetchJson(`/admin/listings?limit=50${status ? `&status=${encodeURIComponent(status)}` : ''}`);
  document.getElementById('admin-listings').innerHTML = listingTable(payload.items || []);
}

async function loadReports() {
  const payload = await fetchJson('/admin/reports');
  document.getElementById('admin-reports').innerHTML = reportTable(payload.items || []);
}

async function loadUsers() {
  const payload = await fetchJson('/admin/users');
  document.getElementById('admin-users').innerHTML = userTable(payload.items || []);
}

async function loadLogs() {
  const payload = await fetchJson('/admin/logs');
  document.getElementById('admin-logs').innerHTML = logTable(payload.items || []);
}

async function actionOnListing(id, action) {
  const reason = action === 'approve' ? 'approved' : window.prompt(`Powód dla akcji ${action}:`, action) || action;
  await fetchJson(`/admin/listings/${encodeURIComponent(id)}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, reason })
  });
  await bootstrap(true);
}

async function actionOnReport(id, action) {
  await fetchJson(`/admin/reports/${encodeURIComponent(id)}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action })
  });
  await bootstrap(true);
}

async function bootstrap(skipLoginCheck = false) {
  const loginCard = document.getElementById('login-card');
  const dashboard = document.getElementById('dashboard');
  const logoutButton = document.getElementById('logout-button');
  try {
    const me = skipLoginCheck ? { ok: true } : await fetchJson('/admin/me');
    if (me.ok) {
      loginCard.hidden = true;
      dashboard.hidden = false;
      logoutButton.hidden = false;
      await Promise.all([loadDashboard(), loadListings(), loadReports(), loadUsers(), loadLogs()]);
    }
  } catch {
    loginCard.hidden = false;
    dashboard.hidden = true;
    logoutButton.hidden = true;
  }
}

document.getElementById('login-form')?.addEventListener('submit', login);
document.getElementById('logout-button')?.addEventListener('click', logout);
document.getElementById('listing-status-filter')?.addEventListener('change', () => loadListings().catch(console.error));
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const listingAction = target.dataset.listingAction;
  const reportAction = target.dataset.reportAction;
  if (listingAction) {
    actionOnListing(target.dataset.id, listingAction).catch((error) => alert(error.message || String(error)));
  }
  if (reportAction) {
    actionOnReport(target.dataset.id, reportAction).catch((error) => alert(error.message || String(error)));
  }
});

loadSiteConfig()
  .then(() => bootstrap())
  .catch((error) => {
    const message = document.getElementById('login-message');
    if (message) {
      message.hidden = false;
      message.textContent = error.message || String(error);
    }
  });
