const isPagesPreview = window.location.hostname.endsWith('.pages.dev');

window.APP_CONFIG = {
  siteName: 'Sprzedam Kłodzko',
  apiBase: isPagesPreview ? 'https://sprzedam-klodzko-api-dev.michal-4ba.workers.dev/api' : '/api',
  city: 'Kłodzko',
  turnstileSiteKey: '',
  siteUrl: window.location.origin
};
