/* global AbortSignal, Buffer, clearTimeout, console, fetch, process, setTimeout */
/* eslint eqeqeq: ["error", "always", {"null": "ignore"}] */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEvaluationOptions} from './mcp-evaluation-options.js';
import {
  scoreMcpConversation,
  summarizeMcpToolResult,
} from './mcp-conversation-scoring.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const {flows, start} = parseEvaluationOptions(process.argv.slice(2));
const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:3b';
const chatUrl =
  process.env.OLLAMA_CHAT_URL ?? 'http://127.0.0.1:11434/api/chat';
const maxToolTurns = 8;
const mcp = spawn(
  `${root}/node_modules/.bin/tsx`,
  [`${root}/src/cli.ts`, 'mcp'],
  {
    cwd: root,
    env: {...process.env, DOTENV_CONFIG_PATH: `${root}/.env`},
    stdio: ['pipe', 'pipe', 'pipe'],
  },
);

const pending = new Map();
let rpcId = 0;
let stderrBytes = 0;
mcp.stderr.on('data', chunk => {
  stderrBytes += Buffer.byteLength(chunk);
});
const lines = createInterface({input: mcp.stdout});
lines.on('line', line => {
  try {
    const response = JSON.parse(line);
    if (response.id && pending.has(response.id)) {
      const entry = pending.get(response.id);
      pending.delete(response.id);
      clearTimeout(entry.timer);
      entry.resolve(response);
    }
  } catch {
    // Ignore non-JSON output; MCP replies use JSON-RPC lines.
  }
});

function rpc(method, params = {}, timeoutMs = 120_000) {
  const id = ++rpcId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, {resolve, reject, timer});
    mcp.stdin.write(
      `${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`,
    );
  });
}

function decodeMcp(response) {
  if (response.error) throw new Error(JSON.stringify(response.error));
  if (response.result?.isError) {
    throw new Error(
      response.result.content?.map(item => item.text).join('\n') ||
        'MCP tool error',
    );
  }
  const content = response.result?.content?.find(
    item => item.type === 'text',
  )?.text;
  return content ? JSON.parse(content) : response.result;
}

async function callMcpTool(name, args) {
  return decodeMcp(await rpc('tools/call', {name, arguments: args}));
}

