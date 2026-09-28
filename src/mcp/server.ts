import {McpServer, type RegisteredTool} from '@modelcontextprotocol/server';
import {
  serveStdio,
  type StdioServerHandle,
} from '@modelcontextprotocol/server/stdio';
import {z} from 'zod';
import type {OfferSearchRequest, SearchRequest} from '../domain/contracts.js';

export interface McpServices {
  search: {search(request: SearchRequest): Promise<unknown>};
  vehicles: {
    getByModelYear(model: string, year: number): Promise<unknown>;
    compare(ids: string[]): Promise<unknown>;
  };
  provenance: {get(documentId: string): Promise<unknown>};
  promotions: {list(filters: Record<string, unknown>): Promise<unknown>};
  offers: {searchOffers(request: OfferSearchRequest): Promise<unknown>};
  catalog: {status(): Promise<unknown>};
}

const filtersSchema = z
  .object({
    model: z
      .string()
      .describe('Ford model name to include in the query.')
      .optional(),
    minPrice: z.number().nonnegative().optional(),
    maxPrice: z
      .number()
      .nonnegative()
      .describe('Set only to a budget stated by the buyer.')
      .optional(),
    modelYear: z.number().int().describe('Exact model year.').optional(),
    category: z
      .string()
      .describe('Use only if the buyer states a category; never guess.')
      .optional(),
    bodyType: z
      .string()
      .describe('Use only if the buyer states a body type; never guess.')
      .optional(),
    fuelType: z
      .string()
      .describe('Use only if the buyer states a fuel type; never guess.')
      .optional(),
  })
  .optional();

const optionalFilter = <T extends z.ZodType>(schema: T) =>
  schema
    .nullable()
    .optional()
    .transform(value => value ?? undefined);

const offerFiltersSchema = z
  .object({
    offerType: optionalFilter(
      z
        .enum([
          'promotion',
          'discount',
          'financing',
          'months_without_interest',
          'cashback',
          'lease',
          'trade_in',
          'other',
        ])
        .describe(
          "Exact offer category: use 'financing' for credit plans or 'promotion' for dealer promotions.",
        ),
    ),
    provider: optionalFilter(z.string()),
    model: z
      .string()
      .describe('Exact Ford model name to filter offers by.')
      .nullable()
      .optional()
      .transform(value => value ?? undefined),
    modelYear: z
      .number()
      .int()
      .describe('Exact vehicle model year.')
      .nullable()
      .optional()
      .transform(value => value ?? undefined),
    maxCashPrice: optionalFilter(
      z.number().nonnegative().describe('Maximum vehicle cash price in MXN.'),
    ),
    maxMonthlyPayment: optionalFilter(z.number().nonnegative()),
    maxDownPayment: optionalFilter(z.number().nonnegative()),
    minimumMonthsWithoutInterest: optionalFilter(
      z.number().int().nonnegative(),
    ),
    asOf: optionalFilter(z.string()),
    activeOnly: optionalFilter(z.boolean()),
  })
  .optional();

