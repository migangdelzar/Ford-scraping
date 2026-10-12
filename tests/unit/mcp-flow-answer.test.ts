import {describe, expect, it} from 'vitest';
import {
  isCompleteVehicleDetail,
  synthesizeFlowAnswer,
} from '../../scripts/mcp-flow-answer.js';

describe('MCP synthetic flow answers', () => {
  it('accepts an unavailable model page when the catalog price source is present', () => {
    expect(
      isCompleteVehicleDetail({
        model: 'TERRITORY',
        year: 2026,
        modelPageUnavailable: true,
        priceSourceUrl: 'https://www.forduruapan.mx/Todos/',
        specifications: [],
        features: [],
      }),
    ).toBe(true);
  });

  it('treats a missing exact year with available-year options as a valid lookup', () => {
    expect(
      isCompleteVehicleDetail({
        model: 'TERRITORY HÍBRIDA',
        requestedYear: 2026,
        status: 'model_year_not_found',
        availableModelYears: [2027],
        options: [
          {
            year: 2027,
            modelPageUrl: 'https://www.forduruapan.mx/TERRITORY-HIBRIDA/27/',
          },
        ],
      }),
    ).toBe(true);
  });

  it('reports the available year and avoids quoting a mismatched year offer', () => {
    const answer = synthesizeFlowAnswer(
      {model: 'TERRITORY HÍBRIDA', budget: 790_000},
      {modelName: 'TERRITORY', modelYear: 2026, price: 559_900},
      {
        model: 'TERRITORY HÍBRIDA',
        requestedYear: 2026,
        status: 'model_year_not_found',
        availableModelYears: [2027],
        options: [
          {
            year: 2027,
            modelPageUrl: 'https://www.forduruapan.mx/TERRITORY-HIBRIDA/27/',
          },
        ],
      },
      {
        results: [
          {
            modelName: 'TERRITORY HÍBRIDA',
            modelYear: 2026,
            title: 'Legacy plan',
            cashPrice: 719_900,
            monthlyPayment: 11_000,
          },
        ],
      },
    );

    expect(answer).toContain('No TERRITORY HÍBRIDA 2026 catalog record');
    expect(answer).toContain('TERRITORY-HIBRIDA/27/');
    expect(answer).toContain(
      'applicability to a current exact vehicle cannot be confirmed',
    );
    expect(answer).not.toContain('MXN $11,000');
  });

  it('does not pair an alternative vehicle with the requested vehicle financing', () => {
    const answer = synthesizeFlowAnswer(
      {model: 'BRONCO', budget: 800_000},
      {
        modelName: 'BRONCO SPORT',
        modelYear: 2026,
        price: 773_500,
        modelPageUrl: 'https://www.forduruapan.mx/BRONCO-SPORT/26/',
      },
      {
        model: 'BRONCO',
        year: 2026,
        price: 998_500,
        modelPageUrl: 'https://www.forduruapan.mx/BRONCO/26/',
        specifications: [],
        features: [],
      },
      {
        results: [
          {
            modelName: 'BRONCO',
            modelYear: 2026,
            title: 'Bronco base financing',
            cashPrice: 998_500,
            monthlyPayment: 34_144,
            annualInterestRate: 13.79,
          },
        ],
      },
    );

    expect(answer).toContain('Requested BRONCO 2026');
    expect(answer).toContain('Alternative result: BRONCO SPORT 2026');
    expect(answer).toContain('https://www.forduruapan.mx/BRONCO-SPORT/26/');
    expect(answer).toContain('Financing for requested BRONCO 2026');
    expect(answer).not.toContain('BRONCO SPORT 2026; vehicle price');
  });
});
