export interface McpConversationExpectation {
  expectedTools: string[];
  budget?: number;
  requireSourceUrl?: boolean;
}

export interface McpToolResult {
  tool: string;
  value: unknown;
}

export interface McpConversationScore {
  passed: boolean;
  failures: string[];
}

function offerResults(results: McpToolResult[]): Record<string, unknown>[] {
  const direct = results.find(result => result.tool === 'search_offers')?.value;
  const combined = results.find(
    result => result.tool === 'search_vehicle_and_offers',
  )?.value;
  const search =
    direct ??
    (typeof combined === 'object' && combined !== null
      ? (combined as {offers?: unknown}).offers
      : undefined);
  if (!search || typeof search !== 'object' || !('results' in search))
    return [];
  const offers = (search as {results?: unknown}).results;
  return Array.isArray(offers)
    ? offers.filter(
        (offer): offer is Record<string, unknown> =>
          typeof offer === 'object' && offer !== null,
      )
    : [];
}

function comparisonResults(
  results: McpToolResult[],
): Record<string, unknown>[] {
  const comparison = results.find(
    result => result.tool === 'compare_vehicles',
  )?.value;
  return Array.isArray(comparison)
    ? comparison.filter(
        (vehicle): vehicle is Record<string, unknown> =>
          typeof vehicle === 'object' && vehicle !== null,
      )
    : [];
}

function combinedVehicleResults(
  results: McpToolResult[],
): Record<string, unknown>[] {
  const combined = results.find(
    result => result.tool === 'search_vehicle_and_offers',
  )?.value;
  if (typeof combined !== 'object' || combined === null) return [];
  const vehicles = (combined as {vehicles?: {results?: unknown}}).vehicles
    ?.results;
  return Array.isArray(vehicles)
    ? vehicles.filter(
        (vehicle): vehicle is Record<string, unknown> =>
          typeof vehicle === 'object' && vehicle !== null,
      )
    : [];
}

const OFFER_SUMMARY_FIELDS = [
  'title',
  'buyerSummary',
  'modelName',
  'modelYear',
  'offerType',
  'provider',
  'cashPrice',
  'cashPriceDisplay',
  'monthlyPayment',
  'monthlyPaymentDisplay',
  'downPaymentAmount',
  'downPaymentPercent',
  'termMonths',
  'monthsWithoutInterest',
  'annualInterestRate',
  'catPercent',
  'validityStatus',
  'validFrom',
  'validUntil',
  'dataQualityWarnings',
  'termConflictDisclosure',
  'validityDisclosure',
  'sourceUrl',
];

function selectFields(
  value: unknown,
  fields: string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    fields
      .filter(field => field in record)
      .map(field => [field, record[field]]),
  );
}

export function summarizeMcpToolResult(tool: string, value: unknown): unknown {
  if (tool === 'get_vehicle') {
    const vehicle = selectFields(value, [
      'model',
      'year',
      'priceDisplay',
      'source_url',
      'specificationCount',
      'specificationsOmitted',
      'missingSpecificationNames',
      'featureCount',
      'featuresOmitted',
    ]);
    const specifications = selectFields(value, [
      'specifications',
    ]).specifications;
    return {
      ...vehicle,
      specifications: (Array.isArray(specifications) ? specifications : [])
        .slice(0, 5)
        .map(specification =>
          selectFields(specification, ['name', 'value', 'unit']),
        ),
    };
  }

  if (tool === 'search_vehicle_and_offers') {
    const combined = selectFields(value, ['vehicles', 'offers']);
    const vehicles = selectFields(combined.vehicles, ['summary', 'results']);
    const offers = selectFields(combined.offers, ['results']);
    return {
      vehicles: {
        summary: vehicles.summary,
        count: Array.isArray(vehicles.results) ? vehicles.results.length : 0,
        results: (Array.isArray(vehicles.results) ? vehicles.results : [])
          .slice(0, 3)
          .map(vehicle =>
            selectFields(vehicle, [
              'model',
              'year',
              'price',
              'priceDisplay',
              'currency',
            ]),
          ),
      },
      offers: {
        count: Array.isArray(offers.results) ? offers.results.length : 0,
        results: (Array.isArray(offers.results) ? offers.results : [])
          .slice(0, 3)
          .map(offer => selectFields(offer, OFFER_SUMMARY_FIELDS)),
      },
    };
  }

  if (tool === 'search_offers') {
    const offersValue = selectFields(value, ['results']).results;
    const offers = Array.isArray(offersValue) ? offersValue : [];
    return {
      count: offers.length,
      results: offers
        .slice(0, 3)
        .map(offer => selectFields(offer, OFFER_SUMMARY_FIELDS)),
    };
  }

  if (tool === 'compare_vehicles') {
    const vehicles = Array.isArray(value) ? value : [];
    return {
      count: vehicles.length,
      results: vehicles
        .slice(0, 5)
        .map(vehicle =>
          selectFields(vehicle, [
            'model',
            'year',
            'price',
            'priceDisplay',
            'currency',
            'specificationCount',
            'specificationsOmitted',
            'featureCount',
            'featuresOmitted',
            'source_url',
          ]),
        ),
    };
  }

  if (typeof value === 'object' && value !== null) {
    return {keys: Object.keys(value)};
  }
  return value;
}

