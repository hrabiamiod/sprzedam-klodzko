const config = Object.assign({}, window.APP_CONFIG || {});

const state = {
  categories: [],
  types: [],
  listings: [],
  fixedCategory: '',
  stats: null
};

const CATEGORY_SLUGS = {
  elektronika: 'Elektronika',
  meble: 'Meble',
  auto: 'Auto',
  ubrania: 'Ubrania',
  uslugi: 'Usługi',
  inne: 'Inne'
};

const CATEGORY_DESCRIPTIONS = {
  Elektronika: 'Telefony, komputery, RTV, drobna elektronika i akcesoria od osób z Kłodzka i okolic.',
  Meble: 'Meble do domu, biura, ogrodu oraz wyposażenie wnętrz dostępne lokalnie.',
  Auto: 'Części, akcesoria, auta, motocykle i lokalne usługi związane z motoryzacją.',
  Ubrania: 'Odzież, obuwie, dodatki i rzeczy dziecięce wystawiane lokalnie.',
  Usługi: 'Lokalne usługi, pomoc, naprawy, zlecenia i oferty specjalistów z okolicy.',
  Inne: 'Pozostałe ogłoszenia lokalne, które nie pasują do głównych kategorii.'
};

const LISTING_DRAFT_KEY = 'sprzedam_listing_draft_v1';
const DRAFT_FIELDS = ['title', 'type', 'category', 'price', 'description', 'contact_name', 'contact_email', 'contact_phone', 'city', 'contact_consent'];

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

function setSiteName() {
  const node = document.getElementById('site-name');
  if (node) node.textContent = config.siteName || 'Sprzedam Kłodzko';
}

async function loadSiteConfig() {
  try {
    const payload = await fetchJson('/config');
    Object.assign(config, payload.config || {});
  } catch {
    // Keep the static defaults if the config endpoint is temporarily unavailable.
  }
  setSiteName();
}

function renderTurnstile(slotId, tokenInputId) {
  const slot = document.getElementById(slotId);
  const tokenInput = document.getElementById(tokenInputId);
  if (!slot || !tokenInput) return;

  tokenInput.value = '';
  if (!config.turnstileSiteKey) {
    slot.hidden = true;
    slot.innerHTML = '';
    return;
  }
  slot.hidden = false;
  if (!window.turnstile) {
    slot.textContent = 'Ładowanie weryfikacji anty-bot...';
    if (slot.dataset.pendingTurnstile !== '1') {
      slot.dataset.pendingTurnstile = '1';
      window.setTimeout(() => {
        slot.dataset.pendingTurnstile = '0';
        renderTurnstile(slotId, tokenInputId);
      }, 200);
    }
    return;
  }

  slot.innerHTML = '';
  const widgetId = window.turnstile.render(slot, {
    sitekey: config.turnstileSiteKey,
    callback: (token) => {
      tokenInput.value = token;
    },
    'expired-callback': () => {
      tokenInput.value = '';
    },
    'error-callback': () => {
      tokenInput.value = '';
    }
  });
  slot.dataset.widgetId = String(widgetId);
}

function money(cents, currency = 'PLN') {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2
  }).format((cents || 0) / 100);
}

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSubmissionMessage(payload) {
  const verifyUrl = payload?.links?.verify || '';
  const manageUrl = payload?.links?.manage || '';
  const notice = payload?.message || 'Ogłoszenie dodane.';
  return `
    <div class="submission-result">
      <strong>${esc(notice)}</strong>
      <p>Nie wysyłamy już e-maila. Zapisz linki poniżej, bo dają dostęp do weryfikacji i zarządzania ogłoszeniem. Zostaną też zapisane w tej przeglądarce.</p>
      <div class="submission-links">
        <a class="button small primary" href="${esc(verifyUrl)}" target="_blank" rel="noreferrer">Link weryfikacyjny</a>
        <a class="button small ghost" href="${esc(manageUrl)}" target="_blank" rel="noreferrer">Link zarządzania</a>
      </div>
      <p class="status-note">Link zarządzania pozwala edytować, usuwać i przedłużać ogłoszenie.</p>
    </div>
  `;
}

