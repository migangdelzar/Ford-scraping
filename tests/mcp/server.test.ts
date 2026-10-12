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
    vehicles: {
      getByModelYear: vi.fn(),
      getAvailableModelYears: vi.fn().mockResolvedValue([]),
      compare: vi.fn(),
    },
    provenance: {get: vi.fn()},
    links: {getPageLinks: vi.fn().mockResolvedValue(null)},
    promotions: {list: vi.fn()},
    offers: {
      searchOffers: vi.fn().mockResolvedValue({
        query: 'financing',
        results: [],
        semanticSearch: 'unavailable',
      }),
    },
    catalog: {status: vi.fn()},
    comparisons: {compareTrims: vi.fn(), compareModelYears: vi.fn(), getVariantComparisons: vi.fn()},
  };
}

describe('MCP server', () => {
  it('normalizes numeric string years for exact vehicle lookups', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );
    const schema = tools.get_vehicle.inputSchema as unknown as {
      safeParse(value: unknown): {success: boolean; data?: {modelYear?: number}};
    };

    const parsed = schema.safeParse({model: 'EXPEDITION', modelYear: '2027'});

    expect(parsed.success).toBe(true);
    expect(parsed.data?.modelYear).toBe(2027);
  });

  it('limits every vehicle and offer year filter to 2025 through 2027', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );
    const supportedInputs = [
      [tools.get_vehicle, {model: 'EXPEDITION', year: '2025'}],
      [tools.search_vehicles, {query: 'SUV', filters: {modelYear: 2026}}],
      [tools.compare_vehicles, {models: [{model: 'RANGER', year: 2027}, {model: 'LOBO', year: 2026}]}],
      [tools.compare_trims, {model: 'RANGER', year: 2025, trims: ['XL', 'XLT']}],
      [tools.compare_model_years, {model: 'RANGER', years: [2025, 2027]}],
      [tools.get_variant_comparisons, {model: 'EXPEDITION', year: 2026}],
      [tools.search_vehicle_and_offers, {model: 'RANGER', modelYear: 2026}],
      [tools.list_promotions, {filters: {modelYear: 2025}}],
      [tools.search_offers, {modelYear: 2027}],
      [tools.search_offers, {filters: {modelYear: 2026}}],
    ] as const;
    const unsupportedInputs = [
      [tools.get_vehicle, {model: 'EXPEDITION', year: 2024}],
      [tools.search_vehicles, {query: 'SUV', filters: {modelYear: 2028}}],
      [tools.compare_vehicles, {models: [{model: 'RANGER', year: 2024}, {model: 'LOBO', year: 2026}]}],
      [tools.compare_trims, {model: 'RANGER', year: 2028, trims: ['XL', 'XLT']}],
      [tools.compare_model_years, {model: 'RANGER', years: [2024, 2026]}],
      [tools.get_variant_comparisons, {model: 'EXPEDITION', year: 2028}],
      [tools.search_vehicle_and_offers, {model: 'RANGER', modelYear: 2024}],
      [tools.list_promotions, {filters: {modelYear: 2028}}],
      [tools.search_offers, {modelYear: 2024}],
      [tools.search_offers, {filters: {modelYear: 2028}}],
    ] as const;

    for (const [tool, input] of supportedInputs) {
      expect(schemaAccepts(tool, input)).toBe(true);
    }
    for (const [tool, input] of unsupportedInputs) {
      expect(schemaAccepts(tool, input)).toBe(false);
    }
  });

  it('documents the required nested year field for comparison model selectors', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.compare_vehicles.description).toContain(
      'Each item uses `year`, not `modelYear`',
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

  it('accepts only named model and year selectors for Ford comparisons', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(
      schemaAccepts(tools.compare_vehicles, {
        ids: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
      }),
    ).toBe(false);
    expect(
      schemaAccepts(tools.compare_vehicles, {
        models: [
          {model: 'TERRITORY', year: 2026},
          {model: 'RANGER', year: 2026},
        ],
        ids: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
      }),
    ).toBe(false);
  });

  it('distinguishes exact vehicle variants and vehicle vs offer prices', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.search_vehicle_and_offers.description).toContain(
      'Preserve the exact requested model variant',
    );
    expect(tools.search_vehicle_and_offers.description).toContain(
      'never substitute one price for the other',
    );
  });

  it('routes financing-only requests to search_offers even with a budget', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.search_vehicle_and_offers.description).toContain(
      'A budget alone does not request vehicle recommendations',
    );
    expect(tools.search_offers.description).toContain(
      'Use when the buyer asks only about financing',
    );
    expect(tools.search_vehicle_and_offers.description).toContain(
      'Copy answerSummary as the concise combined response',
    );
  });

  it('describes how LLM clients must form financing search arguments', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.search_offers.description).toContain('query may be omitted');
    expect(tools.search_offers.description).toContain('offerType to financing');
    expect(tools.search_offers.description).toContain('modelYear/term');
    expect(tools.search_offers.description).toContain(
      'exact model and modelYear/term filters are enforced',
    );
    expect(tools.search_offers.description).toContain(
      'State validity and term-conflict disclosures',
    );
  });

  it('keeps dealer promotions and financing search distinct', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.list_promotions.description).toContain(
      'It does not list Ford Credit financing plans',
    );
    expect(tools.search_offers.description).toContain(
      'Use for Ford Credit financing',
    );
  });

  it('gives each vehicle and comparison tool a distinct routing boundary', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.search_vehicles.description).toContain(
      'recommendations and discovery',
    );
    expect(tools.search_vehicles.description).toContain(
      'SUV/crossover to category, not bodyType',
    );
    expect(tools.search_vehicles.description).toContain(
      'never construct them',
    );
    expect(tools.get_vehicle.description).toContain('exact specifications');
    expect(tools.compare_vehicles.description).toContain(
      'different Ford nameplates',
    );
    expect(tools.compare_trims.description).toContain(
      'same Ford model and model year',
    );
    expect(tools.compare_model_years.description).toContain(
      'same nameplate across model years',
    );
    expect(tools.get_variant_comparisons.description).toContain(
      'against another brand',
    );
  });

  it('marks provenance and catalog status tools as diagnostics', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.get_vehicle_provenance.description).toContain(
      'This is diagnostic only',
    );
    expect(tools.get_catalog_status.description).toContain(
      'when asked about catalog freshness',
    );
  });

  it('preserves catalog timestamps when normalizing MCP responses', async () => {
    const deps = services();
    const crawledAt = new Date('2026-10-09T06:16:01.209Z');
    vi.mocked(deps.catalog.status).mockResolvedValueOnce({
      latest_crawled_at: crawledAt,
    });
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );
    const invoke = tools.get_catalog_status.handler as unknown as (
      input: unknown,
      context: unknown,
    ) => Promise<{content: {text: string}[]}>;

    const response = await invoke({}, {});
    const result = JSON.parse(response.content[0].text);

    expect(result.latest_crawled_at).toBe(crawledAt.toISOString());
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
      limit: 5,
    });
    expect(Object.keys(tools)).toEqual([
      'search_vehicles',
      'search_vehicle_and_offers',
      'get_vehicle',
      'compare_vehicles',
      'compare_trims',
      'compare_model_years',
      'get_variant_comparisons',
      'get_vehicle_provenance',
      'get_page_links',
      'list_promotions',
      'search_offers',
      'get_catalog_status',
    ]);
  });

  it('returns every catalog model-year option when the year is omitted', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.getAvailableModelYears).mockResolvedValueOnce([
      2027, 2026, 2025, 2024,
    ]);
    vi.mocked(deps.vehicles.getByModelYear)
      .mockResolvedValueOnce({
        model: 'RANGER',
        year: 2027,
        price: 775_000,
        specifications: [
          {name: 'Spec 1', value_text: 'A'},
          {name: 'Spec 2', value_text: 'B'},
          {name: 'Spec 3', value_text: 'C'},
          {name: 'Motor', value_text: 'Gasolina 270 hp'},
        ],
        features: [
          {name: 'Feature 1'},
          {name: 'Feature 2'},
          {name: 'Feature 3'},
          {name: 'Feature 4'},
        ],
      })
      .mockResolvedValueOnce({
        model: 'RANGER',
        year: 2026,
        price: 763_500,
        specifications: [],
        features: [],
      })
      .mockResolvedValueOnce({
        model: 'RANGER',
        year: 2025,
        price: 750_000,
        specifications: [],
        features: [],
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
    )({model: 'RANGER'}, {})) as {content: {text: string}[]};

    expect(deps.vehicles.getAvailableModelYears).toHaveBeenCalledWith('RANGER');
    expect(deps.vehicles.getByModelYear).toHaveBeenNthCalledWith(
      1,
      'RANGER',
      2027,
      undefined,
    );
    expect(deps.vehicles.getByModelYear).toHaveBeenNthCalledWith(
      2,
      'RANGER',
      2026,
      undefined,
    );
    expect(deps.vehicles.getByModelYear).toHaveBeenNthCalledWith(
      3,
      'RANGER',
      2025,
      undefined,
    );
    const result = JSON.parse(response.content[0].text);
    expect(result).toMatchObject({
      model: 'RANGER',
      status: 'available_model_year_options',
      options: [
        {model: 'RANGER', year: 2027},
        {model: 'RANGER', year: 2026},
        {model: 'RANGER', year: 2025},
      ],
    });
    expect(result.options[0].specifications).toHaveLength(4);
    expect(result.options[0].features).toHaveLength(4);
    expect(result.options[0].specificationsOmitted).toBe(0);
    expect(result.options[0].featuresOmitted).toBe(0);
  });

  it('does not return model-year options outside 2025 through 2027', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.getAvailableModelYears).mockResolvedValueOnce([
      2024,
    ]);
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    const response = (await (
      tools.get_vehicle.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<{content: {text: string}[]}>
    )({model: 'BRONCO SPORT'}, {})) as {content: {text: string}[]};

    expect(deps.vehicles.getByModelYear).not.toHaveBeenCalled();
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      status: 'no_model_year_options_found',
      options: [],
    });
  });

  it('reports when the database has no model-year options', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.getAvailableModelYears).mockResolvedValueOnce([]);
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    const response = (await (
      tools.get_vehicle.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<{content: {text: string}[]}>
    )({model: 'BRONCO'}, {})) as {content: {text: string}[]};

    expect(deps.vehicles.getByModelYear).not.toHaveBeenCalled();
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      model: 'BRONCO',
      status: 'no_model_year_options_found',
      options: [],
    });
  });

  it('honors an explicitly requested model year without querying available years', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.getByModelYear).mockResolvedValueOnce({
      model: 'MUSTANG',
      year: 2024,
      specifications: [],
      features: [],
    });
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    await (
      tools.get_vehicle.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<unknown>
    )({model: 'MUSTANG', year: 2024}, {});

    expect(deps.vehicles.getAvailableModelYears).not.toHaveBeenCalled();
    expect(deps.vehicles.getByModelYear).toHaveBeenCalledWith('MUSTANG', 2024, undefined);
  });

  it('returns available years when the requested model year has no catalog row', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.getByModelYear)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        model: 'TERRITORY HIBRIDA',
        year: 2027,
        model_page_url: 'https://www.forduruapan.mx/TERRITORY-HIBRIDA/27/',
        technical_sheet_url:
          'https://www.forduruapan.mx/TERRITORY-HIBRIDA/27/Ficha-Tecnica/',
        specifications: [],
        features: [],
        variants: [],
        comparison_urls: [],
      });
    vi.mocked(deps.vehicles.getAvailableModelYears).mockResolvedValueOnce([
      2027,
    ]);
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      deps,
    );

    const response = (await (
      tools.get_vehicle.handler as unknown as (
        input: unknown,
        context: unknown,
      ) => Promise<{content: {text: string}[]}>
    )({model: 'TERRITORY HÍBRIDA', year: 2026}, {})) as {
      content: {text: string}[];
    };

    expect(JSON.parse(response.content[0].text)).toMatchObject({
      model: 'TERRITORY HÍBRIDA',
      requestedYear: 2026,
      status: 'model_year_not_found',
      availableModelYears: [2027],
      options: [
        {
          model: 'TERRITORY HIBRIDA',
          year: 2027,
          modelPageUrl: 'https://www.forduruapan.mx/TERRITORY-HIBRIDA/27/',
        },
      ],
    });
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
      filters: {model: 'F-150 HÍBRIDA', modelYear: 2026, maxPrice: 1_200_000},
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
      filters: {model: 'F-150', modelYear: 2026, category: 'Híbridos y Eléctricos'},
      limit: 5,
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

  it('returns source-backed structured finance inputs with an offer', async () => {
    const deps = services();
    vi.mocked(deps.offers.searchOffers).mockResolvedValueOnce({
      results: [
        {
          modelName: 'EXPEDITION',
          modelYear: 2027,
          title: 'Plan Ford Credit',
          offerType: 'financing',
          annualInterestRate: 14.68,
          catPercent: 37.56,
          taxRatePercent: 16,
          openingCommissionRatePercent: 3,
          maximumDownPaymentPercent: 80,
          lifeInsurancePrice: 12500,
          sourceUrl: 'https://www.forduruapan.mx/Financiamiento/',
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
    )({filters: {model: 'EXPEDITION', modelYear: 2027}}, {})) as {
      content: {text: string}[];
    };

    expect(JSON.parse(response.content[0].text).results[0]).toMatchObject({
      annualInterestRate: 14.68,
      catPercent: 37.56,
      taxRatePercent: 16,
      openingCommissionRatePercent: 3,
      maximumDownPaymentPercent: 80,
      lifeInsurancePrice: 12500,
      sourceUrl: 'https://www.forduruapan.mx/Financiamiento/',
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
      'search_vehicle_and_offers',
    );
  });

  it('routes named model specifications to get_vehicle for exact provenance', () => {
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services(),
    );

    expect(tools.get_vehicle.description).toContain('available 2025-2027 model years');
    expect(tools.get_vehicle.description).toContain(
      'every available specification and feature',
    );
    expect(tools.get_vehicle.description).toContain('with its source');
    expect(tools.get_vehicle.description).toContain(
      'Preserve the exact nameplate',
    );
    expect(tools.search_vehicles.description).toContain(
      'For exact specifications use get_vehicle',
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

    expect(deps.vehicles.getByModelYear).toHaveBeenCalledWith('MUSTANG', 2026, undefined);
  });

  it('passes an explicitly requested trim to the exact vehicle lookup', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.getByModelYear).mockResolvedValueOnce({
      model: 'RANGER', year: 2027, trim_name: 'XL Gasolina 4x2',
      trim_status: 'found', price: 775_000, specifications: [], features: [],
      variants: [], comparison_urls: [],
    });
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}), deps,
    );

    const response = await (tools.get_vehicle.handler as unknown as (
      input: unknown, context: unknown,
    ) => Promise<{content: {text: string}[]}>)({
      model: 'RANGER', year: 2027, trim: 'XL Gasolina 4x2', detail: 'full',
    }, {});

    expect(deps.vehicles.getByModelYear).toHaveBeenCalledWith(
      'RANGER', 2027, 'XL Gasolina 4x2',
    );
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      model: 'RANGER', year: 2027, trim: 'XL Gasolina 4x2', trimStatus: 'found',
    });
  });

  it('returns complete vehicle details and preserves source links', async () => {
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
    )({model: 'BRONCO RAPTOR', year: 2026, detail: 'full'}, {})) as {
      content: {text: string}[];
    };
    const vehicle = JSON.parse(response.content[0].text);

    expect(vehicle).toMatchObject({
      model: 'BRONCO RAPTOR',
      year: 2026,
      price: 2_140_500,
      modelPageUrl: 'https://ford.example/bronco',
      specificationCount: 15,
      specificationsOmitted: 0,
      featureCount: 12,
      featuresOmitted: 0,
    });
    expect(vehicle.specifications).toHaveLength(15);
    expect(vehicle.features).toHaveLength(12);
    expect(vehicle.missingSpecificationNames).toEqual([]);
    expect(vehicle.specifications[0]).toEqual({
      name: 'Spec 0',
      value: 'Value 0',
      sourceUrl: 'https://ford.example/specs',
    });
  });

  it('returns exact trim comparison URLs and labels catalog price provenance clearly', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.getByModelYear).mockResolvedValueOnce({
      model: 'EXPEDITION', year: 2027, price: 1_794_900,
      source_url: 'https://www.forduruapan.mx/Todos/',
      model_page_url: 'https://www.forduruapan.mx/EXPEDITION/27/',
      technical_sheet_url: 'https://www.forduruapan.mx/EXPEDITION/27/Ficha-Tecnica/',
      specifications: [], features: [], variants: [],
      comparison_urls: [{
        trim_name: 'King Ranch Max',
        url: 'https://www.forduruapan.mx/EXPEDITION/27/Comparativo/KING-RANCH-MAX/?exterior=gris%20denim&interior=',
      }],
    });
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}), deps,
    );

    const response = await (tools.get_vehicle.handler as unknown as (
      input: unknown, context: unknown,
    ) => Promise<{content: {text: string}[]}>)({model: 'EXPEDITION', year: 2027}, {});
    const vehicle = JSON.parse(response.content[0].text);

    expect(vehicle).toMatchObject({
      modelPageUrl: 'https://www.forduruapan.mx/EXPEDITION/27/',
      technicalSheetUrl: 'https://www.forduruapan.mx/EXPEDITION/27/Ficha-Tecnica/',
      priceSourceUrl: 'https://www.forduruapan.mx/Todos/',
      comparisonUrls: [{trim: 'King Ranch Max', url: 'https://www.forduruapan.mx/EXPEDITION/27/Comparativo/KING-RANCH-MAX/'}],
    });
    expect(vehicle.sourceUrl).toBeUndefined();
  });

  it('does not present a catalog source as a model page when a year-specific page is missing', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.getByModelYear).mockResolvedValueOnce({
      model: 'TERRITORY', year: 2026, price: 559_900,
      source_url: 'https://www.forduruapan.mx/Todos/',
      source_page_type: 'catalog',
      specifications: [], features: [], variants: [], comparison_urls: [],
    });
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}), deps,
    );

    const response = await (tools.get_vehicle.handler as unknown as (
      input: unknown, context: unknown,
    ) => Promise<{content: {text: string}[]}>)({model: 'TERRITORY', year: 2026}, {});
    const vehicle = JSON.parse(response.content[0].text);

    expect(vehicle.modelPageUrl).toBeUndefined();
    expect(vehicle.modelPageUnavailable).toBe(true);
    expect(vehicle.priceSourceUrl).toBe('https://www.forduruapan.mx/Todos/');
  });

  it('lets the caller opt into asset links while defaulting route lookup to page links', async () => {
    const deps = services();
    vi.mocked(deps.links.getPageLinks).mockResolvedValueOnce({
      source_url: 'https://ford.example/model', links: [], totalLinks: 4,
    });
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}), deps,
    );

    await (tools.get_page_links.handler as unknown as (
      input: unknown, context: unknown,
    ) => Promise<unknown>)({sourceUrl: 'https://ford.example/model'}, {});

    expect(deps.links.getPageLinks).toHaveBeenCalledWith(
      'https://ford.example/model', 0, 20, false,
    );
    expect(schemaAccepts(tools.get_page_links, {
      sourceUrl: 'https://ford.example/model', includeAssets: true,
    })).toBe(true);
  });

  it('keeps shared-trim year changes and source links in the compact comparison output', async () => {
    const deps = services();
    vi.mocked(deps.comparisons.compareModelYears).mockResolvedValueOnce({
      model: 'EXPEDITION', requestedYears: [2025, 2026], missingYears: [],
      foundYears: [{year: 2025, model_page_url: 'https://ford.example/2025', technical_sheet_url: 'https://ford.example/2025/Ficha-Tecnica/', variants: [
        {trim: 'Platinum', sourceUrl: 'https://ford.example/2025', comparisonUrl: 'https://ford.example/2025/Comparativo/PLATINUM/'}, {trim: 'Legacy'},
      ]}, {year: 2026, variants: [{trim: 'Platinum'}, {trim: 'Ultimate'}]}],
      yearPairs: [{fromYear: 2025, toYear: 2026, changedFacts: [], trimChanges: [
        {trim: 'Platinum', priceDifferenceMxn: 10_000,
          sourceUrls: {from: 'https://ford.example/old', to: 'https://ford.example/new'},
          changedFacts: [{normalizedName: 'potencia', name: 'Potencia', older: {value: '400 HP'}, newer: {value: '440 HP'}}]},
      ], unmatchedTrims: {from: ['Legacy'], to: ['Ultimate']}}],
    });
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}), deps,
    );

    const response = await (tools.compare_model_years.handler as unknown as (
      input: unknown, context: unknown,
    ) => Promise<{content: {text: string}[]}>)({model: 'EXPEDITION', years: [2025, 2026]}, {});
    const result = JSON.parse(response.content[0].text);

    expect(result.changes[0].trimChanges).toMatchObject([{
      trim: 'Platinum',
      priceDifferenceMxn: 10_000,
      sourceUrls: {from: 'https://ford.example/old', to: 'https://ford.example/new'},
      changedFacts: [{normalizedName: 'potencia'}],
    }]);
    expect(result.years).toMatchObject([
      {year: 2025, modelPageUrl: 'https://ford.example/2025', technicalSheetUrl: 'https://ford.example/2025/Ficha-Tecnica/', trimLinks: [
        {trim: 'Platinum', comparisonUrl: 'https://ford.example/2025/Comparativo/PLATINUM/'},
        {trim: 'Legacy'},
      ]},
      {year: 2026, modelPageUnavailable: true},
    ]);
    expect(result.changes[0].unmatchedTrims).toEqual({
      from: ['Legacy'], to: ['Ultimate'],
    });
  });

  it('paginates model-year trim deltas and reduces summary facts', async () => {
    const deps = services();
    vi.mocked(deps.comparisons.compareModelYears).mockResolvedValueOnce({
      model: 'EXPEDITION', requestedYears: [2025, 2026], missingYears: [],
      foundYears: [{year: 2025, variants: Array.from({length: 5}, (_, index) => ({
        trim: `Trim ${index + 1}`, comparisonUrl: `https://ford.example/trim/${index + 1}`,
      }))}],
      yearPairs: [{
        fromYear: 2025, toYear: 2026, changedFacts: [],
        trimChanges: Array.from({length: 5}, (_, index) => ({
          trim: `Trim ${index + 1}`,
          priceDifferenceMxn: 1_000,
          changedFacts: Array.from({length: 5}, (_, factIndex) => ({
            normalizedName: `fact_${factIndex + 1}`,
            name: `Fact ${factIndex + 1}`,
            older: {value: 'old'}, newer: {value: 'new'},
          })),
        })),
      }],
    });
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}), deps,
    );
    const response = await (tools.compare_model_years.handler as unknown as (
      input: unknown, context: unknown,
    ) => Promise<{content: {text: string}[]}>)({
      model: 'EXPEDITION', years: [2025, 2026], trimOffset: 2, trimLimit: 2,
    }, {});
    const result = JSON.parse(response.content[0].text);

    expect(result.changes[0].trimChanges.map((trim: {trim: string}) => trim.trim)).toEqual([
      'Trim 3', 'Trim 4',
    ]);
    expect(result.changes[0].trimPagination).toEqual({
      offset: 2, limit: 2, total: 5, hasMore: true,
    });
    expect(result.changes[0].trimChanges[0].changedFacts).toHaveLength(3);
    expect(result.changes[0].trimChanges[0].factsOmitted).toBe(2);
    expect(result.years[0].trimLinks).toHaveLength(5);
    expect(result.years[0]).not.toHaveProperty('trims');
    expect(schemaAccepts(tools.compare_model_years, {
      model: 'EXPEDITION', years: [2025, 2026], trimOffset: 0, trimLimit: 2,
    })).toBe(true);
  });

  it('keeps distinct year-comparison citations but removes URLs repeated from their parent', async () => {
    const deps = services();
    vi.mocked(deps.comparisons.compareModelYears).mockResolvedValueOnce({
      model: 'EXPEDITION', requestedYears: [2025, 2026], missingYears: [],
      foundYears: [{year: 2025, model_page_url: 'https://ford.example/EXPEDITION/25/', variants: [
        {trim: 'Active', sourceUrl: 'https://ford.example/EXPEDITION/25/', comparisonUrl: 'https://ford.example/EXPEDITION/25/Comparativo/ACTIVE/?exterior=gris%20denim&interior='},
      ]}],
      yearPairs: [{fromYear: 2025, toYear: 2026, changedFacts: [], trimChanges: [{
        trim: 'Active', sourceUrls: {from: 'https://ford.example/2025', to: 'https://ford.example/2026'},
        changedFacts: [{name: 'Potencia', older: {value: '400 HP', sourceUrl: 'https://ford.example/EXPEDITION/25/Comparativo/ACTIVE/?exterior=gris%20denim&interior='}, newer: {value: '440 HP', sourceUrl: 'https://ford.example/EXPEDITION/26/Comparativo/ACTIVE/?exterior=gris%20denim&interior='}}],
      }]}],
    });
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}), deps,
    );
    const response = await (tools.compare_model_years.handler as unknown as (
      input: unknown, context: unknown,
    ) => Promise<{content: {text: string}[]}>)({model: 'EXPEDITION', years: [2025, 2026]}, {});
    const result = JSON.parse(response.content[0].text);

    expect(result.years[0].trimLinks).toEqual([{
      trim: 'Active', comparisonUrl: 'https://ford.example/EXPEDITION/25/Comparativo/ACTIVE/',
    }]);
    expect(result.changes[0].trimChanges[0].sourceUrls).toEqual({
      from: 'https://ford.example/2025', to: 'https://ford.example/2026',
    });
    expect(result.changes[0].trimChanges[0].changedFacts[0].older.sourceUrl)
      .toBe('https://ford.example/EXPEDITION/25/Comparativo/ACTIVE/');
    expect(result.changes[0].trimChanges[0].changedFacts[0].newer.sourceUrl)
      .toBe('https://ford.example/EXPEDITION/26/Comparativo/ACTIVE/');
  });

  it('deduplicates identical trim price and comparison source URLs in responses', async () => {
    const deps = services();
    const page = 'https://ford.example/EXPEDITION/27/Comparativo/ACTIVE/';
    vi.mocked(deps.comparisons.compareTrims).mockResolvedValueOnce({
      model: 'EXPEDITION', year: 2027,
      foundTrims: [
        {trim: 'Active', price: 100, currency: 'MXN', price_source_url: page, comparison_url: page},
        {trim: 'King Ranch Max', price: 200, currency: 'MXN', price_source_url: 'https://ford.example/prices', comparison_url: 'https://ford.example/king-ranch'},
      ],
      trimPairs: [{leftTrim: 'Active', rightTrim: 'King Ranch Max', priceSources: {left: page, right: 'https://ford.example/prices'}, sharedFactDifferences: []}],
    });
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}), deps,
    );

    const response = await (tools.compare_trims.handler as unknown as (
      input: unknown, context: unknown,
    ) => Promise<{content: {text: string}[]}>)({
      model: 'EXPEDITION', year: 2027, trims: ['Active', 'King Ranch Max'],
    }, {});
    const result = JSON.parse(response.content[0].text);

    expect(result.trims[0]).toEqual({
      trim: 'Active', price: 100, currency: 'MXN', comparisonUrl: page,
    });
    expect(result.trims[1].priceSourceUrl).toBe('https://ford.example/prices');
    expect(result.comparisons[0]).not.toHaveProperty('priceSources');
  });

  it('labels empty trim and competitor comparisons as missing source data', async () => {
    const deps = services();
    vi.mocked(deps.comparisons.compareTrims).mockResolvedValueOnce({
      model: 'LOBO RAPTOR', year: 2026, modelPageUrl: 'https://ford.example/LOBO-RAPTOR/26/',
      foundTrims: [{trim: 'High', specifications: []}, {trim: 'R', specifications: []}],
      trimPairs: [{leftTrim: 'High', rightTrim: 'R', priceDifferenceMxn: null, sharedFactDifferences: []}],
      note: 'Only source-backed variant facts are included; absent values are unknown.',
    });
    vi.mocked(deps.comparisons.getVariantComparisons).mockResolvedValueOnce({
      model: 'LOBO RAPTOR', year: 2026, modelPageUrl: 'https://ford.example/LOBO-RAPTOR/26/', comparisons: [], count: 0,
      note: 'No Ford Uruapan Comparativo records were found for this model/year. This does not mean competitors or differences do not exist.',
    });
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}), deps,
    );
    const invoke = (tool: {handler: unknown}, input: unknown) =>
      (tool.handler as (input: unknown, context: unknown) => Promise<{content: {text: string}[]}>) (input, {});

    const trimResponse = await invoke(tools.compare_trims, {
      model: 'LOBO RAPTOR', year: 2026, trims: ['High', 'R'],
    });
    const trimResult = JSON.parse(trimResponse.content[0].text);
    const rivalResponse = await invoke(tools.get_variant_comparisons, {
      model: 'LOBO RAPTOR', year: 2026,
    });
    const rivalResult = JSON.parse(rivalResponse.content[0].text);

    expect(trimResult.note).toContain('absent values are unknown');
    expect(trimResult.modelPageUrl).toBe('https://ford.example/LOBO-RAPTOR/26/');
    expect(trimResult.comparisons[0].status).toBe('no_source_backed_differences');
    expect(rivalResult.note).toContain('does not mean competitors or differences do not exist');
    expect(rivalResult.modelPageUrl).toBe('https://ford.example/LOBO-RAPTOR/26/');
  });

  it('returns all vehicle details including Ranger engine horsepower', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.getByModelYear).mockResolvedValueOnce({
      model: 'RANGER',
      year: 2027,
      specifications: [
        {
          name: 'Carga',
          value_text: '1,128 kg',
          source_url: 'https://ford.example/ranger',
        },
        {
          name: 'Cabina',
          value_text: 'Doble',
          source_url: 'https://ford.example/ranger',
        },
        {
          name: 'Transmisión',
          value_text: 'Automática de 10 velocidades',
          source_url: 'https://ford.example/ranger',
        },
        {
          name: 'Motor',
          value_text:
            'Motor 2.3L Gasolina con 270hp | Motor 2.0L Diésel con 168 hp',
          source_url: 'https://ford.example/ranger/ficha-tecnica',
        },
      ],
      features: [
        {name: 'Feature 1', source_url: 'https://ford.example/ranger'},
        {name: 'Feature 2', source_url: 'https://ford.example/ranger'},
        {name: 'Feature 3', source_url: 'https://ford.example/ranger'},
        {name: 'Feature 4', source_url: 'https://ford.example/ranger'},
      ],
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
    )({model: 'RANGER', year: 2027}, {})) as {
      content: {text: string}[];
    };
    const vehicle = JSON.parse(response.content[0].text);

    expect(vehicle.specifications).toHaveLength(4);
    expect(vehicle.features).toHaveLength(4);
    expect(vehicle.specificationsOmitted).toBe(0);
    expect(vehicle.featuresOmitted).toBe(0);
    expect(vehicle.specifications[0]).toEqual({
      name: 'Motor',
      value: 'Motor 2.3L Gasolina con 270hp | Motor 2.0L Diésel con 168 hp',
      sourceUrl: 'https://ford.example/ranger/ficha-tecnica',
    });
  });

  it('bounds specifications and features returned by vehicle comparison', async () => {
    const deps = services();
    vi.mocked(deps.vehicles.getByModelYear)
      .mockResolvedValueOnce({model_year_id: 'bronco-id'} as never)
      .mockResolvedValueOnce({model_year_id: 'ranger-id'} as never);
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
        models: [
          {model: 'BRONCO', year: 2026},
          {model: 'RANGER', year: 2026},
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
      modelPageUrl: 'https://ford.example/bronco',
      specificationCount: 15,
    });
    expect(vehicles[0].specifications).toHaveLength(5);
    expect(vehicles[0]).not.toHaveProperty('features');
    expect(vehicles[0].specificationsOmitted).toBe(10);
    expect(vehicles[1].specifications).toEqual([]);
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
