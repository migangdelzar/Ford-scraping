import {load} from 'cheerio';
import {sanitizeText} from '../crawl/text-normalization.js';
import type {PageParser} from '../crawl/page-parser.js';
import {normalizeOfferCandidate} from '../domain/offers.js';
import type {
  OfferCandidate,
  ParseResult,
  PageType,
  StoredPage,
} from '../domain/contracts.js';

export interface PublicPageCandidate {
  documentType: PageType;
  title: string;
  content: string;
  links: string[];
  sourceUrl: string;
  offers: OfferCandidate[];
}

const PUBLIC_TYPES = new Set<PageType>([
  'promotion',
  'financing',
  'service',
  'used_vehicle',
  'faq',
  'dealer_information',
]);

export class PublicPageParser implements PageParser<PublicPageCandidate> {
  supports(page: StoredPage): boolean {
    return PUBLIC_TYPES.has(page.pageType);
  }

  parse(page: StoredPage): ParseResult<PublicPageCandidate> {
    const $ = load(page.rawHtml);
    const content =
      sanitizeText($('main').text()) || sanitizeText($('body').text()) || '';
    const offers = $('.offer-card, [data-offer], [data-promotion], .promo-item')
      .map((_, element) => {
        const card = $(element);
        if (card.hasClass('promo-item'))
          return parseLivePromotionCard($, card, page);

        const data = (name: string): string | undefined =>
          card.attr(`data-${name}`) || undefined;
        const number = (name: string): number | undefined => {
          const value = data(name)?.replaceAll(',', '');
          if (!value) return undefined;
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : undefined;
        };
        const title =
          sanitizeText(card.find('h2, h3, h4').first().text()) ||
          data('title') ||
          sanitizeText(card.text()) ||
          'Ford offer';
        const description = card
          .find('p')
          .map((_, paragraph) => sanitizeText($(paragraph).text()) ?? '')
          .get()
          .join(' ');
        return normalizeOfferCandidate({
          title,
          description: description || undefined,
          offerType: data('offer-type') || title,
          provider: data('provider'),
          modelName: data('model'),
          modelYear: number('year'),
          cashPrice: number('cash-price'),
          discountAmount: number('discount-amount'),
          discountPercent: number('discount-percent'),
          downPaymentAmount: number('down-payment-amount'),
          downPaymentPercent: number('down-payment-percent'),
          monthlyPayment: number('monthly-payment'),
          termMonths: number('term-months'),
          monthsWithoutInterest: number('months-without-interest'),
          annualInterestRate: number('annual-interest-rate'),
          catPercent: number('cat-percent'),
          validFrom: data('valid-from'),
          validUntil: data('valid-until'),
          requiresCreditApproval: data('requires-credit-approval') !== 'false',
          conditions: undefined,
          currency: data('currency') || 'MXN',
          sourceUrl: page.url,
          metadata: {extraction: 'explicit-offer-card'},
        });
      })
      .get();
    return {
      value: {
        documentType: page.pageType,
        title: $('h1').first().text().trim() || page.title,
        content,
        links: $('a[href]')
          .map((_, element) =>
            new URL($(element).attr('href')!, page.url).toString(),
          )
          .get(),
        sourceUrl: page.url,
        offers,
      },
      warnings: [
        ...(content ? [] : ['Public page has no extracted text']),
        ...(offers.length ? [] : ['No explicit offer cards found']),
      ],
    };
  }
}