function listingCard(listing) {
  const image = listing.image_base64 ? `data:${listing.image_mime || 'image/jpeg'};base64,${listing.image_base64}` : '';
  const href = `/ogloszenie/${encodeURIComponent(listing.slug)}`;
  return `
    <a class="listing-card" href="${href}">
      ${image ? `<img class="listing-image" src="${image}" alt="${esc(listing.title)}" loading="lazy" />` : `<div class="listing-image"></div>`}
      <div class="card-top">
        <span class="pill">${esc(listing.type)}</span>
        <span class="pill gray">${esc(listing.category)}</span>
      </div>
      <h3>${esc(listing.title)}</h3>
      <p>${esc((listing.description || '').slice(0, 140))}${listing.description && listing.description.length > 140 ? '…' : ''}</p>
      <div class="listing-footer">
        <strong>${money(listing.price_cents, listing.currency)}</strong>
        <span class="status-note">${new Date(listing.created_at).toLocaleDateString('pl-PL')}</span>
      </div>
    </a>
  `;
}

function categorySlug(category) {
  const entry = Object.entries(CATEGORY_SLUGS).find(([, value]) => value === category);
  return entry ? entry[0] : encodeURIComponent(String(category).toLowerCase());
}

function renderCategoryLinks() {
  const target = document.getElementById('category-links');
  if (!target) return;
  target.innerHTML = state.categories.map((category) => `
    <a class="category-tile" href="/kategoria/${categorySlug(category)}">
      <strong>${esc(category)} <span>${esc(state.stats?.by_category?.[category] || 0)}</span></strong>
      <span>${esc(CATEGORY_DESCRIPTIONS[category] || 'Lokalne ogłoszenia w tej kategorii.')}</span>
    </a>
  `).join('');
}

function renderMarketStats() {
  const totalNode = document.getElementById('stat-total');
  const categoriesNode = document.getElementById('stat-categories');
  const latestNode = document.getElementById('stat-latest');
  if (totalNode && state.stats) totalNode.textContent = String(state.stats.total_active || 0);
  if (categoriesNode) categoriesNode.textContent = String(state.categories.length || 0);
  if (latestNode && state.stats?.latest_approved_at) {
    latestNode.textContent = new Date(state.stats.latest_approved_at).toLocaleDateString('pl-PL');
  }
}

function renderFilters() {
  const categorySelect = document.getElementById('filter-category');
  const typeSelect = document.getElementById('filter-type');
  const formCategory = document.querySelector('form[name="listing-form"]');
  if (categorySelect) {
    categorySelect.innerHTML = `<option value="">Wszystkie kategorie</option>` + state.categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join('');
  }
  if (typeSelect) {
    typeSelect.innerHTML = `<option value="">Wszystkie typy</option>` + state.types.map((type) => `<option value="${esc(type)}">${esc(type)}</option>`).join('');
  }
  const form = document.getElementById('listing-form');
  if (form) {
    const typeField = form.querySelector('[name="type"]');
    const categoryField = form.querySelector('[name="category"]');
    typeField.innerHTML = state.types.map((type) => `<option value="${esc(type)}">${esc(type)}</option>`).join('');
    categoryField.innerHTML = state.categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join('');
  }
  const categoriesStat = document.getElementById('stat-categories');
  if (categoriesStat) categoriesStat.textContent = String(state.categories.length || 0);
  renderMarketStats();
  renderCategoryLinks();
}

function updateStats(total) {
  const totalNode = document.getElementById('stat-total');
  if (totalNode) totalNode.textContent = String(state.fixedCategory ? total : state.stats?.total_active ?? total);
}

