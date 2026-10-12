import {normalizeModelKey} from '../src/domain/normalization.js';

export interface CatalogModelYear {
  model: string;
  year: number;
  specificationCount: number;
  featureCount: number;
}

export interface CatalogQaQuestion {
  datasetVersion: 1;
  id: string;
  question: string;
  category: string;
  model?: string;
  year?: number;
  expectedTools: string[];
  referenceAnswer: string;
  sourceUrls: string[];
}

export interface CatalogQaCoverage {
  questionCount: number;
  categories: string[];
  tools: string[];
  baselineModelYearCount: number;
  coveredBaselineModelYears: number;
  untestedModelYears: string[];
  catalogDrift: {added: string[]; removed: string[]};
  detailCountDrift: Array<{
    model: string;
    year: number;
    baselineSpecifications: number;
    currentSpecifications: number;
    baselineFeatures: number;
    currentFeatures: number;
  }>;
  fullCatalogCoverage: boolean;
}

export interface VehicleDetailCompleteness {
  complete: boolean;
  model: string;
  year: number;
  expectedSpecifications: number;
  returnedSpecifications: number;
  expectedFeatures: number;
  returnedFeatures: number;
  errors: string[];
}

export interface VehicleModelYearOptionsCompleteness {
  complete: boolean;
  expectedModelYears: number;
  returnedModelYears: number;
  errors: string[];
}

const ALLOWED_TOOLS = new Set([
  'search_vehicles',
  'search_vehicle_and_offers',
  'get_vehicle',
  'compare_vehicles',
  'compare_trims',
  'compare_model_years',
  'get_variant_comparisons',
  'get_page_links',
  'get_vehicle_provenance',
  'list_promotions',
  'search_offers',
  'get_catalog_status',
]);

function modelYearKey(value: Pick<CatalogModelYear, 'model' | 'year'>): string {
  return `${normalizeModelKey(value.model)}:${value.year}`;
}

