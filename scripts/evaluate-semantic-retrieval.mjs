#!/usr/bin/env node
/* global console, process */
import 'dotenv/config';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {loadConfig} from '../src/config.js';
import {createEmbeddingProvider} from '../src/embeddings/provider.js';
import {normalizeModelKey} from '../src/domain/normalization.js';
import {
  calculateFactCoverage,
  calculateRetrievalMetrics,
} from './semantic-retrieval-evaluation.ts';

const CASES_PATH = new URL(
  '../evals/semantic-retrieval/cases.jsonl',
  import.meta.url,
);
const TOP_K = 5;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function requireLoopback(value, name) {
  let hostname;
  try {
    hostname = new URL(value).hostname.replace(/^\[|\]$/g, '');
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(`${name} must point to loopback; this evaluator is local-only`);
  }
}

function parseCases(source) {
  const ids = new Set();
  return source
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map((line, index) => {
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`semantic case line ${index + 1} is not valid JSON`);
      }
      if (
        !value ||
        typeof value.id !== 'string' ||
        !value.id.trim() ||
        ids.has(value.id) ||
        typeof value.query !== 'string' ||
        !value.query.trim() ||
        !['vehicle', 'offer'].includes(value.domain) ||
        !Array.isArray(value.relevantDocumentKeys) ||
        value.relevantDocumentKeys.length === 0 ||
        !Array.isArray(value.expectedFacts) ||
        value.expectedFacts.length === 0
      ) {
        throw new Error(`semantic case line ${index + 1} is invalid`);
      }
      if (value.domain === 'offer' && (!value.model || !value.year)) {
        throw new Error(`offer case ${value.id} requires model and year filters`);
      }
      ids.add(value.id);
      return value;
    });
}

async function findNearestDocuments(pool, vector, testCase, limit, includeOffers, embeddingModel) {
  const includeOfferFilter = includeOffers ? '' : 'AND d.offer_id IS NULL';
  const vehicleDocumentFilter = includeOffers
    ? ''
    : `AND (d.document_type = 'vehicle_profile'
        OR (d.document_type = 'overview' AND p.page_type = 'model'))`;
  const modelFilter = testCase.model
    ? normalizeModelKey(testCase.model)
    : null;
  const result = await pool.query(
    `WITH scored AS (
       SELECT d.document_key, d.document_type, d.title, d.content,
            e.embedding_model, m.name AS model, my.model_year AS year,
            p.url AS source_url,
            1 - (e.embedding <=> $1::vector) AS similarity,
            row_number() OVER (
              PARTITION BY CASE WHEN $2::text = 'vehicle'
                THEN d.model_year_id::text ELSE d.offer_id::text END
              ORDER BY e.embedding <=> $1::vector, d.id
            ) AS entity_rank
     FROM ford.document_embeddings e
     JOIN ford.documents d ON d.id = e.document_id
     LEFT JOIN ford.model_years my ON my.id = d.model_year_id
     LEFT JOIN ford.models m ON m.id = my.model_id
     LEFT JOIN ford.pages p ON p.id = d.page_id
     LEFT JOIN ford.offers o ON o.id = d.offer_id
     WHERE e.status = 'ready' AND e.embedding IS NOT NULL
       AND (($2::text = 'vehicle' AND d.model_year_id IS NOT NULL ${includeOfferFilter} ${vehicleDocumentFilter})
         OR ($2::text = 'offer' AND d.offer_id IS NOT NULL))
       AND ($3::integer IS NULL OR my.model_year = $3)
       AND ($4::text IS NULL OR m.normalized_name = $4)
       AND ($4::text IS NOT NULL OR m.normalized_name NOT LIKE '%police%')
       AND ($7::integer IS NULL OR o.term_months = $7)
       AND ($6::text IS NULL OR e.embedding_model = $6)
       AND ($8::text IS NULL OR EXISTS (
         SELECT 1 FROM ford.model_year_categories mc
         JOIN ford.categories c ON c.id = mc.category_id
         WHERE mc.model_year_id = my.id
           AND (c.normalized_name = lower($8)
             OR (lower($8) IN ('suv', 'suvs', 'suvs & crossovers', 'suvs y crossovers')
               AND c.normalized_name IN ('suvs & crossovers', 'suvs y crossovers')))
       ))
     )
     SELECT * FROM scored WHERE entity_rank = 1
     ORDER BY similarity DESC
     LIMIT $5`,
    [JSON.stringify(vector), testCase.domain, testCase.year ?? null, modelFilter, limit, embeddingModel ?? null, testCase.termMonths ?? null, testCase.category ?? null],
  );
  return result.rows.map(row => ({
    documentKey: row.document_key,
    documentType: row.document_type,
    title: row.title,
    content: row.content,
    embeddingModel: row.embedding_model,
    model: row.model ?? undefined,
    year: row.year === null ? undefined : Number(row.year),
    sourceUrl: row.source_url ?? undefined,
    similarity: Number(row.similarity),
  }));
}