function renderListings(items) {
  const grid = document.getElementById('listing-grid');
  const empty = document.getElementById('empty-state');
  if (!grid) return;
  if (!items.length) {
    grid.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  grid.innerHTML = items.map(listingCard).join('');
}

async function loadListings() {
  const loadState = document.getElementById('load-state');
  if (loadState) loadState.textContent = 'Ładowanie...';
  const params = new URLSearchParams();
  const search = document.getElementById('search');
  const category = document.getElementById('filter-category');
  const type = document.getElementById('filter-type');
  if (search?.value) params.set('q', search.value);
  if (state.fixedCategory) params.set('category', state.fixedCategory);
  else if (category?.value) params.set('category', category.value);
  if (type?.value) params.set('type', type.value);
  params.set('limit', '12');
  const payload = await fetchJson(`/listings?${params.toString()}`);
  state.listings = payload.items || [];
  renderListings(state.listings);
  updateStats(payload.total || 0);
  if (loadState) loadState.textContent = `${payload.total || 0} ogłoszeń`;
}

async function initIndex() {
  await loadSiteConfig();
  const [payload, statsPayload] = await Promise.all([
    fetchJson('/categories'),
    fetchJson('/stats').catch(() => ({ ok: false }))
  ]);
  state.categories = payload.categories || [];
  state.types = payload.types || [];
  state.stats = statsPayload.ok ? statsPayload : null;
  renderFilters();
  renderTurnstile('create-turnstile-slot', 'create-turnstile-token');
  await loadListings();

  document.getElementById('apply-filters')?.addEventListener('click', (event) => {
    event.preventDefault();
    loadListings().catch(showError);
  });
  document.querySelectorAll('[data-type-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-type-filter]').forEach((node) => node.classList.remove('active'));
      button.classList.add('active');
      const type = button.getAttribute('data-type-filter') || '';
      const typeSelect = document.getElementById('filter-type');
      if (typeSelect) typeSelect.value = type;
      loadListings().catch(showError);
    });
  });
  document.getElementById('search')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      loadListings().catch(showError);
    }
  });
  document.querySelector('textarea[name="description"]')?.addEventListener('input', updateDescriptionCounter);
  document.querySelector('input[name="image"]')?.addEventListener('change', previewImage);
  document.getElementById('listing-form')?.addEventListener('submit', submitListing);
  initListingDraftAutosave();
  updateDescriptionCounter();
  setSiteName();
}

async function initCategoryPage() {
  await loadSiteConfig();
  const slug = new URLSearchParams(window.location.search).get('slug') || window.location.pathname.split('/').filter(Boolean).pop() || '';
  const category = CATEGORY_SLUGS[decodeURIComponent(slug)] || '';
  const root = document.getElementById('category-root');
  if (!category || !root) {
    if (root) root.innerHTML = '<div class="empty"><strong>Nie znaleziono kategorii.</strong><span>Wróć na stronę główną i wybierz kategorię z listy.</span></div>';
    return;
  }
  state.fixedCategory = category;
  const [payload, statsPayload] = await Promise.all([
    fetchJson('/categories'),
    fetchJson('/stats').catch(() => ({ ok: false }))
  ]);
  state.categories = payload.categories || [];
  state.types = payload.types || [];
  state.stats = statsPayload.ok ? statsPayload : null;
  document.title = `${category} - ogłoszenia lokalne Kłodzko`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', CATEGORY_DESCRIPTIONS[category] || `Ogłoszenia lokalne w kategorii ${category}.`);
  document.getElementById('category-title').textContent = `${category} w Kłodzku`;
  document.getElementById('category-description').textContent = CATEGORY_DESCRIPTIONS[category] || 'Lokalne ogłoszenia w tej kategorii.';
  renderFilters();
  const categorySelect = document.getElementById('filter-category');
  if (categorySelect) {
    categorySelect.value = category;
    categorySelect.disabled = true;
  }
  await loadListings();
  document.getElementById('apply-filters')?.addEventListener('click', (event) => {
    event.preventDefault();
    loadListings().catch(showError);
  });
  document.querySelectorAll('[data-type-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-type-filter]').forEach((node) => node.classList.remove('active'));
      button.classList.add('active');
      const type = button.getAttribute('data-type-filter') || '';
      const typeSelect = document.getElementById('filter-type');
      if (typeSelect) typeSelect.value = type;
      loadListings().catch(showError);
    });
  });
  document.getElementById('search')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      loadListings().catch(showError);
    }
  });
}

