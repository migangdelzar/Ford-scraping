import type {Pool} from 'pg';
import {
  getOfferDataQualityWarnings,
  getOfferValidityStatus,
} from '../domain/offers.js';
import type {
  DocumentHit,
  OfferFilters,
  OfferSearchCandidate,
  SearchRequest,
  VehicleSearchCandidate,
} from '../domain/contracts.js';
import {normalizeModelKey} from '../domain/normalization.js';
import {
  MAX_SUPPORTED_MODEL_YEAR,
  MIN_SUPPORTED_MODEL_YEAR,
} from '../domain/model-years.js';

export class SearchRepository {
  constructor(private readonly pool: Pool) {}

  async findCandidates(
    filters: SearchRequest['filters'] = {},
  ): Promise<VehicleSearchCandidate[]> {
    const result = await this.pool.query<{
      model_id: string;
      model_year_id: string;
      model_name: string;
      model_year: number;
      starting_price: number | null;
      category: string | null;
      source_url: string | null;
      model_page_url: string | null;
      price_source_url: string | null;
      crawled_at: string | null;
    }>(
      `SELECT m.id AS model_id, my.id AS model_year_id, m.name AS model_name, my.model_year,
              my.starting_price, category.name AS category,
              coalesce(model_page.url, CASE WHEN source.page_type = 'model' THEN source.url END) AS source_url,
              model_page.url AS model_page_url, source.url AS price_source_url,
              coalesce(model_page.crawled_at, source.crawled_at) AS crawled_at
       FROM ford.model_years my
       JOIN ford.models m ON m.id = my.model_id
       LEFT JOIN LATERAL (
         SELECT c.name FROM ford.model_year_categories myc
         JOIN ford.categories c ON c.id = myc.category_id
         WHERE myc.model_year_id = my.id ORDER BY c.name LIMIT 1
       ) category ON true
       LEFT JOIN ford.pages source ON source.id = my.source_page_id
       LEFT JOIN LATERAL (
         SELECT p.url, p.crawled_at
         FROM ford.variants v
         JOIN ford.pages p ON p.id = v.source_page_id
         WHERE v.model_year_id = my.id AND p.page_type = 'model'
         ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC
         LIMIT 1
       ) model_page ON true
       WHERE ($1::numeric IS NULL OR my.starting_price >= $1)
         AND ($2::numeric IS NULL OR my.starting_price <= $2)
         AND my.model_year BETWEEN $8 AND $9
         AND ($3::integer IS NULL OR my.model_year = $3)
         AND ($4::text IS NULL OR EXISTS (
           SELECT 1 FROM ford.model_year_categories myc
           JOIN ford.categories c ON c.id = myc.category_id
           WHERE myc.model_year_id = my.id
             AND (c.normalized_name = lower($4)
               OR (lower($4) IN ('suv', 'suvs', 'suvs & crossovers', 'suvs y crossovers')
                 AND c.normalized_name IN ('suvs & crossovers', 'suvs y crossovers')))
         ))
         AND ($5::text IS NULL OR lower(coalesce(my.metadata->>'body_type', '')) = lower($5))
         AND ($6::text IS NULL OR lower(coalesce(my.metadata->>'fuel_type', '')) = lower($6))
         AND ($7::text IS NULL OR m.normalized_name = $7)
         AND ($7::text IS NOT NULL OR m.normalized_name NOT LIKE '%police%')
       ORDER BY my.starting_price NULLS LAST, m.name`,
      [
        filters.minPrice ?? null,
        filters.maxPrice ?? null,
        filters.modelYear ?? null,
        filters.category ?? null,
        filters.bodyType ?? null,
        filters.fuelType ?? null,
        filters.model ? normalizeModelKey(filters.model) : null,
        MIN_SUPPORTED_MODEL_YEAR,
        MAX_SUPPORTED_MODEL_YEAR,
      ],
    );
    return result.rows.map(row => ({
      modelId: row.model_id,
      modelYearId: row.model_year_id,
      modelName: row.model_name,
      modelYear: row.model_year,
      price:
        row.starting_price === null ? undefined : Number(row.starting_price),
      category: row.category ?? undefined,
      sourceUrl: row.source_url ?? undefined,
      modelPageUrl: row.model_page_url ?? undefined,
      priceSourceUrl: row.price_source_url ?? undefined,
      crawledAt: row.crawled_at ?? undefined,
    }));
  }

