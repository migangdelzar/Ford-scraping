import {describe, expect, it, vi} from 'vitest';
import {McpServer} from '@modelcontextprotocol/server';
import {registerMcpTools, type McpServices} from '../../src/mcp/server.js';

function createServices(): McpServices {
  return {
    search: {search: vi.fn()},
    vehicles: {
      getByModelYear: vi.fn(),
      getAvailableModelYears: vi.fn().mockResolvedValue([2027]),
      compare: vi.fn(),
    },
    provenance: {get: vi.fn()},
    links: {getPageLinks: vi.fn()},
    promotions: {list: vi.fn()},
    offers: {searchOffers: vi.fn()},
    catalog: {status: vi.fn()},
    comparisons: {
      compareTrims: vi.fn(),
      compareModelYears: vi.fn(),
      getVariantComparisons: vi.fn(),
    },
  };
}

async function invoke(
  handler: unknown,
  input: unknown,
): Promise<Record<string, unknown>> {
  const call = handler as (
    input: unknown,
    context: unknown,
  ) => Promise<{content: Array<{text: string}>}>;
  const response = await call(input, {});
  return JSON.parse(response.content[0].text) as Record<string, unknown>;
}

describe('MÍA read-only catalog contract', () => {
  it('preserves observation time and exact source URLs on search results', async () => {
    const services = createServices();
    vi.mocked(services.search.search).mockResolvedValue({
      semanticSearch: 'unavailable',
      results: [
        {
          modelName: 'Ranger',
          modelYear: 2027,
          price: 899000,
          sourceUrl: 'https://www.ford.mx/vehiculos/ranger/',
          modelPageUrl: 'https://www.ford.mx/vehiculos/ranger/',
          priceSourceUrl: 'https://www.ford.mx/vehiculos/ranger/precio/',
          crawledAt: '2026-10-16T10:00:00.000Z',
        },
      ],
    });
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services,
    );

    const result = await invoke(tools.search_vehicles.handler, {query: 'Ranger'});

    expect(result.results).toEqual([
      expect.objectContaining({
        model: 'Ranger',
        year: 2027,
        price: 899000,
        modelPageUrl: 'https://www.ford.mx/vehiculos/ranger/',
        priceSourceUrl: 'https://www.ford.mx/vehiculos/ranger/precio/',
        observedAt: '2026-10-16T10:00:00.000Z',
      }),
    ]);
  });

  it('preserves observation time and technical-sheet provenance for exact details', async () => {
    const services = createServices();
    vi.mocked(services.vehicles.getByModelYear).mockResolvedValue({
      model: 'Ranger',
      year: 2027,
      price: 899000,
      currency: 'MXN',
      source_url: 'https://www.ford.mx/vehiculos/ranger/ficha-tecnica/',
      technical_sheet_url:
        'https://www.ford.mx/vehiculos/ranger/ficha-tecnica/',
      source_page_type: 'technical_sheet',
      model_page_url: 'https://www.ford.mx/vehiculos/ranger/',
      crawled_at: '2026-10-16T10:00:00.000Z',
      specifications: [],
      features: [],
    });
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services,
    );

    const result = await invoke(tools.get_vehicle.handler, {
      model: 'Ranger',
      year: 2027,
    });

    expect(result).toEqual(
      expect.objectContaining({
        model: 'Ranger',
        year: 2027,
        modelPageUrl: 'https://www.ford.mx/vehiculos/ranger/',
        technicalSheetUrl:
          'https://www.ford.mx/vehiculos/ranger/ficha-tecnica/',
        observedAt: '2026-10-16T10:00:00.000Z',
      }),
    );
  });

  it('preserves promotion validity and source link in the public result', async () => {
    const services = createServices();
    vi.mocked(services.promotions.list).mockResolvedValueOnce([
      {
        modelName: 'Ranger',
        modelYear: 2027,
        title: 'Promoción de prueba',
        valid_from: '2026-10-01',
        valid_until: '2026-10-31',
        validityStatus: 'active',
        source_url: 'https://www.ford.mx/promociones/ranger/',
      },
    ]);
    const tools = registerMcpTools(
      new McpServer({name: 'ford-uruapan', version: '0.1.0'}),
      services,
    );

    const result = await invoke(tools.list_promotions.handler, {
      filters: {limit: 3, offset: 0, detail: 'summary'},
    });

    expect(services.promotions.list).toHaveBeenCalledOnce();
    expect(result.results).toEqual([
      expect.objectContaining({
        validFrom: '2026-10-01',
        validUntil: '2026-10-31',
        validityStatus: 'active',
        sourceUrl: 'https://www.ford.mx/promociones/ranger/',
      }),
    ]);
  });
});
