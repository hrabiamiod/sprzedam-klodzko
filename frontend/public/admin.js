const config = Object.assign({}, window.APP_CONFIG || {});
const adminState = {
  selectedListings: new Set(),
  currentStatus: '',
  me: null
};

const STATUS_LABELS = {
  pending: 'Oczekuje',
  approved: 'Aktywne',
  rejected: 'Odrzucone',
  expired: 'Wygasłe',
  archived: 'Archiwum'
};

const ACTION_LABELS = {
  approve: 'Zatwierdź',
  reject: 'Odrzuć',
  archive: 'Archiwizuj',
  delete: 'Usuń'
};

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

function formatDate(value) {
  if (!value) return 'brak';
  return new Date(value).toLocaleString('pl-PL');
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || 'nieznany';
}

function statusClass(status) {
  if (status === 'approved') return 'ok';
  if (status === 'pending') return 'warn';
  if (status === 'rejected' || status === 'archived') return 'bad';
  return '';
}

function moderationHint(item) {
  const parts = [];
  if (item.version) parts.push(`wersja ${item.version}`);
  if (item.moderation_status) parts.push(`moderacja: ${item.moderation_status}`);
  if (item.moderation_reason) parts.push(item.moderation_reason);
  if (Number.isFinite(Number(item.report_count)) && Number(item.report_count) > 0) parts.push(`${item.report_count} zgłoszeń`);
  if (item.expires_at) parts.push(`wygasa: ${formatDate(item.expires_at)}`);
  return parts.join(' · ');
}

function renderEmpty(message) {
  return `<div class="empty"><strong>${esc(message)}</strong><span>Odśwież panel albo zmień filtr statusu.</span></div>`;
}

function renderSession(user) {
  const target = document.getElementById('session-card');
  if (!target || !user) return;
  target.innerHTML = `
    <span class="tag ok">MFA aktywne</span>
    <strong>${esc(user.username)}</strong>
    <span>IP sesji: ${esc(user.ip_address || 'nieznane')}</span>
    <span>MFA: ${esc(formatDate(user.mfa_verified_at))}</span>
    <span>Sesja do: ${esc(formatDate(user.expires_at))}</span>
  `;
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const count = document.getElementById('bulk-count');
  if (!bar || !count) return;
  const selected = adminState.selectedListings.size;
  bar.hidden = selected === 0;
  count.textContent = `${selected} zaznaczonych`;
}

function eventLabel(label) {
  const labels = {
    'listing.created': 'Ogłoszenie utworzone',
    'listing.verified': 'Zweryfikowane przez użytkownika',
    'listing.updated': 'Edycja użytkownika',
    'listing.extended': 'Przedłużenie publikacji',
    'listing.deleted': 'Usunięcie przez użytkownika',
    'listing.approved': 'Zatwierdzone linkiem',
    'listing.moderation.approved': 'AI/moderacja zaakceptowała',
    'listing.moderation.rejected': 'AI/moderacja odrzuciła',
    'listing.reported': 'Zgłoszenie naruszenia',
    'listing.report.processed': 'Zgłoszenie przetworzone',
    'admin.listing.approve': 'Admin zatwierdził',
    'admin.listing.reject': 'Admin odrzucił',
    'admin.listing.archive': 'Admin zarchiwizował',
    'admin.listing.delete': 'Admin usunął',
    'snapshot.archived': 'Snapshot archiwalny',
    'snapshot.revision': 'Snapshot rewizji'
  };
  return labels[label] || label;
}

