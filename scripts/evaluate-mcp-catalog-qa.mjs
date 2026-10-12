#!/usr/bin/env node
/* global URL, console, fetch, process */
import 'dotenv/config';
import {appendFile, mkdir, readFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {Pool} from 'pg';
import {
  checkVehicleDetailCompleteness,
  checkVehicleModelYearOptionsCompleteness,
  mcpToolsToOllamaTools,
  parseCatalogQaQuestions,
  parseMcpJsonRpcResponse,
  parseOllamaToolCalls,
  scoreCatalogQaToolRouting,
  selectCatalogQaRange,
  validateCatalogQaQuestions,
} from './catalog-qa-evaluation.ts';

const QUESTIONS_PATH = new URL(
  '../evals/catalog-qa/questions.jsonl',
  import.meta.url,
);
const INVENTORY_PATH = new URL(
  '../evals/catalog-qa/catalog-inventory.json',
  import.meta.url,
);
const DEFAULT_MCP_URL = 'http://127.0.0.1:3001/mcp';
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3.5:4b';
const SYSTEM_PROMPT = [
  'Eres asesor de Ford Uruapan. Responde en español natural y solo con información devuelta por MCP. No inventes disponibilidad, precios, equipo, comparaciones ni enlaces.',
  'RUTEO: recomendaciones y búsqueda semántica -> search_vehicles; especificaciones de un modelo y año exactos -> get_vehicle; comparar distintas líneas Ford -> compare_vehicles; comparar trims del mismo modelo y año -> compare_trims; comparar años del mismo modelo -> compare_model_years; Ford frente a otra marca usando una página Comparativo -> get_variant_comparisons; enlaces encontrados en una página Ford conocida -> get_page_links; promociones del distribuidor -> list_promotions; financiamiento Ford Credit -> search_offers. REGLA OBLIGATORIA: si la pregunta pide recomendaciones/opciones de vehículos Y financiamiento en la misma solicitud, llama exactamente una vez search_vehicle_and_offers y no llames search_vehicles ni search_offers por separado.',
  'Separa promociones de distribuidor y planes financieros. Si piden ambas categorías explícitamente, llama list_promotions y search_offers una vez cada una. Nunca presentes un resultado financiero como promoción.',
  'No uses compare_vehicles para trims, años o rivales. No uses compare_trims para años distintos. No uses compare_model_years para trims. Conserva el nombre completo de modelo/variante y año solicitado. No cambies a un modelo parecido si no hay coincidencia.',
  'get_vehicle_provenance es diagnóstico: úsalo solo si una respuesta previa carece de fuente o fecha de captura, no para citas ordinarias. get_page_links requiere la URL de la página que el usuario proporcionó o una herramienta devolvió.',
  'Copia precios, plazos, tasas y vigencias tal como aparecen; distingue el precio del vehículo del precio de contado de una oferta. Vigencia desconocida significa que no está confirmada. Si los datos no bastan, dilo claramente. Cada hecho debe conservar su enlace Ford cuando esté disponible.',
].join(' ');

function args(argv) {
  const result = {
    start: 0,
    limit: undefined,
    model: process.env.MCP_QA_MODEL || DEFAULT_MODEL,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--dry-run') result.dryRun = true;
    else if (item === '--start') result.start = Number(argv[++i]);
    else if (item === '--limit') result.limit = Number(argv[++i]);
    else if (item === '--model') result.model = argv[++i];
    else throw new Error(`unknown argument: ${item}`);
  }
  return result;
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error).replace(
    /Bearer\s+\S+/gi,
    'Bearer [redacted]',
  );
}

