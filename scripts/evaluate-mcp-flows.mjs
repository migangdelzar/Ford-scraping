/* global Buffer, clearTimeout, console, process, setTimeout */
/* eslint eqeqeq: ["error", "always", {"null": "ignore"}] */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEvaluationOptions} from './mcp-evaluation-options.js';

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
const docByModelYearId = {
  '39c77a40-f900-48ae-b948-bd3176823269':
    '3493a111-1846-459d-9f44-d895a0dc205c',
  'c75baaf4-1244-4387-bd1c-7b399037093d':
    '1e84c944-3146-45c1-8a7e-b7bc706a7cbe',
  'abda58aa-86f9-423d-a905-c01f9f962cc2':
    'dcfbbc71-4daf-4244-991d-1691f1d57357',
  'b276e19e-1b37-40a3-8d7f-f26fb5d030e8':
    '27e0ca55-a24a-4f63-9f6b-e0b93551a690',
  '204d8dba-b2b8-444a-9315-ce5cb8ba1401':
    '325c60dd-264a-432a-90fc-fdeb39a0dbfe',
  '7690a67b-5fe4-4fdf-b370-4e70f340e7b2':
    '87166a0f-29ef-478b-bac4-ce2c36bba318',
  '92a82412-69e3-4fb8-8258-8831157a9768':
    '1f47d78e-4685-42e7-96ca-aa0a4dce8ca7',
  'e11ae5eb-ace1-45e1-bece-228ca126c53f':
    '30e8a150-6e29-4872-a20f-76af432ed345',
  '45b7ab23-f0cc-4a0d-8c79-4c2bd199201c':
    '351dbd97-3872-442f-9714-2c15313bcedb',
  '0cab03d3-d1b8-40d5-a129-53d97da6d335':
    '0f1c468f-9bbb-4f29-bb30-0631d2e68e8c',
  'b368a668-39b6-41e8-b16e-13a4cbb8419c':
    '37907b2e-fc67-486f-8505-1907faf31cb0',
  '65dedafe-dd0f-42d2-a284-8f69d1329568':
    '7f07051b-97eb-4b4a-ad92-c5f596ccde66',
  '230bf8b2-10fe-4da3-81b7-c80f3fbf0203':
    'a4089f24-7ace-48d9-98fa-5d194b38e9a9',
  '0a77adaf-12d7-49ec-b5c6-8969c7377bee':
    'd16aeaac-da18-4376-a60c-ff9b8cd905e7',
  'cb1863b2-ed60-4440-9c2a-ae007aeae0be':
    '86426222-2427-42c0-8cb7-5df389c2ef39',
  '7276f1c8-0948-4891-a9f2-e9b257d2b234':
    '39b9b20d-aacb-43e6-84a1-6829bedcb7f8',
  '4efd3089-36b2-4041-8c7e-774ef5988ca0':
    '6abba14c-c980-4a17-b7f7-5680179a1765',
  'a602ae76-4f7a-409a-aa76-d3631824687d':
    '03f3c9a8-26f0-4f21-9f55-1c8c76cdbf0f',
  'ac82dc9b-8404-4bb4-af40-a5717468e5a0':
    '5b280dfb-8a0c-4ad4-9eff-e6fcb36d55c1',
  '4aa1221b-4b9d-42ba-8c77-e7d60d259364':
    '07e8a35d-dc1c-46bf-a0e2-25222c030696',
  'ff270524-13f1-4487-b464-655c63c39ab5':
    '20c9b5a6-335a-471c-b217-29099a75f9fd',
  '96c79669-8a2e-478e-a359-bb11b8a285ff':
    '6a5c7b66-b2ab-4b69-8c6f-e8c789127378',
  '90992ccc-f1cc-4ec2-a495-c047386d716c':
    '4c2c520b-0978-4579-a500-71af646e1656',
  '99f0d8b1-b219-484b-8adc-4a6cf519c49c':
    '08732624-0c4f-4d56-8d35-a5b53ee8b10a',
  'c4c8cddb-d85e-47b2-be59-271ba0480d14':
    '1e3c0db1-4e41-4ae3-b879-903d366df1bb',
  'bec069fc-a5cf-457a-8c69-3ca70d4ca7f7':
    '455f63dd-6239-4e75-8f6d-e14cce9ebbbe',
  '203eedef-4834-4403-97f5-8172b9045f46':
    '213eaf6f-04df-4055-a518-1d65399513cf',
};
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
  'compare_vehicles',
  'get_vehicle_provenance',
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
function synthesize(profile, selected, detail, offers, comparison, provenance) {
  const lines = [];
  if (selected?.price != null) {
    const fits = Number(selected.price) <= profile.budget;
    lines.push(
      `${selected.modelName} ${selected.modelYear} starts at ${money(selected.price)}; ${fits ? 'within' : 'above'} the stated ${money(profile.budget)} budget.`,
    );
  } else
    lines.push(
      `The catalog returned no vehicle price within the stated ${money(profile.budget)} budget.`,
    );
  if (selected?.modelName !== profile.model)
    lines.push(
      `The requested ${profile.model} was not among results at this budget. Search returned ${selected?.modelName ?? 'no alternative'} as another option; it does not rank alternatives by price distance.`,
    );
  const fin = offers?.results?.find(
    o => o.modelName === profile.model && o.modelYear === 2026,
  );
  if (fin) {
    const fits =
      fin.cashPrice != null && Number(fin.cashPrice) <= profile.budget;
    lines.push(
      `Financing result: ${fin.title}; vehicle price ${money(fin.cashPrice)}, monthly ${money(fin.monthlyPayment)}, annual rate ${fin.annualInterestRate ?? 'not provided'}%. The finance vehicle price is ${fits ? 'within' : 'above'} budget.`,
    );
    const evidence = fin.evidence?.[0]?.content ?? '';
    const down = evidence.match(/Enganche:\s*([\d,]+(?:\.\d+)?)\s*MXN/i)?.[1];
    if (down) lines.push(`Listed down payment: MXN $${down}.`);
    if (/sujeto a aprobación de crédito/i.test(evidence))
      lines.push('Subject to credit approval.');
    for (const warning of fin.dataQualityWarnings ?? []) {
      flags.termConflictsDetected++;
      lines.push(`Source-data warning: ${warning}`);
    }
    if (fin.validityStatus === 'unknown') {
      flags.missingValidityDates++;
      lines.push(
        'The source provides no validity dates; current availability is unconfirmed.',
      );
    }
    if (fin.cashPrice != null && Number(fin.cashPrice) > profile.budget)
      flags.financingOfferOverBudget++;
  } else
    lines.push(
      'No financing result was returned for the requested model and year.',
    );
  if (
    Array.isArray(detail?.specifications) &&
    Array.isArray(detail?.features) &&
    !detail.specifications.length &&
    !detail.features.length
  ) {
    flags.missingSpecsDisclosed++;
    lines.push(
      'The vehicle detail record has no specifications or features, so this response makes no seating, cargo, or equipment claims.',
    );
  } else if (detail?.specifications?.length) {
    const spec = detail.specifications.find(
      s => s.value_text && s.value_text !== '-',
    );
    if (spec)
      lines.push(
        `Vehicle data: ${spec.name} — ${spec.value_text}${spec.source_url ? ` (source: ${spec.source_url})` : ''}.`,
      );
  }
  if (comparison?.length >= 2) {
    const [a, b] = comparison;
    lines.push(
      `Price comparison: ${a.model} ${a.year} ${money(a.price)} vs ${b.model} ${b.year} ${money(b.price)}.`,
    );
    const specsA = new Map(
      (a.specifications ?? []).map(s => [s.name, s.value]),
    );
    const shared = (b.specifications ?? []).find(
      s => specsA.has(s.name) && specsA.get(s.name) !== s.value && s.value,
    );
    if (shared)
      lines.push(
        `Specification comparison: ${shared.name} is ${specsA.get(shared.name)} on ${a.model} and ${shared.value} on ${b.model}.`,
      );
  }
  const date = provenance?.crawled_at
    ? new Date(provenance.crawled_at).toISOString().slice(0, 10)
    : undefined;
  if (date)
    lines.push(
      `Source: ${provenance.source_url}; collected ${date}. Confirm current availability and terms with Ford Uruapan.`,
    );
  return lines.join(' ');
}
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
    rows.find(r => r.modelName === profile.model && r.modelYear === 2026) ??
    rows[0];
  if (!selected || selected.modelName !== profile.model)
    flags.targetNotInBudgetResults++;
  const chosenModel = selected?.modelName ?? profile.model;
  const chosenYear = selected?.modelYear ?? 2026;
  const detail = await invoke(
    'get_vehicle',
    {model: chosenModel, year: chosenYear},
    v => {
      if (
        !v ||
        !v.model_year_id ||
        !Array.isArray(v.specifications) ||
        !Array.isArray(v.features)
      )
        throw Error('vehicle detail response incomplete');
    },
  );
  if (!detail) failures.push('get_vehicle');
  const offers = await invoke(
    'search_offers',
    {
      query: `Financiamiento ${profile.model} 2026, enganche, mensualidad y tasa para ${profile.need}.`,
      filters: {model: profile.model, modelYear: 2026, activeOnly: true},
      limit: 5,
    },
    v => {
      if (!Array.isArray(v.results))
        throw Error('search_offers results is not an array');
      if (
        v.results.some(
          r => r.modelName !== profile.model || r.modelYear !== 2026,
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
  const ids = [...new Set(rows.map(r => r.modelYearId).filter(Boolean))];
  const primaryId = detail?.model_year_id;
  if (primaryId && !ids.includes(primaryId)) ids.unshift(primaryId);
  const fallbackIds = [
    '39c77a40-f900-48ae-b948-bd3176823269',
    'e11ae5eb-ace1-45e1-bece-228ca126c53f',
    '96c79669-8a2e-478e-a359-bb11b8a285ff',
  ];
  for (const fallback of fallbackIds) {
    if (ids.length >= 2) break;
    if (!ids.includes(fallback)) ids.push(fallback);
  }
  const comparison = await invoke(
    'compare_vehicles',
    {ids: ids.slice(0, 2)},
    v => {
      if (!Array.isArray(v) || v.length < 2)
        throw Error('compare_vehicles returned fewer than two records');
      if (
        v.some(
          r => !Array.isArray(r.specifications) || !Array.isArray(r.features),
        )
      )
        throw Error('comparison missing structured equipment arrays');
    },
  );
  if (!comparison) failures.push('compare_vehicles');
  const docId =
    docByModelYearId[primaryId] ??
    docByModelYearId[selected?.modelYearId] ??
    '1f47d78e-4685-42e7-96ca-aa0a4dce8ca7';
  const provenance = await invoke(
    'get_vehicle_provenance',
    {documentId: docId},
    v => {
      if (!v || !v.document_id || !v.source_url || !v.crawled_at)
        throw Error('provenance missing source or crawl date');
    },
  );
  if (!provenance) failures.push('get_vehicle_provenance');
  const promotions = await invoke(
    'list_promotions',
    {filters: {asOf: new Date().toISOString().slice(0, 10)}},
    v => {
      if (!Array.isArray(v))
        throw Error('list_promotions result is not an array');
      if (v.some(o => o.offer_type === 'financing'))
        throw Error('financing record leaked into promotions');
      if (
        v.some(
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
      !v.latest_crawled_at
    )
      throw Error('catalog status schema or freshness missing');
  });
  if (!status) failures.push('get_catalog_status');
  const assistantAnswer = synthesize(
    profile,
    selected,
    detail,
    offers,
    comparison,
    provenance,
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
    !assistantAnswer.includes('no specifications or features')
  )
    failures.push('answer_unstated_feature_gap');
  const fin = offers?.results?.[0];
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
  if (
    provenance?.crawled_at &&
    !assistantAnswer.includes(
      new Date(provenance.crawled_at).toISOString().slice(0, 10),
    )
  )
    failures.push('answer_missing_freshness');
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
        selected: selected?.modelName,
        offers: offers?.results?.length,
        comparison: comparison?.map(r => ({model: r.model, price: r.price})),
        source: provenance?.source_url,
        crawledAt: provenance?.crawled_at,
        promotions: promotions?.length,
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