function parseLivePromotionCard(
  $: ReturnType<typeof load>,
  card: ReturnType<ReturnType<typeof load>>,
  page: StoredPage,
): OfferCandidate {
  const promotionBody =
    sanitizeText(card.find('.txt-promocion').text()) ||
    sanitizeText(card.text()) ||
    '';
  const href = card.find('a[href]').first().attr('href');
  const vehicleUrl = href ? new URL(href, page.url) : undefined;
  const routeVehicle = vehicleUrl ? parseVehicleRoute(vehicleUrl) : undefined;
  const modelName = routeVehicle?.modelName ??
    sanitizeText(card.find('h3').first().text());
  const title =
    card
      .find('.txt-promocion h4, .txt-promocion h2, .txt-promocion h3')
      .first()
      .text() ||
    `${modelName ?? 'Ford'} ${parseYear(promotionBody) ?? ''}`.trim();
  const modelPageUrl = vehicleUrl ? toVehicleModelPageUrl(vehicleUrl) : undefined;
  const dates = parseSpanishValidity(card.find('small').text() || card.text());
  const benefits = parsePromotionBenefits(promotionBody);
  const conditions = extractPromotionConditions(promotionBody);

  return normalizeOfferCandidate({
    title,
    description: promotionBody || undefined,
    offerType: 'promotion',
    modelName,
    modelYear:
      routeVehicle?.modelYear ?? parseYear(title) ?? parseYear(promotionBody),
    cashPrice: parseMoney(promotionBody, /precio\s+desde/i),
    discountAmount: parseMoney(promotionBody, /bono\s+de/i),
    monthlyPayment: parseMoney(promotionBody, /mensualidades?\s+desde/i),
    termMonths: parseTermMonths(promotionBody),
    monthsWithoutInterest: parseInterestFreeMonths(promotionBody),
    annualInterestRate: parseRate(promotionBody),
    catPercent: parseCat(promotionBody),
    downPaymentPercent: parseDownPayment(promotionBody),
    validFrom: dates?.validFrom,
    validUntil: dates?.validUntil,
    requiresCreditApproval:
      /sujeto\s+a\s+(?:an[aá]lisis|aprobaci[oó]n)\s+de\s+cr[eé]dito/i.test(
        promotionBody,
      ),
    conditions,
    currency: 'MXN',
    sourceUrl: page.url,
    metadata: {
      extraction: 'live-promo-item',
      externalPromotionId: card.attr('data-id'),
      promotionCategory: card.attr('data-tipopromo'),
      benefits,
      ...(modelPageUrl ? {modelUrl: modelPageUrl} : {}),
    },
  });
}

function parsePromotionBenefits(text: string): Array<Record<string, unknown>> {
  const benefits: Array<Record<string, unknown>> = [];
  const insurance =
    text.match(/[^.\n]*(?:primer\s+a[nñ]o|1\s*er\s+a[nñ]o)[^.\n]*seguro[^.\n]*(?:gratis|sin\s+costo|sin\s+costos)[^.\n]*/i) ??
    text.match(/[^.\n]*seguro\s+sin\s+costo[^.\n]*(?:primer\s+a[nñ]o|1\s*er\s+a[nñ]o)[^.\n]*/i);
  if (insurance)
    benefits.push({type: 'free_insurance', durationYears: 1, sourceText: insurance[0].trim()});
  const deferred = text.match(/[^.\n]*(?:primer\s+pago|primera\s+mensualidad)[^.\n]*(?:\d{1,3}\s+d[ií]as|\d{1,3}\s+meses)[^.\n]*/i);
  if (deferred) {
    const delay = deferred[0].match(/(\d{1,3})\s*(d[ií]as|meses)/i);
    benefits.push({
      type: 'deferred_first_payment',
      ...(delay ? {delay: Number(delay[1]), delayUnit: normalizeSpanish(delay[2])} : {}),
      sourceText: deferred[0].trim(),
    });
  }
  return benefits;
}

function extractPromotionConditions(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const anchors = /sujeto a an[aá]lisis de cr[eé]dito|sujeto a disponibilidad|no aplica(?: para)?|la diferencia en el costo del seguro|el bono puede ser aplicado|el bono debe aplicarse|aplica con la contrataci[oó]n|los recibos subsecuentes|aplican restricciones|aplican t[eé]rminos|consulta t[eé]rminos|consulta condiciones|no acumulable|hasta agotar existencias/gi;
  const starts = [...normalized.matchAll(anchors)].map(match => ({
    index: match.index ?? 0,
    text: match[0],
  }));
  const clauses = starts.map((start, index) => {
    const end = starts[index + 1]?.index ?? normalized.length;
    return normalized.slice(start.index, end).trim().replace(/[\s.;]+$/g, '.');
  });
  return clauses.length ? [...new Set(clauses)].join(' ') : undefined;
}