  async findOfferCandidates(
    filters: OfferFilters = {},
  ): Promise<OfferSearchCandidate[]> {
    const asOf = filters.asOf ?? new Date().toISOString().slice(0, 10);
    const result = await this.pool.query<{
      offer_id: string;
      model_year_id: string | null;
      model_name: string | null;
      model_year: number | null;
      title: string;
      offer_type: OfferSearchCandidate['offerType'];
      provider: string | null;
      cash_price: number | null;
      monthly_payment: number | null;
      term_months: number | null;
      months_without_interest: number | null;
      annual_interest_rate: number | null;
      cat_percent: number | null;
      tax_rate_percent: number | null;
      opening_commission_rate_percent: number | null;
      maximum_down_payment_percent: number | null;
      life_insurance_price: number | null;
      valid_until: string | null;
      valid_from: string | null;
      metadata: Record<string, unknown>;
      source_url: string | null;
      model_url: string | null;
      crawled_at: string | null;
    }>(
      `SELECT o.id AS offer_id, o.model_year_id, m.name AS model_name, my.model_year,
              o.title, o.offer_type, o.provider, o.cash_price, o.monthly_payment,
              o.term_months,
              o.months_without_interest, o.annual_interest_rate, o.cat_percent,
              o.tax_rate_percent, o.opening_commission_rate_percent,
              o.maximum_down_payment_percent, o.life_insurance_price, o.valid_from,
              o.valid_until, o.metadata,
              page.url AS source_url,
              coalesce(o.metadata->>'modelUrl', model_page.url,
                CASE WHEN model_source.page_type = 'model' THEN model_source.url END) AS model_url,
              page.crawled_at
       FROM ford.offers o
       LEFT JOIN ford.model_years my ON my.id = o.model_year_id
       LEFT JOIN ford.models m ON m.id = my.model_id
       LEFT JOIN ford.pages page ON page.id = o.source_page_id
       LEFT JOIN ford.pages model_source ON model_source.id = my.source_page_id
       LEFT JOIN LATERAL (
         SELECT p.url FROM ford.variants v
         JOIN ford.pages p ON p.id = v.source_page_id
         WHERE v.model_year_id = my.id AND p.page_type = 'model'
         ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC LIMIT 1
       ) model_page ON true
       WHERE ($1::text IS NULL OR o.offer_type = $1)
         AND ($2::text IS NULL OR lower(coalesce(o.provider, '')) = lower($2))
         AND ($3::text IS NULL OR m.normalized_name = $3)
         AND ($4::integer IS NULL OR my.model_year = $4)
         AND ($5::numeric IS NULL OR o.cash_price <= $5)
         AND ($6::numeric IS NULL OR o.monthly_payment <= $6)
         AND ($7::numeric IS NULL OR o.down_payment_amount <= $7)
         AND ($8::integer IS NULL OR o.months_without_interest >= $8)
         AND ($11::integer IS NULL OR o.term_months = $11)
         AND (o.model_year_id IS NULL OR my.model_year BETWEEN $12 AND $13)
         AND ($10::boolean IS NOT TRUE OR (
           (o.valid_from IS NULL OR o.valid_from <= $9::date)
           AND (o.valid_until IS NULL OR o.valid_until >= $9::date)
         ))
       ORDER BY o.valid_until NULLS LAST, o.title`,
      [
        filters.offerType ?? null,
        filters.provider ?? null,
        filters.model ? normalizeModelKey(filters.model) : null,
        filters.modelYear ?? null,
        filters.maxCashPrice ?? null,
        filters.maxMonthlyPayment ?? null,
        filters.maxDownPayment ?? null,
        filters.minimumMonthsWithoutInterest ?? null,
        asOf,
        filters.activeOnly ?? false,
        filters.termMonths ?? null,
        MIN_SUPPORTED_MODEL_YEAR,
        MAX_SUPPORTED_MODEL_YEAR,
      ],
    );
    return result.rows.map(row => ({
      offerId: row.offer_id,
      modelYearId: row.model_year_id ?? undefined,
      modelName: row.model_name ?? undefined,
      modelYear: row.model_year ?? undefined,
      title: row.title,
      offerType: row.offer_type,
      provider: row.provider ?? undefined,
      cashPrice: row.cash_price === null ? undefined : Number(row.cash_price),
      monthlyPayment:
        row.monthly_payment === null ? undefined : Number(row.monthly_payment),
      termMonths:
        row.term_months === null ? undefined : Number(row.term_months),
      monthsWithoutInterest:
        row.months_without_interest === null
          ? undefined
          : Number(row.months_without_interest),
      annualInterestRate:
        row.annual_interest_rate === null
          ? undefined
          : Number(row.annual_interest_rate),
      catPercent: row.cat_percent === null ? undefined : Number(row.cat_percent),
      taxRatePercent:
        row.tax_rate_percent === null || row.tax_rate_percent === undefined
          ? undefined
          : Number(row.tax_rate_percent),
      openingCommissionRatePercent:
        row.opening_commission_rate_percent === null ||
        row.opening_commission_rate_percent === undefined
          ? undefined
          : Number(row.opening_commission_rate_percent),
      maximumDownPaymentPercent:
        row.maximum_down_payment_percent === null ||
        row.maximum_down_payment_percent === undefined
          ? undefined
          : Number(row.maximum_down_payment_percent),
      lifeInsurancePrice:
        row.life_insurance_price === null ||
        row.life_insurance_price === undefined
          ? undefined
          : Number(row.life_insurance_price),
      validFrom: row.valid_from ?? undefined,
      validUntil: row.valid_until ?? undefined,
      validityStatus: getOfferValidityStatus(
        {
          validFrom: row.valid_from ?? undefined,
          validUntil: row.valid_until ?? undefined,
        },
        asOf,
      ),
      dataQualityWarnings: getOfferDataQualityWarnings(row.metadata),
      sourceUrl: row.source_url ?? undefined,
      modelUrl: row.model_url ?? undefined,
      crawledAt: row.crawled_at ?? undefined,
    }));
  }

