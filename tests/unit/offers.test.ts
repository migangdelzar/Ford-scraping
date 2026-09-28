import {describe, expect, it} from 'vitest';
import {
  buildOfferDocument,
  isOfferActive,
  getOfferValidityStatus,
  normalizeOfferCandidate,
  normalizeOfferType,
} from '../../src/domain/offers.js';

describe('offer domain', () => {
  it('recognizes MSI as a financing offer type', () => {
    expect(normalizeOfferType('12 meses sin intereses')).toBe(
      'months_without_interest',
    );
  });

  it('treats an offer as active on its end date', () => {
    expect(
      isOfferActive(
        {validFrom: '2026-09-01', validUntil: '2026-09-30'},
        '2026-09-30',
      ),
    ).toBe(true);
    expect(
      isOfferActive(
        {validFrom: '2026-09-01', validUntil: '2026-09-30'},
        '2026-10-01',
      ),
    ).toBe(false);
  });

  it('marks offers with missing validity dates as unknown', () => {
    expect(getOfferValidityStatus({}, '2026-09-27')).toBe('unknown');
    expect(isOfferActive({}, '2026-09-27')).toBe(false);
  });

  it('does not invent missing financing terms', () => {
    const result = normalizeOfferCandidate({
      title: 'Oferta',
      offerType: 'financing',
      currency: 'MXN',
      sourceUrl: '/oferta',
    });

    expect(result.monthlyPayment).toBeUndefined();
    expect(result.annualInterestRate).toBeUndefined();
    expect(result.requiresCreditApproval).toBe(true);
  });

  it('builds a searchable document with explicit financial terms', () => {
    const document = buildOfferDocument({
      id: 'offer-1',
      title: '12 meses sin intereses',
      offerType: 'months_without_interest',
      provider: 'BBVA',
      modelName: 'Territory',
      modelYear: 2026,
      monthsWithoutInterest: 12,
      downPaymentPercent: 20,
      validUntil: '2026-10-31',
      currency: 'MXN',
      requiresCreditApproval: true,
      conditions: 'Sujeto a aprobación de crédito.',
    });

    expect(document.documentType).toBe('offer');
    expect(document.content).toContain('12 meses sin intereses');
    expect(document.content).toContain('12');
    expect(document.content).toContain('BBVA');
    expect(document.content).toContain('Sujeto a aprobación de crédito.');
  });

  it('warns when a plan label and structured term disagree', () => {
    const document = buildOfferDocument({
      id: 'offer-conflict',
      title: 'Explorer 72-month financing',
      offerType: 'financing',
      description: '24 Meses Tasa 13.79%',
      termMonths: 72,
      currency: 'MXN',
      requiresCreditApproval: true,
      sourceUrl: '/Financiamiento/',
      metadata: {
        termConflict: {labelMonths: 24, structuredMonths: 72},
      },
    });

    expect(document.content).toContain(
      'El nombre del plan indica 24 meses, pero el plazo estructurado es 72 meses.',
    );
  });
});