async function callModel(messages, tools) {
  const response = await fetch(chatUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      model,
      messages,
      tools,
      stream: false,
      options: {temperature: 0, num_predict: 320},
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}: ${body.error ?? 'error'}`);
  }
  return body;
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

function createScenario(index) {
  const [modelName, price] = models[index % models.length];
  const other = models[(index * 7 + 3) % models.length][0];
  const budget =
    Math.round((price * [0.8, 0.95, 1, 1.1, 1.4][index % 5]) / 10000) * 10000;
  const need = [
    'familia y viajes',
    'mensualidad accesible',
    'trabajo diario',
    'buen espacio y tecnología',
    'opciones de crédito',
  ][index % 5];
  const type = index % 7;
  if (type === 0) {
    return {
      id: index + 1,
      modelName,
      budget,
      expectedTools: ['search_vehicle_and_offers'],
      user: `Busco un ${modelName} 2026 para ${need}. Mi presupuesto máximo son $${budget} MXN. ¿Qué alternativas y financiamiento hay?`,
    };
  }
  if (type === 1) {
    return {
      id: index + 1,
      modelName,
      requireSourceUrl: true,
      expectedTools: ['get_vehicle'],
      user: `Dame los datos de equipamiento principales del ${modelName} 2026 y dime de qué fuente vienen.`,
    };
  }
  if (type === 2) {
    return {
      id: index + 1,
      modelName,
      expectedTools: ['compare_vehicles'],
      user: `Compara ${modelName} 2026 con ${other} 2026 en precio y especificaciones.`,
    };
  }
  if (type === 3) {
    return {
      id: index + 1,
      modelName,
      expectedTools: ['list_promotions', 'search_offers'],
      user: '¿Qué promociones y planes de financiamiento de Ford Uruapan están publicados actualmente? Busca ambas categorías y sepáralas en la respuesta.',
    };
  }
  if (type === 4) {
    return {
      id: index + 1,
      modelName,
      budget,
      expectedTools: ['search_offers'],
      user: `Busca financiamiento para ${modelName} 2026. Mi presupuesto es $${budget} MXN; dime mensualidad, enganche y si la vigencia está confirmada.`,
    };
  }
  if (type === 5) {
    return {
      id: index + 1,
      modelName,
      expectedTools: ['get_catalog_status'],
      user: '¿Qué tan actualizado está el catálogo de Ford Uruapan y cuántos vehículos tiene?',
    };
  }
  return {
    id: index + 1,
    modelName,
    expectedTools: ['get_vehicle'],
    user: `¿Qué especificaciones del ${modelName} 2026 están disponibles? Indica claramente si algún dato falta.`,
  };
}

const systemPrompt =
  'Eres asesor de Ford Uruapan. Responde en español natural, máximo 55 palabras y nunca excedas 500 caracteres. Usa MCP y contesta solo con sus resultados. TOOL ROUTING: financiamiento solamente para modelo conocido, aunque incluya presupuesto, usa search_offers. search_vehicle_and_offers requiere que pidan tanto opciones/recomendaciones de vehículo como financiamiento. Solo vehículos: search_vehicles. Solo promociones: list_promotions. Promociones Y financiamiento: primero llama list_promotions; cuando responda, llama INMEDIATAMENTE search_offers; solo después de recibir ambas respuestas escribe al usuario. Cada herramienta exactamente una vez; nunca respondas entre llamadas ni repitas/cambies argumentos. En búsqueda combinada copia answerSummary completo tal cual, sin repetir ni añadir datos; siempre incluye el precio del vehículo o la declaración de que no hubo coincidencia exacta, y los datos/disclosures de oferta o que no se encontraron ofertas. MODEL GROUNDING: conserva literalmente variantes pedidas HÍBRIDA, RAPTOR, SPORT, CHASIS y VAN al filtrar. Si el modelo/variante devuelto no coincide exactamente, di que no se encontró la variante y no la presentes como disponible; nunca sustituyas silenciosamente por otro. PRICE GROUNDING: distingue precio de vehículo (vehicles.results[].priceDisplay) de precio de contado de oferta (offers.results[].cashPriceDisplay). Copia importes exactamente; nunca sustituyas, inventes ni conviertas. Si hay ofertas que exceden presupuesto, preséntalas e indica que lo exceden; nunca digas que no hay ofertas. Si no hay ofertas, dilo. SEARCH_OFFERS: usa offerType financing, modelo/año exactos y limit 2; presenta hasta dos. Copia cashPriceDisplay, monthlyPaymentDisplay y cada validityDisclosure/termConflictDisclosure existente. Vigencia desconocida significa literalmente "La vigencia no está confirmada"; no digas que el plazo está sin confirmar salvo que termConflictDisclosure lo indique. Si difieren plazos, indica el plazo nombrado y el estructurado. Plazo no es vigencia. No infieras promociones desde ofertas financieras. PROMOTIONS: list_promotions contiene solo promociones. Si vacío, di "No hay promociones publicadas"; no infieras promociones desde search_offers. Pon créditos solo bajo "Financiamientos". FILTERS: omite filtros opcionales desconocidos; nunca envíes null. Usa category, bodyType o fuelType solo si el usuario lo menciona. GET_VEHICLE: usa año exacto; muestra máximo tres especificaciones con valores; no enumeres features ni campos omitidos. Si missingSpecificationNames no está vacío, di solo "Falta: " y copia el primer nombre exacto. Si piden fuente, copia sourceUrl completa y exacta; no inventes enlaces ni fuentes. COMPARISON: compare_vehicles usa `models: [{model: "TERRITORY", year: 2026}, {model: "RANGER", year: 2026}]`; cada item requiere year, nunca modelYear; no uses model/modelYear de nivel superior junto con models. Si herramienta devuelve error por modelo ausente, explica que no se encontró y no compares con sustitutos. Responde con precio exacto y máximo una especificación breve por vehículo, sin lista de faltantes y en menos de 500 caracteres. HANDOFF: recopila datos requeridos y pide consentimiento explícito antes de handoff_to_specialist. Si rechaza, no llames y ofrece continuar aquí. Nunca afirmes contacto real, lead creado, cita o seguimiento confirmado: solo es simulación local. No sugieras contactar al distribuidor por datos ausentes. Sigue esquemas MCP. No menciones HTML, JSON ni detalles internos.';

const flowResults = [];
const toolStats = new Map();
let totalModelCalls = 0;
let promptTokens = 0;
let generatedTokens = 0;
let totalElapsedMs = 0;

async function runScenario(scenario, tools) {
  const started = performance.now();
  const messages = [
    {role: 'system', content: systemPrompt},
    {role: 'user', content: scenario.user},
  ];
  const calledTools = [];
  const toolTrace = [];
  const toolResults = [];
  let answer = '';
  let doneReason = '';
  const errors = [];
  let toolTurns = 0;
  let scenarioPromptTokens = 0;
  let scenarioGeneratedTokens = 0;

  while (toolTurns <= maxToolTurns) {
    let completion;
    try {
      completion = await callModel(messages, tools);
    } catch (error) {
      errors.push(`ollama:${String(error)}`);
      break;
    }
    totalModelCalls++;
    scenarioPromptTokens += completion.prompt_eval_count ?? 0;
    scenarioGeneratedTokens += completion.eval_count ?? 0;
    const assistantMessage = completion.message ?? {};
    const requests = assistantMessage.tool_calls ?? [];
    if (!requests.length) {
      answer = assistantMessage.content?.trim() ?? '';
      doneReason = completion.done_reason ?? '';
      break;
    }
    messages.push(assistantMessage);
    toolTurns++;
    for (const request of requests) {
      const name = request.function?.name;
      const args = request.function?.arguments ?? {};
      calledTools.push(name);
      const trace = {name, arguments: args, succeeded: false};
      toolTrace.push(trace);
      const stats = toolStats.get(name) ?? {calls: 0, errors: 0, latencies: []};
      stats.calls++;
      toolStats.set(name, stats);
      try {
        const toolStarted = performance.now();
        const value = await callMcpTool(name, args);
        stats.latencies.push(performance.now() - toolStarted);
        trace.succeeded = true;
        trace.resultSummary = summarizeMcpToolResult(name, value);
        toolResults.push({tool: name, value});
        messages.push({
          role: 'tool',
          tool_name: name,
          content: JSON.stringify(value),
        });
      } catch (error) {
        stats.errors++;
        const message = String(error);
        trace.error = message;
        errors.push(`${name}:${message}`);
        messages.push({role: 'tool', tool_name: name, content: message});
      }
    }
  }

  if (!answer && toolTurns > maxToolTurns) errors.push('tool_turn_limit');
  const score = scoreMcpConversation(
    scenario,
    calledTools,
    toolResults,
    answer,
    doneReason,
  );
  const elapsedMs = performance.now() - started;
  totalElapsedMs += elapsedMs;
  promptTokens += scenarioPromptTokens;
  generatedTokens += scenarioGeneratedTokens;
  const result = {
    id: scenario.id,
    expectedTools: scenario.expectedTools,
    calledTools,
    toolTrace,
    doneReason,
    toolTurns,
    passed: score.passed && errors.length === 0,
    failures: [...score.failures, ...errors],
    answer,
    elapsedMs: Math.round(elapsedMs),
    promptTokens: scenarioPromptTokens,
    generatedTokens: scenarioGeneratedTokens,
    budget: scenario.budget,
    toolResults,
  };
  flowResults.push(result);
  return result;
}

try {
  const initialization = await rpc('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: {name: 'ford-mcp-local-llm-eval', version: '1.0.0'},
  });
  if (initialization.error)
    throw new Error(JSON.stringify(initialization.error));
  mcp.stdin.write(
    `${JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})}\n`,
  );
  const listed = await rpc('tools/list');
  const toolDefinitions = listed.result?.tools ?? [];
  const tools = toolDefinitions.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? tool.title ?? tool.name,
      parameters: tool.inputSchema,
    },
  }));
  if (!tools.length) throw new Error('MCP server listed no tools');

  const health = await fetch(chatUrl.replace(/\/api\/chat$/, '/api/tags'), {
    signal: AbortSignal.timeout(5000),
  });
  if (!health.ok) throw new Error(`Ollama unavailable: HTTP ${health.status}`);

  for (let index = 0; index < flows; index++) {
    const result = await runScenario(createScenario(start + index), tools);
    console.error(
      JSON.stringify({
        flow: result.id,
        passed: result.passed,
        calledTools: result.calledTools,
        failures: result.failures,
        answer: result.answer,
      }),
    );
  }

  const toolReport = Object.fromEntries(
    [...toolStats.entries()].map(([name, stats]) => {
      const sorted = [...stats.latencies].sort((a, b) => a - b);
      return [
        name,
        {
          calls: stats.calls,
          errors: stats.errors,
          p50Ms: Math.round(sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0),
          p95Ms: Math.round(
            sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0,
          ),
        },
      ];
    }),
  );
  const passed = flowResults.filter(flow => flow.passed).length;
  const failures = flowResults.filter(flow => !flow.passed);
  const allPassed = failures.length === 0 && flowResults.length === flows;
  console.log(
    JSON.stringify(
      {
        server: initialization.result?.serverInfo?.name,
        model,
        simulatedFlows: flowResults.length,
        passed,
        failed: failures.length,
        allPassed,
        totalMcpToolCalls: [...toolStats.values()].reduce(
          (sum, stats) => sum + stats.calls,
          0,
        ),
        totalModelCalls,
        promptTokens,
        generatedTokens,
        averageFlowMs: Math.round(totalElapsedMs / Math.max(1, flows)),
        toolUsage: toolReport,
        failureCounts: failures.reduce((counts, flow) => {
          for (const failure of flow.failures) {
            const code = failure.split(':')[0];
            counts[code] = (counts[code] ?? 0) + 1;
          }
          return counts;
        }, {}),
        failures: failures
          .slice(0, 20)
          .map(({id, expectedTools, calledTools, failures: why}) => ({
            id,
            expectedTools,
            calledTools,
            failures: why,
          })),
        samples: flowResults
          .slice(0, 3)
          .map(
            ({
              id,
              expectedTools,
              calledTools,
              toolTrace,
              passed: ok,
              failures: why,
              answer,
              budget,
            }) => ({
              id,
              expectedTools,
              calledTools,
              toolTrace,
              passed: ok,
              failures: why,
              budget,
              answer,
            }),
          ),
        mcpStderrBytes: stderrBytes,
      },
      null,
      2,
    ),
  );
  mcp.stdin.end();
  await Promise.race([
    once(mcp, 'exit'),
    new Promise(resolve => setTimeout(() => resolve(null), 5000)),
  ]);
  if (mcp.exitCode === null) mcp.kill();
  if (!allPassed) process.exitCode = 1;
} catch (error) {
  console.error(String(error));
  mcp.kill();
  process.exitCode = 1;
}
