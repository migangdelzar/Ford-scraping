import {describe, expect, it} from 'vitest';
import {
  scoreMcpConversation,
  summarizeMcpToolResult,
} from '../../scripts/mcp-conversation-scoring.js';

describe('scoreMcpConversation', () => {
  it('scores financing disclosures from the composite tool result', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['search_vehicle_and_offers'], budget: 700_000},
      ['search_vehicle_and_offers'],
      [
        {
          tool: 'search_vehicle_and_offers',
          value: {
            vehicles: {
              results: [
                {
                  model: 'TERRITORY',
                  price: 559_900,
                  priceDisplay: 'MXN $559,900',
                },
              ],
            },
            offers: {
              results: [
                {
                  cashPrice: 770_000,
                  monthlyPayment: 20_000,
                  validityStatus: 'unknown',
                  dataQualityWarnings: ['El plazo no coincide con el nombre'],
                },
              ],
            },
          },
        },
      ],
      'TERRITORY cuesta MXN $559,900. El financiamiento cuesta $770,000. Rebasan tu presupuesto. La vigencia no está confirmada y el plazo tiene una inconsistencia.',
    );

    expect(score).toEqual({passed: true, failures: []});
  });

  it('rejects vehicle and offer claims that contradict empty or non-empty sections', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['search_vehicle_and_offers']},
      ['search_vehicle_and_offers'],
      [
        {
          tool: 'search_vehicle_and_offers',
          value: {
            vehicles: {results: [{model: 'RANGER', year: 2026}]},
            offers: {resultCount: 0, results: []},
          },
        },
      ],
      'No hay vehículos para ti y encontré financiamiento disponible.',
    );

    expect(score.failures).toEqual(
      expect.arrayContaining([
        'contradicted_vehicle_results',
        'unsupported_offer_availability_claim',
      ]),
    );
  });

  it('accepts explicit negative financing availability in combined results', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['search_vehicle_and_offers']},
      ['search_vehicle_and_offers'],
      [
        {
          tool: 'search_vehicle_and_offers',
          value: {
            vehicles: {results: []},
            offers: {resultCount: 0, results: []},
          },
        },
      ],
      'No hay vehículos disponibles para opciones de crédito. No hay ofertas encontradas.',
    );

    expect(score.failures).not.toContain(
      'unsupported_offer_availability_claim',
    );
  });

  it('rejects labeling a populated specification as missing', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['get_vehicle']},
      ['get_vehicle'],
      [
        {
          tool: 'get_vehicle',
          value: {
            specifications: [
              {name: 'Control de Crucero', value: 'Adaptativo con Stop & Go'},
            ],
          },
        },
      ],
      'Faltan detalles para los siguientes elementos: Control de Crucero.',
    );

    expect(score.failures).toContain('unsupported_missing_spec_claim');
  });

  it('rejects missing-spec claims that use a paraphrased label', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['get_vehicle']},
      ['get_vehicle'],
      [
        {
          tool: 'get_vehicle',
          value: {
            specifications: [
              {
                name: 'Asiento de Pasajero ajuste eléctrico',
                value: '4 posiciones',
              },
            ],
          },
        },
      ],
      'Faltan especificaciones como los asientos de pasajero.',
    );

    expect(score.failures).toContain('unsupported_missing_spec_claim');
  });

  it('requires missing-spec claims to match the MCP missingSpecificationNames list', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['get_vehicle']},
      ['get_vehicle'],
      [
        {
          tool: 'get_vehicle',
          value: {
            missingSpecificationNames: ['Cancelación activa de ruido'],
            specifications: [],
          },
        },
      ],
      'Faltan especificaciones como los asientos de pasajero.',
    );

    expect(score.failures).toContain('unsupported_missing_spec_claim');
  });

  it('rejects claiming promotions exist when the promotion result is empty', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['list_promotions', 'search_offers']},
      ['list_promotions', 'search_offers'],
      [
        {tool: 'list_promotions', value: []},
        {tool: 'search_offers', value: {results: [{title: 'F-150 credit'}]}},
      ],
      'Hay promociones y financiamientos disponibles para Ford Uruapan.',
    );

    expect(score.failures).toContain(
      'unsupported_promotion_availability_claim',
    );
  });

  it('passes when expected tools are called and the answer discloses offer risks', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['search_vehicles', 'search_offers'], budget: 700_000},
      ['search_vehicles', 'search_offers'],
      [
        {
          tool: 'search_offers',
          value: {
            results: [
              {
                cashPrice: 770_000,
                validityStatus: 'unknown',
                dataQualityWarnings: ['El plazo no coincide con el nombre'],
              },
            ],
          },
        },
      ],
      'La oferta rebasa tu presupuesto. La vigencia no está confirmada y el plazo indicado tiene una inconsistencia.',
    );

    expect(score).toEqual({passed: true, failures: []});
  });

  it('reports missing expected tools and missing safety disclosures', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['search_offers'], budget: 700_000},
      [],
      [
        {
          tool: 'search_offers',
          value: {
            results: [
              {
                cashPrice: 770_000,
                validityStatus: 'unknown',
                dataQualityWarnings: ['El plazo no coincide con el nombre'],
              },
            ],
          },
        },
      ],
      'Encontré una oferta de financiamiento para el vehículo.',
    );

    expect(score.passed).toBe(false);
    expect(score.failures).toEqual(
      expect.arrayContaining([
        'missing_tool:search_offers',
        'missing_budget_disclosure',
        'missing_validity_disclosure',
        'missing_term_conflict_disclosure',
      ]),
    );
  });

  it('does not require financing caveats when no financing result was returned', () => {
    expect(
      scoreMcpConversation(
        {expectedTools: ['get_catalog_status']},
        ['get_catalog_status'],
        [{tool: 'get_catalog_status', value: {vehicles: 40}}],
        'El catálogo contiene 40 vehículos.',
      ),
    ).toEqual({passed: true, failures: []});
  });

  it('checks budget against prices serialized as numeric strings', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['search_offers'], budget: 800_000},
      ['search_offers'],
      [
        {
          tool: 'search_offers',
          value: {
            results: [{cashPrice: '998500.00', validityStatus: 'active'}],
          },
        },
      ],
      'Este financiamiento está dentro de tu presupuesto.',
    );

    expect(score.failures).toContain('missing_budget_disclosure');
  });

  it('fails when the model calls the offers tool but ignores its results', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['search_offers'], budget: 800_000},
      ['search_offers'],
      [
        {
          tool: 'search_offers',
          value: {results: [{title: 'Bronco plan', cashPrice: 700_000}]},
        },
      ],
      'El Bronco 2026 tiene varias opciones.',
    );

    expect(score.failures).toContain('missing_offer_result_discussion');
  });

  it('rejects comparison prices that differ from MCP results', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['compare_vehicles']},
      ['compare_vehicles'],
      [
        {
          tool: 'compare_vehicles',
          value: [
            {model: 'BRONCO SPORT', price: 773_500},
            {model: 'SUPER DUTY CHASIS', price: 1_081_600},
          ],
        },
      ],
      'BRONCO SPORT cuesta MXN 77,350. SUPER DUTY CHASIS cuesta MXN 108,160.',
    );

    expect(score.failures).toEqual(
      expect.arrayContaining([
        'mismatched_comparison_price:BRONCO SPORT',
        'mismatched_comparison_price:SUPER DUTY CHASIS',
      ]),
    );
  });

  it('accepts localized comparison prices when they match MCP results', () => {
    expect(
      scoreMcpConversation(
        {expectedTools: ['compare_vehicles']},
        ['compare_vehicles'],
        [
          {
            tool: 'compare_vehicles',
            value: [
              {model: 'BRONCO SPORT', price: 773_500},
              {model: 'SUPER DUTY CHASIS', price: 1_081_600},
            ],
          },
        ],
        'BRONCO SPORT cuesta MXN 773,500 y SUPER DUTY CHASIS cuesta MXN 1,081,600.',
      ),
    ).toEqual({passed: true, failures: []});
  });

  it('rejects an empty comparison result for a named-model comparison request', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['compare_vehicles']},
      ['compare_vehicles'],
      [{tool: 'compare_vehicles', value: []}],
      'No hay vehículos encontrados para comparar.',
    );

    expect(score.failures).toContain('empty_comparison_results');
  });

  it('does not treat an unconfirmed validity date as a disclosed term conflict', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['search_offers']},
      ['search_offers'],
      [
        {
          tool: 'search_offers',
          value: {
            results: [
              {
                validityStatus: 'unknown',
                dataQualityWarnings: [
                  'Label says 24 months but structured term is 60 months',
                ],
              },
            ],
          },
        },
      ],
      'La vigencia no está confirmada; el plazo estructurado es de 60 meses.',
    );

    expect(score.failures).toContain('missing_term_conflict_disclosure');
  });

  it('accepts explicit label-versus-structured term comparisons', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['search_offers']},
      ['search_offers'],
      [
        {
          tool: 'search_offers',
          value: {
            results: [
              {
                validityStatus: 'unknown',
                dataQualityWarnings: [
                  'El nombre del plan indica 24 meses, pero el plazo estructurado es 72 meses.',
                ],
              },
            ],
          },
        },
      ],
      'Vigencia no confirmada. Diferencia con el nombre del plan: 24 meses vs 72 meses; plazo estructurado 72 meses.',
    );

    expect(score.failures).not.toContain('missing_term_conflict_disclosure');
  });

  it('summarizes offer evidence without copying unrelated result fields', () => {
    expect(
      summarizeMcpToolResult('search_offers', {
        results: [
          {
            title: 'Expedition plan',
            termMonths: 60,
            cashPrice: 2_470_000,
            validityStatus: 'unknown',
            dataQualityWarnings: ['Label says 72 months; terms say 60'],
            sourceUrl: 'https://ford.example/offer',
            rawHtml: 'large unrelated payload',
          },
        ],
      }),
    ).toEqual({
      count: 1,
      results: [
        {
          title: 'Expedition plan',
          termMonths: 60,
          cashPrice: 2_470_000,
          validityStatus: 'unknown',
          dataQualityWarnings: ['Label says 72 months; terms say 60'],
          sourceUrl: 'https://ford.example/offer',
        },
      ],
    });
  });

  it('summarizes vehicle specifications and explicit missing names for traces', () => {
    expect(
      summarizeMcpToolResult('get_vehicle', {
        model: 'MUSTANG',
        year: 2026,
        priceDisplay: 'MXN $951,500',
        specificationCount: 69,
        specificationsOmitted: 64,
        missingSpecificationNames: ['Cancelación activa de ruido'],
        specifications: [{name: 'Control de Crucero', value: 'Adaptativo'}],
      }),
    ).toEqual({
      model: 'MUSTANG',
      year: 2026,
      priceDisplay: 'MXN $951,500',
      specificationCount: 69,
      specificationsOmitted: 64,
      missingSpecificationNames: ['Cancelación activa de ruido'],
      specifications: [{name: 'Control de Crucero', value: 'Adaptativo'}],
    });
  });

  it('requires requested source links and rejects internal source-format narration', () => {
    const score = scoreMcpConversation(
      {expectedTools: ['get_vehicle'], requireSourceUrl: true},
      ['get_vehicle'],
      [
        {
          tool: 'get_vehicle',
          value: {
            source_url: 'https://www.forduruapan.mx/BRONCO/26/Ficha-Tecnica/',
          },
        },
      ],
      'El contenido proporcionado es una respuesta HTML de un motor de búsqueda.',
    );

    expect(score.failures).toEqual(
      expect.arrayContaining(['missing_source_link', 'leaked_source_format']),
    );
  });

  it('flags answers cut off by the local model output limit', () => {
    expect(
      scoreMcpConversation(
        {expectedTools: ['get_vehicle']},
        ['get_vehicle'],
        [],
        'El vehículo tiene',
        'length',
      ).failures,
    ).toContain('truncated_final_answer');
  });
});
