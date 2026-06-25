const config = window.APP_CONFIG || {};

function api(path) {
  return `${config.apiBase || '/api'}${path}`;
}

async function fetchJson(path, options = {}) {
  const response = await fetch(api(path), {
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
    // Keep the static defaults if config is unavailable.
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

const STATUS_LABELS = {
  pending: 'Oczekuje na moderację',
  approved: 'Opublikowane',
  rejected: 'Odrzucone',
  expired: 'Wygasłe',
  archived: 'Archiwum'
};

function formatDate(value) {
  if (!value) return 'brak';
  return new Date(value).toLocaleString('pl-PL');
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || 'nieznany';
}

function publicListingUrl(listing) {
  return `${window.location.origin}/ogloszenie/${encodeURIComponent(listing.slug)}`;
}

async function fileToDataUrl(file) {
  if (!file) return null;
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Nie udało się wczytać zdjęcia'));
    reader.readAsDataURL(file);
  });
}

function getToken() {
  return new URLSearchParams(window.location.search).get('token') || '';
}

function renderListing(listing, tokenPurpose) {
  const image = listing.image_base64 ? `data:${listing.image_mime || 'image/jpeg'};base64,${listing.image_base64}` : '';
  const canManage = tokenPurpose === 'manage_listing';
  const publicUrl = publicListingUrl(listing);
  const root = document.getElementById('manage-root');
  root.innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow">Panel ogłoszenia</span>
        <h1>${esc(listing.title)}</h1>
      </div>
      <div class="status-note">Status: ${esc(statusLabel(listing.status))}</div>
    </div>
    <div class="metric-grid manage-metrics">
      <div class="metric"><strong>${esc(statusLabel(listing.status))}</strong><span>Status publikacji</span></div>
      <div class="metric"><strong>${esc(formatDate(listing.expires_at))}</strong><span>Wygasa</span></div>
      <div class="metric"><strong>${esc(formatDate(listing.updated_at))}</strong><span>Ostatnia zmiana</span></div>
    </div>
    <div class="detail-hero">
      <div class="detail-media">
        ${image ? `<img src="${image}" alt="${esc(listing.title)}" />` : '<div class="no-image">Brak zdjęcia</div>'}
      </div>
      <aside class="detail-panel">
        <div class="pill-row">
          <span class="pill">${esc(listing.type)}</span>
          <span class="pill gray">${esc(listing.category)}</span>
        </div>
        <div class="detail-price">${money(listing.price_cents, listing.currency)}</div>
        <p>${esc(listing.description)}</p>
        <div class="pill-row">
          <span class="tag">${esc(listing.contact_email)}</span>
          ${listing.contact_phone ? `<span class="tag">${esc(listing.contact_phone)}</span>` : ''}
        </div>
        <div class="pill-row">
          <span class="tag ok">Weryfikacja: ${esc(statusLabel(listing.status))}</span>
        </div>
      </aside>
    </div>
    <section class="publish-panel" id="edit-section">
      <div class="section-head">
        <div>
          <span class="eyebrow">Edycja</span>
          <h2>Zmień dane ogłoszenia</h2>
        </div>
        <div class="status-note">Po edycji opublikowane ogłoszenie wraca do moderacji.</div>
      </div>
      <form id="edit-form" class="form-grid">
        <label>
          <span>Tytuł</span>
          <input name="title" class="input" value="${esc(listing.title)}" required />
        </label>
        <label>
          <span>Typ</span>
          <select name="type" class="input" required>
            <option ${listing.type === 'sprzedam' ? 'selected' : ''}>sprzedam</option>
            <option ${listing.type === 'kupię' ? 'selected' : ''}>kupię</option>
            <option ${listing.type === 'oddam' ? 'selected' : ''}>oddam</option>
            <option ${listing.type === 'szukam' ? 'selected' : ''}>szukam</option>
          </select>
        </label>
        <label>
          <span>Kategoria</span>
          <select name="category" class="input" required>
            <option ${listing.category === 'Elektronika' ? 'selected' : ''}>Elektronika</option>
            <option ${listing.category === 'Meble' ? 'selected' : ''}>Meble</option>
            <option ${listing.category === 'Auto' ? 'selected' : ''}>Auto</option>
            <option ${listing.category === 'Ubrania' ? 'selected' : ''}>Ubrania</option>
            <option ${listing.category === 'Usługi' ? 'selected' : ''}>Usługi</option>
            <option ${listing.category === 'Inne' ? 'selected' : ''}>Inne</option>
          </select>
        </label>
        <label>
          <span>Cena</span>
          <input name="price" class="input" value="${esc((listing.price_cents / 100).toString())}" />
        </label>
        <label class="full">
          <span>Opis</span>
          <textarea name="description" class="input textarea" required>${esc(listing.description)}</textarea>
        </label>
        <label>
          <span>Kontakt</span>
          <input name="contact_name" class="input" value="${esc(listing.contact_name || '')}" />
        </label>
        <label>
          <span>E-mail</span>
          <input name="contact_email" class="input" type="email" value="${esc(listing.contact_email || '')}" required />
        </label>
        <label>
          <span>Telefon</span>
          <input name="contact_phone" class="input" value="${esc(listing.contact_phone || '')}" />
        </label>
        <label>
          <span>Miejscowość</span>
          <input name="city" class="input" value="${esc(listing.city || 'Kłodzko')}" />
        </label>
        <label class="full">
          <span>Nowe zdjęcie</span>
          <input name="image" class="input" type="file" accept="image/*" />
        </label>
        <button class="button primary" type="submit">Zapisz zmiany</button>
      </form>
    </section>
    <section class="publish-panel">
      <div class="section-head">
        <div>
          <span class="eyebrow">Operacje</span>
          <h2>Publikacja i udostępnianie</h2>
        </div>
      </div>
      <div class="hero-actions">
        <button class="button primary" id="extend-button" type="button">Przedłuż o 30 dni</button>
        <button class="button ghost" id="copy-public-link" type="button">Kopiuj link publiczny</button>
        <a class="button ghost" href="${esc(publicUrl)}" target="_blank" rel="noreferrer">Zobacz publicznie</a>
        ${canManage ? '<button class="button ghost danger-action" id="delete-button" type="button">Usuń ogłoszenie</button>' : ''}
        <a class="button ghost" href="/">Wróć do listy</a>
      </div>
      <pre class="message" id="manage-message" hidden></pre>
    </section>
  `;
  if (!canManage) {
    const editSection = document.getElementById('edit-section');
    editSection.hidden = true;
  }
}

async function init() {
  await loadSiteConfig();
  const token = getToken();
  const root = document.getElementById('manage-root');
  if (!token) {
    root.innerHTML = '<div class="status-note">Brak tokenu ogłoszenia w adresie URL.</div>';
    return;
  }
  const payload = await fetchJson(`/manage/${encodeURIComponent(token)}`);
  const listing = payload.listing;
  renderListing(listing, payload.token_purpose);

  const message = document.getElementById('manage-message');
  document.getElementById('copy-public-link')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(publicListingUrl(listing));
      message.hidden = false;
      message.textContent = 'Link publiczny został skopiowany.';
    } catch {
      message.hidden = false;
      message.textContent = publicListingUrl(listing);
    }
  });
  document.getElementById('edit-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const imageFile = data.get('image');
    try {
      await fetchJson(`/manage/${encodeURIComponent(token)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: String(data.get('title') || ''),
          type: String(data.get('type') || ''),
          category: String(data.get('category') || ''),
          price: String(data.get('price') || ''),
          description: String(data.get('description') || ''),
          contact_name: String(data.get('contact_name') || ''),
          contact_email: String(data.get('contact_email') || ''),
          contact_phone: String(data.get('contact_phone') || ''),
          city: String(data.get('city') || ''),
          image_data: imageFile instanceof File && imageFile.size ? await fileToDataUrl(imageFile) : null
        })
      });
      message.hidden = false;
      message.textContent = 'Zapisano. Ogłoszenie wróciło do kolejki moderacji.';
    } catch (error) {
      message.hidden = false;
      message.textContent = error.message || String(error);
    }
  });

  document.getElementById('extend-button')?.addEventListener('click', async () => {
    try {
      const response = await fetchJson(`/manage/${encodeURIComponent(token)}/extend`, {
        method: 'POST'
      });
      message.hidden = false;
      message.textContent = response.message || 'Przedłużono ogłoszenie.';
    } catch (error) {
      message.hidden = false;
      message.textContent = error.message || String(error);
    }
  });

  document.getElementById('delete-button')?.addEventListener('click', async () => {
    if (!window.confirm('Usunąć ogłoszenie bez możliwości cofnięcia?')) return;
    try {
      const response = await fetchJson(`/manage/${encodeURIComponent(token)}`, {
        method: 'DELETE'
      });
      message.hidden = false;
      message.textContent = response.message || 'Usunięto ogłoszenie.';
    } catch (error) {
      message.hidden = false;
      message.textContent = error.message || String(error);
    }
  });
}

init().catch((error) => {
  const root = document.getElementById('manage-root');
  root.innerHTML = `<div class="status-note">${esc(error.message || String(error))}</div>`;
});