function updateDescriptionCounter() {
  const textarea = document.querySelector('textarea[name="description"]');
  const counter = document.getElementById('description-counter');
  if (!textarea || !counter) return;
  const length = textarea.value.trim().length;
  counter.textContent = length < 20 ? `${length}/20 znaków. Dopisz kilka konkretów.` : `${length} znaków.`;
}

function draftPayloadFromForm(form) {
  const data = new FormData(form);
  return Object.fromEntries(DRAFT_FIELDS.map((field) => {
    if (field === 'contact_consent') return [field, Boolean(data.get(field))];
    return [field, String(data.get(field) || '')];
  }));
}

function draftHasContent(draft) {
  return Object.entries(draft || {}).some(([key, value]) => key !== 'city' && key !== 'contact_consent' && String(value || '').trim());
}

function updateDraftStatus(message, canClear = true) {
  const target = document.getElementById('draft-status');
  if (!target) return;
  target.hidden = false;
  target.innerHTML = `
    <span>${esc(message)}</span>
    ${canClear ? '<button class="button ghost small" type="button" id="clear-draft">Wyczyść szkic</button>' : ''}
  `;
  document.getElementById('clear-draft')?.addEventListener('click', clearListingDraft);
}

function saveListingDraft() {
  const form = document.getElementById('listing-form');
  if (!form) return;
  const draft = draftPayloadFromForm(form);
  if (!draftHasContent(draft)) return;
  try {
    localStorage.setItem(LISTING_DRAFT_KEY, JSON.stringify({ ...draft, saved_at: new Date().toISOString() }));
    updateDraftStatus('Szkic zapisany w tej przeglądarce.');
  } catch {
    updateDraftStatus('Nie udało się zapisać szkicu w tej przeglądarce.', false);
  }
}

