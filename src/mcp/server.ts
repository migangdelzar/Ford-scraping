import {McpServer, type RegisteredTool} from '@modelcontextprotocol/server';
import {
  serveStdio,
  type StdioServerHandle,
} from '@modelcontextprotocol/server/stdio';
import {z} from 'zod';
import type {OfferSearchRequest, SearchRequest} from '../domain/contracts.js';
import {
  isSupportedModelYear,
  MAX_SUPPORTED_MODEL_YEAR,
  MIN_SUPPORTED_MODEL_YEAR,
} from '../domain/model-years.js';

const modelYearSchema = z.coerce
  .number()
  .int()
  .min(MIN_SUPPORTED_MODEL_YEAR)
  .max(MAX_SUPPORTED_MODEL_YEAR)
  .describe(`Supported Ford model years: ${MIN_SUPPORTED_MODEL_YEAR}-${MAX_SUPPORTED_MODEL_YEAR}.`);

export interface McpServices {
  search: {search(request: SearchRequest): Promise<unknown>};
  vehicles: {
    getByModelYear(model: string, year: number, trim?: string): Promise<unknown>;
    getAvailableModelYears(model: string): Promise<number[]>;
    compare(ids: string[]): Promise<unknown>;
  };
  provenance: {get(documentId: string): Promise<unknown>};
  links: {
    getPageLinks(sourceUrl: string, offset?: number, limit?: number, includeAssets?: boolean): Promise<unknown>;
  };
  promotions: {list(filters: Record<string, unknown>): Promise<unknown>};
  offers: {searchOffers(request: OfferSearchRequest): Promise<unknown>};
  catalog: {status(): Promise<unknown>};
  comparisons: {
    compareTrims(model: string, year: number, trims: string[]): Promise<unknown>;
    compareModelYears(model: string, years: number[]): Promise<unknown>;
    getVariantComparisons(model: string, year: number, trim?: string): Promise<unknown>;
  };
}

const filtersSchema = z
  .object({
    model: z
      .string()
      .describe(
        'Exact Ford nameplate or powertrain/body variant stated by the buyer, such as F-150 Híbrida, Transit Van, or Ranger Raptor. For a trim such as XL Gasolina 4x2, use get_vehicle with its trim field.',
      )
      .optional(),
    minPrice: z.number().nonnegative().optional(),
    maxPrice: z
      .number()
      .nonnegative()
      .describe(
        'Set only to a budget stated by the buyer. If a named model exceeds it, preserve that model as an exact request and disclose the mismatch; do not silently replace it.',
      )
      .optional(),
    modelYear: modelYearSchema.optional(),
    category: z
      .string()
      .describe(
        'Use for broad vehicle classes the buyer states, such as SUV, pickup, or van. SUV/crossover belongs here, not bodyType. Never infer.',
      )
      .optional(),
    bodyType: z
      .string()
      .describe(
        'Use only for a specific body style explicitly stated by the buyer, such as regular cab, SuperCrew, or wheelbase/body variant. Do not use SUV/crossover here.',
      )
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
    modelYear: modelYearSchema
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
    termMonths: optionalFilter(
      z.number().int().positive().describe('Exact financing term in months.'),
    ),
    asOf: optionalFilter(z.string()),
    activeOnly: optionalFilter(z.boolean()),
  })
  .optional();

function result(value: unknown) {
  return {content: [{type: 'text' as const, text: JSON.stringify(cleanComparisonUrls(value))}]};
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function definedFields(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ''),
  );
}

function cleanComparisonUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanComparisonUrls);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object' || value === null) {
    if (typeof value !== 'string') return value;
    try {
      const url = new URL(value);
      if (!/^\/.+\/(?:20\d{2}|\d{2})\/Comparativo\/[^/]+\/?$/i.test(url.pathname)) return value;
      const selectors = [...url.searchParams.keys()].filter(key =>
        ['exterior', 'interior'].includes(key.toLowerCase()),
      );
      if (!selectors.length) return value;
      for (const selector of selectors) url.searchParams.delete(selector);
      return url.toString();
    } catch {
      return value;
    }
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cleanComparisonUrls(item)]),
  );
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

function prioritizeVehicleSpecifications(value: unknown): unknown {
  const vehicle = record(value);
  if (!vehicle || !Array.isArray(vehicle.specifications)) return value;
  const priority = (specification: unknown): number => {
    const row = record(specification);
    const name = String(row?.name ?? '');
    if (/motor|potencia|horsepower|\bhp\b|torque|par motor/i.test(name)) {
      return 0;
    }
    if (
      /consumo|autonom[ií]a|bater[ií]a|combustible|capacidad|arrastre|carga|pasajeros|tanque|tracci[oó]n|transmisi[oó]n|dimensi/i.test(
        name,
      )
    ) {
      return 1;
    }
    return 2;
  };
  return {
    ...vehicle,
    specifications: vehicle.specifications
      .map((specification, index) => ({specification, index}))
      .sort(
        (left, right) =>
          priority(left.specification) - priority(right.specification) ||
          left.index - right.index,
      )
      .map(({specification}) => specification),
  };
}