const disclosesUnconfirmedValidity = (answer: string): boolean =>
  /(?:vigencia|disponibilidad)[^.]{0,70}(?:no\s+(?:está\s+)?confirm|sin confirm|desconoc|pendiente|no se indica)|(?:no\s+(?:está\s+)?confirm|sin confirm|desconoc|pendiente)[^.]{0,70}(?:vigencia|disponibilidad)/i.test(
    answer,
  );

const disclosesTermConflict = (answer: string): boolean =>
  /(?:plazo|mes(?:es)?|término|termino)[^.]{0,70}(?:inconsisten|no coincide|difiere|conflict|confirm)|(?:inconsisten|no coincide|difiere|conflict)[^.]{0,70}(?:plazo|mes(?:es)?|término|termino)|(?:indica|dice|señala)[^.]{0,30}\d+\s+mes(?:es)?[^.]{0,50}(?:plazo|t[eé]rmino) estructurado[^.]{0,25}\d+\s+mes(?:es)?|diferencia[^.]{0,50}\d+\s+mes(?:es)?\s+(?:vs\.?|frente a|contra)\s+\d+\s+mes(?:es)?/i.test(
    answer,
  );

const disclosesOverBudget = (answer: string): boolean =>
  /(?:supera|excede|rebasa|por encima|fuera|no alcanza|rebasa)[^.]{0,80}presupuesto|presupuesto[^.]{0,80}(?:supera|excede|rebasa|por encima|fuera|no alcanza)/i.test(
    answer,
  );