function parseVehicleRoute(
  url: URL,
): {modelName: string; modelYear: number} | undefined {
  const parts = url.pathname.split('/').filter(Boolean);
  const modelSlug = parts[0];
  const yearPart = parts[1];
  if (!yearPart || !modelSlug || !/^(?:20\d{2}|\d{2})$/.test(yearPart))
    return undefined;
  const modelName = decodeURIComponent(modelSlug)
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => `${part[0].toLocaleUpperCase('es-MX')}${part.slice(1).toLocaleLowerCase('es-MX')}`)
    .join(' ');
  const modelYear = Number(yearPart.length === 2 ? `20${yearPart}` : yearPart);
  return modelName && Number.isInteger(modelYear)
    ? {modelName, modelYear}
    : undefined;
}

function toVehicleModelPageUrl(url: URL): string | undefined {
  const match = url.pathname.match(/^\/([^/]+)\/(20\d{2}|\d{2})(?:\/|$)/);
  if (!match) return undefined;
  return new URL(`/${match[1]}/${match[2]}/`, url.origin).toString();
}

function parseMoney(text: string, label: RegExp): number | undefined {
  const match = text.match(
    new RegExp(`${label.source}[^$]{0,80}\\$\\s*([\\d,]+(?:\\.\\d+)?)`, 'i'),
  );
  return match ? Number(match[1].replaceAll(',', '')) : undefined;
}

function parseYear(text: string): number | undefined {
  const match = text.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function parseTermMonths(text: string): number | undefined {
  const match = text.match(/\b(\d{1,3})\s*(?:\([^)]*\)\s*)?meses?\b/i);
  return match ? Number(match[1]) : undefined;
}

function parseInterestFreeMonths(text: string): number | undefined {
  const match = normalizeSpanish(text).match(
    /(\d+)\s+meses?\s+sin\s+intereses?/i,
  );
  return match ? Number(match[1]) : undefined;
}

function parseRate(text: string): number | undefined {
  const match = normalizeSpanish(text).match(
    /tasa(?:\s+de\s+interes)?(?:\s+anual(?:\s+ordinario)?(?:\s+fija)?)?\s+(?:del?\s+)?(\d+(?:\.\d+)?)\s*%/i,
  );
  return match ? Number(match[1]) : undefined;
}

function parseCat(text: string): number | undefined {
  const match = normalizeSpanish(text).match(
    /cat\s+promedio\s+(\d+(?:\.\d+)?)\s*%/i,
  );
  return match ? Number(match[1]) : undefined;
}

function parseDownPayment(text: string): number | undefined {
  const match = normalizeSpanish(text).match(
    /enganche\s+minimo\s+del\s+(\d+(?:\.\d+)?)\s*%/i,
  );
  return match ? Number(match[1]) : undefined;
}

function parseSpanishValidity(
  text: string,
): {validFrom?: string; validUntil?: string} | undefined {
  const normalized = normalizeSpanish(text);
  const match = normalized.match(
    /(?:del\s+)?(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(20\d{2})\s+al\s+(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(20\d{2})/i,
  );
  if (!match) return undefined;
  const validFrom = isoDate(match[1], match[2], match[3]);
  const validUntil = isoDate(match[4], match[5], match[6]);
  return validFrom && validUntil ? {validFrom, validUntil} : undefined;
}

function isoDate(day: string, month: string, year: string): string | undefined {
  const monthNumber =
    [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ].indexOf(month) + 1;
  return monthNumber > 0
    ? `${year}-${String(monthNumber).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`
    : undefined;
}

function normalizeSpanish(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('es-MX');
}

export function parsePublicInformationPage(
  page: StoredPage,
): ParseResult<PublicPageCandidate> {
  return new PublicPageParser().parse(page);
}
