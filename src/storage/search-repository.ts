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
      crawled_at: string | null;
    }>(
      `SELECT m.id AS model_id, my.id AS model_year_id, m.name AS model_name, my.model_year,
              my.starting_price, category.name AS category, source.url AS source_url, source.crawled_at
       FROM ford.model_years my
       JOIN ford.models m ON m.id = my.model_id
       LEFT JOIN LATERAL (
         SELECT c.name FROM ford.model_year_categories myc
         JOIN ford.categories c ON c.id = myc.category_id
         WHERE myc.model_year_id = my.id ORDER BY c.name LIMIT 1
       ) category ON true
       LEFT JOIN ford.pages source ON source.id = my.source_page_id
       WHERE ($1::numeric IS NULL OR my.starting_price >= $1)
         AND ($2::numeric IS NULL OR my.starting_price <= $2)
         AND ($3::integer IS NULL OR my.model_year = $3)
         AND ($4::text IS NULL OR EXISTS (
           SELECT 1 FROM ford.model_year_categories myc
           JOIN ford.categories c ON c.id = myc.category_id
           WHERE myc.model_year_id = my.id AND c.normalized_name = lower($4)
         ))
         AND ($5::text IS NULL OR lower(coalesce(my.metadata->>'body_type', '')) = lower($5))
         AND ($6::text IS NULL OR lower(coalesce(my.metadata->>'fuel_type', '')) = lower($6))
       ORDER BY my.starting_price NULLS LAST, m.name`,
      [
        filters.minPrice ?? null,
        filters.maxPrice ?? null,
        filters.modelYear ?? null,
        filters.category ?? null,
        filters.bodyType ?? null,
        filters.fuelType ?? null,
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
      months_without_interest: number | null;
      annual_interest_rate: number | null;
      valid_until: string | null;
      valid_from: string | null;
      metadata: Record<string, unknown>;
      source_url: string | null;
      crawled_at: string | null;
    }>(
      `SELECT o.id AS offer_id, o.model_year_id, m.name AS model_name, my.model_year,
              o.title, o.offer_type, o.provider, o.cash_price, o.monthly_payment,
              o.months_without_interest, o.annual_interest_rate, o.valid_from,
              o.valid_until, o.metadata,
              page.url AS source_url, page.crawled_at
       FROM ford.offers o
       LEFT JOIN ford.model_years my ON my.id = o.model_year_id
       LEFT JOIN ford.models m ON m.id = my.model_id
       LEFT JOIN ford.pages page ON page.id = o.source_page_id
       WHERE ($1::text IS NULL OR o.offer_type = $1)
         AND ($2::text IS NULL OR lower(coalesce(o.provider, '')) = lower($2))
         AND ($3::text IS NULL OR lower(coalesce(m.name, '')) = lower($3))
         AND ($4::integer IS NULL OR my.model_year = $4)
         AND ($5::numeric IS NULL OR o.cash_price <= $5)
         AND ($6::numeric IS NULL OR o.monthly_payment <= $6)
         AND ($7::numeric IS NULL OR o.down_payment_amount <= $7)
         AND ($8::integer IS NULL OR o.months_without_interest >= $8)
         AND ($10::boolean IS NOT TRUE OR (
           (o.valid_from IS NULL OR o.valid_from <= $9::date)
           AND (o.valid_until IS NULL OR o.valid_until >= $9::date)
         ))
       ORDER BY o.valid_until NULLS LAST, o.title`,
      [
        filters.offerType ?? null,
        filters.provider ?? null,
        filters.model ?? null,
        filters.modelYear ?? null,
        filters.maxCashPrice ?? null,
        filters.maxMonthlyPayment ?? null,
        filters.maxDownPayment ?? null,
        filters.minimumMonthsWithoutInterest ?? null,
        asOf,
        filters.activeOnly ?? false,
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
      monthsWithoutInterest:
        row.months_without_interest === null
          ? undefined
          : Number(row.months_without_interest),
      annualInterestRate:
        row.annual_interest_rate === null
          ? undefined
          : Number(row.annual_interest_rate),
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
      `SELECT d.id AS document_id, d.model_year_id, d.document_type, coalesce(d.title, '') AS title,
              d.content, ts_rank_cd(d.search_vector, websearch_to_tsquery('spanish', $1)) AS score,
              p.url AS source_url, p.crawled_at
       FROM ford.documents d
       LEFT JOIN ford.pages p ON p.id = d.page_id
       WHERE d.model_year_id = ANY($2::uuid[])
         AND d.search_vector @@ websearch_to_tsquery('spanish', $1)
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
  ): Promise<DocumentHit[]> {
    if (!candidates.length) return [];
    const result = await this.pool.query<RawDocumentHit>(
      `SELECT d.id AS document_id, d.model_year_id, d.document_type, coalesce(d.title, '') AS title,
              d.content, 1 - (e.embedding <=> $1::vector) AS score,
              p.url AS source_url, p.crawled_at
       FROM ford.document_embeddings e
       JOIN ford.documents d ON d.id = e.document_id
       LEFT JOIN ford.pages p ON p.id = d.page_id
       WHERE e.status = 'ready' AND e.embedding IS NOT NULL
         AND d.model_year_id = ANY($2::uuid[])
       ORDER BY e.embedding <=> $1::vector
       LIMIT $3`,
      [
        JSON.stringify(embedding),
        candidates.map(candidate => candidate.modelYearId),
        limit,
      ],
    );
    return mapHits(result.rows);
  }

  async searchOfferSemantic(
    embedding: number[],
    candidates: OfferSearchCandidate[],
    limit: number,
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
       ORDER BY e.embedding <=> $1::vector
       LIMIT $3`,
      [
        JSON.stringify(embedding),
        candidates.map(candidate => candidate.offerId),
        limit,
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