function compactVehicle(value: unknown, detailLimit = 8): unknown {
  const vehicle = record(value);
  if (!vehicle) return value;
  const sourceUrl = vehicle.source_url ?? vehicle.sourceUrl;
  const modelPageUrl =
    vehicle.model_page_url ?? vehicle.modelPageUrl ??
    (vehicle.source_page_type === 'model' || vehicle.sourcePageType === 'model'
      ? sourceUrl
      : vehicle.source_page_type === undefined && vehicle.sourcePageType === undefined
        ? sourceUrl
        : undefined);
  const technicalSheetUrl = vehicle.technical_sheet_url ?? vehicle.technicalSheetUrl;
  const priceSourceUrl = vehicle.price_source_url ?? vehicle.priceSourceUrl ?? sourceUrl;
  const defaultFactSource = technicalSheetUrl ?? modelPageUrl;

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
  const availableSpecifications = specifications.filter(spec => {
    const value = spec.value_text ?? spec.value ?? spec.value_numeric;
    return value !== undefined && value !== null && value !== '' && value !== '—' && value !== '-';
  });
  const compactSpecifications = availableSpecifications
    .slice(0, detailLimit)
    .map(spec => {
      const source = spec.source_url ?? spec.sourceUrl;
      return definedFields({
        name: spec.name,
        value: spec.value_text ?? spec.value ?? spec.value_numeric,
        unit: spec.unit,
        ...(source && source !== defaultFactSource
          ? {sourceUrl: source}
          : {}),
      });
    });
  const compactFeatures = features.slice(0, detailLimit).map(feature => {
    const description = feature.description;
    const source = feature.source_url ?? feature.sourceUrl;
    return definedFields({
      name: feature.name,
      description:
        typeof description === 'string' && description.length > 180
          ? `${description.slice(0, 180)}…`
          : description,
      ...(typeof description === 'string' && description.length > 180
        ? {descriptionOmitted: true}
        : {}),
      ...(feature.category ? {category: feature.category} : {}),
      ...(source && source !== defaultFactSource ? {sourceUrl: source} : {}),
    });
  });
  const images = Array.isArray(vehicle.images)
    ? vehicle.images.map(record).filter(
        (image): image is Record<string, unknown> => image !== undefined,
      )
    : [];
  const compactImages = images
    .slice(0, detailLimit === Number.POSITIVE_INFINITY ? 6 : 2)
    .map(image => image.url)
    .filter((url): url is string => typeof url === 'string');
  const variantRows = Array.isArray(vehicle.variants)
    ? vehicle.variants.map(record).filter(
        (variant): variant is Record<string, unknown> => variant !== undefined,
      )
    : [];
  const variants = variantRows.map(variant => {
    const variantSource = variant.source_url ?? variant.sourceUrl;
    return {
      name: variant.trim_name ?? variant.name,
      ...(variantSource && variantSource !== modelPageUrl
        ? {sourceUrl: variantSource}
        : {}),
    };
  });
  const variantSourceUrls = new Set(
    variants.map(variant => variant.sourceUrl).filter(
      (url): url is string => typeof url === 'string',
    ),
  );
  const comparisonUrls = Array.isArray(vehicle.comparison_urls)
    ? vehicle.comparison_urls
        .map(item => {
          if (typeof item === 'string') return {url: item};
          const comparison = record(item);
          const url = comparison?.url ?? comparison?.target_url;
          if (typeof url !== 'string') return undefined;
          const trimName = comparison?.trim_name ?? comparison?.trim;
          return {
            ...(typeof trimName === 'string' ? {trim: trimName} : {}),
            url,
          };
        })
        .filter((item): item is {trim?: string; url: string} =>
          item !== undefined && !variantSourceUrls.has(item.url),
        )
        .filter((item, index, rows) => rows.findIndex(other => other.url === item.url) === index)
    : [];

  return definedFields({
    model: vehicle.model ?? vehicle.modelName ?? vehicle.model_name,
    year: vehicle.year ?? vehicle.modelYear ?? vehicle.model_year,
    ...(vehicle.trim_name ?? vehicle.trim
      ? {trim: vehicle.trim_name ?? vehicle.trim}
      : {}),
    ...(vehicle.trim_status ?? vehicle.trimStatus
      ? {trimStatus: vehicle.trim_status ?? vehicle.trimStatus}
      : {}),
    ...(vehicle.trim_source_url ?? vehicle.trimSourceUrl
      ? {trimSourceUrl: vehicle.trim_source_url ?? vehicle.trimSourceUrl}
      : {}),
    price: vehicle.price,
    priceDisplay: priceDisplay(vehicle.price, vehicle.currency ?? 'MXN'),
    currency: vehicle.currency,
    category: vehicle.category,
    ...(priceSourceUrl && priceSourceUrl !== modelPageUrl ? {priceSourceUrl} : {}),
    modelPageUnavailable: !modelPageUrl,
    specificationCount: specifications.length,
    specificationsOmitted: Math.max(0, availableSpecifications.length - detailLimit),
    missingSpecificationNames: missingSpecificationNames.slice(0, 3),
    missingSpecificationCount: missingSpecificationNames.length,
    specifications: compactSpecifications,
    featuresOmitted: Math.max(0, features.length - detailLimit),
    featureCount: features.length,
    features: compactFeatures,
    ...(compactImages.length ? {imageLinks: compactImages} : {}),
    modelPageUrl,
    ...(technicalSheetUrl && technicalSheetUrl !== modelPageUrl
      ? {technicalSheetUrl}
      : {}),
    variants,
    comparisonUrls,
  });
}