function displayModelYear(
  value: Pick<CatalogModelYear, 'model' | 'year'>,
): string {
  return `${value.model} ${value.year}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseCatalogQaQuestions(source: string): unknown[] {
  const rows: unknown[] = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as unknown);
    } catch {
      throw new Error(`line ${index + 1} is not valid JSON`);
    }
  }
  return rows;
}

export function validateCatalogQaQuestions(
  value: unknown,
  baselineInventory: readonly CatalogModelYear[],
  currentInventory: readonly CatalogModelYear[],
): CatalogQaCoverage {
  if (!Array.isArray(value)) throw new Error('questions must be an array');

  const ids = new Set<string>();
  const coveredModelYears = new Set<string>();
  const categories = new Set<string>();
  const tools = new Set<string>();

  for (const row of value) {
    if (!isRecord(row)) throw new Error('each question must be an object');
    const {
      datasetVersion,
      id,
      question,
      category,
      model,
      year,
      expectedTools,
      referenceAnswer,
      sourceUrls,
    } = row;
    if (datasetVersion !== 1) {
      throw new Error('each question must use datasetVersion 1');
    }
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('each question requires a non-empty id');
    }
    if (ids.has(id)) throw new Error(`duplicate question id: ${id}`);
    ids.add(id);
    if (typeof question !== 'string' || !question.trim()) {
      throw new Error(`${id} requires a non-empty customer question`);
    }
    if (typeof category !== 'string' || !category.trim()) {
      throw new Error(`${id} requires a category`);
    }
    if (typeof model === 'string') {
      if (year === undefined) {
        // Model-only questions intentionally exercise all-year lookup behavior.
      } else if (Number.isInteger(year)) {
        coveredModelYears.add(modelYearKey({model, year: year as number}));
      } else {
        throw new Error(`${id} year must be an integer when provided`);
      }
    } else if (model !== undefined || year !== undefined) {
      throw new Error(`${id} requires a model when a year is provided`);
    }
    if (
      !Array.isArray(expectedTools) ||
      expectedTools.length === 0 ||
      !expectedTools.every(tool => typeof tool === 'string')
    ) {
      throw new Error(`${id} requires at least one expected MCP tool`);
    }
    for (const tool of expectedTools as string[]) {
      if (!ALLOWED_TOOLS.has(tool)) {
        throw new Error(`${id} has unsupported MCP tool: ${tool}`);
      }
      tools.add(tool);
    }
    if (
      typeof referenceAnswer !== 'string' ||
      !referenceAnswer.trim() ||
      !Array.isArray(sourceUrls) ||
      sourceUrls.length === 0 ||
      !sourceUrls.every(
        url => typeof url === 'string' && /^https:\/\//.test(url),
      )
    ) {
      throw new Error(
        `${id} requires a reference answer and at least one source URL`,
      );
    }
    categories.add(category);
  }

  if (value.length < 100) {
    throw new Error('catalog QA dataset needs at least 100 questions');
  }

  const baselineMap = new Map(
    baselineInventory.map(row => [modelYearKey(row), row]),
  );
  const currentMap = new Map(
    currentInventory.map(row => [modelYearKey(row), row]),
  );
  const baselineKeys = new Set(baselineMap.keys());
  const currentKeys = new Set(currentMap.keys());
  const untestedModelYears = [...currentKeys]
    .filter(key => !coveredModelYears.has(key))
    .map(key => displayModelYear(currentMap.get(key)!))
    .sort();
  const catalogDrift = {
    added: [...currentKeys]
      .filter(key => !baselineKeys.has(key))
      .map(key => displayModelYear(currentMap.get(key)!))
      .sort(),
    removed: [...baselineKeys]
      .filter(key => !currentKeys.has(key))
      .map(key => displayModelYear(baselineMap.get(key)!))
      .sort(),
  };
  const detailCountDrift = currentInventory.flatMap(current => {
    const baseline = baselineMap.get(modelYearKey(current));
    if (
      !baseline ||
      (baseline.specificationCount === current.specificationCount &&
        baseline.featureCount === current.featureCount)
    ) {
      return [];
    }
    return [
      {
        model: current.model,
        year: current.year,
        baselineSpecifications: baseline.specificationCount,
        currentSpecifications: current.specificationCount,
        baselineFeatures: baseline.featureCount,
        currentFeatures: current.featureCount,
      },
    ];
  });
  const coveredBaselineModelYears = [...baselineKeys].filter(key =>
    coveredModelYears.has(key),
  ).length;

  return {
    questionCount: value.length,
    categories: [...categories].sort(),
    tools: [...tools].sort(),
    baselineModelYearCount: baselineKeys.size,
    coveredBaselineModelYears,
    untestedModelYears,
    catalogDrift,
    detailCountDrift,
    fullCatalogCoverage:
      coveredBaselineModelYears === baselineKeys.size &&
      untestedModelYears.length === 0 &&
      catalogDrift.added.length === 0 &&
      catalogDrift.removed.length === 0 &&
      detailCountDrift.length === 0,
  };
}

export function checkVehicleDetailCompleteness(
  vehicle: unknown,
  expected: CatalogModelYear,
): VehicleDetailCompleteness {
  const value = isRecord(vehicle) ? vehicle : {};
  const specifications = Array.isArray(value.specifications)
    ? value.specifications
    : [];
  const features = Array.isArray(value.features) ? value.features : [];
  const returnedSpecifications = specifications.length;
  const returnedFeatures = features.length;
  const errors: string[] = [];

  if (value.specificationCount !== expected.specificationCount) {
    errors.push(
      `reported specification count ${String(value.specificationCount)} does not match catalog count ${expected.specificationCount}`,
    );
  }
  if (returnedSpecifications !== expected.specificationCount) {
    errors.push(
      `returned ${returnedSpecifications} specifications; catalog contains ${expected.specificationCount}`,
    );
  }
  if (value.specificationsOmitted !== 0) {
    errors.push(
      `MCP reports ${String(value.specificationsOmitted)} omitted specifications`,
    );
  }
  if (value.featureCount !== expected.featureCount) {
    errors.push(
      `reported feature count ${String(value.featureCount)} does not match catalog count ${expected.featureCount}`,
    );
  }
  if (returnedFeatures !== expected.featureCount) {
    errors.push(
      `returned ${returnedFeatures} features; catalog contains ${expected.featureCount}`,
    );
  }
  if (value.featuresOmitted !== 0) {
    errors.push(
      `MCP reports ${String(value.featuresOmitted)} omitted features`,
    );
  }

  return {
    complete: errors.length === 0,
    model: expected.model,
    year: expected.year,
    expectedSpecifications: expected.specificationCount,
    returnedSpecifications,
    expectedFeatures: expected.featureCount,
    returnedFeatures,
    errors,
  };
}

export function checkVehicleModelYearOptionsCompleteness(
  response: unknown,
  expected: readonly CatalogModelYear[],
): VehicleModelYearOptionsCompleteness {
  const value = isRecord(response) ? response : {};
  const options = Array.isArray(value.options) ? value.options : [];
  const errors: string[] = [];
  const byYear = new Map<number, unknown>();

  for (const option of options) {
    if (!isRecord(option)) continue;
    const year = Number(option.year ?? option.modelYear ?? option.model_year);
    if (Number.isInteger(year)) byYear.set(year, option);
  }
  if (value.status !== 'available_model_year_options') {
    errors.push(
      `MCP returned status ${String(value.status)} instead of available_model_year_options`,
    );
  }
  if (byYear.size !== options.length) {
    errors.push('MCP returned an option without a unique integer model year');
  }
  for (const modelYear of expected) {
    const option = byYear.get(modelYear.year);
    if (!option) {
      errors.push(`MCP omitted ${modelYear.model} ${modelYear.year}`);
      continue;
    }
    const detail = checkVehicleDetailCompleteness(option, modelYear);
    errors.push(
      ...detail.errors.map(
        error => `${modelYear.model} ${modelYear.year}: ${error}`,
      ),
    );
  }
  for (const year of byYear.keys()) {
    if (!expected.some(modelYear => modelYear.year === year)) {
      errors.push(`MCP returned unexpected model year ${year}`);
    }
  }

  return {
    complete: errors.length === 0 && byYear.size === expected.length,
    expectedModelYears: expected.length,
    returnedModelYears: byYear.size,
    errors,
  };
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface OllamaToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolRoutingScore {
  precision: number;
  recall: number;
  f1: number;
  exact: boolean;
}

export function scoreCatalogQaToolRouting(
  expectedTools: readonly string[],
  actualTools: readonly string[],
): ToolRoutingScore {
  const expected = new Set(expectedTools);
  const actual = new Set(actualTools);
  const matchedExpected = new Set(
    [...actual].filter(tool => expected.has(tool)),
  );
  const precision =
    actualTools.length === 0 ? 0 : matchedExpected.size / actualTools.length;
  const recall = expected.size === 0 ? 1 : matchedExpected.size / expected.size;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return {
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    exact:
      expected.size === actualTools.length &&
      matchedExpected.size === expected.size,
  };
}

export function parseMcpJsonRpcResponse(
  source: string,
): Record<string, unknown> {
  try {
    const payload: unknown = JSON.parse(source);
    if (isRecord(payload)) return payload;
  } catch {
    // Streamable HTTP uses server-sent events for JSON-RPC messages.
  }

  const events = source.split(/\r?\n\r?\n/);
  for (const event of events.reverse()) {
    const data = event
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice('data:'.length).trim())
      .join('\n');
    if (!data || data === '[DONE]') continue;
    try {
      const payload: unknown = JSON.parse(data);
      if (isRecord(payload)) return payload;
    } catch {
      continue;
    }
  }
  throw new Error('MCP response contains no JSON-RPC message');
}

export function mcpToolsToOllamaTools(
  definitions: readonly McpToolDefinition[],
): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  return definitions.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.inputSchema,
    },
  }));
}

export function parseOllamaToolCalls(message: unknown): OllamaToolCall[] {
  if (!isRecord(message) || !Array.isArray(message.tool_calls)) return [];
  return message.tool_calls.map(value => {
    const call = isRecord(value) ? value : {};
    const fn = isRecord(call.function) ? call.function : {};
    const name = typeof fn.name === 'string' ? fn.name : '';
    let args: unknown = fn.arguments;
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args) as unknown;
      } catch {
        throw new Error(
          `tool ${name || '<unknown>'} returned invalid JSON arguments`,
        );
      }
    }
    if (!name || !isRecord(args)) {
      throw new Error('Ollama returned a malformed tool call');
    }
    return {name, arguments: args};
  });
}

export function selectCatalogQaRange<T>(
  questions: readonly T[],
  start: number,
  limit?: number,
): T[] {
  if (!Number.isInteger(start) || start < 0) {
    throw new Error('question range start must be a non-negative integer');
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('question range limit must be a positive integer');
  }
  if (start >= questions.length) {
    throw new Error('question range starts outside the dataset');
  }
  return questions.slice(
    start,
    limit === undefined ? undefined : start + limit,
  );
}