function listingTable(items) {
  if (!items.length) return renderEmpty('Brak ogłoszeń w tym widoku.');
  return `
    <table>
      <thead>
        <tr>
          <th><input type="checkbox" data-select-all-listings /></th>
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
            <td><input type="checkbox" data-select-listing="${esc(item.id)}" ${adminState.selectedListings.has(item.id) ? 'checked' : ''} /></td>
            <td>
              <strong>${esc(item.title)}</strong>
              <br /><a class="muted-link" href="/ogloszenie/${encodeURIComponent(item.slug)}" target="_blank" rel="noopener">${esc(item.slug)}</a>
              <br /><span class="status-note">${esc(moderationHint(item))}</span>
            </td>
            <td><span class="tag ${statusClass(item.status)}">${esc(statusLabel(item.status))}</span></td>
            <td>${esc(item.category)}</td>
            <td>${esc(item.type)}</td>
            <td>${esc(money(item.price_cents, item.currency))}</td>
            <td>${esc(item.contact_email || '')}<br />${esc(item.contact_phone || '')}</td>
            <td>
              <div class="row-actions">
                <button class="button ghost small" data-listing-action="approve" data-id="${esc(item.id)}">${ACTION_LABELS.approve}</button>
                <button class="button ghost small" data-listing-action="reject" data-id="${esc(item.id)}">${ACTION_LABELS.reject}</button>
                <button class="button ghost small" data-listing-action="archive" data-id="${esc(item.id)}">${ACTION_LABELS.archive}</button>
                <button class="button ghost small" data-history-id="${esc(item.id)}">Historia</button>
                <button class="button ghost small danger-action" data-listing-action="delete" data-id="${esc(item.id)}">${ACTION_LABELS.delete}</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderHistoryPanel(payload) {
  const listing = payload.listing || {};
  const timeline = payload.timeline || [];
  return `
    <div class="history-card">
      <div class="section-head">
        <div>
          <span class="eyebrow">Historia ogłoszenia</span>
          <h3>${esc(listing.title || 'Ogłoszenie')}</h3>
        </div>
        <button class="button ghost small" type="button" data-close-history>Zamknij</button>
      </div>
      <div class="pill-row">
        <span class="tag ${statusClass(listing.status)}">${esc(statusLabel(listing.status))}</span>
        <span class="tag">Wersja ${esc(listing.version || 1)}</span>
        <span class="tag">${esc(listing.owner_email_normalized || '')}</span>
      </div>
      ${timeline.length ? `
        <ol class="timeline-list">
          ${timeline.map((item) => `
            <li>
              <strong>${esc(eventLabel(item.label))}</strong>
              <span>${esc(formatDate(item.created_at))}</span>
              ${item.source ? `<span>Źródło: ${esc(item.source)}</span>` : ''}
              ${item.reason ? `<span>Powód: ${esc(item.reason)}</span>` : ''}
              ${item.version ? `<span>Wersja: ${esc(item.version)}</span>` : ''}
            </li>
          `).join('')}
        </ol>
      ` : '<div class="empty"><strong>Brak historii.</strong><span>Nie znaleziono zdarzeń dla tego ogłoszenia.</span></div>'}
    </div>
  `;
}

function reportTable(items) {
  if (!items.length) return renderEmpty('Brak zgłoszeń do obsługi.');
  return `
    <table>
      <thead>
        <tr>
          <th>Data</th>
          <th>Ryzyko</th>
          <th>Zgłoszenie</th>
          <th>Ogłoszenie</th>
          <th>Stan</th>
          <th>Akcje</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item) => `
          <tr>
            <td>${esc(formatDate(item.created_at))}</td>
            <td>
              <span class="tag ${Number(item.listing_report_count || 0) >= 3 ? 'bad' : item.status === 'pending' ? 'warn' : 'ok'}">${esc(item.listing_report_count || 1)} zgł.</span>
              ${item.ai_flagged ? '<br /><span class="tag bad">AI flag</span>' : ''}
            </td>
            <td>
              <strong>${esc(item.reason)}</strong>
              ${item.details ? `<br /><span class="status-note">${esc(item.details)}</span>` : ''}
              ${item.reporter_email ? `<br /><span class="status-note">Reporter: ${esc(item.reporter_email)}</span>` : ''}
            </td>
            <td>
              <a class="muted-link" href="/ogloszenie/${encodeURIComponent(item.slug)}" target="_blank" rel="noopener">${esc(item.title)}</a>
              <br /><span class="status-note">${esc(item.slug)}</span>
              <br /><span class="status-note">Kontakt: ${esc(item.listing_contact_email || '')}</span>
              ${item.listing_moderation_reason ? `<br /><span class="status-note">Moderacja: ${esc(item.listing_moderation_reason)}</span>` : ''}
            </td>
            <td>
              <span class="tag ${item.status === 'pending' ? 'warn' : 'ok'}">${esc(item.status === 'pending' ? 'Oczekuje' : item.status)}</span>
              <br /><span class="tag ${statusClass(item.listing_status)}">${esc(statusLabel(item.listing_status))}</span>
              ${item.listing_report_status ? `<br /><span class="status-note">Raport: ${esc(item.listing_report_status)}</span>` : ''}
            </td>
            <td>
              <div class="row-actions">
                <button class="button ghost small" data-report-action="resolve" data-id="${esc(item.id)}">Oznacz obsłużone</button>
                <button class="button ghost small" data-report-action="dismiss" data-id="${esc(item.id)}">Odrzuć zgłoszenie</button>
                <button class="button ghost small" data-history-id="${esc(item.listing_id)}">Historia</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function userTable(items) {
  if (!items.length) return renderEmpty('Brak historii publikujących.');
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
            <td>${esc(formatDate(item.last_published_at))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function logTable(items) {
  if (!items.length) return renderEmpty('Brak logów.');
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
            <td>${esc(formatDate(item.created_at))}</td>
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
    form.reset();
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
    metricCard('Do moderacji', dashboard.data.pending),
    metricCard('Zgłoszenia', dashboard.data.reports),
    metricCard('Wszystkie', dashboard.data.total_listings),
    metricCard('Publiczne', dashboard.data.active_listings),
    metricCard('Odrzucone', dashboard.data.rejected),
    metricCard('Publikujący', dashboard.data.users)
  ].join('');
}

async function loadListings() {
  const status = adminState.currentStatus || document.getElementById('listing-status-filter').value;
  const payload = await fetchJson(`/admin/listings?limit=50${status ? `&status=${encodeURIComponent(status)}` : ''}`);
  const visibleIds = new Set((payload.items || []).map((item) => item.id));
  adminState.selectedListings.forEach((id) => {
    if (!visibleIds.has(id)) adminState.selectedListings.delete(id);
  });
  document.getElementById('admin-listings').innerHTML = listingTable(payload.items || []);
  updateBulkBar();
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

async function loadListingHistory(id) {
  if (!id) return;
  const target = document.getElementById('admin-history');
  if (!target) return;
  target.hidden = false;
  target.innerHTML = '<div class="status-note">Ładowanie historii...</div>';
  const payload = await fetchJson(`/admin/listings/${encodeURIComponent(id)}/history`);
  target.innerHTML = renderHistoryPanel(payload);
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function actionOnListing(id, action) {
  if (!id) return;
  const defaultReason = action === 'approve' ? 'Zatwierdzone przez administratora' : ACTION_LABELS[action] || action;
  const reason = action === 'approve' ? defaultReason : window.prompt(`Powód akcji: ${ACTION_LABELS[action] || action}`, defaultReason) || defaultReason;
  if ((action === 'delete' || action === 'archive') && !window.confirm(`Potwierdź akcję: ${ACTION_LABELS[action] || action}`)) return;
  await fetchJson(`/admin/listings/${encodeURIComponent(id)}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, reason })
  });
  adminState.selectedListings.delete(id);
  await bootstrap(true);
}