function restoreListingDraft() {
  const form = document.getElementById('listing-form');
  if (!form) return;
  try {
    const raw = localStorage.getItem(LISTING_DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    for (const field of DRAFT_FIELDS) {
      const input = form.elements[field];
      if (!input) continue;
      if (field === 'contact_consent') input.checked = Boolean(draft[field]);
      else if (draft[field] !== undefined && draft[field] !== null) input.value = draft[field];
    }
    updateDescriptionCounter();
    updateDraftStatus(`Przywrócono szkic z ${new Date(draft.saved_at || Date.now()).toLocaleString('pl-PL')}.`);
  } catch {
    clearListingDraft();
  }
}

function clearListingDraft() {
  try {
    localStorage.removeItem(LISTING_DRAFT_KEY);
  } catch {
    // Storage may be disabled in hardened/private browser contexts.
  }
  const target = document.getElementById('draft-status');
  if (target) {
    target.hidden = true;
    target.innerHTML = '';
  }
}

function initListingDraftAutosave() {
  const form = document.getElementById('listing-form');
  if (!form) return;
  restoreListingDraft();
  form.addEventListener('input', (event) => {
    if (event.target?.name === 'image') return;
    saveListingDraft();
  });
  form.addEventListener('change', (event) => {
    if (event.target?.name === 'image') return;
    saveListingDraft();
  });
}

async function previewImage(event) {
  const file = event.currentTarget?.files?.[0];
  const preview = document.getElementById('image-preview');
  if (!preview) return;
  if (!file) {
    preview.hidden = true;
    preview.innerHTML = '';
    return;
  }
  if (file.size > 750_000) {
    preview.hidden = false;
    preview.innerHTML = `<strong>Zdjęcie może być za duże.</strong><span>Maksymalny rozmiar produkcyjny to około 750 KB. Zmniejsz plik przed wysłaniem.</span>`;
    return;
  }
  const dataUrl = await fileToDataUrl(file);
  preview.hidden = false;
  preview.innerHTML = `<img src="${esc(dataUrl)}" alt="Podgląd zdjęcia" /><span>${esc(file.name)} · ${Math.ceil(file.size / 1024)} KB</span>`;
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

async function submitListing(event) {
  event.preventDefault();
  const message = document.getElementById('form-message');
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const imageFile = data.get('image');
  const body = {
    title: String(data.get('title') || ''),
    type: String(data.get('type') || ''),
    category: String(data.get('category') || ''),
    price: String(data.get('price') || ''),
    description: String(data.get('description') || ''),
    contact_name: String(data.get('contact_name') || ''),
    contact_email: String(data.get('contact_email') || ''),
    contact_phone: String(data.get('contact_phone') || ''),
    city: String(data.get('city') || config.city || 'Kłodzko'),
    contact_consent: Boolean(data.get('contact_consent')),
    turnstile_token: String(data.get('turnstile_token') || ''),
    image_data: imageFile instanceof File && imageFile.size ? await fileToDataUrl(imageFile) : null
  };
  if (config.turnstileSiteKey && !body.turnstile_token) {
    if (message) {
      message.hidden = false;
      message.textContent = 'Potwierdź weryfikację anty-bot przed wysłaniem ogłoszenia.';
    }
    submitButton.disabled = false;
    return;
  }
  submitButton.disabled = true;
  try {
    const payload = await fetchJson('/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    form.reset();
    clearListingDraft();
    renderTurnstile('create-turnstile-slot', 'create-turnstile-token');
    if (message) {
      message.hidden = false;
      message.innerHTML = `
        ${renderSubmissionMessage(payload)}
        <div class="submission-meta">
          <span>Ogłoszenie: ${esc(payload.listing?.title || '')}</span>
          <span>Stan: ${esc(payload.listing?.status || '')}</span>
        </div>
      `;
    }
    try {
      localStorage.setItem('sprzedam_last_submission', JSON.stringify({
        message: payload.message,
        listing: payload.listing,
        links: payload.links
      }));
    } catch {
      // Best effort only.
    }
    await loadListings();
  } catch (error) {
    if (message) {
      message.hidden = false;
      message.textContent = error.message || String(error);
    }
  } finally {
    submitButton.disabled = false;
  }
}

async function initListingPage() {
  await loadSiteConfig();
  const root = document.getElementById('detail-root');
  const slug = new URLSearchParams(window.location.search).get('slug');
  if (!slug) {
    root.innerHTML = '<div class="status-note">Brak identyfikatora ogłoszenia.</div>';
    return;
  }
  const payload = await fetchJson(`/listings/${encodeURIComponent(slug)}`);
  const listing = payload.item;
  document.title = `${listing.title} - ${config.siteName || 'Sprzedam Kłodzko'}`;
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', listing.description.slice(0, 160));
  const image = listing.image_base64 ? `data:${listing.image_mime || 'image/jpeg'};base64,${listing.image_base64}` : '';
  root.innerHTML = `
    <div class="detail-hero">
      <div class="detail-media">
        ${image ? `<img src="${image}" alt="${esc(listing.title)}" />` : '<div class="no-image">Brak zdjęcia</div>'}
      </div>
      <aside class="detail-panel">
        <div class="pill-row">
          <span class="pill">${esc(listing.type)}</span>
          <span class="pill gray">${esc(listing.category)}</span>
        </div>
        <h1 class="detail-title">${esc(listing.title)}</h1>
        <div class="detail-price">${money(listing.price_cents, listing.currency)}</div>
        <div class="detail-meta">
          <span class="pill gray">${esc(listing.city || 'Kłodzko')}</span>
          <span class="pill gray">${new Date(listing.created_at).toLocaleDateString('pl-PL')}</span>
        </div>
        <div>
          <strong>Kontakt</strong>
          <p>${esc(listing.contact_name || '')}<br />${esc(listing.contact_email || '')}${listing.contact_phone ? `<br />${esc(listing.contact_phone)}` : ''}</p>
        </div>
        <div class="pill-row">
          <span class="tag ok">Aktywne</span>
          <span class="tag">${esc(listing.report_count || 0)} zgłoszeń</span>
        </div>
      </aside>
    </div>
    <div class="detail-copy">
      <span class="eyebrow">Opis</span>
      <p>${esc(listing.description).replace(/\n/g, '<br />')}</p>
    </div>
    <div class="detail-footer">
      <a class="button ghost" href="/">Wróć do listy</a>
      <div class="row-actions">
        <button class="button ghost" id="share-button" type="button">Kopiuj link</button>
        <button class="button primary" id="report-button" type="button">Zgłoś naruszenie</button>
      </div>
    </div>
    <form id="report-form" class="form-grid" hidden>
      <label class="full">
        <span>Powód zgłoszenia</span>
        <input name="reason" class="input" required />
      </label>
      <label class="full">
        <span>Szczegóły</span>
        <textarea name="details" class="input textarea"></textarea>
      </label>
      <label class="full">
        <span>E-mail (opcjonalnie)</span>
        <input name="reporter_email" class="input" type="email" />
      </label>
      <div class="turnstile-slot full" id="report-turnstile-slot"></div>
      <input type="hidden" name="turnstile_token" id="report-turnstile-token" />
      <button class="button primary" type="submit">Wyślij zgłoszenie</button>
    </form>
    <pre class="message" id="report-message" hidden></pre>
  `;
  document.getElementById('share-button')?.addEventListener('click', async () => {
    const message = document.getElementById('report-message');
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      if (message) {
        message.hidden = false;
        message.textContent = 'Link do ogłoszenia został skopiowany.';
      }
    } catch {
      if (message) {
        message.hidden = false;
        message.textContent = url;
      }
    }
  });
  document.getElementById('report-button')?.addEventListener('click', () => {
    const form = document.getElementById('report-form');
    form.hidden = !form.hidden;
    if (!form.hidden) {
      renderTurnstile('report-turnstile-slot', 'report-turnstile-token');
    }
  });
  document.getElementById('report-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const message = document.getElementById('report-message');
    const turnstileToken = String(data.get('turnstile_token') || '');
    if (config.turnstileSiteKey && !turnstileToken) {
      message.hidden = false;
      message.textContent = 'Potwierdź weryfikację anty-bot przed wysłaniem zgłoszenia.';
      return;
    }
    try {
      const payload = await fetchJson(`/listings/${encodeURIComponent(listing.id)}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason: String(data.get('reason') || ''),
          details: String(data.get('details') || ''),
          reporter_email: String(data.get('reporter_email') || ''),
          turnstile_token: turnstileToken
        })
      });
      message.hidden = false;
      message.textContent = payload.message;
      form.reset();
      form.hidden = true;
      renderTurnstile('report-turnstile-slot', 'report-turnstile-token');
    } catch (error) {
      message.hidden = false;
      message.textContent = error.message || String(error);
    }
  });
}

function showError(error) {
  const stateNode = document.getElementById('load-state');
  if (stateNode) stateNode.textContent = error.message || String(error);
}

function restoreLastSubmission() {
  const message = document.getElementById('form-message');
  if (!message) return;
  try {
    const raw = localStorage.getItem('sprzedam_last_submission');
    if (!raw) return;
    const data = JSON.parse(raw);
    message.hidden = false;
    message.innerHTML = `
      ${renderSubmissionMessage(data)}
      <div class="submission-meta">
        <span>Ogłoszenie: ${esc(data.listing?.title || '')}</span>
        <span>Stan: ${esc(data.listing?.status || '')}</span>
      </div>
    `;
  } catch {
    // Ignore invalid cached state.
  }
}

if (document.getElementById('listing-form')) {
  restoreLastSubmission();
  initIndex().catch(showError);
} else if (document.getElementById('category-root')) {
  initCategoryPage().catch(showError);
} else if (document.getElementById('detail-root')) {
  initListingPage().catch(showError);
}
