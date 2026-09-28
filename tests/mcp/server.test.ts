import {describe, expect, it, vi} from 'vitest';
import {McpServer} from '@modelcontextprotocol/server';
import {
  buildMcpServer,
  registerMcpTools,
  type McpServices,
} from '../../src/mcp/server.js';

function schemaAccepts(tool: {inputSchema?: unknown}, input: unknown): boolean {
  const schema = tool.inputSchema as {
    safeParse(value: unknown): {success: boolean};
  };
  if (!schema) throw new Error('Tool input schema is missing');
  return schema.safeParse(input).success;
}

function services(): McpServices {
  return {
    search: {
      search: vi.fn().mockResolvedValue({
        query: 'SUV',
        results: [],
        semanticSearch: 'unavailable',
      }),
    },
    vehicles: {getByModelYear: vi.fn(), compare: vi.fn()},
    provenance: {get: vi.fn()},
    promotions: {list: vi.fn()},
    offers: {
      searchOffers: vi.fn().mockResolvedValue({
        query: 'financing',
        results: [],
        semanticSearch: 'unavailable',
      }),
    },
    catalog: {status: vi.fn()},
  };
}

describe('MCP server', () => {
  it('documents the required nested year field for comparison model selectors', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.compare_vehicles.description).toContain(
      'each item uses `year`, not `modelYear`',
    );
  });

  it('rejects comparison arguments with unsupported singular model selectors', () => {
    const server = new McpServer({name: 'ford-uruapan', version: '0.1.0'});
    const tools = registerMcpTools(server, services());

    expect(
      schemaAccepts(tools.compare_vehicles, {
        model: 'TRANSIT VAN',
        modelYear: 2026,
      }),
    ).toBe(false);
  });

  it('distinguishes exact vehicle variants and vehicle vs offer prices', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.search_vehicle_and_offers.description).toContain(
      'Never claim a requested variant unless vehicles.results has that exact model',
    );
    expect(tools.search_vehicle_and_offers.description).toContain(
      'do not substitute offers.results cashPriceDisplay for vehicles.results priceDisplay',
    );
  });

  it('routes financing-only requests to search_offers even with a budget', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.search_vehicle_and_offers.description).toContain(
      'A budget by itself does not mean the buyer asked for vehicle recommendations',
    );
    expect(tools.search_offers.description).toContain(
      'Use this when a named model is already known and the buyer asks only about financing',
    );
    expect(tools.search_vehicle_and_offers.description).toContain(
      'Copy answerSummary as the canonical concise response',
    );
  });

  it('describes how LLM clients must form financing search arguments', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.search_offers.description).toContain('query can be omitted');
    expect(tools.search_offers.description).toContain("offerType: 'financing'");
    expect(tools.search_offers.description).toContain('exact model name');
    expect(tools.search_offers.description).toContain('modelYear');
    expect(tools.search_offers.description).toContain('limit');
    expect(tools.search_offers.description).toContain(
      'exact model name and modelYear when named',
    );
    expect(tools.search_offers.description).toContain(
      'State each validityDisclosure and termConflictDisclosure',
    );
  });

  it('keeps dealer promotions and financing search distinct', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.list_promotions.description).toContain(
      'financing plans are a separate category',
    );
    expect(tools.search_offers.description).toContain(
      'Use for financing plans',
    );
  });

  it('exposes search_vehicles and delegates to SearchService', async () => {
    const deps = services();
    const server = new McpServer({name: 'ford-uruapan', version: '0.1.0'});
    const tools = registerMcpTools(server, deps);
    await (
      tools.search_vehicles.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<unknown>
    )({query: 'SUV', filters: {maxPrice: 800000}}, {});
    expect(deps.search.search).toHaveBeenCalledWith({
      query: 'SUV',
      filters: {maxPrice: 800000},
      limit: 3,
    });
    expect(Object.keys(tools)).toEqual([
      'search_vehicles',
      'search_vehicle_and_offers',
      'get_vehicle',
      'compare_vehicles',
      'get_vehicle_provenance',
      'list_promotions',
      'search_offers',
      'get_catalog_status',
    ]);
  });

  it('searches vehicles and financing together with shared exact filters', async () => {
    const deps = services();
    vi.mocked(deps.search.search).mockResolvedValueOnce({
      results: [
        {model: 'F-150 HÍBRIDA', year: 2026, price: 1_180_000},
        {model: 'RANGER', year: 2026, price: 763_500},
      ],
      semanticSearch: 'ready',
    });
    vi.mocked(deps.offers.searchOffers).mockResolvedValueOnce({
      query: 'F-150 HÍBRIDA 2026 financing',
      results: [
        {
          modelName: 'F-150 HÍBRIDA',
          modelYear: 2026,
          title: 'Plan F-150',
          validityStatus: 'unknown',
          cashPrice: 1_300_000,
          monthlyPayment: 30_000,
          currency: 'MXN',
        },
        {title: 'Second plan', validityStatus: 'unknown'},
      ],
    } as never);
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    const response = (await (
      tools.search_vehicle_and_offers.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<{content: {text: string}[]}>
    )({model: 'F-150 HÍBRIDA', modelYear: 2026, budget: 1_200_000}, {})) as {
      content: {text: string}[];
    };
    const combined = JSON.parse(response.content[0].text);

    expect(deps.search.search).toHaveBeenCalledWith({
      query: 'F-150 HÍBRIDA 2026',
      filters: {modelYear: 2026, maxPrice: 1_200_000},
      limit: 1,
    });
    expect(deps.offers.searchOffers).toHaveBeenCalledWith({
      query: 'F-150 HÍBRIDA 2026 financing',
      filters: {
        model: 'F-150 HÍBRIDA',
        modelYear: 2026,
        maxCashPrice: 1_200_000,
        offerType: 'financing',
      },
      limit: 1,
    });
    expect(combined.vehicles.results[0]).toMatchObject({
      model: 'F-150 HÍBRIDA',
      priceDisplay: 'MXN $1,180,000',
    });
    expect(combined.vehicles.summary).toBe(
      'F-150 HÍBRIDA 2026: MXN $1,180,000',
    );
    expect(combined.answerSummary).toBe(
      'F-150 HÍBRIDA 2026: MXN $1,180,000. Plan F-150. Precio de contado: MXN $1,300,000. Mensualidad: MXN $30,000. La vigencia no está confirmada. Excede el presupuesto de MXN $1,200,000.',
    );
    expect(combined.offers.requiredDisclosures).toContain(
      'Plan F-150: La vigencia no está confirmada.',
    );
    expect(combined.vehicles.results).toHaveLength(1);
    expect(combined.offers.results).toHaveLength(1);
    expect(combined.answerSummary).toContain('Excede el presupuesto');
  });

  it('states explicit outcomes in combined summaries when either result is empty', async () => {
    const deps = services();
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );
    const response = (await (
      tools.search_vehicle_and_offers.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<{content: {text: string}[]}>
    )({model: 'BRONCO RAPTOR', modelYear: 2026, budget: 2_140_500}, {})) as {
      content: {text: string}[];
    };
    const combined = JSON.parse(response.content[0].text);

    expect(combined.answerSummary).toBe(
      'No se encontró el vehículo o variante exactos. No se encontraron ofertas de financiamiento.',
    );
  });

  it('builds a vehicle query from filters when the LLM omits query', async () => {
    const deps = services();
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    await (
      tools.search_vehicles.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<unknown>
    )(
      {
        filters: {
          model: 'F-150',
          modelYear: 2026,
          category: 'Híbridos y Eléctricos',
        },
      },
      {},
    );

    expect(deps.search.search).toHaveBeenCalledWith({
      query: 'F-150 2026 Híbridos y Eléctricos',
      filters: {modelYear: 2026, category: 'Híbridos y Eléctricos'},
      limit: 3,
    });
  });

  it('builds a server with the complete read-only tool surface', () => {
    const deps = services();
    const server = buildMcpServer(deps);
    expect(server).toBeInstanceOf(McpServer);
  });

  it('exposes search_offers with deterministic financing filters', async () => {
    const deps = services();
    const server = new McpServer({name: 'ford-uruapan', version: '0.1.0'});
    const tools = registerMcpTools(server, deps);
    await (
      tools.search_offers.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<unknown>
    )(
      {
        query: 'SUV familiar',
        filters: {maxCashPrice: 900000, minimumMonthsWithoutInterest: 12},
      },
      {},
    );
    expect(deps.offers.searchOffers).toHaveBeenCalledWith({
      query: 'SUV familiar',
      filters: {maxCashPrice: 900000, minimumMonthsWithoutInterest: 12},
      limit: 2,
    });
  });

  it('treats null optional offer filters as omitted', async () => {
    const deps = services();
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    await (
      tools.search_offers.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<unknown>
    )(
      {
        filters: {
          model: 'LOBO RAPTOR',
          modelYear: 2026,
          offerType: 'financing',
          maxCashPrice: 2_330_000,
          maxMonthlyPayment: null,
          maxDownPayment: null,
          minimumMonthsWithoutInterest: null,
          asOf: null,
          activeOnly: true,
        },
      },
      {},
    );

    expect(deps.offers.searchOffers).toHaveBeenCalledWith({
      query: 'LOBO RAPTOR 2026 financing',
      filters: {
        model: 'LOBO RAPTOR',
        modelYear: 2026,
        offerType: 'financing',
        maxCashPrice: 2_330_000,
        activeOnly: true,
      },
      limit: 2,
    });
  });

  it('treats a null offer query as omitted', async () => {
    const deps = services();
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    await (
      tools.search_offers.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<unknown>
    )({query: null, filters: {model: 'BRONCO RAPTOR', modelYear: 2026}}, {});

    expect(deps.offers.searchOffers).toHaveBeenCalledWith({
      query: 'BRONCO RAPTOR 2026',
      filters: {model: 'BRONCO RAPTOR', modelYear: 2026},
      limit: 2,
    });
  });

  it('filters out offers that do not match the exact requested model and year', async () => {
    const deps = services();
    vi.mocked(deps.offers.searchOffers).mockResolvedValueOnce({
      results: [
        {
          modelName: 'F-150',
          modelYear: 2026,
          title: 'F-150 plan',
          cashPrice: 1_200_000,
        },
      ],
    } as never);
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    const response = (await (
      tools.search_offers.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<{content: {text: string}[]}>
    )({filters: {model: 'RANGER RAPTOR', modelYear: 2026}}, {})) as {
      content: {text: string}[];
    };

    expect(JSON.parse(response.content[0].text)).toMatchObject({
      resultCount: 0,
      totalResultCount: 0,
      results: [],
    });
  });

  it('builds an offer query from model filters when the LLM omits query', async () => {
    const deps = services();
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    await (
      tools.search_offers.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<unknown>
    )(
      {
        filters: {
          model: 'EXPEDITION',
          modelYear: 2026,
          offerType: 'financing',
        },
      },
      {},
    );

    expect(deps.offers.searchOffers).toHaveBeenCalledWith({
      query: 'EXPEDITION 2026 financing',
      filters: {
        model: 'EXPEDITION',
        modelYear: 2026,
        offerType: 'financing',
      },
      limit: 2,
    });
  });

  it('puts offer caveats first and trims unrelated search metadata', async () => {
    const deps = services();
    vi.mocked(deps.offers.searchOffers).mockResolvedValueOnce({
      query: 'EXPEDITION 2026',
      semanticSearch: 'ready',
      results: [
        {
          offerId: 'offer-1',
          title: 'EXPEDITION Active - 60-month financing',
          modelName: 'EXPEDITION',
          modelYear: 2026,
          offerType: 'financing',
          cashPrice: 1_765_500,
          monthlyPayment: 29_403.4,
          termMonths: 60,
          validityStatus: 'unknown',
          dataQualityWarnings: [
            'El nombre del plan indica 24 meses, pero el plazo estructurado es 60 meses.',
          ],
          evidence: [{sourceUrl: 'https://ford.example/finance'}],
          finalScore: 0.91,
        },
      ],
    } as never);
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    const response = (await (
      tools.search_offers.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<{content: {text: string}[]}>
    )({query: 'EXPEDITION 2026'}, {})) as {
      content: {text: string}[];
    };
    const offers = JSON.parse(response.content[0].text);

    expect(offers).toMatchObject({
      query: 'EXPEDITION 2026',
      resultCount: 1,
      requiredDisclosures: [
        'EXPEDITION Active - 60-month financing: La vigencia no está confirmada.',
        'EXPEDITION Active - 60-month financing: El nombre indica 24 meses, pero el plazo estructurado es 60 meses; los plazos difieren.',
      ],
    });
    expect(offers.results[0]).toMatchObject({
      title: 'EXPEDITION Active - 60-month financing',
      termMonths: 60,
      termConflict: {labelMonths: 24, structuredTermMonths: 60},
      validityStatus: 'unknown',
      buyerSummary:
        'EXPEDITION Active - 60-month financing. Precio de contado: MXN $1,765,500. Mensualidad: MXN $29,403. La vigencia no está confirmada. El nombre indica 24 meses, pero el plazo estructurado es 60 meses; los plazos difieren.',
      sourceUrl: 'https://ford.example/finance',
    });
    expect(offers.results[0]).not.toHaveProperty('finalScore');
    expect(offers.results[0]).not.toHaveProperty('evidence');
  });

  it('requires vehicle search when a buyer also asks about financing', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.search_vehicles.description).toContain(
      'use search_vehicle_and_offers',
    );
  });

  it('routes named model specifications to get_vehicle for exact provenance', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.get_vehicle.description).toContain('named model and year');
    expect(tools.get_vehicle.description).toContain('source URL');
    expect(tools.search_vehicles.description).toContain(
      'For specifications use get_vehicle',
    );
  });

  it('accepts modelYear when the LLM uses it instead of year', async () => {
    const deps = services();
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    await (
      tools.get_vehicle.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<unknown>
    )({model: 'MUSTANG', modelYear: 2026}, {});

    expect(deps.vehicles.getByModelYear).toHaveBeenCalledWith('MUSTANG', 2026);
  });

  it('limits vehicle details and preserves a compact source link', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.getByModelYear).mockResolvedValueOnce({
      model: 'BRONCO RAPTOR',
      year: 2026,
      price: 2_140_500,
      currency: 'MXN',
      source_url: 'https://ford.example/bronco',
      specifications: Array.from({length: 15}, (_, index) => ({
        name: `Spec ${index}`,
        value_text: `Value ${index}`,
        source_url: 'https://ford.example/specs',
      })),
      features: Array.from({length: 12}, (_, index) => ({
        name: `Feature ${index}`,
        source_url: 'https://ford.example/features',
      })),
    });
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    const response = (await (
      tools.get_vehicle.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<{content: {text: string}[]}>
    )({model: 'BRONCO RAPTOR', year: 2026}, {})) as {
      content: {text: string}[];
    };
    const vehicle = JSON.parse(response.content[0].text);

    expect(vehicle).toMatchObject({
      model: 'BRONCO RAPTOR',
      year: 2026,
      price: 2_140_500,
      source_url: 'https://ford.example/bronco',
      specificationCount: 15,
      specificationsOmitted: 12,
      featureCount: 12,
      featuresOmitted: 9,
    });
    expect(vehicle.specifications).toHaveLength(3);
    expect(vehicle.features).toHaveLength(3);
    expect(vehicle.missingSpecificationNames).toEqual([]);
    expect(vehicle.specifications[0]).toEqual({
      name: 'Spec 0',
      value: 'Value 0',
      sourceUrl: 'https://ford.example/specs',
    });
  });

  it('bounds specifications and features returned by vehicle comparison', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.compare).mockResolvedValueOnce([
      {
        model: 'BRONCO',
        year: 2026,
        price: 998_500,
        currency: 'MXN',
        source_url: 'https://ford.example/bronco',
        specifications: Array.from({length: 15}, (_, index) => ({
          name: `Spec ${index}`,
          value_text: `Value ${index}`,
        })),
        features: Array.from({length: 12}, (_, index) => ({
          name: `Feature ${index}`,
        })),
      },
      {
        model: 'RANGER',
        year: 2026,
        price: 763_500,
        source_url: 'https://ford.example/ranger',
        specifications: [],
        features: [],
      },
    ]);
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    const response = (await (
      tools.compare_vehicles.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<{content: {text: string}[]}>
    )(
      {
        ids: [
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002',
        ],
      },
      {},
    )) as {
      content: {text: string}[];
    };
    const vehicles = JSON.parse(response.content[0].text);

    expect(vehicles[0]).toMatchObject({
      model: 'BRONCO',
      price: 998_500,
      priceDisplay: 'MXN $998,500',
      source_url: 'https://ford.example/bronco',
      specificationCount: 15,
    });
    expect(vehicles[0].specifications).toHaveLength(2);
    expect(vehicles[0]).not.toHaveProperty('features');
    expect(vehicles[0]).not.toHaveProperty('specificationsOmitted');
    expect(vehicles[1].specifications).toEqual([]);
  });

  it('resolves model/year selectors mistakenly supplied in ids', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.getByModelYear)
      .mockResolvedValueOnce({model_year_id: 'id-lobo'} as never)
      .mockResolvedValueOnce({model_year_id: 'id-territory'} as never);
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    await (
      tools.compare_vehicles.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<unknown>
    )({ids: ['LOBO 2026', 'TERRITORY 2026']}, {});

    expect(deps.vehicles.getByModelYear).toHaveBeenNthCalledWith(
      1,
      'LOBO',
      2026,
    );
    expect(deps.vehicles.getByModelYear).toHaveBeenNthCalledWith(
      2,
      'TERRITORY',
      2026,
    );
    expect(deps.vehicles.compare).toHaveBeenCalledWith([
      'id-lobo',
      'id-territory',
    ]);
  });

  it('rejects a singular model/year comparison request', async () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(
      schemaAccepts(tools.compare_vehicles, {
        model: 'TRANSIT VAN',
        modelYear: 2026,
      }),
    ).toBe(false);
  });

  it('resolves model/year pairs before comparing vehicles', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.getByModelYear)
      .mockResolvedValueOnce({model_year_id: 'id-bronco'} as never)
      .mockResolvedValueOnce({model_year_id: 'id-ranger'} as never);
    const server = new McpServer({name: 'ford-uruapan', version: '0.1.0'});
    const tools = registerMcpTools(server, deps);

    await (
      tools.compare_vehicles.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<unknown>
    )(
      {
        models: [
          {model: 'BRONCO', year: 2026},
          {model: 'RANGER', year: 2026},
        ],
      },
      {},
    );

    expect(deps.vehicles.getByModelYear).toHaveBeenNthCalledWith(
      1,
      'BRONCO',
      2026,
    );
    expect(deps.vehicles.getByModelYear).toHaveBeenNthCalledWith(
      2,
      'RANGER',
      2026,
    );
    expect(deps.vehicles.compare).toHaveBeenCalledWith([
      'id-bronco',
      'id-ranger',
    ]);
  });

  it('reports a useful error when a named comparison vehicle is absent', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.getByModelYear).mockResolvedValueOnce(null);
    const server = new McpServer({name: 'ford-uruapan', version: '0.1.0'});
    const tools = registerMcpTools(server, deps);

    await expect(
      (
        tools.compare_vehicles.handler as unknown as (
          input: unknown,
          context: unknown,
        ) => Promise<unknown>
      )(
        {
          models: [
            {model: 'UNKNOWN', year: 2026},
            {model: 'RANGER', year: 2026},
          ],
        },
        {},
      ),
    ).rejects.toThrow('Vehicle UNKNOWN 2026 was not found');
  });
});