async function findKeywordDocuments(pool, testCase, limit) {
  const modelFilter = testCase.model ? normalizeModelKey(testCase.model) : null;
  const result = await pool.query(
    `WITH scored AS (
       SELECT d.document_key, d.document_type, d.title, d.content,
            m.name AS model, my.model_year AS year, p.url AS source_url,
            ts_rank_cd(d.search_vector, to_tsquery('spanish', array_to_string(
              tsvector_to_array(to_tsvector('spanish', $1)), ' | '
            ))) AS score,
            row_number() OVER (
              PARTITION BY CASE WHEN $2::text = 'vehicle'
                THEN d.model_year_id::text ELSE d.offer_id::text END
              ORDER BY ts_rank_cd(d.search_vector, to_tsquery('spanish', array_to_string(
                tsvector_to_array(to_tsvector('spanish', $1)), ' | '
              ))) DESC,
                d.id
            ) AS entity_rank
     FROM ford.documents d
     LEFT JOIN ford.model_years my ON my.id = d.model_year_id
     LEFT JOIN ford.models m ON m.id = my.model_id
     LEFT JOIN ford.pages p ON p.id = d.page_id
     LEFT JOIN ford.offers o ON o.id = d.offer_id
     WHERE d.search_vector @@ to_tsquery('spanish', array_to_string(
       tsvector_to_array(to_tsvector('spanish', $1)), ' | '
     ))
       AND (($2::text = 'vehicle' AND d.model_year_id IS NOT NULL AND d.offer_id IS NULL
         AND (d.document_type = 'vehicle_profile'
           OR (d.document_type = 'overview' AND p.page_type = 'model')))
         OR ($2::text = 'offer' AND d.offer_id IS NOT NULL))
       AND ($3::integer IS NULL OR my.model_year = $3)
       AND ($4::text IS NULL OR m.normalized_name = $4)
       AND ($4::text IS NOT NULL OR m.normalized_name NOT LIKE '%police%')
       AND ($6::integer IS NULL OR o.term_months = $6)
       AND ($7::text IS NULL OR EXISTS (
         SELECT 1 FROM ford.model_year_categories mc
         JOIN ford.categories c ON c.id = mc.category_id
         WHERE mc.model_year_id = my.id
           AND (c.normalized_name = lower($7)
             OR (lower($7) IN ('suv', 'suvs', 'suvs & crossovers', 'suvs y crossovers')
               AND c.normalized_name IN ('suvs & crossovers', 'suvs y crossovers')))
       ))
     )
     SELECT * FROM scored WHERE entity_rank = 1
     ORDER BY score DESC
     LIMIT $5`,
    [testCase.query, testCase.domain, testCase.year ?? null, modelFilter, limit, testCase.termMonths ?? null, testCase.category ?? null],
  );
  return result.rows.map(row => ({
    documentKey: row.document_key,
    documentType: row.document_type,
    title: row.title,
    content: row.content,
    model: row.model ?? undefined,
    year: row.year === null ? undefined : Number(row.year),
    sourceUrl: row.source_url ?? undefined,
    score: Number(row.score),
  }));
}

