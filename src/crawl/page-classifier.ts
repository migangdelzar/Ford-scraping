import type {PageType} from '../domain/contracts.js';

export function classifyPage(url: URL, title: string, text: string): PageType {
  const path = url.pathname.toLocaleLowerCase('es-MX');
  const haystack = `${title} ${text}`.toLocaleLowerCase('es-MX');

  if (path.includes('aviso-de-privacidad')) return 'unknown';
  if (path.includes('/todos')) return 'catalog';
  if (path.includes('ficha-tecnica')) return 'technical_sheet';
  if (/\/comparativo\//.test(path)) return 'comparison';
  if (path.includes('promocion')) return 'promotion';
  if (path.includes('financiamiento')) return 'financing';
  if (path.includes('/servicio')) return 'service';
  if (path.includes('seminuevo') || path.includes('usado'))
    return 'used_vehicle';
  if (path.includes('pregunta') || path.includes('faq')) return 'faq';
  if (path === '/' || path.includes('contact') || path.includes('dealer'))
    return 'dealer_information';
  if (/\/(20\d{2}|2\d)\/?$/.test(path)) return 'model';
  if (haystack.includes('financiamiento')) return 'financing';
  return 'unknown';
}
