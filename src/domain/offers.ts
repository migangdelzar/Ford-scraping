import {createHash} from 'node:crypto';
import type {
  DocumentCandidate,
  OfferCandidate,
  OfferType,
} from './contracts.js';

export interface OfferInput extends Omit<
  Partial<OfferCandidate>,
  'title' | 'currency' | 'sourceUrl' | 'offerType'
> {
  title: string;
  currency: string;
  sourceUrl: string;
  offerType?: OfferType | string;
}

export interface PersistedOffer extends Omit<
  OfferCandidate,
  'sourceUrl' | 'metadata'
> {
  id: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
}

const OFFER_TYPES: OfferType[] = [
  'promotion',
  'discount',
  'financing',
  'months_without_interest',
  'cashback',
  'lease',
  'trade_in',
  'other',
];

function normalizedText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es-MX');
}

export function normalizeOfferType(value?: string): OfferType {
  const normalized = normalizedText(value ?? 'promotion');
  if (
    normalized.includes('meses sin intereses') ||
    normalized === 'msi' ||
    normalized.includes('sin intereses')
  ) {
    return 'months_without_interest';
  }
  if (
    normalized.includes('financ') ||
    normalized.includes('credito') ||
    normalized.includes('credit')
  ) {
    return 'financing';
  }
  if (normalized.includes('descuento')) return 'discount';
  if (normalized.includes('cashback') || normalized.includes('bonificacion'))
    return 'cashback';
  if (normalized.includes('arrendamiento') || normalized.includes('lease'))
    return 'lease';
  if (normalized.includes('intercambio') || normalized.includes('trade'))
    return 'trade_in';
  return OFFER_TYPES.includes(normalized as OfferType)
    ? (normalized as OfferType)
    : 'promotion';
}

export function normalizeOfferCandidate(input: OfferInput): OfferCandidate {
  return {
    ...input,
    title: input.title.trim(),
    offerType: normalizeOfferType(input.offerType),
    currency: input.currency.trim().toUpperCase(),
    requiresCreditApproval: input.requiresCreditApproval ?? true,
    metadata: input.metadata ?? {},
  };
}

export function isOfferActive(
  offer: Pick<OfferCandidate, 'validFrom' | 'validUntil'>,
  asOf: string,
): boolean {
  return getOfferValidityStatus(offer, asOf) === 'active';
}

export function getOfferValidityStatus(
  offer: Pick<OfferCandidate, 'validFrom' | 'validUntil'>,
  asOf: string,
): 'active' | 'expired' | 'upcoming' | 'unknown' {
  if (!offer.validFrom || !offer.validUntil) return 'unknown';
  if (offer.validFrom > asOf) return 'upcoming';
  if (offer.validUntil < asOf) return 'expired';
  return 'active';
}

export function getOfferDataQualityWarnings(
  metadata?: Record<string, unknown>,
): string[] {
  const conflict = metadata?.termConflict;
  if (!conflict || typeof conflict !== 'object') return [];
  const {labelMonths, structuredMonths} = conflict as Record<string, unknown>;
  if (typeof labelMonths !== 'number' || typeof structuredMonths !== 'number')
    return [];
  return [
    `El nombre del plan indica ${labelMonths} meses, pero el plazo estructurado es ${structuredMonths} meses. Confirmar con el distribuidor.`,
  ];
}

function money(
  value: number | undefined,
  currency: string,
): string | undefined {
  return value === undefined
    ? undefined
    : `${value.toLocaleString('en-US')} ${currency}`;
}

export function buildOfferDocument(offer: PersistedOffer): DocumentCandidate {
  const vehicle =
    offer.modelName && offer.modelYear
      ? `Ford ${offer.modelName} ${offer.modelYear}`
      : 'Ford';
  const lines = [
    vehicle,
    `Oferta: ${offer.title}`,
    `Tipo: ${offer.offerType}`,
    offer.provider ? `Proveedor: ${offer.provider}` : undefined,
    money(offer.cashPrice, offer.currency)
      ? `Precio: ${money(offer.cashPrice, offer.currency)}`
      : undefined,
    offer.monthsWithoutInterest === undefined
      ? undefined
      : `Meses sin intereses: ${offer.monthsWithoutInterest}`,
    offer.termMonths === undefined
      ? undefined
      : `Plazo: ${offer.termMonths} meses`,
    offer.downPaymentPercent === undefined
      ? undefined
      : `Enganche: ${offer.downPaymentPercent}%`,
    money(offer.downPaymentAmount, offer.currency)
      ? `Enganche: ${money(offer.downPaymentAmount, offer.currency)}`
      : undefined,
    money(offer.monthlyPayment, offer.currency)
      ? `Mensualidad: ${money(offer.monthlyPayment, offer.currency)}`
      : undefined,
    offer.annualInterestRate === undefined
      ? undefined
      : `Tasa anual: ${offer.annualInterestRate}%`,
    offer.catPercent === undefined ? undefined : `CAT: ${offer.catPercent}%`,
    offer.validFrom || offer.validUntil
      ? `Vigencia: ${offer.validFrom ?? 'sin inicio'} a ${offer.validUntil ?? 'sin fecha final'}`
      : 'Vigencia no indicada por la fuente; confirmar vigencia.',
    ...getOfferDataQualityWarnings(offer.metadata),
    offer.requiresCreditApproval
      ? 'Sujeto a aprobación de crédito.'
      : undefined,
    offer.conditions,
    offer.description,
  ].filter((line): line is string => Boolean(line && line.trim()));

  return {
    offerId: offer.id,
    documentType: 'offer',
    sectionKey: 'offer',
    chunkIndex: 0,
    title: `${vehicle} — ${offer.title}`,
    content: lines.join('\n'),
    modelName: offer.modelName,
    modelYear: offer.modelYear,
    metadata: {
      offerId: offer.id,
      offerType: offer.offerType,
      provider: offer.provider,
    },
  };
}

export function hashOffer(offer: OfferCandidate): string {
  const identity = {
    title: offer.title,
    description: offer.description,
    offerType: offer.offerType,
    provider: offer.provider,
    modelName: offer.modelName,
    modelYear: offer.modelYear,
    cashPrice: offer.cashPrice,
    discountAmount: offer.discountAmount,
    discountPercent: offer.discountPercent,
    downPaymentAmount: offer.downPaymentAmount,
    downPaymentPercent: offer.downPaymentPercent,
    monthlyPayment: offer.monthlyPayment,
    termMonths: offer.termMonths,
    monthsWithoutInterest: offer.monthsWithoutInterest,
    annualInterestRate: offer.annualInterestRate,
    catPercent: offer.catPercent,
    currency: offer.currency,
    validFrom: offer.validFrom,
    validUntil: offer.validUntil,
    requiresCreditApproval: offer.requiresCreditApproval,
    conditions: offer.conditions,
  };
  return createHash('sha256')
    .update(JSON.stringify(identity), 'utf8')
    .digest('hex');
}
