const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
]);

const REJECTED_PATH_PARTS = [
  'cotiza',
  'contactanos',
  'contacto',
  'forms',
  'formulario',
  'appointment',
  'agendar',
];

const NON_PAGE_EXTENSIONS = /\.(?:avif|css|gif|ico|jpe?g|js|pdf|png|svg|webp|woff2?|ttf|eot|mp4|webm)$/i;

export interface CrawlPolicy {
  baseUrl: URL;
  allowedHosts: Set<string>;
}

export function stripComparisonSelectorParamsFromText(value: string): string {
  return value.replace(
    /((?:https?:\/\/[^"'<>\s]+)?\/[^"'<>\s]*\/(?:20\d{2}|\d{2})\/Comparativo\/[^"'<>?\s]+\/?)\?([^"'<>\s]*)/gi,
    (match, route: string, query: string) =>
      /(?:^|&(?:amp;)?)(?:exterior|interior)=/i.test(query) ? route : match,
  );
}

export function normalizeUrl(rawUrl: string, baseUrl: URL): string {
  const url = new URL(rawUrl, baseUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.has(key.toLowerCase()))
      url.searchParams.delete(key);
  }
  if (/^\/.+\/(?:20\d{2}|\d{2})\/comparativo\/[^/]+\/?$/i.test(url.pathname)) {
    for (const key of [...url.searchParams.keys()]) {
      if (['exterior', 'interior'].includes(key.toLowerCase()))
        url.searchParams.delete(key);
    }
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

export function isAllowedPublicUrl(url: URL, policy: CrawlPolicy): boolean {
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (!policy.allowedHosts.has(url.hostname.toLowerCase())) return false;
  const path = url.pathname.toLocaleLowerCase('es-MX');
  if (REJECTED_PATH_PARTS.some(part => path.includes(part))) return false;
  if (
    path.includes('financiamiento') &&
    /(submit|send|apply|solicitud|form)/.test(path + url.search)
  )
    return false;
  return true;
}

export function isCrawlablePublicPage(url: URL, policy: CrawlPolicy): boolean {
  if (!isAllowedPublicUrl(url, policy) || NON_PAGE_EXTENSIONS.test(url.pathname))
    return false;
  // Comparativo uses color selectors in its query string; allow only those
  // parameters there so arbitrary search/filter combinations stay excluded.
  if (url.search) {
    if (!/^\/.+\/(?:20\d{2}|\d{2})\/comparativo\/[^/]+\/?$/i.test(url.pathname))
      return false;
    const allowed = new Set(['exterior', 'interior']);
    for (const key of url.searchParams.keys())
      if (!allowed.has(key.toLowerCase())) return false;
  }
  return true;
}