async function bulkActionOnListings(action) {
  const ids = Array.from(adminState.selectedListings);
  if (!ids.length) return;
  const label = ACTION_LABELS[action] || action;
  const reason = action === 'approve'
    ? 'Zatwierdzone zbiorczo przez administratora'
    : window.prompt(`Powód zbiorczej akcji: ${label}`, label) || label;
  if (!window.confirm(`Wykonać "${label}" dla ${ids.length} ogłoszeń?`)) return;
  for (const id of ids) {
    await fetchJson(`/admin/listings/${encodeURIComponent(id)}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, reason })
    });
  }
  adminState.selectedListings.clear();
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
    const me = skipLoginCheck && adminState.me ? { ok: true, user: adminState.me } : await fetchJson('/admin/me');
    if (me.ok) {
      adminState.me = me.user || adminState.me;
      renderSession(adminState.me);
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
document.getElementById('refresh-admin')?.addEventListener('click', () => bootstrap(true).catch((error) => alert(error.message || String(error))));
document.querySelector('[name="mfa"]')?.addEventListener('input', (event) => {
  event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '').slice(0, 6);
});
document.querySelectorAll('[data-admin-status]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-admin-status]').forEach((node) => node.classList.remove('active'));
    button.classList.add('active');
    adminState.currentStatus = button.getAttribute('data-admin-status') || '';
    const statusFilter = document.getElementById('listing-status-filter');
    if (statusFilter) statusFilter.value = adminState.currentStatus;
    adminState.selectedListings.clear();
    loadListings().catch((error) => alert(error.message || String(error)));
  });
});
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const listingAction = target.dataset.listingAction;
  const reportAction = target.dataset.reportAction;
  const bulkListingAction = target.dataset.bulkListingAction;
  const historyId = target.dataset.historyId;
  if (listingAction) {
    actionOnListing(target.dataset.id, listingAction).catch((error) => alert(error.message || String(error)));
  }
  if (reportAction) {
    actionOnReport(target.dataset.id, reportAction).catch((error) => alert(error.message || String(error)));
  }
  if (bulkListingAction) {
    bulkActionOnListings(bulkListingAction).catch((error) => alert(error.message || String(error)));
  }
  if (historyId) {
    loadListingHistory(historyId).catch((error) => alert(error.message || String(error)));
  }
  if (target.dataset.closeHistory !== undefined) {
    const history = document.getElementById('admin-history');
    if (history) {
      history.hidden = true;
      history.innerHTML = '';
    }
  }
});
document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const listingId = target.dataset.selectListing;
  if (listingId) {
    if (target.checked) adminState.selectedListings.add(listingId);
    else adminState.selectedListings.delete(listingId);
    updateBulkBar();
  }
  if (target.dataset.selectAllListings !== undefined) {
    document.querySelectorAll('[data-select-listing]').forEach((checkbox) => {
      if (!(checkbox instanceof HTMLInputElement)) return;
      checkbox.checked = target.checked;
      const id = checkbox.dataset.selectListing;
      if (target.checked && id) adminState.selectedListings.add(id);
      if (!target.checked && id) adminState.selectedListings.delete(id);
    });
    updateBulkBar();
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
