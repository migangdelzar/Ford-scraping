import {describe, expect, it} from 'vitest';
import {normalizeFinancingOffers} from '../../src/finance/financing-offers.js';
import {hashOffer, normalizeOfferCandidate} from '../../src/domain/offers.js';

describe('normalizeFinancingOffers', () => {
  it('creates one structured offer per financing plan and term', () => {
    const offers = normalizeFinancingOffers({
      sourceUrl: 'https://www.forduruapan.mx/Financiamiento/',
      vehicles: [
        {modelName: 'Territory', modelYear: 2026, vehicleKey: 'TERR26'},
      ],
      versionsByVehicleKey: new Map([
        [
          'TERR26',
          {
            Versiones: [
              {
                modeloJato: 'Territory',
                anio: '26',
                VersionJato: 'Titanium',
                precioLista: 789900,
                IDClaveVersion: 'VERSION-1',
                xsID: 'TERR26',
              },
            ],
          },
        ],
      ]),
      plansByVersionId: new Map([
        [
          'VERSION-1',
          {
            Planes: [
              {
                plaID: 1,
                plaNombre: '24 meses sin intereses',
                plaBono: 0,
                plaIva1: 16,
                plaInv: 0,
                plaEngMax: 80,
              },
            ],
            Plazos: [{plaid: 1, tasa: 0, EngancheMin: 20, plazo: 24}],
            Seguros: [{Precio: 0}, {Precio: 0}],
            Mensaje: [{Mensaje: 'Sujeto a aprobación de crédito.'}],
          },
        ],
      ]),
    });

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      modelName: 'Territory',
      modelYear: 2026,
      title: 'Territory Titanium - 24-month financing',
      offerType: 'months_without_interest',
      cashPrice: 789900,
      monthlyPayment: 26330,
      downPaymentPercent: 20,
      termMonths: 24,
      monthsWithoutInterest: 24,
      annualInterestRate: 0,
      taxRatePercent: 16,
      openingCommissionRatePercent: 0,
      maximumDownPaymentPercent: 80,
      lifeInsurancePrice: 0,
      requiresCreditApproval: true,
      sourceUrl: 'https://www.forduruapan.mx/Financiamiento/',
    });
    expect(offers[0].metadata).toMatchObject({
      vehicleKey: 'TERR26',
      versionId: 'VERSION-1',
      planId: '1',
      termMonths: 24,
      externalKey: 'TERR26:VERSION-1:1:24',
      monthlyPaymentSource: 'calculated-from-ford-ui-formula',
    });
  });

  it('skips incomplete versions and terms instead of inventing financial values', () => {
    const offers = normalizeFinancingOffers({
      sourceUrl: 'https://www.forduruapan.mx/Financiamiento/',
      vehicles: [],
      versionsByVehicleKey: new Map([
        [
          'UNKNOWN',
          {Versiones: [{IDClaveVersion: 'VERSION-2', precioLista: 800000}]},
        ],
      ]),
      plansByVersionId: new Map([
        ['VERSION-2', {Planes: [{plaID: 2, plaNombre: 'Plan'}], Plazos: []}],
      ]),
    });

    expect(offers).toEqual([]);
  });

  it('keeps a financing plan as financing when its label conflicts with the term', () => {
    const offers = normalizeFinancingOffers({
      sourceUrl: 'https://www.forduruapan.mx/Financiamiento/',
      vehicles: [{modelName: 'Explorer', modelYear: 2026, vehicleKey: 'EXP26'}],
      versionsByVehicleKey: new Map([
        [
          'EXP26',
          {
            Versiones: [
              {
                modeloJato: 'Explorer',
                anio: '26',
                VersionJato: 'Active',
                precioLista: 1193600,
                IDClaveVersion: 'VERSION-3',
                xsID: 'EXP26',
              },
            ],
          },
        ],
      ]),
      plansByVersionId: new Map([
        [
          'VERSION-3',
          {
            Planes: [
              {
                plaID: 3,
                plaNombre: '24 Meses Tasa 13.79% 35% de Enganche',
                plaIva1: 0,
              },
            ],
            Plazos: [{plaid: 3, tasa: 13.79, EngancheMin: 35, plazo: 72}],
          },
        ],
      ]),
    });

    expect(offers[0]).toMatchObject({
      offerType: 'financing',
      termMonths: 72,
      metadata: {
        termConflict: {labelMonths: 24, structuredMonths: 72},
      },
    });
  });

  it('changes the offer identity when structured financing inputs change', () => {
    const offer = normalizeOfferCandidate({
      title: 'Example plan',
      offerType: 'financing',
      currency: 'MXN',
      sourceUrl: 'https://example.com/financing',
      annualInterestRate: 12,
      taxRatePercent: 16,
      requiresCreditApproval: true,
    });

    expect(hashOffer({...offer, taxRatePercent: 8})).not.toBe(hashOffer(offer));
  });
});