async function postMcp(url, token, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? {authorization: `Bearer ${token}`} : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 400)}`);
  const message = parseMcpJsonRpcResponse(text);
  if (message.error)
    throw new Error(`MCP JSON-RPC error: ${JSON.stringify(message.error)}`);
  return message.result ?? {};
}

function mcpPayload(result) {
  const texts = Array.isArray(result.content)
    ? result.content
        .filter(item => item?.type === 'text')
        .map(item => item.text)
    : [];
  if (texts.length === 1) {
    try {
      return JSON.parse(texts[0]);
    } catch {
      return texts[0];
    }
  }
  return texts;
}

async function ollamaChat(baseUrl, model, messages, tools) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      model,
      messages,
      tools,
      stream: false,
      options: {temperature: 0, num_ctx: 32768, num_predict: 1600},
    }),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `Ollama HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 400)}`,
    );
  if (!payload.message)
    throw new Error('Ollama response did not contain a message');
  return payload;
}

async function currentInventory(pool) {
  const result = await pool.query(`
    SELECT m.name AS model, my.model_year AS year,
      (SELECT count(*)::int FROM ford.specifications s WHERE s.model_year_id=my.id AND s.variant_id IS NULL) AS "specificationCount",
      (SELECT count(*)::int FROM ford.features f WHERE f.model_year_id=my.id AND f.variant_id IS NULL) AS "featureCount"
    FROM ford.model_years my JOIN ford.models m ON m.id=my.model_id
    ORDER BY m.name, my.model_year DESC`);
  return result.rows.map(row => ({...row, year: Number(row.year)}));
}

async function main() {
  const options = args(process.argv.slice(2));
  const mcpUrl = process.env.MCP_QA_URL || DEFAULT_MCP_URL;
  const parsedMcpUrl = new URL(mcpUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsedMcpUrl.hostname))
    throw new Error(
      'MCP_QA_URL must point to loopback; this evaluator is local-only',
    );
  const ollamaUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL;
  if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(ollamaUrl).hostname))
    throw new Error(
      'OLLAMA_BASE_URL must point to loopback; this evaluator is local-only',
    );

  const baseline = JSON.parse(
    await readFile(INVENTORY_PATH, 'utf8'),
  ).modelYears;
  const questions = parseCatalogQaQuestions(
    await readFile(QUESTIONS_PATH, 'utf8'),
  );
  const pool = new Pool({connectionString: process.env.DATABASE_URL, max: 2});
  try {
    const inventory = await currentInventory(pool);
    const coverage = validateCatalogQaQuestions(questions, baseline, inventory);
    const selected = selectCatalogQaRange(
      questions,
      options.start,
      options.limit,
    );
    const initialized = await postMcp(
      mcpUrl,
      process.env.MCP_HTTP_BEARER_TOKEN,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: {name: 'ford-catalog-qa', version: '1.0.0'},
        },
      },
    );
    const listed = await postMcp(mcpUrl, process.env.MCP_HTTP_BEARER_TOKEN, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    const mcpTools = listed.tools || [];
    const exactVehicleTool = mcpTools.find(tool => tool.name === 'get_vehicle');
    if (
      !exactVehicleTool?.description?.includes(
        'every specification and feature',
      ) ||
      !exactVehicleTool.description.includes(
        'Preserve the exact model variant',
      )
    ) {
      throw new Error(
        'local MCP get_vehicle tool is stale or missing complete-detail/variant guidance; restart it from current source',
      );
    }
    const tagsResponse = await fetch(`${ollamaUrl}/api/tags`);
    const tagsBody = await tagsResponse.json();
    if (!tagsResponse.ok)
      throw new Error(`Ollama tags HTTP ${tagsResponse.status}`);
    const localModels = new Set((tagsBody.models || []).map(item => item.name));
    const available = [...localModels];
    const report = {
      status: coverage.fullCatalogCoverage
        ? 'full_catalog_coverage'
        : 'catalog_drift_or_missing_coverage',
      datasetQuestions: questions.length,
      selectedQuestions: selected.length,
      categories: coverage.categories,
      expectedTools: coverage.tools,
      baselineModelYears: coverage.baselineModelYearCount,
      currentModelYears: inventory.length,
      coveredBaselineModelYears: coverage.coveredBaselineModelYears,
      untestedModelYears: coverage.untestedModelYears,
      catalogDrift: coverage.catalogDrift,
      detailCountDrift: coverage.detailCountDrift,
      mcpServer: initialized.serverInfo || 'initialized',
      mcpTools: mcpTools.map(tool => tool.name),
      answerModel: options.model,
      ollamaModels: available,
      answerModelAvailable: localModels.has(options.model),
      dryRun: options.dryRun,
    };
    console.log(JSON.stringify(report, null, 2));
    if (!coverage.fullCatalogCoverage)
      throw new Error(
        'catalog inventory differs from evaluated baseline; update questions and manifest before full run',
      );
    if (!localModels.has(options.model))
      throw new Error(`local Ollama answer model is missing: ${options.model}`);
    if (options.dryRun) return;

    const known = new Map(mcpTools.map(tool => [tool.name, tool]));
    const ollamaTools = mcpToolsToOllamaTools(mcpTools);
    const runName = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = join(process.cwd(), 'eval-results', 'catalog-qa');
    await mkdir(outputDir, {recursive: true});
    const tracePath = join(
      outputDir,
      `${runName}-${basename(options.model.replaceAll(':', '-'))}.jsonl`,
    );
    for (let index = 0; index < selected.length; index += 1) {
      const question = selected[index];
      const started = Date.now();
      const toolCalls = [];
      const retrievedContexts = [];
      const errors = [];
      let answer = '';
      let complete = false;
      let detailCompleteness = null;
      try {
        const messages = [
          {role: 'system', content: SYSTEM_PROMPT},
          {role: 'user', content: question.question},
        ];
        let reply;
        for (let turn = 0; turn < 4; turn += 1) {
          reply = await ollamaChat(
            ollamaUrl,
            options.model,
            messages,
            ollamaTools,
          );
          const calls = parseOllamaToolCalls(reply.message);
          if (!calls.length) {
            answer = reply.message.content || '';
            complete = Boolean(answer.trim());
            break;
          }
          messages.push(reply.message);
          for (const call of calls) {
            if (!known.has(call.name))
              throw new Error(
                `Ollama requested unknown MCP tool: ${call.name}`,
              );
            const toolResult = await postMcp(
              mcpUrl,
              process.env.MCP_HTTP_BEARER_TOKEN,
              {
                jsonrpc: '2.0',
                id: `${question.id}-${toolCalls.length}`,
                method: 'tools/call',
                params: {name: call.name, arguments: call.arguments},
              },
            );
            const value = mcpPayload(toolResult);
            if (
              call.name === 'get_vehicle' &&
              question.expectedTools.includes('get_vehicle') &&
              (!value || typeof value !== 'object')
            ) {
              errors.push(
                `get_vehicle found no catalog record for ${String(call.arguments.model)} ${String(call.arguments.year ?? call.arguments.modelYear ?? '')}`.trim(),
              );
            }
            toolCalls.push({
              name: call.name,
              arguments: call.arguments,
              result: value,
              isError: toolResult.isError === true,
            });
            retrievedContexts.push(JSON.stringify(value));
            if (
              call.name === 'get_vehicle' &&
              question.expectedTools.includes('get_vehicle') &&
              question.model &&
              value &&
              typeof value === 'object'
            ) {
              if (question.year) {
                const expected = inventory.find(
                  item =>
                    item.model.toLowerCase() === question.model.toLowerCase() &&
                    item.year === question.year,
                );
                if (expected) {
                  detailCompleteness = checkVehicleDetailCompleteness(
                    value,
                    expected,
                  );
                } else {
                  errors.push(
                    `catalog inventory has no row for ${question.model} ${question.year}`,
                  );
                }
              } else {
                const expected = inventory.filter(
                  item =>
                    item.model.toLowerCase() === question.model.toLowerCase(),
                );
                detailCompleteness = checkVehicleModelYearOptionsCompleteness(
                  value,
                  expected,
                );
              }
              if (!detailCompleteness.complete)
                errors.push(...detailCompleteness.errors);
            }
            messages.push({
              role: 'tool',
              tool_name: call.name,
              content: JSON.stringify(value),
            });
            if (toolResult.isError)
              errors.push(`MCP tool ${call.name} returned isError`);
          }
        }
        if (!complete) errors.push('answer_missing_or_tool_loop_limit');
      } catch (error) {
        errors.push(safeError(error));
      }
      const routing = scoreCatalogQaToolRouting(
        question.expectedTools,
        toolCalls.map(call => call.name),
      );
      const trace = {
        datasetVersion: question.datasetVersion,
        questionId: question.id,
        model: question.model ?? null,
        year: question.year ?? null,
        category: question.category,
        question: question.question,
        expectedTools: question.expectedTools,
        toolRouting: routing,
        toolCalls,
        retrievedContexts,
        answer,
        referenceAnswer: question.referenceAnswer,
        sourceUrls: question.sourceUrls,
        detailCompleteness,
        complete,
        errors,
        elapsedMs: Date.now() - started,
      };
      await appendFile(tracePath, `${JSON.stringify(trace)}\n`);
      const marker =
        complete && errors.length === 0 && routing.exact ? 'PASS' : 'CHECK';
      console.log(
        `[${index + 1}/${selected.length}] ${marker} ${question.id} tools=${toolCalls.map(call => call.name).join(',') || 'none'} detail=${detailCompleteness?.complete ?? 'n/a'} ${answer.slice(0, 160).replace(/\s+/g, ' ')}`,
      );
    }
    console.log(JSON.stringify({tracePath, traces: selected.length}));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  const detail =
    error instanceof Error
      ? error.stack || error.message || error.name
      : JSON.stringify(error);
  console.error(safeError(detail || 'Unknown evaluation failure'));
  process.exitCode = 1;
});