function compareRankings(keyword, semantic, testCase) {
  const keywordMax = Math.max(...keyword.map(hit => hit.score), 0);
  const semanticMax = Math.max(...semantic.map(hit => hit.similarity), 0);
  const byEntity = new Map();
  const entityId = documentKey =>
    testCase.domain === 'offer'
      ? documentKey.split(':')[1]
      : documentKey.split(':')[0];
  const add = (hit, kind, rank) => {
    const id = entityId(hit.documentKey);
    const entry = byEntity.get(id) ?? {
      id,
      keywordScore: 0,
      semanticScore: 0,
      keywordRank: undefined,
      semanticRank: undefined,
      evidence: new Map(),
    };
    entry.evidence.set(hit.documentKey, hit);
    if (kind === 'keyword') {
      const normalized = keywordMax > 0 ? hit.score / keywordMax : 0;
      entry.keywordScore = Math.max(entry.keywordScore, normalized);
      entry.keywordRank ??= rank;
    } else {
      const normalized = semanticMax > 0 ? hit.similarity / semanticMax : 0;
      entry.semanticScore = Math.max(entry.semanticScore, normalized);
      entry.semanticRank ??= rank;
    }
    byEntity.set(id, entry);
  };
  keyword.forEach((hit, index) => add(hit, 'keyword', index + 1));
  semantic.forEach((hit, index) => add(hit, 'semantic', index + 1));
  const rows = [...byEntity.values()];
  const blend = rows.toSorted((left, right) => {
    const leftScore = semantic.length
      ? left.keywordScore * 0.3 + left.semanticScore * 0.7
      : left.keywordScore;
    const rightScore = semantic.length
      ? right.keywordScore * 0.3 + right.semanticScore * 0.7
      : right.keywordScore;
    return rightScore - leftScore || left.id.localeCompare(right.id);
  }).slice(0, TOP_K);
  const rrf = rows.toSorted((left, right) => {
    const leftScore = (left.keywordRank ? 1 / (60 + left.keywordRank) : 0) +
      (left.semanticRank ? 1 / (60 + left.semanticRank) : 0);
    const rightScore = (right.keywordRank ? 1 / (60 + right.keywordRank) : 0) +
      (right.semanticRank ? 1 / (60 + right.semanticRank) : 0);
    return rightScore - leftScore || left.id.localeCompare(right.id);
  }).slice(0, TOP_K);
  const relevantEntities = [...new Set(testCase.relevantDocumentKeys.map(entityId))];
  const summarize = ranked => {
    const hits = ranked.flatMap(row => [...row.evidence.values()]);
    return {
      rankedEntityIds: ranked.map(row => row.id),
      rankedDocumentKeys: hits.map(hit => hit.documentKey),
      metrics: calculateRetrievalMetrics(
        ranked.map(row => row.id),
        relevantEntities,
        TOP_K,
      ),
      answerFactCoverage: calculateFactCoverage(
        hits.map(hit => `${hit.title}\n${hit.content}`),
        testCase.expectedFacts,
      ),
    };
  };
  return {currentBlend: summarize(blend), rrf: summarize(rrf)};
}