function compactVehicleResults(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map(vehicle => compactVehicle(vehicle, 3))
    : compactVehicle(value);
}

function compactVehicleSearch(value: unknown): unknown {
  const response = record(value);
  if (!response) return value;
  const results = Array.isArray(response.results)
    ? response.results.map(record).filter(
        (vehicle): vehicle is Record<string, unknown> => vehicle !== undefined,
      )
    : [];
  return {
    semanticSearch: response.semanticSearch,
    resultCount: results.length,
    results: results.map(vehicle => {
      const modelPageUrl = vehicle.modelPageUrl ?? vehicle.model_page_url ?? vehicle.sourceUrl;
      const priceSourceUrl = vehicle.priceSourceUrl ?? vehicle.price_source_url;
      const evidence = Array.isArray(vehicle.evidence)
        ? vehicle.evidence.map(record).filter(
            (item): item is Record<string, unknown> => item !== undefined,
          ).slice(0, 2)
        : [];
      return definedFields({
        model: vehicle.modelName ?? vehicle.model_name,
        year: vehicle.modelYear ?? vehicle.model_year,
        price: vehicle.price,
        currency: 'MXN',
        category: vehicle.category,
        modelPageUrl,
        ...(priceSourceUrl && priceSourceUrl !== modelPageUrl ? {priceSourceUrl} : {}),
        evidence: evidence.map(item => {
          const content = typeof item.content === 'string' ? item.content : '';
          return {
            title: item.title,
            excerpt: content.length > 320 ? `${content.slice(0, 320)}…` : content,
            ...(item.sourceUrl && item.sourceUrl !== modelPageUrl
              ? {sourceUrl: item.sourceUrl}
              : {}),
          };
        }),
      });
    }),
  };
}

function compactComparisonResults(
  value: unknown,
  detailLimit = 5,
  includeFeatures = false,
): unknown {
  if (!Array.isArray(value)) return value;
  return value.map(vehicle => {
    const prioritized = prioritizeVehicleSpecifications(vehicle);
    const compact = record(compactVehicle(prioritized, detailLimit));
    if (!compact) return vehicle;
    const buyerComparison = {...compact};
    if (!includeFeatures) {
      delete buyerComparison.features;
      delete buyerComparison.featureCount;
      delete buyerComparison.featuresOmitted;
    }
    delete buyerComparison.missingSpecificationNames;
    return buyerComparison;
  });
}

function compactPromotionResults(
  value: unknown,
  limit: number,
  offset: number,
  detail: 'summary' | 'full',
): unknown {
  if (!Array.isArray(value)) return value;
  const rows = value.map(record).filter(
    (row): row is Record<string, unknown> => row !== undefined,
  );
  const results = rows.slice(offset, offset + limit).map(row => {
    const conditions = row.conditions ?? row.termsAndConditions;
    return definedFields({
      model: row.modelName ?? row.model_name,
      year: row.modelYear ?? row.model_year,
      title: row.title,
      discountAmount: row.discount_amount ?? row.discountAmount,
      discountPercent: row.discount_percent ?? row.discountPercent,
      cashPrice: row.cash_price ?? row.cashPrice,
      downPaymentAmount: row.down_payment_amount ?? row.downPaymentAmount,
      downPaymentPercent: row.down_payment_percent ?? row.downPaymentPercent,
      monthlyPayment: row.monthly_payment ?? row.monthlyPayment,
      termMonths: row.term_months ?? row.termMonths,
      monthsWithoutInterest: row.months_without_interest ?? row.monthsWithoutInterest,
      annualInterestRate: row.annual_interest_rate ?? row.annualInterestRate,
      catPercent: row.cat_percent ?? row.catPercent,
      requiresCreditApproval: row.requires_credit_approval ?? row.requiresCreditApproval,
      currency: row.currency,
      ...(detail === 'full' && row.description ? {description: row.description} : {}),
      benefits: row.benefits,
      validFrom: row.valid_from ?? row.validFrom,
      validUntil: row.valid_until ?? row.validUntil,
      validityStatus: row.validityStatus,
      ...(detail === 'full' || (typeof conditions === 'string' && conditions.length <= 280)
        ? {conditions}
        : typeof conditions === 'string' && conditions.length > 280
          ? {conditionsOmitted: true}
          : {}),
      sourceUrl: row.sourceUrl ?? row.source_url,
      modelPageUrl: row.modelUrl ?? row.model_url,
    });
  });
  return definedFields({
    totalCount: rows.length,
    offset,
    limit,
    hasMore: offset + results.length < rows.length,
    results,
  });
}

