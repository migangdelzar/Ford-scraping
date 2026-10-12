type DataRecord = Record<string, unknown>;

const record = (value: unknown): DataRecord =>
  value !== null && typeof value === 'object' ? (value as DataRecord) : {};
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;
const displayName = (value: DataRecord): string | undefined =>
  text(value.modelName) ?? text(value.model);
const displayYear = (value: DataRecord): number | undefined => {
  const year = value.modelYear ?? value.year;
  return typeof year === 'number' ? year : undefined;
};
const normalizeName = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim();
const money = (value: unknown): string =>
  `MXN $${Number(value).toLocaleString('en-US', {maximumFractionDigits: 2})}`;

export function getVehicleSource(value: unknown): string | undefined {
  const detail = record(value);
  return (
    text(detail.sourceUrl) ??
    text(detail.modelPageUrl) ??
    text(detail.technicalSheetUrl)
  );
}

export function isCompleteVehicleDetail(value: unknown): boolean {
  const detail = record(value);
  if (
    (detail.status === 'model_year_not_found' ||
      detail.status === 'no_model_year_options_found') &&
    Array.isArray(detail.availableModelYears) &&
    Array.isArray(detail.options)
  )
    return !!text(detail.model) && typeof detail.requestedYear === 'number';
  if (
    !text(detail.model) ||
    typeof detail.year !== 'number' ||
    !Array.isArray(detail.specifications) ||
    !Array.isArray(detail.features)
  )
    return false;
  if (detail.modelPageUnavailable === true)
    return !!text(detail.priceSourceUrl);
  return !!getVehicleSource(detail);
}

export function synthesizeFlowAnswer(
  profileValue: unknown,
  selectedValue: unknown,
  detailValue: unknown,
  offersValue: unknown,
): string {
  const profile = record(profileValue);
  const selected = record(selectedValue);
  const detail = record(detailValue);
  const offers = record(offersValue);
  const requestedModel = text(profile.model) ?? 'Ford';
  const budget = Number(profile.budget);
  const selectedName = displayName(selected);
  const selectedSource = getVehicleSource(selected);
  if (
    detail.status === 'model_year_not_found' ||
    detail.status === 'no_model_year_options_found'
  ) {
    const options = Array.isArray(detail.options)
      ? detail.options.map(record)
      : [];
    const available = options
      .map(option => ({
        year: displayYear(option),
        url: getVehicleSource(option),
      }))
      .filter(
        (option): option is {year: number; url: string} =>
          typeof option.year === 'number' && !!option.url,
      );
    const availableText = available.length
      ? available.map(option => `${option.year}: ${option.url}`).join('; ')
      : 'no current catalog years';
    const requestedYear =
      typeof detail.requestedYear === 'number' ? detail.requestedYear : 2026;
    const lines = [
      `No ${requestedModel} ${requestedYear} catalog record was found. Available model-year pages: ${availableText}.`,
    ];
    if (selectedName)
      lines.push(
        `Alternative result: ${selectedName} ${displayYear(selected) ?? ''}${selected.price === null || selected.price === undefined ? '' : ` at ${money(selected.price)}`}.${selectedSource ? ` Source: ${selectedSource}.` : ''}`,
      );
    const resultRows = Array.isArray(offers.results) ? offers.results : [];
    const hasLegacyOffer = resultRows.some(
      offer =>
        normalizeName(record(offer).modelName) ===
          normalizeName(requestedModel) &&
        record(offer).modelYear === requestedYear,
    );
    if (hasLegacyOffer)
      lines.push(
        `A financing record exists for ${requestedYear}, but its applicability to a current exact vehicle cannot be confirmed.`,
      );
    else
      lines.push(
        'No financing result was returned for the requested model and year.',
      );
    return lines.join(' ');
  }
  const isExact =
    normalizeName(selectedName) === normalizeName(requestedModel) &&
    displayYear(selected) === 2026;
  const lines: string[] = [];

  if (isExact && selected.price !== null && selected.price !== undefined) {
    const fits = Number(selected.price) <= budget;
    lines.push(
      `Requested ${requestedModel} 2026 starts at ${money(selected.price)}; ${fits ? 'within' : 'above'} the stated ${money(budget)} budget.`,
    );
  } else {
    if (detail.price !== null && detail.price !== undefined) {
      const fits = Number(detail.price) <= budget;
      lines.push(
        `Requested ${requestedModel} 2026 starts at ${money(detail.price)}; ${fits ? 'within' : 'above'} the stated ${money(budget)} budget.`,
      );
    } else {
      lines.push(
        `No exact ${requestedModel} 2026 result was found within the stated ${money(budget)} budget.`,
      );
    }
    if (selectedName)
      lines.push(
        `Alternative result: ${selectedName} ${displayYear(selected) ?? ''}${selected.price === null || selected.price === undefined ? '' : ` at ${money(selected.price)}`}.${selectedSource ? ` Source: ${selectedSource}.` : ''}`,
      );
  }

  const resultRows = Array.isArray(offers.results) ? offers.results : [];
  const financing = resultRows
    .map(record)
    .find(
      offer =>
        normalizeName(offer.modelName) === normalizeName(requestedModel) &&
        offer.modelYear === 2026,
    );
  if (financing) {
    const fits =
      financing.cashPrice !== null &&
      financing.cashPrice !== undefined &&
      Number(financing.cashPrice) <= budget;
    lines.push(
      `Financing for requested ${requestedModel} 2026: ${text(financing.title) ?? 'listed plan'}; vehicle price ${money(financing.cashPrice)}, monthly ${money(financing.monthlyPayment)}, annual rate ${financing.annualInterestRate ?? 'not provided'}%. The finance vehicle price is ${fits ? 'within' : 'above'} budget.`,
    );
    const evidence = record(
      Array.isArray(financing.evidence) ? financing.evidence[0] : undefined,
    );
    const evidenceText = text(evidence.content) ?? '';
    const down = evidenceText.match(
      /Enganche:\s*([\d,]+(?:\.\d+)?)\s*MXN/i,
    )?.[1];
    if (down) lines.push(`Listed down payment: MXN $${down}.`);
    if (/sujeto a aprobación de crédito/i.test(evidenceText))
      lines.push('Subject to credit approval.');
    if (Array.isArray(financing.dataQualityWarnings))
      for (const warning of financing.dataQualityWarnings)
        lines.push(`Source-data warning: ${String(warning)}`);
    if (financing.validityStatus === 'unknown')
      lines.push('The current availability is unconfirmed.');
  } else {
    lines.push(
      'No financing result was returned for the requested model and year.',
    );
  }

  if (detail.modelPageUnavailable === true) {
    lines.push(
      `The model-specific 2026 page is unavailable; specifications were not confirmed. Catalog price source: ${text(detail.priceSourceUrl) ?? 'unavailable'}.`,
    );
  } else if (
    Array.isArray(detail.specifications) &&
    detail.specifications.length
  ) {
    const spec = detail.specifications
      .map(record)
      .find(item => text(item.value) && item.value !== '-');
    if (spec)
      lines.push(
        `Vehicle data: ${text(spec.name) ?? 'Specification'} — ${text(spec.value)}${text(spec.sourceUrl) ? ` (source: ${text(spec.sourceUrl)})` : ''}.`,
      );
  } else if (
    Array.isArray(detail.specifications) &&
    Array.isArray(detail.features) &&
    !detail.specifications.length &&
    !detail.features.length
  ) {
    lines.push(
      'No specifications or features were available for this vehicle record.',
    );
  }

  const source = getVehicleSource(detail);
  if (source) lines.push(`Source: ${source}.`);
  return lines.join(' ');
}