  async searchKeyword(
    query: string,
    candidates: VehicleSearchCandidate[],
    limit: number,
  ): Promise<DocumentHit[]> {
    if (!candidates.length || !query.trim()) return [];
    const result = await this.pool.query<RawDocumentHit>(
      `WITH scored AS (
         SELECT d.id AS document_id, d.model_year_id, d.document_type,
                coalesce(d.title, '') AS title, d.content,
                ts_rank_cd(
                  d.search_vector,
                  to_tsquery('spanish', array_to_string(
                    tsvector_to_array(to_tsvector('spanish', $1)), ' | '
                  ))
                ) AS score,
                p.url AS source_url, p.crawled_at,
                row_number() OVER (
                  PARTITION BY d.model_year_id
                  ORDER BY ts_rank_cd(
                    d.search_vector,
                    to_tsquery('spanish', array_to_string(
                      tsvector_to_array(to_tsvector('spanish', $1)), ' | '
                    ))
                  ) DESC,
                    d.id
                ) AS entity_rank
         FROM ford.documents d
         LEFT JOIN ford.pages p ON p.id = d.page_id
         WHERE d.model_year_id = ANY($2::uuid[])
           AND d.offer_id IS NULL
           AND d.semantic_content IS NOT NULL AND d.semantic_content <> ''
           AND (d.document_type = 'vehicle_profile'
             OR (d.document_type = 'overview' AND p.page_type = 'model'))
           AND d.search_vector @@ to_tsquery('spanish', array_to_string(
             tsvector_to_array(to_tsvector('spanish', $1)), ' | '
           ))
       )
       SELECT document_id, model_year_id, document_type, title, content,
              score, source_url, crawled_at
       FROM scored WHERE entity_rank = 1
       ORDER BY score DESC
       LIMIT $3`,
      [query, candidates.map(candidate => candidate.modelYearId), limit],
    );
    return mapHits(result.rows);
  }