function compactYearComparison(
  value: unknown,
  detail: 'summary' | 'full',
  trimOffset: number,
  trimLimit: number,
): unknown {
  const response = record(value);
  if (!response) return value;
  const foundYears = Array.isArray(response.foundYears)
    ? response.foundYears.map(record).filter(
        (year): year is Record<string, unknown> => year !== undefined,
      )
    : [];
  const yearPairs = Array.isArray(response.yearPairs)
    ? response.yearPairs.map(record).filter(
        (pair): pair is Record<string, unknown> => pair !== undefined,
      )
    : [];
  const years = foundYears.map(year => {
    const modelPageUrl = year.model_page_url;
    const priceSourceUrl = year.price_source_url;
    const technicalSheetUrl = year.technical_sheet_url;
    const variants = Array.isArray(year.variants)
      ? year.variants.map(record).filter(
          (variant): variant is Record<string, unknown> => variant !== undefined,
        )
      : [];
    return definedFields({
      year: year.year,
      price: year.price,
      currency: year.currency,
      modelPageUrl,
      ...(technicalSheetUrl ? {technicalSheetUrl} : {}),
      modelPageUnavailable: !modelPageUrl,
      trimLinks: variants.map(variant => definedFields({
        trim: variant.trim,
        ...(variant.sourceUrl && variant.sourceUrl !== modelPageUrl
          ? {sourceUrl: variant.sourceUrl}
          : {}),
        comparisonUrl: variant.comparisonUrl,
      })),
      ...(priceSourceUrl && priceSourceUrl !== modelPageUrl ? {priceSourceUrl} : {}),
      promotions: Array.isArray(year.active_promotions)
        ? year.active_promotions.map(record).filter(
            (promotion): promotion is Record<string, unknown> => promotion !== undefined,
          ).map(promotion => definedFields({
            title: promotion.title,
            discountAmount: promotion.discountAmount,
            cashPrice: promotion.cashPrice,
            validUntil: promotion.validUntil,
            sourceUrl: promotion.sourceUrl,
          }))
        : [],
    });
  });
  const factPriority = (fact: Record<string, unknown>) => {
    const name = String(fact.name ?? '');
    if (/motor|potencia|horsepower|torque|transmisi[oó]n|combustible|h[ií]brid/i.test(name)) return 0;
    if (/seguridad|airbag|freno|asistencia|c[aá]mara|adapta|control crucero/i.test(name)) return 1;
    if (/pasajero|carga|cajuela|dimensi|arrastre|tracci[oó]n|bater[ií]a/i.test(name)) return 2;
    return 3;
  };
  const changes = yearPairs.map(pair => {
    const facts = Array.isArray(pair.changedFacts)
      ? pair.changedFacts.map(record).filter(
          (fact): fact is Record<string, unknown> => fact !== undefined,
        )
      : [];
    const sortedFacts = [...facts].sort((left, right) => factPriority(left) - factPriority(right));
    const selectedFacts = detail === 'full' ? sortedFacts : sortedFacts.slice(0, 5);
    const trimChanges = Array.isArray(pair.trimChanges)
      ? pair.trimChanges.map(record).filter(
          (trim): trim is Record<string, unknown> => trim !== undefined,
        )
      : [];
    const selectedTrims = trimChanges.slice(trimOffset, trimOffset + trimLimit);
    const hasTrimChanges = trimChanges.some(trim => {
      const trimFacts = Array.isArray(trim.changedFacts) ? trim.changedFacts : [];
      const priceDifference = trim.priceDifferenceMxn;
      return trimFacts.length > 0 ||
        (priceDifference !== null && priceDifference !== undefined && Number(priceDifference) !== 0);
    });
    return definedFields({
      fromYear: pair.fromYear,
      toYear: pair.toYear,
      status: selectedFacts.length || hasTrimChanges ||
        (pair.priceDifferenceMxn !== null && Number(pair.priceDifferenceMxn) !== 0)
        ? 'source_backed_changes_found'
        : 'no_source_backed_changes_found',
      priceDifferenceMxn: pair.priceDifferenceMxn,
      priceSourceUrls: pair.priceSourceUrls,
      changedFacts: selectedFacts,
      unmatchedTrims: pair.unmatchedTrims,
      note: pair.note,
      trimPagination: {
        offset: trimOffset,
        limit: trimLimit,
        total: trimChanges.length,
        hasMore: trimOffset + selectedTrims.length < trimChanges.length,
      },
      trimChanges: selectedTrims.map(trim => {
        const trimFacts = Array.isArray(trim.changedFacts)
          ? trim.changedFacts.map(record).filter(
              (fact): fact is Record<string, unknown> => fact !== undefined,
            )
          : [];
        const selectedTrimFacts = (detail === 'full' ? trimFacts : trimFacts.slice(0, 3))
          .map(fact => {
            const compactFact = {...fact};
            const sourceUrls = record(trim.sourceUrls);
            const older = record(fact.older);
            const newer = record(fact.newer);
            if (older?.sourceUrl && older.sourceUrl === sourceUrls?.from) {
              compactFact.older = {...older};
              delete (compactFact.older as Record<string, unknown>).sourceUrl;
            }
            if (newer?.sourceUrl && newer.sourceUrl === sourceUrls?.to) {
              compactFact.newer = {...newer};
              delete (compactFact.newer as Record<string, unknown>).sourceUrl;
            }
            return compactFact;
          });
        return definedFields({
          trim: trim.trim,
          priceDifferenceMxn: trim.priceDifferenceMxn,
          sourceUrls: trim.sourceUrls,
          changedFacts: selectedTrimFacts,
          ...(trimFacts.length > selectedTrimFacts.length
            ? {factsOmitted: trimFacts.length - selectedTrimFacts.length}
            : {}),
        });
      }),
      ...(facts.length > selectedFacts.length
        ? {factsOmitted: facts.length - selectedFacts.length}
        : {}),
    });
  });
  return definedFields({
    model: response.model,
    years,
    changes,
    missingYears: response.missingYears,
  });
}