function result(value: unknown) {
  return {content: [{type: 'text' as const, text: JSON.stringify(value)}]};
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sameVehicleSelector(
  value: unknown,
  model: string | undefined,
  year: number | undefined,
): boolean {
  const vehicle = record(value);
  if (!vehicle) return false;
  if (
    year !== undefined &&
    Number(vehicle.year ?? vehicle.modelYear) !== year
  ) {
    return false;
  }
  if (!model) return true;
  const actual = String(vehicle.model ?? vehicle.modelName ?? '').trim();
  return actual.localeCompare(model.trim(), 'es', {sensitivity: 'base'}) === 0;
}

function priceDisplay(price: unknown, currency: unknown): string | undefined {
  const amount = Number(price);
  if (
    price === null ||
    price === undefined ||
    !Number.isFinite(amount) ||
    typeof currency !== 'string'
  ) {
    return undefined;
  }
  return `${currency} ${new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)}`;
}

function compactVehicle(value: unknown, detailLimit = 5): unknown {
  const vehicle = record(value);
  if (!vehicle) return value;

  const specifications = Array.isArray(vehicle.specifications)
    ? vehicle.specifications
        .map(record)
        .filter((spec): spec is Record<string, unknown> => spec !== undefined)
    : [];
  const features = Array.isArray(vehicle.features)
    ? vehicle.features
        .map(record)
        .filter(
          (feature): feature is Record<string, unknown> =>
            feature !== undefined,
        )
    : [];
  const missingSpecificationNames = specifications
    .filter(spec => {
      const specValue = spec.value_text ?? spec.value ?? spec.value_numeric;
      return (
        specValue === undefined ||
        specValue === null ||
        (typeof specValue === 'string' &&
          (specValue.trim() === '' || /^[-—]$/.test(specValue.trim())))
      );
    })
    .map(spec => spec.name)
    .filter((name): name is string => typeof name === 'string');
  const compactSpecifications = specifications
    .slice(0, detailLimit)
    .map(spec => ({
      name: spec.name,
      value: spec.value_text ?? spec.value ?? spec.value_numeric,
      unit: spec.unit,
      sourceUrl: spec.source_url ?? spec.sourceUrl,
    }));
  const compactFeatures = features.slice(0, detailLimit).map(feature => ({
    name: feature.name,
    description: feature.description,
    category: feature.category,
    sourceUrl: feature.source_url ?? feature.sourceUrl,
  }));

  return {
    model: vehicle.model ?? vehicle.modelName ?? vehicle.model_name,
    year: vehicle.year ?? vehicle.modelYear ?? vehicle.model_year,
    price: vehicle.price,
    priceDisplay: priceDisplay(vehicle.price, vehicle.currency ?? 'MXN'),
    currency: vehicle.currency,
    category: vehicle.category,
    source_url: vehicle.source_url,
    sourceUrl: vehicle.source_url,
    crawled_at: vehicle.crawled_at,
    specificationCount: specifications.length,
    specificationsOmitted: Math.max(0, specifications.length - detailLimit),
    missingSpecificationNames: missingSpecificationNames.slice(0, 3),
    missingSpecificationCount: missingSpecificationNames.length,
    specifications: compactSpecifications,
    featureCount: features.length,
    featuresOmitted: Math.max(0, features.length - detailLimit),
    features: compactFeatures,
  };
}

function compactVehicleResults(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map(vehicle => compactVehicle(vehicle, 3))
    : compactVehicle(value);
}

function compactComparisonResults(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map(vehicle => {
    const compact = record(compactVehicle(vehicle, 2));
    if (!compact) return vehicle;
    const buyerComparison = {...compact};
    delete buyerComparison.featureCount;
    delete buyerComparison.featuresOmitted;
    delete buyerComparison.features;
    delete buyerComparison.specificationsOmitted;
    delete buyerComparison.missingSpecificationNames;
    return buyerComparison;
  });
}

function compactOfferSearch(
  value: unknown,
  resultLimit = 3,
  exactFilters: {model?: string; modelYear?: number} = {},
): unknown {
  const response = record(value);
  if (!response) return value;
  const offers = Array.isArray(response.results)
    ? response.results
        .map(record)
        .filter(
          (offer): offer is Record<string, unknown> => offer !== undefined,
        )
    : [];
  const matchingOffers = offers.filter(offer => {
    if (
      exactFilters.model &&
      (typeof offer.modelName !== 'string' ||
        offer.modelName.localeCompare(exactFilters.model, 'es', {
          sensitivity: 'base',
        }) !== 0)
    ) {
      return false;
    }
    return (
      exactFilters.modelYear === undefined ||
      Number(offer.modelYear) === exactFilters.modelYear
    );
  });
  const requiredDisclosures: string[] = [];
  const results = matchingOffers.slice(0, resultLimit).map(offer => {
    const title = typeof offer.title === 'string' ? offer.title : 'Esta oferta';
    const warnings = Array.isArray(offer.dataQualityWarnings)
      ? offer.dataQualityWarnings.filter(
          (warning): warning is string => typeof warning === 'string',
        )
      : [];
    const termConflict = warnings
      .map(warning =>
        /(\d+)\s+mes(?:es)?[\s\S]{0,80}?(?:plazo|t[eé]rmino)\s+estructurado(?:\s+es)?\s+(\d+)\s+mes(?:es)?/i.exec(
          warning,
        ),
      )
      .find(Boolean);
    const termConflictDisclosure = termConflict
      ? `El nombre indica ${termConflict[1]} meses, pero el plazo estructurado es ${termConflict[2]} meses; los plazos difieren.`
      : undefined;
    const validityDisclosure =
      offer.validityStatus === 'unknown'
        ? 'La vigencia no está confirmada.'
        : undefined;
    if (validityDisclosure) {
      requiredDisclosures.push(`${title}: ${validityDisclosure}`);
    }
    if (termConflictDisclosure) {
      requiredDisclosures.push(`${title}: ${termConflictDisclosure}`);
    } else {
      requiredDisclosures.push(
        ...warnings.map(warning => `${title}: ${warning}`),
      );
    }
    const evidence = Array.isArray(offer.evidence)
      ? record(offer.evidence[0])
      : undefined;
    const currency = offer.currency ?? 'MXN';
    const cashPriceDisplay = priceDisplay(offer.cashPrice, currency);
    const monthlyPaymentDisplay = priceDisplay(offer.monthlyPayment, currency);
    const buyerSummary = [
      `${title}.`,
      cashPriceDisplay ? `Precio de contado: ${cashPriceDisplay}.` : undefined,
      monthlyPaymentDisplay
        ? `Mensualidad: ${monthlyPaymentDisplay}.`
        : undefined,
      validityDisclosure,
      termConflictDisclosure,
    ]
      .filter((item): item is string => Boolean(item))
      .join(' ');
    return {
      offerId: offer.offerId,
      modelName: offer.modelName,
      modelYear: offer.modelYear,
      title: offer.title,
      offerType: offer.offerType,
      provider: offer.provider,
      cashPrice: offer.cashPrice,
      cashPriceDisplay,
      monthlyPayment: offer.monthlyPayment,
      monthlyPaymentDisplay,
      buyerSummary,
      downPaymentAmount: offer.downPaymentAmount,
      downPaymentDisplay: priceDisplay(offer.downPaymentAmount, currency),
      downPaymentPercent: offer.downPaymentPercent,
      termMonths: offer.termMonths,
      termConflict: termConflict
        ? {
            labelMonths: Number(termConflict[1]),
            structuredTermMonths: Number(termConflict[2]),
          }
        : undefined,
      termConflictDisclosure,
      validityDisclosure,
      monthsWithoutInterest: offer.monthsWithoutInterest,
      annualInterestRate: offer.annualInterestRate,
      catPercent: offer.catPercent,
      currency,
      validityStatus: offer.validityStatus,
      validFrom: offer.validFrom,
      validUntil: offer.validUntil,
      requiresCreditApproval: offer.requiresCreditApproval,
      conditions: offer.conditions,
      dataQualityWarnings: warnings,
      sourceUrl: offer.sourceUrl ?? evidence?.sourceUrl,
    };
  });

  return {
    query: response.query,
    semanticSearch: response.semanticSearch,
    resultCount: results.length,
    totalResultCount: matchingOffers.length,
    requiredDisclosures,
    results,
  };
}

export function registerMcpTools(
  server: McpServer,
  services: McpServices,
): Record<string, RegisteredTool> {
  const tools: Record<string, RegisteredTool> = {};
  tools.search_vehicles = server.registerTool(
    'search_vehicles',
    {
      title: 'Search Ford vehicles',
      description:
        'Hybrid-search Ford vehicles using deterministic filters and semantic relevance. For vehicle options alone, call this tool. When the buyer also asks about financing, use search_vehicle_and_offers for both. For specifications use get_vehicle. Use only buyer-stated filters; never guess category, body type, or fuel type. The server builds a query from filters if omitted; result limit defaults to 3.',
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe(
            'Optional; the server builds a query from filters if omitted.',
          )
          .nullable()
          .optional()
          .transform(value => value ?? undefined),
        filters: filtersSchema,
        limit: z.number().int().min(1).max(50).optional(),
      }),
    },
    async input => {
      const {model, ...filters} = input.filters ?? {};
      const query =
        input.query?.trim() ||
        [
          model,
          filters.modelYear,
          filters.category,
          filters.bodyType,
          filters.fuelType,
        ]
          .filter(value => value !== undefined && value !== '')
          .join(' ') ||
        'Ford vehicles';
      return result(
        await services.search.search({
          query,
          filters,
          limit: input.limit ?? 3,
        }),
      );
    },
  );

  tools.search_vehicle_and_offers = server.registerTool(
    'search_vehicle_and_offers',
    {
      title: 'Search Ford vehicles and financing together',
      description:
        'Use this single tool only when the buyer asks for both vehicle options or recommendations and financing. A budget by itself does not mean the buyer asked for vehicle recommendations; a financing-only request for a known model belongs to search_offers, even when a budget is stated. It searches in parallel and returns the top matching vehicle and top financing offer to keep the lead response focused. Copy answerSummary as the canonical concise response; it combines vehicle and offer facts with required disclosures. The separate search tools return more results when requested. Only apply buyer-stated model, year, and budget. Preserve variant words such as HÍBRIDA, RAPTOR, SPORT, CHASIS, and VAN in the model filter. The vehicle and offer results are separate records and can have different prices. Never claim a requested variant unless vehicles.results has that exact model. Quote vehicle price from vehicles.results priceDisplay and offer cash price from offers.results cashPriceDisplay; do not substitute offers.results cashPriceDisplay for vehicles.results priceDisplay.',
      inputSchema: z.object({
        query: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        year: z.number().int().optional(),
        modelYear: z.number().int().optional(),
        budget: z.number().nonnegative().optional(),
      }),
    },
    async input => {
      const model = input.model?.trim();
      const year = input.year ?? input.modelYear;
      const subject = [model, year].filter(Boolean).join(' ');
      const query = input.query?.trim() || subject || 'Ford vehicles';
      const offersQuery = `${query} financing`;
      const [vehicleResponse, offerResponse] = await Promise.all([
        services.search.search({
          query,
          filters: {
            ...(year === undefined ? {} : {modelYear: year}),
            ...(input.budget === undefined ? {} : {maxPrice: input.budget}),
          },
          limit: 1,
        }),
        services.offers.searchOffers({
          query: offersQuery,
          filters: {
            ...(model ? {model} : {}),
            ...(year === undefined ? {} : {modelYear: year}),
            ...(input.budget === undefined ? {} : {maxCashPrice: input.budget}),
            offerType: 'financing',
          },
          limit: 1,
        }),
      ]);
      const vehicleResults = record(vehicleResponse)?.results;
      const compactOffers = record(
        compactOfferSearch(offerResponse, 1, {model, modelYear: year}),
      );
      const selectedVehicleResults = Array.isArray(vehicleResults)
        ? vehicleResults
            .filter(value => sameVehicleSelector(value, model, year))
            .slice(0, 1)
        : [];
      const compactVehicles = compactVehicleResults(selectedVehicleResults);
      const firstVehicle = Array.isArray(compactVehicles)
        ? record(compactVehicles[0])
        : undefined;
      const vehicleSummary = firstVehicle
        ? `${firstVehicle.model ?? ''} ${firstVehicle.year ?? ''}: ${firstVehicle.priceDisplay ?? 'precio no disponible'}`.trim()
        : undefined;
      const offerResults = Array.isArray(compactOffers?.results)
        ? compactOffers.results.map(value => {
            const offer = record(value) ?? {};
            return {
              modelName: offer.modelName,
              modelYear: offer.modelYear,
              title: offer.title,
              cashPrice: offer.cashPrice,
              cashPriceDisplay: offer.cashPriceDisplay,
              monthlyPayment: offer.monthlyPayment,
              monthlyPaymentDisplay: offer.monthlyPaymentDisplay,
              buyerSummary: offer.buyerSummary,
              termMonths: offer.termMonths,
              termConflict: offer.termConflict,
              termConflictDisclosure: offer.termConflictDisclosure,
              validityStatus: offer.validityStatus,
              validityDisclosure: offer.validityDisclosure,
              dataQualityWarnings: offer.dataQualityWarnings,
              sourceUrl: offer.sourceUrl,
            };
          })
        : [];
      const firstOffer = offerResults[0];
      const offerSummary =
        typeof firstOffer?.buyerSummary === 'string'
          ? [
              firstOffer.buyerSummary,
              input.budget !== undefined &&
              typeof firstOffer.cashPrice === 'number' &&
              firstOffer.cashPrice > input.budget
                ? `Excede el presupuesto de ${priceDisplay(input.budget, 'MXN')}.`
                : undefined,
            ]
              .filter((item): item is string => Boolean(item))
              .join(' ')
          : undefined;
      const answerSummary = [
        vehicleSummary
          ? `${vehicleSummary}.`
          : 'No se encontró el vehículo o variante exactos.',
        offerSummary ?? 'No se encontraron ofertas de financiamiento.',
      ]
        .filter((item): item is string => Boolean(item))
        .join(' ');
      return result({
        query,
        answerSummary,
        vehicles: {
          results: compactVehicles,
          summary: vehicleSummary,
          resultCount: selectedVehicleResults.length,
        },
        offers: {
          query: compactOffers?.query,
          resultCount: compactOffers?.resultCount,
          requiredDisclosures: compactOffers?.requiredDisclosures,
          results: offerResults,
        },
      });
    },
  );

  tools.get_vehicle = server.registerTool(
    'get_vehicle',
    {
      title: 'Get Ford vehicle',
      description:
        'Use for specifications on a named model and year. Pass the model year as year or modelYear. Returns up to 5 specifications and features, counts for omitted details, explicit missingSpecificationNames, and a source URL. Only report missing specifications listed in missingSpecificationNames; specifications omitted from this short response may still exist. Cite source_url when asked for the source; prefer this over search_vehicles for exact model details.',
      inputSchema: z.object({
        model: z.string().min(1),
        year: z.number().int().optional(),
        modelYear: z.number().int().optional(),
      }),
    },
    async input => {
      const year = input.year ?? input.modelYear;
      if (year === undefined) {
        throw new Error('Provide year or modelYear for the requested vehicle');
      }
      return result(
        compactVehicle(
          await services.vehicles.getByModelYear(input.model, year),
          3,
        ),
      );
    },
  );

  tools.compare_vehicles = server.registerTool(
    'compare_vehicles',
    {
      title: 'Compare Ford vehicles',
      description:
        'Compare two to five Ford vehicles by price, specifications, and features when available. Returns up to three specifications and features per vehicle. Copy priceDisplay exactly when quoting prices. For named models, provide `models` with exact model names and years; each item uses `year`, not `modelYear`. Example: models: [{model: "TERRITORY", year: 2026}, {model: "RANGER", year: 2026}]. Use `ids` only when at least two ids came from another tool. Provide either `models` or `ids`, never a singular top-level model selector.',
      inputSchema: z
        .object({
          ids: z.array(z.string().min(1)).min(2).max(5).optional(),
          models: z
            .array(
              z.object({
                model: z.string().min(1),
                year: z
                  .number()
                  .int()
                  .describe(
                    'Required model year for this item; the property is named year, not modelYear.',
                  ),
              }),
            )
            .min(2)
            .max(5)
            .optional(),
        })
        .strict()
        .refine(input => Boolean(input.ids || input.models), {
          message: 'Provide either ids or models to compare vehicles',
        }),
    },
    async input => {
      if (input.ids && input.models) {
        throw new Error('Provide either ids or models, not both');
      }

      let ids: string[];
      const resolveModel = async (model: string, year: number) => {
        const vehicle = await services.vehicles.getByModelYear(model, year);
        if (
          !vehicle ||
          typeof vehicle !== 'object' ||
          !('model_year_id' in vehicle) ||
          typeof vehicle.model_year_id !== 'string'
        ) {
          throw new Error(`Vehicle ${model} ${year} was not found`);
        }
        return vehicle.model_year_id;
      };
      if (input.models) {
        ids = await Promise.all(
          input.models.map(({model, year}) => resolveModel(model, year)),
        );
      } else if (input.ids) {
        ids = await Promise.all(
          input.ids.map(async id => {
            if (
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                id,
              )
            ) {
              return id;
            }
            const selector = /^(.+?)\s+(\d{4})$/.exec(id.trim());
            if (!selector) {
              throw new Error(
                `Invalid vehicle id or model/year selector: ${id}`,
              );
            }
            return resolveModel(selector[1], Number(selector[2]));
          }),
        );
      } else {
        throw new Error('Provide ids or models to compare vehicles');
      }

      return result(
        compactComparisonResults(await services.vehicles.compare(ids)),
      );
    },
  );

  tools.get_vehicle_provenance = server.registerTool(
    'get_vehicle_provenance',
    {
      title: 'Get vehicle provenance',
      description:
        'Return source URL and crawl information for a retrieved document.',
      inputSchema: z.object({documentId: z.string().min(1)}),
    },
    async input => result(await services.provenance.get(input.documentId)),
  );

  tools.list_promotions = server.registerTool(
    'list_promotions',
    {
      title: 'List Ford promotions',
      description:
        'List published dealer promotions only; financing plans are a separate category and are not included. If the buyer also asks for financing, call search_offers as a separate search.',
      inputSchema: z.object({
        filters: z.record(z.string(), z.unknown()).default({}),
      }),
    },
    async input => result(await services.promotions.list(input.filters)),
  );

  tools.search_offers = server.registerTool(
    'search_offers',
    {
      title: 'Search Ford financing and structured offers',
      description:
        "Use for financing plans and structured commercial offers. Use this when a named model is already known and the buyer asks only about financing, monthly payment, down payment, or cash price, even when they state a budget. Dealer promotions are listed separately by list_promotions. For finance searches set offerType: 'financing'. A query can be omitted; the server builds one from filters. Put filters in the filters object; top-level model, modelYear, offerType, maxCashPrice, and common filter fields are also accepted. Use the exact model name and modelYear when named; these filters are enforced on returned offers. Result limit defaults to 2. State each validityDisclosure and termConflictDisclosure when present; explain both terms and say they differ.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe(
            'Optional; the server builds a query from filters if omitted.',
          )
          .nullable()
          .optional()
          .transform(value => value ?? undefined),
        filters: offerFiltersSchema,
        model: z.string().nullable().optional(),
        modelYear: z.number().int().nullable().optional(),
        offerType: z
          .enum([
            'promotion',
            'discount',
            'financing',
            'months_without_interest',
            'cashback',
            'lease',
            'trade_in',
            'other',
          ])
          .nullable()
          .optional(),
        maxCashPrice: z.number().nonnegative().nullable().optional(),
        maxMonthlyPayment: z.number().nonnegative().nullable().optional(),
        maxDownPayment: z.number().nonnegative().nullable().optional(),
        minimumMonthsWithoutInterest: z
          .number()
          .int()
          .nonnegative()
          .nullable()
          .optional(),
        provider: z.string().nullable().optional(),
        activeOnly: z.boolean().nullable().optional(),
        asOf: z.string().nullable().optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .describe('Maximum results; defaults to 2 for concise buyer answers.')
          .optional(),
      }),
    },
    async input => {
      const topLevelFilters = {
        model: input.model,
        modelYear: input.modelYear,
        offerType: input.offerType,
        maxCashPrice: input.maxCashPrice,
        maxMonthlyPayment: input.maxMonthlyPayment,
        maxDownPayment: input.maxDownPayment,
        minimumMonthsWithoutInterest: input.minimumMonthsWithoutInterest,
        provider: input.provider,
        activeOnly: input.activeOnly,
        asOf: input.asOf,
      };
      const providedTopLevelFilters = Object.fromEntries(
        Object.entries(topLevelFilters).filter(
          ([, value]) => value !== undefined && value !== null,
        ),
      );
      const filters = Object.fromEntries(
        Object.entries({...input.filters, ...providedTopLevelFilters}).filter(
          ([, value]) => value !== undefined && value !== null,
        ),
      );
      const query =
        input.query?.trim() ||
        [filters.model, filters.modelYear, filters.offerType]
          .filter(value => value !== undefined && value !== '')
          .join(' ') ||
        'Ford offers';
      return result(
        compactOfferSearch(
          await services.offers.searchOffers({
            ...input,
            filters,
            query,
            limit: input.limit ?? 2,
          }),
          input.limit ?? 2,
          {
            model:
              typeof filters.model === 'string' ? filters.model : undefined,
            modelYear:
              typeof filters.modelYear === 'number'
                ? filters.modelYear
                : undefined,
          },
        ),
      );
    },
  );

  tools.get_catalog_status = server.registerTool(
    'get_catalog_status',
    {
      title: 'Get catalog status',
      description: 'Report catalog crawl and embedding freshness.',
      inputSchema: z.object({}),
    },
    async () => result(await services.catalog.status()),
  );

  return tools;
}

export function buildMcpServer(services: McpServices): McpServer {
  const server = new McpServer({
    name: 'ford-uruapan-hybrid-search',
    version: '0.1.0',
  });
  registerMcpTools(server, services);
  return server;
}

export function serveMcpStdio(services: McpServices): StdioServerHandle {
  return serveStdio(() => buildMcpServer(services));
}