  async searchOfferKeyword(
    query: string,
    candidates: OfferSearchCandidate[],
    limit: number,
  ): Promise<DocumentHit[]> {
    if (!candidates.length || !query.trim()) return [];
    const result = await this.pool.query<RawDocumentHit>(
      `SELECT d.id AS document_id, coalesce(d.model_year_id::text, '') AS model_year_id,
              d.offer_id, d.document_type, coalesce(d.title, '') AS title, d.content,
              ts_rank_cd(d.search_vector, websearch_to_tsquery('spanish', $1)) AS score,
              p.url AS source_url, p.crawled_at
       FROM ford.documents d
       LEFT JOIN ford.pages p ON p.id = d.page_id
       WHERE d.offer_id = ANY($2::uuid[])
         AND d.search_vector @@ websearch_to_tsquery('spanish', $1)
       ORDER BY score DESC
       LIMIT $3`,
      [query, candidates.map(candidate => candidate.offerId), limit],
    );
    return mapHits(result.rows);
  }

  async searchSemantic(
    embedding: number[],
    candidates: VehicleSearchCandidate[],
    limit: number,
    embeddingModel: string,
  ): Promise<DocumentHit[]> {
    if (!candidates.length) return [];
    const result = await this.pool.query<RawDocumentHit>(
      `WITH scored AS (
         SELECT d.id AS document_id, d.model_year_id, d.document_type,
                coalesce(d.title, '') AS title, d.content,
                1 - (e.embedding <=> $1::vector) AS score,
                p.url AS source_url, p.crawled_at,
                row_number() OVER (
                  PARTITION BY d.model_year_id
                  ORDER BY e.embedding <=> $1::vector, d.id
                ) AS entity_rank
         FROM ford.document_embeddings e
         JOIN ford.documents d ON d.id = e.document_id
         LEFT JOIN ford.pages p ON p.id = d.page_id
         WHERE e.status = 'ready' AND e.embedding IS NOT NULL
           AND d.offer_id IS NULL
           AND (d.document_type = 'vehicle_profile'
             OR (d.document_type = 'overview' AND p.page_type = 'model'))
           AND e.embedding_model = $4
           AND d.model_year_id = ANY($2::uuid[])
       )
       SELECT document_id, model_year_id, document_type, title, content,
              score, source_url, crawled_at
       FROM scored WHERE entity_rank = 1
       ORDER BY score DESC
       LIMIT $3`,
      [
        JSON.stringify(embedding),
        candidates.map(candidate => candidate.modelYearId),
        limit,
        embeddingModel,
      ],
    );
    return mapHits(result.rows);
  }

  async searchOfferSemantic(
    embedding: number[],
    candidates: OfferSearchCandidate[],
    limit: number,
    embeddingModel: string,
  ): Promise<DocumentHit[]> {
    if (!candidates.length) return [];
    const result = await this.pool.query<RawDocumentHit>(
      `SELECT d.id AS document_id, coalesce(d.model_year_id::text, '') AS model_year_id,
              d.offer_id, d.document_type, coalesce(d.title, '') AS title, d.content,
              1 - (e.embedding <=> $1::vector) AS score,
              p.url AS source_url, p.crawled_at
       FROM ford.document_embeddings e
       JOIN ford.documents d ON d.id = e.document_id
       LEFT JOIN ford.pages p ON p.id = d.page_id
       WHERE e.status = 'ready' AND e.embedding IS NOT NULL
         AND d.offer_id = ANY($2::uuid[])
         AND d.semantic_content IS NOT NULL AND d.semantic_content <> ''
         AND e.embedding_model = $4
       ORDER BY e.embedding <=> $1::vector
       LIMIT $3`,
      [
        JSON.stringify(embedding),
        candidates.map(candidate => candidate.offerId),
        limit,
        embeddingModel,
      ],
    );
    return mapHits(result.rows);
  }
}

interface RawDocumentHit {
  document_id: string;
  model_year_id: string;
  offer_id?: string | null;
  document_type: string;
  title: string;
  content: string;
  score: number;
  source_url: string | null;
  crawled_at: string | null;
}

function mapHits(rows: RawDocumentHit[]): DocumentHit[] {
  return rows.map(row => ({
    documentId: row.document_id,
    modelYearId: row.model_year_id,
    offerId: row.offer_id ?? undefined,
    documentType: row.document_type,
    title: row.title,
    content: row.content,
    score: Number(row.score),
    sourceUrl: row.source_url ?? undefined,
    crawledAt: row.crawled_at ?? undefined,
  }));
}
