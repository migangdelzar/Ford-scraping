/* global AbortSignal, Buffer, clearTimeout, console, fetch, process, setTimeout */
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import {createInterface} from 'node:readline';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  loadLeadFlowFixtures,
  selectLeadFlowFixtures,
} from './mcp-lead-flow-fixtures.js';
import {
  isHandoffAuthorized,
  scoreLeadHandoff,
} from './mcp-lead-handoff-scoring.js';
import {handoffTool, simulateLeadHandoff} from './mcp-lead-handoff-tool.js';
import {cleanOptionalToolArguments} from './mcp-argument-cleanup.js';
import {
  appendLeadFlowTrace,
  createLeadFlowTrace,
  referenceForLeadFlowFixture,
} from './mcp-lead-traces.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = loadLeadFlowFixtures();
let start = 0;
let flows = fixtures.length;
for (const arg of process.argv.slice(2)) {
  const match = /^--(start|flows)=(.+)$/.exec(arg);
  if (!match) throw new Error(`Unknown evaluation option: ${arg}`);
  const value = Number(match[2]);
  if (!Number.isSafeInteger(value))
    throw new Error(`Invalid ${match[1]}: ${match[2]}`);
  if (match[1] === 'start') start = value;
  else flows = value;
}
if (start > 0 && !process.argv.some(arg => arg.startsWith('--flows='))) {
  flows = fixtures.length - start;
}
const selected = selectLeadFlowFixtures(fixtures, start, flows);
const tracePath = resolve(
  root,
  'eval-results/multistep-leads',
  `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
);
const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:3b';
const chatUrl =
  process.env.OLLAMA_CHAT_URL ?? 'http://127.0.0.1:11434/api/chat';
const maxToolRoundsPerTurn = 8;
const systemPrompt =
  'Eres un asistente virtual de Ford Uruapan. Responde en español. REGLAS DE TRASPASO: (1) Si el usuario pide directamente hablar, llamar o conectarse con un especialista/asesor, llama handoff_to_specialist sin pedir permiso otra vez. (2) Si muestra intención de compra, interés en prueba de manejo, o una duda de oferta queda sin resolver, primero responde ofreciendo la opción de hablar con un especialista y NO llames ninguna herramienta de handoff en esa respuesta. Espera el siguiente turno real del usuario; solo una respuesta afirmativa posterior autoriza la llamada. Nunca interpretes tu propia oferta como aceptación ni uses un sí de un turno anterior. Respeta el rechazo. (3) Esta herramienta solo registra una simulación local: nunca contacta, transfiere, agenda ni crea un prospecto. Después de recibir simulated_success responde exactamente: "La simulación local quedó registrada; no se contactó a nadie ni se programó una cita." No agregues promesas de seguimiento. (4) Payload: reason obligatorio; si mencionaron modelo, vehicle exacto; si expresaron necesidad/preferencia, needs con sus palabras; unresolvedQuestion solo para una pregunta de datos que sigue sin respuesta. needs son preferencias del cliente, no dudas de oferta. Omite opcionales desconocidos; nunca envíes null. En ofertas, omite filtros sin valor conocido: no uses minPrice 0 como valor por defecto y no adivines límites. En búsquedas, usa únicamente propiedades permitidas por el esquema. Envía filtros simples como {"model":"Territory"}; nunca copies objetos properties/type del esquema dentro de los argumentos. (5) Usa solo hechos del usuario y resultados MCP, no inventes. En búsquedas omite categoría, carrocería y combustible no mencionados. No exijas nombre/contacto. No digas que eres humano ni asesor humano; responde con sinceridad sobre tu identidad. No inventes vigencias, condiciones ni respuestas que las herramientas no confirmen.';
const handoffExample =
  'Ejemplo de handoff_to_specialist: si el cliente pide especialista para Ranger porque quiere viajar con mi familia, usa {"reason":"hablar sobre viajar con mi familia","vehicle":"Ranger","needs":["viajar con mi familia"]}. Aunque reason ya mencione la necesidad, incluye needs.';

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
mcp.on('exit', (code, signal) => {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(
      new Error(`MCP exited before response (code=${code}, signal=${signal})`),
    );
  }
  pending.clear();
});
createInterface({input: mcp.stdout}).on('line', line => {
  try {
    const response = JSON.parse(line);
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);
    entry.resolve(response);
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

function toolArguments(request) {
  const value = request.function?.arguments ?? {};
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

async function runFlow(fixture, tools, mcpNames) {
  const started = performance.now();
  const messages = [
    {role: 'system', content: `${systemPrompt} ${handoffExample}`},
  ];
  const observation = {assistantAnswers: [], mcpCalls: [], handoffCalls: []};
  const errors = [];
  let modelCalls = 0;
  let promptTokens = 0;
  let generatedTokens = 0;
  let eventIndex = 0;
  let completedTurns = 0;

  for (const [userTurnIndex, userTurn] of fixture.userTurns.entries()) {
    messages.push({role: 'user', content: userTurn});
    let completed = false;
    for (let round = 0; round <= maxToolRoundsPerTurn; round++) {
      let completion;
      try {
        completion = await callModel(messages, tools);
      } catch (error) {
        errors.push(`ollama:${String(error)}`);
        break;
      }
      modelCalls++;
      promptTokens += completion.prompt_eval_count ?? 0;
      generatedTokens += completion.eval_count ?? 0;
      const assistant = completion.message ?? {role: 'assistant', content: ''};
      messages.push(assistant);
      const requestEventIndex = ++eventIndex;
      const answer =
        typeof assistant.content === 'string' ? assistant.content.trim() : '';
      if (answer)
        observation.assistantAnswers.push({
          userTurnIndex,
          eventIndex: requestEventIndex,
          text: answer,
        });
      const requests = assistant.tool_calls ?? [];
      if (requests.length === 0) {
        completed = true;
        break;
      }
      if (round === maxToolRoundsPerTurn) {
        errors.push(`tool_turn_limit:turn_${userTurnIndex}`);
        break;
      }
      for (const request of requests) {
        const name = request.function?.name;
        let args;
        try {
          args = toolArguments(request);
        } catch (error) {
          args = {};
          errors.push(`${name}:invalid_arguments:${String(error)}`);
        }
        let result;
        if (name === 'handoff_to_specialist') {
          const authorized = isHandoffAuthorized(
            fixture,
            observation,
            userTurnIndex,
            requestEventIndex,
          );
          const attempt = simulateLeadHandoff(
            fixture.id,
            observation.handoffCalls.length + 1,
            args,
            authorized ? undefined : 'Customer authorization is missing',
          );
          result = attempt.result;
          if (attempt.status === 'simulated_failure')
            errors.push(`handoff_to_specialist:${attempt.result.error}`);
          observation.handoffCalls.push({
            userTurnIndex,
            requestEventIndex,
            eventIndex: ++eventIndex,
            arguments: attempt.arguments,
            status: attempt.status,
          });
        } else {
          const tool = tools.find(item => item.function.name === name);
          const cleanup = cleanOptionalToolArguments(
            args,
            tool?.function.parameters ?? {},
            fixture.userTurns.slice(0, userTurnIndex + 1),
          );
          const call = {
            userTurnIndex,
            requestEventIndex,
            eventIndex: 0,
            name,
            arguments: cleanup.arguments,
            requestedArguments: args,
            removedOptionalArguments: cleanup.removedPaths,
            succeeded: false,
          };
          observation.mcpCalls.push(call);
          try {
            if (!mcpNames.has(name))
              throw new Error(`Unknown MCP tool: ${name}`);
            result = decodeMcp(
              await rpc('tools/call', {name, arguments: cleanup.arguments}),
            );
            call.succeeded = true;
          } catch (error) {
            result = {error: String(error)};
            errors.push(`${name}:${String(error)}`);
          }
          call.result = result;
          call.eventIndex = ++eventIndex;
        }
        messages.push({
          role: 'tool',
          tool_name: name,
          content: JSON.stringify(result),
        });
      }
    }
    if (!completed) break;
    if (
      observation.assistantAnswers.some(
        answer => answer.userTurnIndex === userTurnIndex,
      )
    ) {
      completedTurns++;
    } else {
      break;
    }
  }

  const policyScore = scoreLeadHandoff(fixture, observation);
  const complete = completedTurns === fixture.userTurns.length;
  const failures = [...policyScore.failures];
  if (!complete) failures.push('incomplete_flow');
  if (errors.length > 0) failures.push('evaluation_error');
  const score = {passed: failures.length === 0, failures};
  return {
    id: fixture.id,
    passed: score.passed,
    failures,
    score,
    complete,
    errors: complete ? errors : [...errors, 'incomplete_flow'],
    observation,
    messages,
    modelCalls,
    promptTokens,
    generatedTokens,
    elapsedMs: Math.round(performance.now() - started),
  };
}

function traceForFlow(fixture, result) {
  const messages = result.messages;
  const turns = messages
    .filter(message => message.role === 'user')
    .map((message, userTurnIndex) => ({
      userTurnIndex,
      userMessage: message.content,
      assistantAnswers: result.observation.assistantAnswers
        .filter(answer => answer.userTurnIndex === userTurnIndex)
        .map(answer => answer.text),
    }));
  const traceMessages = messages;
  const traceTurns = turns;
  return createLeadFlowTrace({
    flowId: fixture.id,
    fixtureVersion: 1,
    model,
    messages: traceMessages,
    turns: traceTurns,
    mcpCalls: result.observation.mcpCalls,
    handoffCalls: result.observation.handoffCalls,
    deterministicScore: result.score,
    ragasInput: {
      reference: referenceForLeadFlowFixture(fixture),
      expectedToolNames:
        fixture.expected.finalHandoff === 'succeeded'
          ? ['handoff_to_specialist']
          : [],
      expectedHandoff: fixture.expected.handoff,
      messages: traceMessages,
    },
    complete: result.complete,
    errors: result.complete
      ? result.errors
      : [...result.errors, 'incomplete_flow'],
    elapsedMs: result.elapsedMs,
    promptTokens: result.promptTokens,
    generatedTokens: result.generatedTokens,
  });
}

try {
  const initialization = await rpc('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: {name: 'ford-mcp-multistep-lead-eval', version: '1.0.0'},
  });
  if (initialization.error)
    throw new Error(JSON.stringify(initialization.error));
  mcp.stdin.write(
    `${JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})}\n`,
  );
  const listed = await rpc('tools/list');
  if (listed.error) throw new Error(JSON.stringify(listed.error));
  const definitions = listed.result?.tools ?? [];
  const mcpNames = new Set(definitions.map(tool => tool.name));
  if (!mcpNames.size) throw new Error('MCP server listed no tools');
  if (mcpNames.has('handoff_to_specialist')) {
    throw new Error('handoff_to_specialist must remain harness-only');
  }
  const tools = definitions.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: `${tool.description ?? tool.title ?? tool.name} No incluyas propiedades opcionales con valor null. No inventes filtros ni valores predeterminados.`,
      parameters: tool.inputSchema,
    },
  }));
  tools.push(handoffTool);
  const health = await fetch(chatUrl.replace(/\/api\/chat$/, '/api/tags'), {
    signal: AbortSignal.timeout(5000),
  });
  if (!health.ok) throw new Error(`Ollama unavailable: HTTP ${health.status}`);

  const results = [];
  for (const fixture of selected) {
    const result = await runFlow(fixture, tools, mcpNames);
    try {
      await appendLeadFlowTrace(tracePath, traceForFlow(fixture, result));
    } catch (error) {
      result.passed = false;
      result.failures = [
        ...new Set([...result.failures, 'trace_write_failed']),
      ];
      result.errors.push(`trace_write_failed:${String(error)}`);
    }
    results.push(result);
    console.error(
      JSON.stringify({
        flow: result.id,
        passed: result.passed,
        failures: result.failures,
      }),
    );
  }
  const passed = results.filter(result => result.passed).length;
  console.log(
    JSON.stringify(
      {
        server: initialization.result?.serverInfo?.name,
        model,
        selectedFlows: selected.map(flow => flow.id),
        tracePath,
        simulatedFlows: results.length,
        passed,
        failed: results.length - passed,
        totalModelCalls: results.reduce(
          (sum, result) => sum + result.modelCalls,
          0,
        ),
        totalMcpToolCalls: results.reduce(
          (sum, result) => sum + result.observation.mcpCalls.length,
          0,
        ),
        totalHandoffCalls: results.reduce(
          (sum, result) => sum + result.observation.handoffCalls.length,
          0,
        ),
        promptTokens: results.reduce(
          (sum, result) => sum + result.promptTokens,
          0,
        ),
        generatedTokens: results.reduce(
          (sum, result) => sum + result.generatedTokens,
          0,
        ),
        elapsedMs: results.reduce((sum, result) => sum + result.elapsedMs, 0),
        results,
        mcpStderrBytes: stderrBytes,
      },
      null,
      2,
    ),
  );
  if (passed !== results.length) process.exitCode = 1;
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
} finally {
  mcp.stdin.end();
  await Promise.race([
    once(mcp, 'exit'),
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]);
  if (mcp.exitCode === null) mcp.kill();
}