function compactTrimComparison(value: unknown, detail: 'summary' | 'full'): unknown {
  const response = record(value);
  if (!response) return value;
  const foundTrims = Array.isArray(response.foundTrims)
    ? response.foundTrims.map(record).filter(
        (trim): trim is Record<string, unknown> => trim !== undefined,
      )
    : [];
  const trimPairs = Array.isArray(response.trimPairs)
    ? response.trimPairs.map(record).filter(
        (pair): pair is Record<string, unknown> => pair !== undefined,
      )
    : [];
  return definedFields({
    model: response.model,
    year: response.year,
    modelPageUrl: response.modelPageUrl ?? response.model_page_url,
    technicalSheetUrl: response.technicalSheetUrl ?? response.technical_sheet_url,
    trims: foundTrims.map(trim => {
      const comparisonUrl = trim.comparison_url ?? trim.comparisonUrl;
      const priceSourceUrl = trim.price_source_url ?? trim.priceSourceUrl;
      return definedFields({
        trim: trim.trim,
        price: trim.price,
        currency: trim.currency,
        ...(priceSourceUrl && priceSourceUrl !== comparisonUrl ? {priceSourceUrl} : {}),
        comparisonUrl,
      });
    }),
    comparisons: trimPairs.map(pair => {
      const facts = Array.isArray(pair.sharedFactDifferences)
        ? pair.sharedFactDifferences.map(record).filter(
            (fact): fact is Record<string, unknown> => fact !== undefined,
          )
        : [];
      const factPriority = (fact: Record<string, unknown>) => {
        const name = String(fact.name ?? '');
        if (/motor|potencia|horsepower|torque|transmisi[oó]n|combustible|h[ií]brid/i.test(name)) return 0;
        if (/seguridad|airbag|freno|asistencia|c[aá]mara|adapta|control crucero/i.test(name)) return 1;
        if (/pasajero|carga|cajuela|dimensi|arrastre|tracci[oó]n|bater[ií]a/i.test(name)) return 2;
        return 3;
      };
      const sortedFacts = [...facts].sort((left, right) => factPriority(left) - factPriority(right));
      const selectedFacts = detail === 'full' ? sortedFacts : sortedFacts.slice(0, 5);
      const hasPriceChange =
        pair.priceDifferenceMxn !== null &&
        pair.priceDifferenceMxn !== undefined &&
        Number(pair.priceDifferenceMxn) !== 0;
      return definedFields({
        leftTrim: pair.leftTrim,
        rightTrim: pair.rightTrim,
        status: selectedFacts.length || hasPriceChange
          ? 'source_backed_differences_found'
          : 'no_source_backed_differences',
        priceDifferenceMxn: pair.priceDifferenceMxn,
        differences: selectedFacts,
        ...(facts.length > selectedFacts.length
          ? {differencesOmitted: facts.length - selectedFacts.length}
          : {}),
      });
    }),
    missingTrims: response.missingTrims,
    note: response.note,
  });
}

function compactCompetitorComparison(
  value: unknown,
  detail: 'summary' | 'full',
  offset: number,
  limit: number,
): unknown {
  const response = record(value);
  if (!response) return value;
  const comparisons = Array.isArray(response.comparisons)
    ? response.comparisons.map(record).filter(
        (comparison): comparison is Record<string, unknown> => comparison !== undefined,
      )
    : [];
  return definedFields({
    model: response.model,
    year: response.year,
    trim: response.trim,
    modelPageUrl: response.modelPageUrl ?? response.model_page_url,
    technicalSheetUrl: response.technicalSheetUrl ?? response.technical_sheet_url,
    count: response.count ?? comparisons.length,
    offset,
    limit,
    hasMore: offset + Math.max(0, Math.min(limit, comparisons.length - offset)) < comparisons.length,
    comparisons: comparisons.slice(offset, offset + limit).map(comparison => {
      const pairedFacts = Array.isArray(comparison.paired_facts)
        ? comparison.paired_facts
        : [];
      const selectedFacts = detail === 'full' ? pairedFacts : pairedFacts.slice(0, 5);
      return definedFields({
        fordTrim: comparison.ford_trim,
        competitorMake: comparison.competitor_make,
        competitorModel: comparison.competitor_model,
        competitorYear: comparison.competitor_year,
        competitorVariant: comparison.competitor_variant,
        comparisonUrl: comparison.comparison_url,
        fordImageUrl: comparison.ford_image_url,
        competitorImageUrl: comparison.competitor_image_url,
        pairedFacts: selectedFacts,
        ...(pairedFacts.length > selectedFacts.length
          ? {pairedFactsOmitted: pairedFacts.length - selectedFacts.length}
          : {}),
        excludedFactCount: Array.isArray(comparison.excluded_source_rows)
          ? comparison.excluded_source_rows.length
          : 0,
      });
    }),
    note: response.note,
  });
}

