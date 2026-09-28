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

export interface CrawlPolicy {
  baseUrl: URL;
  allowedHosts: Set<string>;
}

export function normalizeUrl(rawUrl: string, baseUrl: URL): string {
  const url = new URL(rawUrl, baseUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.has(key.toLowerCase()))
      url.searchParams.delete(key);
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
