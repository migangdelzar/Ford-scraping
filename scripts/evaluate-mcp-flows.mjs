/* global Buffer, clearTimeout, console, process, setTimeout */
/* eslint eqeqeq: ["error", "always", {"null": "ignore"}] */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEvaluationOptions} from './mcp-evaluation-options.js';
import {
  getVehicleSource,
  isCompleteVehicleDetail,
  synthesizeFlowAnswer,
} from './mcp-flow-answer.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = parseEvaluationOptions(process.argv.slice(2));
const child = spawn(
  `${root}/node_modules/.bin/tsx`,
  [`${root}/src/cli.ts`, 'mcp'],
  {
    cwd: root,
    env: {...process.env, DOTENV_CONFIG_PATH: `${root}/.env`},
    stdio: ['pipe', 'pipe', 'pipe'],
  },
);
const lines = createInterface({input: child.stdout});
const pending = new Map();
let rpcId = 0;
let stderr = '';
child.stderr.on('data', chunk => {
  stderr += chunk.toString();
});
lines.on('line', line => {
  try {
    const message = JSON.parse(line);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timer);
      entry.resolve(message);
    }
  } catch {
    // Ignore non-JSON stdout lines so pending MCP replies can still resolve.
  }
});
function rpc(method, params = {}, timeoutMs = 60000) {
  const id = ++rpcId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout ${method} (${timeoutMs}ms)`));
    }, timeoutMs);
    pending.set(id, {resolve, reject, timer});
    child.stdin.write(
      `${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`,
    );
  });
}
function decode(response) {
  if (response.error) throw new Error(JSON.stringify(response.error));
  if (response.result?.isError)
    throw new Error(
      response.result.content?.map(c => c.text).join('\n') || 'MCP tool error',
    );
  const text = response.result?.content?.find(c => c.type === 'text')?.text;
  if (!text) throw new Error('MCP response omitted text content');
  return JSON.parse(text);
}
async function call(name, args) {
  return decode(await rpc('tools/call', {name, arguments: args}));
}
const models = [
  ['BRONCO', 998500],
  ['BRONCO RAPTOR', 2140500],
  ['BRONCO SPORT', 773500],
  ['EDGE HÍBRIDA', 897000],
  ['EXPEDITION', 1765500],
  ['EXPLORER', 1193600],
  ['F-150', 1027000],
  ['F-150 HÍBRIDA', 1180000],
  ['F-250', 1560800],
  ['LOBO', 1453500],
  ['LOBO HÍBRIDA', 1821500],
  ['LOBO RAPTOR', 2450000],
  ['MAVERICK HÍBRIDA', 770700],
  ['MUSTANG', 951500],
  ['MUSTANG MACH E', 996500],
  ['RANGER', 763500],
  ['RANGER RAPTOR', 1313500],
  ['SUPER DUTY CHASIS', 1081600],
  ['TERRITORY', 559900],
  ['TERRITORY HÍBRIDA', 719900],
  ['TRANSIT CHASIS', 838600],
  ['TRANSIT CUSTOM', 865600],
  ['TRANSIT PASAJEROS', 1075600],
  ['TRANSIT VAN', 1052600],
];
const profiles = Array.from({length: options.flows}, (_, i) => {
  const profileIndex = options.start + i;
  const [model, basePrice] = models[profileIndex % models.length];
  const multiplier = [0.8, 0.95, 1.0, 1.1, 1.4][profileIndex % 5];
  const budget = Math.round((basePrice * multiplier) / 10000) * 10000;
  const needs = [
    'familia y viajes',
    'mensualidad accesible',
    'trabajo diario',
    'buen espacio y tecnología',
    'opciones de crédito',
  ];
  return {
    id: profileIndex + 1,
    model,
    basePrice,
    budget,
    need: needs[profileIndex % needs.length],
  };
});
const toolNames = [
  'search_vehicles',
  'get_vehicle',
  'search_offers',
  'list_promotions',
  'get_catalog_status',
];
const metrics = Object.fromEntries(
  toolNames.map(name => [
    name,
    {calls: 0, passed: 0, failed: 0, latencies: [], errors: []},
  ]),
);
const flags = {
  targetNotInBudgetResults: 0,
  financingOfferOverBudget: 0,
  termConflictsDetected: 0,
  missingSpecsDisclosed: 0,
  missingValidityDates: 0,
};
const flowErrors = [];
const samples = [];
function measured(name, start, validate) {
  const m = metrics[name];
  m.calls++;
  m.latencies.push(performance.now() - start);
  try {
    validate();
    m.passed++;
    return true;
  } catch (e) {
    m.failed++;
    if (m.errors.length < 5) m.errors.push(String(e));
    return false;
  }
}
async function invoke(name, args, validate) {
  const start = performance.now();
  try {
    const value = await call(name, args);
    measured(name, start, () => validate(value));
    return value;
  } catch (e) {
    measured(name, start, () => {
      throw e;
    });
    return undefined;
  }
}
const money = n =>
  `MXN $${Number(n).toLocaleString('en-US', {maximumFractionDigits: 2})}`;
function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim();
}
const vehicleName = value => value?.modelName ?? value?.model;
const vehicleYear = value => value?.modelYear ?? value?.year;
async function simulate(profile) {
  const failures = [];
  const search = await invoke(
    'search_vehicles',
    {
      query: `Busco ${profile.model} 2026 para ${profile.need}, presupuesto de ${profile.budget} pesos y quiero revisar financiamiento.`,
      filters: {modelYear: 2026, maxPrice: profile.budget},
      limit: 5,
    },
    v => {
      if (!Array.isArray(v.results))
        throw Error('search_vehicles results is not an array');
      if (
        v.results.some(r => r.price != null && Number(r.price) > profile.budget)
      )
        throw Error('vehicle search leaked a result above maxPrice');
      if (!['ready', 'unavailable'].includes(v.semanticSearch))
        throw Error('invalid semanticSearch');
    },
  );
  if (!search) failures.push('search_vehicles');
  const rows = search?.results ?? [];
  const selected =
    rows.find(
      r =>
        normalizeName(vehicleName(r)) === normalizeName(profile.model) &&
        vehicleYear(r) === 2026,
    ) ?? rows[0];
  if (
    !selected ||
    normalizeName(vehicleName(selected)) !== normalizeName(profile.model)
  )
    flags.targetNotInBudgetResults++;
  const detail = await invoke(
    'get_vehicle',
    {model: profile.model, year: 2026},
    v => {
      if (!isCompleteVehicleDetail(v))
        throw Error('vehicle detail response incomplete');
    },
  );
  if (!detail) failures.push('get_vehicle');
  const offers = await invoke(
    'search_offers',
    {
      query: `Financiamiento ${profile.model} 2026, enganche, mensualidad y tasa para ${profile.need}.`,
      filters: {
        model: profile.model,
        modelYear: 2026,
        offerType: 'financing',
        activeOnly: true,
      },
      limit: 5,
    },
    v => {
      if (!Array.isArray(v.results))
        throw Error('search_offers results is not an array');
      if (
        v.results.some(
          r =>
            normalizeName(r.modelName) !== normalizeName(profile.model) ||
            r.modelYear !== 2026,
        )
      )
        throw Error('offer search filter mismatch');
      if (
        v.results.some(
          r =>
            r.monthlyPayment != null &&
            r.annualInterestRate != null &&
            r.offerType === 'promotion',
        )
      )
        throw Error('finance API offer exposed as promotion');
      if (
        v.results.some(
          r =>
            !['active', 'expired', 'upcoming', 'unknown'].includes(
              r.validityStatus,
            ),
        )
      )
        throw Error('offer validity status missing');
      if (!['ready', 'unavailable'].includes(v.semanticSearch))
        throw Error('invalid semanticSearch');
    },
  );
  if (!offers) failures.push('search_offers');
  const promotions = await invoke(
    'list_promotions',
    {filters: {asOf: new Date().toISOString().slice(0, 10)}},
    v => {
      const rows = Array.isArray(v) ? v : v?.results;
      if (!Array.isArray(rows))
        throw Error('list_promotions results is not an array');
      if (
        rows.some(
          o => o.offer_type === 'financing' || o.offerType === 'financing',
        )
      )
        throw Error('financing record leaked into promotions');
      if (
        rows.some(
          o =>
            !['active', 'expired', 'upcoming', 'unknown'].includes(
              o.validityStatus,
            ),
        )
      )
        throw Error('promotion validity status missing');
    },
  );
  if (!promotions) failures.push('list_promotions');
  const status = await invoke('get_catalog_status', {}, v => {
    if (
      !v ||
      !Number.isInteger(v.pages) ||
      !Number.isInteger(v.vehicles) ||
      !Number.isInteger(v.documents) ||
      typeof v.latest_crawled_at !== 'string' ||
      Number.isNaN(Date.parse(v.latest_crawled_at))
    )
      throw Error('catalog status schema or freshness missing');
  });
  if (!status) failures.push('get_catalog_status');
  const fin = offers?.results?.find(
    offer =>
      normalizeName(offer.modelName) === normalizeName(profile.model) &&
      offer.modelYear === 2026,
  );
  if (fin?.validityStatus === 'unknown') flags.missingValidityDates++;
  if (fin?.dataQualityWarnings?.length)
    flags.termConflictsDetected += fin.dataQualityWarnings.length;
  if (fin?.cashPrice != null && Number(fin.cashPrice) > profile.budget)
    flags.financingOfferOverBudget++;
  if (
    Array.isArray(detail?.specifications) &&
    Array.isArray(detail?.features) &&
    !detail.specifications.length &&
    !detail.features.length
  )
    flags.missingSpecsDisclosed++;
  const assistantAnswer = synthesizeFlowAnswer(
    profile,
    selected,
    detail,
    offers,
  );
  if (
    selected?.price != null &&
    Number(selected.price) > profile.budget &&
    assistantAnswer.includes('within the stated')
  )
    failures.push('answer_budget_hallucination');
  if (
    detail &&
    !detail.features?.length &&
    !detail.specifications?.length &&
    !['model_year_not_found', 'no_model_year_options_found'].includes(
      detail.status,
    ) &&
    !assistantAnswer.includes('model-specific 2026 page is unavailable') &&
    !assistantAnswer.includes('no specifications or features')
  )
    failures.push('answer_unstated_feature_gap');
  if (
    fin?.validityStatus === 'unknown' &&
    !assistantAnswer.includes('current availability is unconfirmed')
  )
    failures.push('answer_missing_unknown_validity');
  if (
    fin?.dataQualityWarnings?.length &&
    !assistantAnswer.includes('Source-data warning:')
  )
    failures.push('answer_missing_term_conflict');
  if (
    detail?.specifications?.length &&
    !assistantAnswer.includes('Vehicle data:')
  )
    failures.push('answer_missing_structured_vehicle_data');
  if (
    fin?.monthlyPayment != null &&
    !assistantAnswer.includes(money(fin.monthlyPayment))
  )
    failures.push('answer_missing_finance_value');
  if (failures.length && flowErrors.length < 15)
    flowErrors.push({
      simulation: profile.id,
      model: profile.model,
      budget: profile.budget,
      failures,
    });
  if (samples.length < 3)
    samples.push({
      simulation: profile.id,
      user: `Busco ${profile.model} 2026 para ${profile.need}, con presupuesto de ${money(profile.budget)} y financiamiento.`,
      assistantAnswer,
      toolSummary: {
        vehicleResults: rows.length,
        selected: vehicleName(selected),
        offers: offers?.results?.length,
        source: getVehicleSource(detail) ?? detail?.priceSourceUrl,
        promotions: Array.isArray(promotions)
          ? promotions.length
          : promotions?.results?.length,
        catalog: status,
      },
    });
}

try {
  const init = await rpc('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: {name: 'ford-mcp-grounded-flow-eval', version: '1.0.0'},
  });
  if (init.error) throw Error(JSON.stringify(init.error));
  child.stdin.write(
    `${JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})}\n`,
  );
  const listed = await rpc('tools/list');
  const actualNames = listed.result?.tools?.map(t => t.name) ?? [];
  if (toolNames.some(name => !actualNames.includes(name)))
    throw Error(`tool catalog missing tools: ${actualNames.join(', ')}`);
  const started = performance.now();
  const concurrency = options.concurrency;
  for (let i = 0; i < profiles.length; i += concurrency)
    await Promise.all(profiles.slice(i, i + concurrency).map(simulate));
  const byTool = Object.fromEntries(
    Object.entries(metrics).map(([name, m]) => {
      const sorted = [...m.latencies].sort((a, b) => a - b);
      return [
        name,
        {
          calls: m.calls,
          passed: m.passed,
          failed: m.failed,
          p50Ms: Math.round(sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0),
          p95Ms: Math.round(
            sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0,
          ),
          maxMs: Math.round(sorted.at(-1) ?? 0),
          errors: m.errors,
        },
      ];
    }),
  );
  const allPassed =
    Object.values(metrics).every(
      m => m.calls === options.flows && m.failed === 0,
    ) && flowErrors.length === 0;
  console.log(
    JSON.stringify(
      {
        server: init.result?.serverInfo?.name,
        simulatedFlows: profiles.length,
        callsPerTool: options.flows,
        totalMcpCalls: Object.values(metrics).reduce(
          (sum, m) => sum + m.calls,
          0,
        ),
        concurrency,
        totalElapsedMs: Math.round(performance.now() - started),
        allPassed,
        checks: {
          targetNotInBudgetResults: flags.targetNotInBudgetResults,
          financingOfferOverBudget: flags.financingOfferOverBudget,
          termConflictsDetected: flags.termConflictsDetected,
          missingSpecsDisclosed: flags.missingSpecsDisclosed,
          missingValidityDates: flags.missingValidityDates,
        },
        byTool,
        flowErrors,
        samples,
        stderrBytes: Buffer.byteLength(stderr),
      },
      null,
      2,
    ),
  );
  child.stdin.end();
  await Promise.race([
    once(child, 'exit'),
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null) child.kill();
  if (!allPassed) process.exitCode = 1;
} catch (e) {
  console.error(String(e), stderr);
  child.kill();
  process.exitCode = 1;
}