function compactPageLinks(value: unknown): unknown {
  const response = record(value);
  if (!response) return value;
  const links = Array.isArray(response.links) ? response.links : [];
  return definedFields({
    sourceUrl: response.source_url,
    title: response.title,
    totalLinks: response.totalLinks,
    offset: response.offset,
    limit: response.limit,
    links: links.map(link => {
      const row = record(link) ?? {};
      return definedFields({
        url: row.target_url ?? row.href,
        text: row.anchor_text,
        type: row.link_type,
        internal: row.is_internal,
      });
    }),
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
      taxRatePercent: offer.taxRatePercent,
      openingCommissionRatePercent: offer.openingCommissionRatePercent,
      maximumDownPaymentPercent: offer.maximumDownPaymentPercent,
      lifeInsurancePrice: offer.lifeInsurancePrice,
      currency,
      validityStatus: offer.validityStatus,
      validFrom: offer.validFrom,
      validUntil: offer.validUntil,
      requiresCreditApproval: offer.requiresCreditApproval,
      conditions: offer.conditions,
      dataQualityWarnings: warnings,
      sourceUrl: offer.sourceUrl ?? evidence?.sourceUrl,
      modelPageUrl: offer.modelUrl,
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
        'Use for Ford vehicle recommendations and discovery, including lifestyle queries. Apply only explicit buyer filters; map SUV/crossover to category, not bodyType. Preserve named model variants exactly. If budget excludes a named model, state the mismatch and label any other matches as alternatives. Hybrid search filters before semantic ranking and returns up to 5 compact results with evidence and direct model links. For exact specifications use get_vehicle; comparisons use the matching compare tool; vehicle + finance uses search_vehicle_and_offers. Copy URLs exactly; never construct them.',
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
      return result(compactVehicleSearch(
        await services.search.search({
          query,
          filters: {...filters, ...(model ? {model} : {})},
          limit: input.limit ?? 5,
        }),
      ));
    },
  );

  tools.search_vehicle_and_offers = server.registerTool(
    'search_vehicle_and_offers',
    {
      title: 'Search Ford vehicles and financing together',
      description:
        'Use this tool exactly once when the buyer asks for both vehicle recommendations/options and financing in one request. Do not call search_vehicles or search_offers separately for that request. It first selects a vehicle, then searches financing for that exact returned model/year, so the two records stay aligned. A budget alone does not request vehicle recommendations; financing for a known model belongs to search_offers. Copy answerSummary as the concise combined response. never substitute one price for the other. Preserve the exact requested model variant.',
      inputSchema: z.object({
        query: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        year: modelYearSchema.optional(),
        modelYear: modelYearSchema.optional(),
        budget: z.number().nonnegative().optional(),
        termMonths: z.number().int().positive().optional(),
      }),
    },
    async input => {
      const model = input.model?.trim();
      const year = input.year ?? input.modelYear;
      const subject = [model, year].filter(Boolean).join(' ');
      const query = input.query?.trim() || subject || 'Ford vehicles';
      const vehicleResponse = await services.search.search({
          query,
          filters: {
            ...(model ? {model} : {}),
            ...(year === undefined ? {} : {modelYear: year}),
            ...(input.budget === undefined ? {} : {maxPrice: input.budget}),
          },
          limit: 1,
        });
      const vehicleResults = record(vehicleResponse)?.results;
      const selectedVehicleResults = Array.isArray(vehicleResults)
        ? vehicleResults
            .filter(value => sameVehicleSelector(value, model, year))
            .slice(0, 1)
        : [];
      const compactVehicles = compactVehicleResults(selectedVehicleResults);
      const firstVehicle = Array.isArray(compactVehicles)
        ? record(compactVehicles[0])
        : undefined;
      const matchedModel = model ?? (typeof firstVehicle?.model === 'string' ? firstVehicle.model : undefined);
      const matchedYear = year ?? (typeof firstVehicle?.year === 'number' ? firstVehicle.year : undefined);
      const offersQuery = `${matchedModel ?? query} ${matchedYear ?? ''} financing`.trim();
      const offerResponse = await services.offers.searchOffers({
        query: offersQuery,
        filters: {
          ...(matchedModel ? {model: matchedModel} : {}),
          ...(matchedYear === undefined ? {} : {modelYear: matchedYear}),
          ...(input.budget === undefined ? {} : {maxCashPrice: input.budget}),
          ...(input.termMonths === undefined ? {} : {termMonths: input.termMonths}),
          offerType: 'financing',
        },
        limit: 1,
      });
      const compactOffers = record(compactOfferSearch(
        offerResponse, 1, {model: matchedModel, modelYear: matchedYear},
      ));
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
              modelPageUrl: offer.modelPageUrl,
              buyerSummary: offer.buyerSummary,
              termMonths: offer.termMonths,
              annualInterestRate: offer.annualInterestRate,
              catPercent: offer.catPercent,
              downPaymentPercent: offer.downPaymentPercent,
              openingCommissionRatePercent: offer.openingCommissionRatePercent,
              maximumDownPaymentPercent: offer.maximumDownPaymentPercent,
              taxRatePercent: offer.taxRatePercent,
              lifeInsurancePrice: offer.lifeInsurancePrice,
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
        'Use for exact specifications, trims, and direct page links for a named Ford model. Pass `trim` when the buyer names one; this returns only source-backed facts for that exact trim, never grouped model-level values. Without a year, returns available 2025-2027 model years; if the requested year has no catalog row, returns known available years and their exact links. detail="full" returns every available specification and feature with its source. Compact summary returns up to 5 specs and 5 features; check omitted counts before saying a fact is absent. modelPageUnavailable=true means no year-specific detail link is available; do not cite the catalog as that page. Preserve the exact nameplate, powertrain variant, year, and trim.',
      inputSchema: z.object({
        model: z.string().min(1),
        year: modelYearSchema
          .describe(
            'Optional exact year; numeric strings are normalized. Omit to return all years stored for this model.',
          )
          .optional(),
        modelYear: modelYearSchema
          .describe(
            'Alias for year; numeric strings are normalized. Omit both year fields to return all stored model years.',
          )
          .optional(),
        trim: z.string().trim().min(1)
          .describe('Optional exact trim/version, such as XL Gasolina 4x2. Never substitute a nearby trim.' )
          .optional(),
        detail: z.enum(['summary', 'full']).default('summary'),
      }),
    },
    async input => {
      const explicitYear = input.year ?? input.modelYear;
      if (explicitYear === undefined) {
        const availableModelYears =
          await services.vehicles.getAvailableModelYears(input.model);
        const options = await Promise.all(
          availableModelYears.filter(isSupportedModelYear).map(async year =>
            compactVehicle(
              prioritizeVehicleSpecifications(
                await services.vehicles.getByModelYear(input.model, year, input.trim),
              ),
              input.detail === 'full' ? Number.POSITIVE_INFINITY : 5,
            ),
          ),
        );
        const foundOptions = options.filter(option => option !== null);
        return result({
          model: input.model,
          status:
            foundOptions.length > 0
              ? 'available_model_year_options'
              : 'no_model_year_options_found',
          options: foundOptions,
        });
      }

      const vehicle = await services.vehicles.getByModelYear(
        input.model,
        explicitYear,
        input.trim,
      );
      if (vehicle !== null && vehicle !== undefined)
        return result(
          compactVehicle(
            prioritizeVehicleSpecifications(vehicle),
            input.detail === 'full' ? Number.POSITIVE_INFINITY : 5,
          ),
        );

      const availableModelYears =
        await services.vehicles.getAvailableModelYears(input.model);
      const options = await Promise.all(
        availableModelYears.filter(isSupportedModelYear).map(async year =>
          compactVehicle(
            prioritizeVehicleSpecifications(
              await services.vehicles.getByModelYear(input.model, year, input.trim),
            ),
            input.detail === 'full' ? Number.POSITIVE_INFINITY : 5,
          ),
        ),
      );
      const foundOptions = options.filter(option => option !== null);
      return result({
        model: input.model,
        requestedYear: explicitYear,
        status:
          foundOptions.length > 0
            ? 'model_year_not_found'
            : 'no_model_year_options_found',
        availableModelYears: foundOptions
          .map(option => record(option)?.year)
          .filter((year): year is number => typeof year === 'number'),
        options: foundOptions,
      });
    },
  );

  tools.compare_vehicles = server.registerTool(
    'compare_vehicles',
    {
      title: 'Compare Ford vehicles',
      description:
        'Compare different Ford nameplates. Each item uses `year`, not `modelYear`. Summary returns up to 5 specs per vehicle; use detail="full" for all specs and features. Exact model/year links stay attached. For trims use compare_trims; across years use compare_model_years; another brand use get_variant_comparisons.',
      inputSchema: z
        .object({
          models: z
            .array(
              z.object({
                model: z
                  .string()
                  .min(1)
                  .describe('Exact Ford nameplate and variant, not a trim name.'),
                year: modelYearSchema
                  .describe(
                    'Required model year for this item; the property is named year, not modelYear.',
                  ),
              }),
            )
            .min(2)
            .max(5),
          detail: z.enum(['summary', 'full']).default('summary'),
        })
        .strict(),
    },
    async input => {
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
      const ids = await Promise.all(
        input.models.map(({model, year}) => resolveModel(model, year)),
      );
      return result(
        compactComparisonResults(
          await services.vehicles.compare(ids),
          input.detail === 'full' ? Number.POSITIVE_INFINITY : 5,
          input.detail === 'full',
        ),
      );
    },
  );

  tools.compare_trims = server.registerTool(
    'compare_trims',
    {
      title: 'Compare Ford trims',
      description:
        'Compare two to five exact trims of the same Ford model and model year. Compact summary returns up to 5 source-backed differences per pair; use detail="full" for all differences. Empty differences mean the database has no paired source facts, not that trims are identical. Trim prices and direct Ford Comparativo URLs are included. Copy exact trim names. For different Ford models use compare_vehicles; across years use compare_model_years; another brand use get_variant_comparisons.',
      inputSchema: z.object({
        model: z.string().min(1).describe('Exact Ford nameplate, without the trim name.'),
        year: modelYearSchema,
        trims: z.array(z.string().min(1)).min(2).max(5),
        detail: z.enum(['summary', 'full']).default('summary'),
      }),
    },
    async input => result(compactTrimComparison(
      await services.comparisons.compareTrims(input.model, input.year, input.trims),
      input.detail,
    )),
  );

  tools.compare_model_years = server.registerTool(
    'compare_model_years',
    {
      title: 'Compare model years of a Ford nameplate',
      description:
        'Compare the same nameplate across model years (two to five years). Summary returns prices, promotions, model/spec links, all published trim links, unmatched trims, up to 5 model-level facts, and 2 trim deltas per year pair. Use trimOffset/trimLimit to page through trim deltas; each result says total and hasMore. Summary gives up to 3 facts per selected trim; detail="full" gives every fact for the selected page. Missing facts do not prove a feature was removed. Use compare_trims within one year or compare_vehicles across nameplates.',
      inputSchema: z.object({
        model: z.string().min(1),
        years: z.array(modelYearSchema).min(2).max(5),
        detail: z.enum(['summary', 'full']).default('summary'),
        trimOffset: z.number().int().nonnegative().default(0),
        trimLimit: z.number().int().min(1).max(10).default(2),
      }),
    },
    async input => result(compactYearComparison(
      await services.comparisons.compareModelYears(input.model, input.years),
      input.detail,
      input.trimOffset ?? 0,
      input.trimLimit ?? 2,
    )),
  );

  tools.get_variant_comparisons = server.registerTool(
    'get_variant_comparisons',
    {
      title: 'Get trim comparison with another brand',
      description:
        'Compare a Ford trim against another brand using Ford Uruapan Comparativo pages. IMPORTANT: model must be the base name only (for example "EXPEDITION") and trim must be separate (for example "King Ranch Max"); never put the trim inside model. Returns 3 comparisons per page and up to 5 paired facts each in compact summary; use detail="full" for every paired fact. If count is zero, say the official comparison is unavailable and use the returned model/spec links; do not invent competitor differences. Use offset/limit to page. Do not treat excluded source rows as advantages. For Ford-only comparisons use compare_vehicles, compare_trims, or compare_model_years.',
      inputSchema: z.object({
        model: z.string().min(1),
        year: modelYearSchema,
        trim: z.string().min(1).optional(),
        detail: z.enum(['summary', 'full']).default('summary'),
        offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(20).default(3),
      }),
    },
    async input => result(compactCompetitorComparison(
      await services.comparisons.getVariantComparisons(input.model, input.year, input.trim),
      input.detail,
      input.offset,
      input.limit,
    )),
  );

  tools.get_vehicle_provenance = server.registerTool(
    'get_vehicle_provenance',
    {
      title: 'Get vehicle provenance',
      description:
        'This is diagnostic only: return source URL and crawl metadata for a document ID when source details are missing from a prior result. For normal citations, use the source URLs already returned by the retrieval tool.',
      inputSchema: z.object({documentId: z.string().min(1)}),
    },
    async input => result(await services.provenance.get(input.documentId)),
  );

  tools.get_page_links = server.registerTool(
    'get_page_links',
    {
      title: 'List links found on a Ford page',
      description:
        'Return stored page routes from a known Ford page when a requested link is missing from prior results. Includes linked Comparativo records. Returns 20 useful links by default, excluding image and static asset URLs; set includeAssets=true to include them. Use offset/limit to page. Pass sourceUrl from a prior result.',
      inputSchema: z.object({
        sourceUrl: z.string().url(),
        offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(200).default(20),
        includeAssets: z.boolean().default(false),
      }),
    },
    async input =>
      result(compactPageLinks(await services.links.getPageLinks(
          input.sourceUrl,
          input.offset ?? 0,
          input.limit ?? 20,
          input.includeAssets ?? false,
        )),
      ),
  );

  tools.list_promotions = server.registerTool(
    'list_promotions',
    {
      title: 'List Ford promotions',
      description:
        'List Ford Uruapan dealer promotions. It does not list Ford Credit financing plans. Summary returns 3 compact records per page; set detail="full" for complete terms and structured fields, or raise limit (max 20). Use search_offers for Ford Credit financing.',
      inputSchema: z.object({
        filters: z.object({
          model: z.string().optional(),
          modelYear: modelYearSchema.optional(),
          activeOnly: z.boolean().optional(),
          asOf: z.string().optional(),
          limit: z.number().int().min(1).max(20).default(3),
          offset: z.number().int().nonnegative().default(0),
          detail: z.enum(['summary', 'full']).default('summary'),
        }).default({limit: 3, offset: 0, detail: 'summary'}),
      }),
    },
    async input => {
      const {limit, offset, detail, ...filters} = input.filters;
      const rows = await services.promotions.list(filters);
      return result(compactPromotionResults(rows, limit, offset, detail));
    },
  );

  tools.search_offers = server.registerTool(
    'search_offers',
    {
      title: 'Search Ford financing and structured offers',
      description:
        "Use for Ford Credit financing and structured payment-plan searches, including monthly payment, down payment, rate, CAT, and term. Use when the buyer asks only about financing or names a model and asks for its plan, even with a budget. Dealer promotion cards belong to list_promotions. Set offerType to financing or months_without_interest when specified; exact model and modelYear/term filters are enforced. The response includes source-backed structured plan inputs where available. A query may be omitted; default result limit is 2. State validity and term-conflict disclosures when returned.",
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
        modelYear: modelYearSchema.nullable().optional(),
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
        termMonths: z.number().int().positive().nullable().optional(),
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
        termMonths: input.termMonths,
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
      description:
        'Use only when asked about catalog freshness, crawl time, or number of catalog records. This is a catalog count, not live dealer inventory.',
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