async function assertRelevantDocumentsExist(pool, testCase) {
  const result = await pool.query(
    `SELECT d.document_key
     FROM ford.documents d
     JOIN ford.document_embeddings e ON e.document_id = d.id
     LEFT JOIN ford.model_years my ON my.id = d.model_year_id
     LEFT JOIN ford.models m ON m.id = my.model_id
     LEFT JOIN ford.offers o ON o.id = d.offer_id
     WHERE d.document_key = ANY($1::text[])
       AND e.status = 'ready' AND e.embedding IS NOT NULL
       AND (($2::text = 'vehicle' AND d.model_year_id IS NOT NULL AND d.offer_id IS NULL
         AND (d.document_type = 'vehicle_profile'
           OR (d.document_type = 'overview' AND EXISTS (
             SELECT 1 FROM ford.pages model_page
             WHERE model_page.id = d.page_id AND model_page.page_type = 'model'))))
         OR ($2::text = 'offer' AND d.offer_id IS NOT NULL))
       AND ($3::integer IS NULL OR my.model_year = $3)
       AND ($4::text IS NULL OR m.normalized_name = $4)
       AND ($4::text IS NOT NULL OR m.normalized_name NOT LIKE '%police%')
       AND ($5::integer IS NULL OR o.term_months = $5)
       AND ($6::text IS NULL OR EXISTS (
         SELECT 1 FROM ford.model_year_categories mc
         JOIN ford.categories c ON c.id = mc.category_id
         WHERE mc.model_year_id = my.id
           AND (c.normalized_name = lower($6)
             OR (lower($6) IN ('suv', 'suvs', 'suvs & crossovers', 'suvs y crossovers')
               AND c.normalized_name IN ('suvs & crossovers', 'suvs y crossovers')))
       ))`,
    [
      testCase.relevantDocumentKeys,
      testCase.domain,
      testCase.year ?? null,
      testCase.model ? normalizeModelKey(testCase.model) : null,
      testCase.termMonths ?? null,
      testCase.category ?? null,
    ],
  );
  const found = new Set(result.rows.map(row => row.document_key));
  const missing = testCase.relevantDocumentKeys.filter(key => !found.has(key));
  if (missing.length) {
    throw new Error(`${testCase.id} gold documents are missing or out of scope: ${missing.join(', ')}`);
  }
}

async function corpusSnapshot(pool) {
  const [embeddings, documents] = await Promise.all([
    pool.query(
      `SELECT embedding_model, status, count(*)::int AS count,
              count(*) FILTER (WHERE embedding IS NOT NULL)::int AS vectors,
              min(vector_dims(embedding)) AS min_dimensions,
              max(vector_dims(embedding)) AS max_dimensions
       FROM ford.document_embeddings GROUP BY embedding_model, status
       ORDER BY embedding_model, status`,
    ),
    pool.query(
      `SELECT d.document_type, count(*)::int AS count,
              count(*) FILTER (WHERE d.offer_id IS NOT NULL)::int AS offer_documents
       FROM ford.documents d GROUP BY d.document_type ORDER BY d.document_type`,
    ),
  ]);
  return {embeddings: embeddings.rows, documentTypes: documents.rows};
}

function averageMetrics(results) {
  const keys = ['hitAtK', 'precisionAtK', 'recallAtK', 'mrr', 'ndcgAtK'];
  return Object.fromEntries(
    keys.map(key => [
      key,
      results.reduce((sum, item) => sum + item.metrics[key], 0) / results.length,
    ]),
  );
}