export function scoreMcpConversation(
  expectation: McpConversationExpectation,
  calledTools: string[],
  toolResults: McpToolResult[],
  answer: string,
  doneReason?: string,
): McpConversationScore {
  const failures = expectation.expectedTools
    .filter(tool => !calledTools.includes(tool))
    .map(tool => `missing_tool:${tool}`);

  if (!answer.trim()) failures.push('missing_final_answer');
  if (answer.trim().split(/\s+/).length > 140) {
    failures.push('excessive_answer_length');
  }
  if (doneReason === 'length') failures.push('truncated_final_answer');
  if (/respuesta html|archivo json|contenido proporcionado/i.test(answer)) {
    failures.push('leaked_source_format');
  }

  if (
    calledTools.includes('compare_vehicles') &&
    toolResults.some(result => result.tool === 'compare_vehicles') &&
    comparisonResults(toolResults).length === 0
  ) {
    failures.push('empty_comparison_results');
  }

  for (const vehicle of comparisonResults(toolResults)) {
    const price = Number(vehicle.price);
    if (!Number.isFinite(price)) continue;
    const formats = [
      String(price),
      new Intl.NumberFormat('es-MX', {maximumFractionDigits: 2}).format(price),
      new Intl.NumberFormat('en-US', {maximumFractionDigits: 2}).format(price),
    ];
    if (!formats.some(format => answer.includes(format))) {
      const model =
        typeof vehicle.model === 'string' ? vehicle.model : 'unknown';
      failures.push(`mismatched_comparison_price:${model}`);
    }
  }

  if (expectation.requireSourceUrl) {
    const vehicle = toolResults.find(result => result.tool === 'get_vehicle')
      ?.value as {source_url?: unknown} | undefined;
    const sourceUrl =
      typeof vehicle?.source_url === 'string' ? vehicle.source_url : undefined;
    const sourceHost = sourceUrl ? new URL(sourceUrl).host : undefined;
    if (
      sourceUrl &&
      !answer.includes(sourceUrl) &&
      (!sourceHost || !answer.includes(sourceHost))
    ) {
      failures.push('missing_source_link');
    }
  }

  const specificationResponse = toolResults.find(
    result => result.tool === 'get_vehicle',
  )?.value;
  const missingDetails =
    /(?:faltan detalles para los siguientes elementos|faltan especificaciones como|no se incluyen las especificaciones de)\s*:?\s*([\s\S]*)/i.exec(
      answer,
    )?.[1] ?? '';
  const specifications =
    typeof specificationResponse === 'object' &&
    specificationResponse !== null &&
    'specifications' in specificationResponse &&
    Array.isArray(specificationResponse.specifications)
      ? specificationResponse.specifications
      : [];
  const missingSpecificationNames =
    typeof specificationResponse === 'object' &&
    specificationResponse !== null &&
    'missingSpecificationNames' in specificationResponse &&
    Array.isArray(specificationResponse.missingSpecificationNames)
      ? specificationResponse.missingSpecificationNames.filter(
          (name): name is string => typeof name === 'string',
        )
      : undefined;
  const stopWords = new Set(['como', 'para', 'entre', 'con', 'los', 'las']);
  const words = (value: string) =>
    value
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(word => word.length > 3 && !stopWords.has(word))
      .map(word => (word.endsWith('s') ? word.slice(0, -1) : word));
  const unsupportedMissingName =
    missingDetails && missingSpecificationNames !== undefined
      ? missingDetails
          .split(/[,;\n]|\s+y\s+/i)
          .map(words)
          .filter(segment => segment.length > 0)
          .some(
            segment =>
              !missingSpecificationNames.some(name => {
                const declared = new Set(words(name));
                const overlap = segment.filter(word =>
                  declared.has(word),
                ).length;
                return overlap >= Math.min(2, segment.length);
              }),
          )
      : false;
  if (
    unsupportedMissingName ||
    (missingDetails &&
      specifications.some(specification => {
        if (typeof specification !== 'object' || specification === null) {
          return false;
        }
        const item = specification as {name?: unknown; value?: unknown};
        const mentionedWords = new Set(words(missingDetails));
        const specWords = typeof item.name === 'string' ? words(item.name) : [];
        return (
          typeof item.name === 'string' &&
          typeof item.value === 'string' &&
          item.value.trim() !== '' &&
          !/^[-—]$/.test(item.value.trim()) &&
          specWords.some(word => mentionedWords.has(word))
        );
      }))
  ) {
    failures.push('unsupported_missing_spec_claim');
  }

  const offers = offerResults(toolResults);
  const promotionValue = toolResults.find(
    result => result.tool === 'list_promotions',
  )?.value;
  const promotionCount = Array.isArray(promotionValue)
    ? promotionValue.length
    : typeof promotionValue === 'object' && promotionValue !== null
      ? Array.isArray((promotionValue as {results?: unknown}).results)
        ? (promotionValue as {results: unknown[]}).results.length
        : undefined
      : undefined;
  if (
    promotionCount === 0 &&
    /(?:hay|encontr[eé]|disponibles?)[^.]{0,70}promociones/i.test(answer) &&
    !/(?:no|sin)\s+(?:hay|se encontraron|se publicaron)[^.]{0,50}promociones/i.test(
      answer,
    )
  ) {
    failures.push('unsupported_promotion_availability_claim');
  }

  if (
    calledTools.includes('search_offers') ||
    calledTools.includes('search_vehicle_and_offers')
  ) {
    const discussesOffers = offers.length
      ? /oferta|financiam|mensual|enganche|tasa/i.test(answer)
      : /(?:no|sin).{0,50}(?:oferta|financiam|resultado)|no se encontraron/i.test(
          answer,
        );
    if (!discussesOffers) failures.push('missing_offer_result_discussion');
  }

  const vehicles = combinedVehicleResults(toolResults);
  if (
    vehicles.length > 0 &&
    /(?:no hay|sin|no encontr[eé])[^.]{0,60}(?:veh[ií]cul|opcion|alternativ)/i.test(
      answer,
    ) &&
    !vehicles.some(vehicle => {
      const model =
        typeof vehicle.model === 'string' ? vehicle.model : undefined;
      return Boolean(
        model && answer.toLocaleLowerCase().includes(model.toLocaleLowerCase()),
      );
    })
  ) {
    failures.push('contradicted_vehicle_results');
  }
  if (
    vehicles.length > 0 &&
    !vehicles.some(vehicle => {
      const model =
        typeof vehicle.model === 'string' ? vehicle.model : undefined;
      const priceDisplay =
        typeof vehicle.priceDisplay === 'string'
          ? vehicle.priceDisplay
          : undefined;
      return Boolean(
        model &&
        priceDisplay &&
        answer.toLocaleLowerCase().includes(model.toLocaleLowerCase()) &&
        answer.includes(priceDisplay),
      );
    })
  ) {
    failures.push('missing_vehicle_result_detail');
  }

  const combined = toolResults.find(
    result => result.tool === 'search_vehicle_and_offers',
  )?.value;
  const combinedOfferCount =
    typeof combined === 'object' && combined !== null
      ? (combined as {offers?: {resultCount?: unknown}}).offers?.resultCount
      : undefined;
  const assertsOfferAvailability = answer
    .split(/[.!?\n]|\s+y\s+|\s+pero\s+/i)
    .some(
      sentence =>
        /(?:hay|encontr[eé]|disponibles?)[^.]{0,60}(?:oferta|financiam|cr[eé]dito)/i.test(
          sentence,
        ) &&
        !/(?:no\s+hay|no\s+encontr|no\s+.{0,30}disponibles?|sin\s+(?:oferta|financiam|cr[eé]dito))/i.test(
          sentence,
        ),
    );
  if (combinedOfferCount === 0 && assertsOfferAvailability) {
    failures.push('unsupported_offer_availability_claim');
  }

  if (
    expectation.budget !== undefined &&
    offers.some(
      offer =>
        offer.cashPrice !== null &&
        offer.cashPrice !== undefined &&
        Number.isFinite(Number(offer.cashPrice)) &&
        Number(offer.cashPrice) > expectation.budget!,
    ) &&
    !disclosesOverBudget(answer)
  ) {
    failures.push('missing_budget_disclosure');
  }

  if (
    offers.some(offer => offer.validityStatus === 'unknown') &&
    !disclosesUnconfirmedValidity(answer)
  ) {
    failures.push('missing_validity_disclosure');
  }

  if (
    offers.some(
      offer =>
        Array.isArray(offer.dataQualityWarnings) &&
        offer.dataQualityWarnings.length > 0,
    ) &&
    !disclosesTermConflict(answer)
  ) {
    failures.push('missing_term_conflict_disclosure');
  }

  if (
    calledTools.includes('search_vehicle_and_offers') &&
    offers.length > 0 &&
    /financiam|mensualidad|enganche/i.test(answer) &&
    !offers.some(offer => {
      const price = Number(offer.cashPrice);
      return (
        Number.isFinite(price) &&
        [
          String(price),
          new Intl.NumberFormat('es-MX', {maximumFractionDigits: 2}).format(
            price,
          ),
          new Intl.NumberFormat('en-US', {maximumFractionDigits: 2}).format(
            price,
          ),
        ].some(formatted => answer.includes(formatted))
      );
    })
  ) {
    failures.push('missing_offer_price');
  }

  return {passed: failures.length === 0, failures};
}