async function main() {
  const config = loadConfig(process.env);
  requireLoopback(config.databaseUrl, 'DATABASE_URL');
  requireLoopback(config.embedding.apiUrl.toString(), 'EMBEDDING_API_URL');
  if (config.embedding.provider !== 'ollama') {
    throw new Error('semantic retrieval evaluation requires the local Ollama embedding provider');
  }

  const cases = parseCases(await readFile(CASES_PATH, 'utf8'));
  const pool = new Pool({connectionString: config.databaseUrl, max: 2});
  const provider = createEmbeddingProvider(config.embedding);
  const results = [];
  try {
    const corpus = await corpusSnapshot(pool);
    for (const testCase of cases) {
      await assertRelevantDocumentsExist(pool, testCase);
      const [vector] = await provider.embed([testCase.query]);
      const ranked = await findNearestDocuments(
        pool,
        vector,
        testCase,
        TOP_K,
        false,
        provider.model,
      );
      const metrics = calculateRetrievalMetrics(
        testCase.domain === 'vehicle'
          ? ranked.map(hit => hit.documentKey.split(':')[0])
          : ranked.map(hit => hit.documentKey),
        testCase.domain === 'vehicle'
          ? [...new Set(testCase.relevantDocumentKeys.map(key => key.split(':')[0]))]
          : testCase.relevantDocumentKeys,
        TOP_K,
      );
      const facts = calculateFactCoverage(
        ranked.map(hit => `${hit.title}\n${hit.content}`),
        testCase.expectedFacts,
      );
      const keywordHits = await findKeywordDocuments(pool, testCase, TOP_K * 3);
      const semanticHits = await findNearestDocuments(
        pool,
        vector,
        testCase,
        TOP_K * 3,
        false,
        provider.model,
      );
      const rankingComparison = compareRankings(keywordHits, semanticHits, testCase);
      let legacyOfferHits = 0;
      if (testCase.domain === 'vehicle') {
        const legacyRanked = await findNearestDocuments(
          pool,
          vector,
          testCase,
          TOP_K,
          true,
          undefined,
        );
        legacyOfferHits = legacyRanked.filter(
          hit => hit.documentType === 'offer',
        ).length;
      }
      results.push({
        id: testCase.id,
        domain: testCase.domain,
        query: testCase.query,
        relevantDocumentKeys: testCase.relevantDocumentKeys,
        ranked: ranked.map((hit, index) => ({rank: index + 1, ...hit})),
        metrics,
        answerFactCoverage: facts,
        rankingComparison,
        nonConfiguredEmbeddingHits: ranked
          .filter(hit => hit.embeddingModel !== provider.model)
          .map(hit => ({documentKey: hit.documentKey, embeddingModel: hit.embeddingModel})),
        legacyUnfilteredOfferHitsAtK: legacyOfferHits,
      });
    }

    const report = {
      evaluator: 'deterministic-local-pgvector',
      generatedAt: new Date().toISOString(),
      queryEmbedding: {provider: config.embedding.provider, model: provider.model, dimensions: provider.dimensions},
      topK: TOP_K,
      llmJudge: false,
      databaseWrites: 0,
      corpus,
      summary: {
        cases: results.length,
        byDomain: Object.fromEntries(
          ['vehicle', 'offer'].map(domain => {
            const group = results.filter(item => item.domain === domain);
            return [domain, group.length ? averageMetrics(group) : null];
          }),
        ),
        overall: averageMetrics(results),
        rankingComparison: Object.fromEntries(
          ['currentBlend', 'rrf'].map(method => [
            method,
            averageMetrics(results
              .filter(item => item.domain === 'vehicle')
              .map(item => ({metrics: item.rankingComparison[method].metrics}))),
          ]),
        ),
        rankingComparisonCases: results.filter(item => item.domain === 'vehicle').length,
        answerFactCoverage: results.reduce(
          (sum, item) => sum + item.answerFactCoverage.coverage,
          0,
        ) / results.length,
        totalLegacyUnfilteredOfferHitsAtK: results.reduce(
          (sum, item) => sum + item.legacyUnfilteredOfferHitsAtK,
          0,
        ),
        totalNonConfiguredEmbeddingHits: results.reduce(
          (sum, item) => sum + item.nonConfiguredEmbeddingHits.length,
          0,
        ),
      },
      results,
    };
    const outputDir = join(process.cwd(), 'eval-results', 'semantic-retrieval');
    await mkdir(outputDir, {recursive: true});
    const filename = `${report.generatedAt.replace(/[:.]/g, '-')}-${provider.model.replaceAll(':', '-')}.json`;
    const outputPath = join(outputDir, filename);
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({reportPath: outputPath, summary: report.summary, corpus: report.corpus}, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
