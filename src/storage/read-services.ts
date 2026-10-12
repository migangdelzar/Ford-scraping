import type {Pool} from 'pg';
import {normalizeModelKey} from '../domain/normalization.js';
import {
  MAX_SUPPORTED_MODEL_YEAR,
  MIN_SUPPORTED_MODEL_YEAR,
} from '../domain/model-years.js';
import {
  getOfferDataQualityWarnings,
  getOfferValidityStatus,
} from '../domain/offers.js';

function comparisonValueKind(value: unknown): 'boolean' | 'numeric' | 'text' | 'missing' {
  if (typeof value !== 'string' || !value.trim() || /^(?:[-—]|n\/?a)$/i.test(value.trim())) {
    return 'missing';
  }
  if (/^(?:s[ií]|no)$/i.test(value.trim())) return 'boolean';
  if (/^[\s$€£¥\d.,%+-]+$/.test(value.trim())) return 'numeric';
  return 'text';
}

function isInvalidQuantitativeBoolean(name: unknown, value: unknown): boolean {
  return (
    typeof name === 'string' &&
    /precio|rendimiento|consumo|econom[ií]a|potencia|torque|capacidad|arrastre|velocidad|kilometraje|autonom[ií]a/i.test(name) &&
    comparisonValueKind(value) === 'boolean'
  );
}

function classifyComparisonRows(rawData: unknown): {
  rawData: Record<string, unknown>;
  comparableFacts: Array<Record<string, unknown>>;
  excludedRows: Array<Record<string, unknown>>;
} {
  const source = typeof rawData === 'object' && rawData !== null && !Array.isArray(rawData)
    ? rawData as Record<string, unknown>
    : {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const comparableFacts: Array<Record<string, unknown>> = [];
  const excludedRows: Array<Record<string, unknown>> = [];
  for (const candidate of rows) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue;
    const row = candidate as Record<string, unknown>;
    const fordKind = comparisonValueKind(row.fordValue);
    const competitorKind = comparisonValueKind(row.competitorValue);
    if (
      fordKind === 'missing' ||
      competitorKind === 'missing' ||
      fordKind !== competitorKind ||
      isInvalidQuantitativeBoolean(row.name, row.fordValue) ||
      isInvalidQuantitativeBoolean(row.name, row.competitorValue)
    ) {
      excludedRows.push({
        ...row,
        excludedReason: 'Source values are missing, use different value types, or encode a quantitative specification as yes/no; do not compare as a like-for-like difference.',
      });
    } else {
      comparableFacts.push(row);
    }
  }
  return {
    rawData: {
      ...source,
      rows: comparableFacts,
      excludedRows,
    },
    comparableFacts,
    excludedRows,
  };
}

function normalizeTrimForModel(model: string, trim: string): string {
  const modelKey = normalizeModelKey(model);
  const trimKey = normalizeModelKey(trim);
  return trimKey.startsWith(modelKey) && trimKey.length > modelKey.length
    ? trimKey.slice(modelKey.length)
    : trimKey;
}

export class VehicleQueryService {
  constructor(private readonly pool: Pool) {}

  async getAvailableModelYears(model: string): Promise<number[]> {
    const result = await this.pool.query<{model_year: number}>(
      `SELECT my.model_year
       FROM ford.model_years my
       JOIN ford.models m ON m.id = my.model_id
       WHERE m.normalized_name = $1 AND my.model_year BETWEEN $2 AND $3
       ORDER BY my.model_year DESC`,
      [normalizeModelKey(model), MIN_SUPPORTED_MODEL_YEAR, MAX_SUPPORTED_MODEL_YEAR],
    );
    return result.rows.map(row => Number(row.model_year));
  }

  async getByModelYear(model: string, year: number, trim?: string): Promise<unknown | null> {
    const vehicle = await this.pool.query(
      `SELECT m.id AS model_id, m.name AS model, my.id AS model_year_id, my.model_year AS year,
              my.starting_price AS price, my.currency, my.metadata,
              my.source_page_id, source.url AS source_url,
              coalesce(model_page.url,
                CASE WHEN source.page_type = 'model' THEN source.url END) AS model_page_url,
              source.page_type AS source_page_type, source.crawled_at
      FROM ford.model_years my
      JOIN ford.models m ON m.id = my.model_id
      LEFT JOIN ford.pages source ON source.id = my.source_page_id
      LEFT JOIN LATERAL (
        SELECT p.url
        FROM ford.variants v
        JOIN ford.pages p ON p.id = v.source_page_id
        WHERE v.model_year_id = my.id AND p.page_type = 'model'
        ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC
        LIMIT 1
      ) model_page ON true
      WHERE m.normalized_name = $1 AND my.model_year = $2
        AND my.model_year BETWEEN $3 AND $4`,
      [normalizeModelKey(model), year, MIN_SUPPORTED_MODEL_YEAR, MAX_SUPPORTED_MODEL_YEAR],
    );
    if (!vehicle.rowCount) return null;
    const row = vehicle.rows[0];
    if (trim) {
      const trimKeys = [...new Set([
        normalizeModelKey(trim),
        normalizeTrimForModel(model, trim),
        normalizeModelKey(`${model} ${trim}`),
      ])];
      const [variants, comparisonLinks, variantResult, technicalSheet, images] = await Promise.all([
        this.pool.query(
          `SELECT v.id, v.name, v.trim_name, v.metadata,
                  source.url AS source_url, source.crawled_at
           FROM ford.variants v
           LEFT JOIN ford.pages source ON source.id = v.source_page_id
           WHERE v.model_year_id = $1 ORDER BY v.name`,
          [row.model_year_id],
        ),
        this.pool.query<{trim_name: string; target_url: string}>(
          `SELECT DISTINCT v.name AS trim_name, p.url AS target_url
           FROM ford.comparisons c
           JOIN ford.variants v ON v.id = c.variant_id
           JOIN ford.pages p ON p.id = c.source_page_id
           WHERE c.model_year_id = $1
           ORDER BY v.name, p.url`,
          [row.model_year_id],
        ),
        this.pool.query(
          `SELECT v.id, v.name, v.trim_name, v.price, v.currency,
                  variant_page.url AS source_url,
                  comparison_page.url AS comparison_url,
                  coalesce(price_page.url, comparison_page.url) AS price_source_url
           FROM ford.variants v
           LEFT JOIN ford.pages variant_page ON variant_page.id = v.source_page_id
           LEFT JOIN LATERAL (
             SELECT p.url FROM ford.comparisons c
             JOIN ford.pages p ON p.id = c.source_page_id
             WHERE c.variant_id = v.id ORDER BY p.url LIMIT 1
           ) comparison_page ON true
           LEFT JOIN LATERAL (
             SELECT p.url FROM ford.specifications s
             JOIN ford.pages p ON p.id = s.source_page_id
             WHERE s.variant_id = v.id AND s.normalized_name = 'precio'
             ORDER BY s.id DESC LIMIT 1
           ) price_page ON true
           WHERE v.model_year_id = $1 AND v.normalized_name = ANY($2::text[])
           ORDER BY v.name LIMIT 1`,
          [row.model_year_id, trimKeys],
        ),
        this.pool.query(
          `SELECT p.url
           FROM ford.specifications s JOIN ford.pages p ON p.id = s.source_page_id
           WHERE s.model_year_id = $1 AND s.variant_id IS NULL AND p.page_type = 'technical_sheet'
           ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC LIMIT 1`,
          [row.model_year_id],
        ),
        this.pool.query(
          `SELECT i.url, i.alt_text, i.image_type, i.width, i.height,
                  source.url AS source_url, source.crawled_at
           FROM ford.images i
           LEFT JOIN ford.pages source ON source.id = i.source_page_id
           WHERE i.model_year_id = $1 AND i.variant_id IS NULL
           ORDER BY i.image_type, i.id`,
          [row.model_year_id],
        ),
      ]);
      const variant = variantResult.rows[0] as Record<string, unknown> | undefined;
      if (!variant) {
        return {
          ...row,
          price: null,
          trim_name: trim,
          trim_status: 'not_found',
          trim_source_url: null,
          technical_sheet_url: technicalSheet.rows[0]?.url ?? null,
          specifications: [],
          features: [],
          images: images.rows,
          variants: variants.rows,
          comparison_urls: comparisonLinks.rows.map(link => ({
            trim_name: link.trim_name,
            url: link.target_url,
          })),
        };
      }
      const [specs, features] = await Promise.all([
        this.pool.query(
          `SELECT s.name, s.normalized_name, s.value_text, s.value_numeric, s.unit,
                  source.url AS source_url, source.page_type AS source_page_type,
                  source.crawled_at
           FROM ford.specifications s
           LEFT JOIN ford.pages source ON source.id = s.source_page_id
           WHERE s.model_year_id = $1 AND s.variant_id = $2 ORDER BY s.id`,
          [row.model_year_id, variant.id],
        ),
        this.pool.query(
          `SELECT f.name, f.description, f.category,
                  source.url AS source_url, source.crawled_at
           FROM ford.features f
           LEFT JOIN ford.pages source ON source.id = f.source_page_id
           WHERE f.model_year_id = $1 AND f.variant_id = $2 ORDER BY f.id`,
          [row.model_year_id, variant.id],
        ),
      ]);
      return {
        ...row,
        price: variant.price ?? null,
        currency: variant.currency ?? row.currency,
        price_source_url: variant.price_source_url ?? variant.comparison_url ?? null,
        trim_name: variant.trim_name ?? variant.name,
        trim_status: 'found',
        trim_source_url: variant.comparison_url ?? variant.source_url ?? null,
        technical_sheet_url: technicalSheet.rows[0]?.url ?? null,
        specifications: specs.rows,
        features: features.rows,
        images: images.rows,
        variants: variants.rows,
        comparison_urls: comparisonLinks.rows.map(link => ({
          trim_name: link.trim_name,
          url: link.target_url,
        })),
      };
    }
    const specs = await this.pool.query(
      `SELECT s.name, s.normalized_name, s.value_text, s.value_numeric, s.unit,
              source.url AS source_url, source.page_type AS source_page_type,
              source.crawled_at
       FROM ford.specifications s
       LEFT JOIN ford.pages source ON source.id = s.source_page_id
       WHERE s.model_year_id = $1 AND s.variant_id IS NULL ORDER BY s.id`,
      [row.model_year_id],
    );
    const features = await this.pool.query(
      `SELECT f.name, f.description, f.category,
              source.url AS source_url, source.crawled_at
       FROM ford.features f
       LEFT JOIN ford.pages source ON source.id = f.source_page_id
       WHERE f.model_year_id = $1 AND f.variant_id IS NULL ORDER BY f.id`,
      [row.model_year_id],
    );
    const images = await this.pool.query(
      `SELECT i.url, i.alt_text, i.image_type, i.width, i.height,
              source.url AS source_url, source.crawled_at
       FROM ford.images i
       LEFT JOIN ford.pages source ON source.id = i.source_page_id
       WHERE i.model_year_id = $1 ORDER BY i.image_type, i.id`,
      [row.model_year_id],
    );
    const variants = await this.pool.query(
      `SELECT v.id, v.name, v.trim_name, v.metadata,
              source.url AS source_url, source.crawled_at
       FROM ford.variants v
       LEFT JOIN ford.pages source ON source.id = v.source_page_id
       WHERE v.model_year_id = $1 ORDER BY v.name`,
      [row.model_year_id],
    );
    const comparisonLinks = await this.pool.query<{
      trim_name: string;
      target_url: string;
    }>(
      `SELECT DISTINCT v.name AS trim_name, p.url AS target_url
       FROM ford.comparisons c
       JOIN ford.variants v ON v.id = c.variant_id
       JOIN ford.pages p ON p.id = c.source_page_id
       WHERE c.model_year_id = $1
       ORDER BY v.name, p.url`,
      [row.model_year_id],
    );
    const variantNames = new Map(
      variants.rows.map(variant => [
        normalizeModelKey(String(variant.name)),
        String(variant.name),
      ]),
    );
    return {
      ...row,
      model_page_url: row.model_page_url,
      technical_sheet_url:
        specs.rows.find(spec => spec.source_page_type === 'technical_sheet')
          ?.source_url ?? null,
      comparison_urls: comparisonLinks.rows.map(link => ({
        trim_name:
          variantNames.get(normalizeModelKey(link.trim_name)) ?? link.trim_name,
        url: link.target_url,
      })),
      specifications: specs.rows,
      features: features.rows,
      images: images.rows,
      variants: variants.rows,
    };
  }

  async compare(ids: string[]): Promise<unknown> {
    const result = await this.pool.query(
      `SELECT m.name AS model, my.model_year AS year, my.starting_price AS price, my.currency,
              my.id AS model_year_id,
              coalesce(model_page.url,
                CASE WHEN source_page.page_type = 'model' THEN source_page.url END) AS model_page_url,
              source_page.url AS source_url,
              coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                  'name', s.name, 'value', s.value_text, 'unit', s.unit,
                  'category', s.category, 'sourceUrl', source.url,
                  'crawledAt', source.crawled_at
                ) ORDER BY s.category NULLS LAST, s.name)
                FROM ford.specifications s
                LEFT JOIN ford.pages source ON source.id = s.source_page_id
                WHERE s.model_year_id = my.id AND s.variant_id IS NULL
              ), '[]'::jsonb) AS specifications,
              coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                  'name', f.name, 'description', f.description, 'category', f.category,
                  'sourceUrl', source.url, 'crawledAt', source.crawled_at
                ) ORDER BY f.category NULLS LAST, f.name)
                FROM ford.features f
                LEFT JOIN ford.pages source ON source.id = f.source_page_id
                WHERE f.model_year_id = my.id AND f.variant_id IS NULL
              ), '[]'::jsonb) AS features,
              coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                  'url', i.url, 'altText', i.alt_text, 'imageType', i.image_type,
                  'width', i.width, 'height', i.height, 'sourceUrl', source.url,
                  'crawledAt', source.crawled_at
                ) ORDER BY i.image_type NULLS LAST, i.id)
                FROM ford.images i
                LEFT JOIN ford.pages source ON source.id = i.source_page_id
                WHERE i.model_year_id = my.id
              ), '[]'::jsonb) AS images
       FROM ford.model_years my JOIN ford.models m ON m.id = my.model_id
       LEFT JOIN ford.pages source_page ON source_page.id = my.source_page_id
       LEFT JOIN LATERAL (
         SELECT p.url FROM ford.variants v
         JOIN ford.pages p ON p.id = v.source_page_id
         WHERE v.model_year_id = my.id AND p.page_type = 'model'
         ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC LIMIT 1
       ) model_page ON true
       WHERE my.id = ANY($1::uuid[]) ORDER BY m.name, my.model_year`,
      [ids],
    );
    return result.rows;
  }
}

export class PageLinkService {
  constructor(private readonly pool: Pool) {}

  async getPageLinks(
    sourceUrl: string,
    offset = 0,
    limit = 100,
    includeAssets = false,
  ): Promise<unknown> {
    const page = await this.pool.query(
      `SELECT id AS source_page_id, url AS source_url, title, page_type, crawled_at
       FROM ford.pages WHERE url = $1`,
      [sourceUrl],
    );
    if (!page.rowCount) return null;
    const links = await this.pool.query(
      `SELECT href, target_url, anchor_text, rel, is_internal, link_type
       FROM (
         SELECT DISTINCT ON (target_url)
           href, target_url, anchor_text, rel, is_internal, link_type
         FROM (
           SELECT href, target_url, anchor_text, rel, is_internal, link_type
           FROM ford.page_links WHERE source_page_id = $1
           UNION ALL
           SELECT comparison_page.url AS href, comparison_page.url AS target_url,
             'Compáralo en el mercado' AS anchor_text, '' AS rel,
             true AS is_internal, 'internal' AS link_type
           FROM ford.variants v
           JOIN ford.comparisons c ON c.variant_id = v.id
           JOIN ford.pages comparison_page ON comparison_page.id = c.source_page_id
           WHERE v.source_page_id = $1
         ) candidate_links
         WHERE $4::boolean OR target_url !~* '\\.(avif|bmp|gif|jpe?g|png|svg|webp|ico|css|js|woff2?|ttf|eot|pdf)([?#].*)?$'
         ORDER BY target_url, (anchor_text IS NULL), anchor_text
       ) distinct_links
       ORDER BY target_url ~* '/Comparativo/' DESC, is_internal DESC,
         (anchor_text IS NULL), anchor_text, target_url
       OFFSET $2 LIMIT $3`,
      [page.rows[0].source_page_id, Math.max(0, offset), Math.min(Math.max(1, limit), 200), includeAssets],
    );
    const count = await this.pool.query<{count: string}>(
      `SELECT count(DISTINCT candidate_url)::text AS count FROM (
         SELECT target_url AS candidate_url FROM ford.page_links
         WHERE source_page_id = $1
         UNION
         SELECT comparison_page.url AS candidate_url
         FROM ford.variants v
         JOIN ford.comparisons c ON c.variant_id = v.id
         JOIN ford.pages comparison_page ON comparison_page.id = c.source_page_id
         WHERE v.source_page_id = $1
       ) candidate_links
       WHERE $2::boolean OR candidate_url !~* '\\.(avif|bmp|gif|jpe?g|png|svg|webp|ico|css|js|woff2?|ttf|eot|pdf)([?#].*)?$'`,
      [page.rows[0].source_page_id, includeAssets],
    );
    return {
      ...page.rows[0],
      totalLinks: Number(count.rows[0].count),
      offset: Math.max(0, offset),
      limit: Math.min(Math.max(1, limit), 200),
      links: links.rows,
    };
  }
}

export class ProvenanceService {
  constructor(private readonly pool: Pool) {}

  async get(documentId: string): Promise<unknown> {
    const result = await this.pool.query(
      `SELECT d.id AS document_id, d.document_type, d.content_hash,
              p.url AS source_url, p.crawled_at, p.content_hash AS page_content_hash
       FROM ford.documents d LEFT JOIN ford.pages p ON p.id = d.page_id
       WHERE d.id = $1`,
      [documentId],
    );
    return result.rows[0] ?? null;
  }
}

export class PromotionService {
  constructor(private readonly pool: Pool) {}

  async list(filters: Record<string, unknown>): Promise<unknown> {
    const model = typeof filters.model === 'string' ? filters.model : undefined;
    const modelYear = typeof filters.modelYear === 'number' ? filters.modelYear : undefined;
    const activeOnly = filters.activeOnly === true;
    const asOf = typeof filters.asOf === 'string'
      ? filters.asOf
      : new Date().toISOString().slice(0, 10);
    const result = await this.pool.query(
      `SELECT o.id, o.model_year_id, m.name AS model_name, my.model_year,
              o.title, o.description, o.offer_type, o.valid_from, o.valid_until,
              o.cash_price, o.discount_amount, o.discount_percent, o.down_payment_amount,
              o.down_payment_percent, o.monthly_payment, o.term_months,
              o.months_without_interest, o.annual_interest_rate, o.cat_percent,
              o.currency, o.requires_credit_approval, o.conditions, o.metadata,
              page.url AS source_url,
              coalesce(o.metadata->>'modelUrl', model_page.url,
                CASE WHEN model_source_page.page_type = 'model' THEN model_source_page.url END) AS model_url,
              o.metadata->'benefits' AS benefits,
              o.source_page_id
       FROM ford.offers o
       LEFT JOIN ford.model_years my ON my.id = o.model_year_id
       LEFT JOIN ford.models m ON m.id = my.model_id
       LEFT JOIN ford.pages page ON page.id = o.source_page_id
       LEFT JOIN ford.pages model_source_page ON model_source_page.id = my.source_page_id
       LEFT JOIN LATERAL (
         SELECT p.url FROM ford.variants v
         JOIN ford.pages p ON p.id = v.source_page_id
         WHERE v.model_year_id = my.id AND p.page_type = 'model'
         ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC LIMIT 1
       ) model_page ON true
       WHERE o.offer_type = 'promotion'
         AND ($1::date IS NULL OR o.valid_until IS NULL OR o.valid_until >= $1::date)
         AND ($2::text IS NULL OR m.normalized_name = $2)
         AND ($3::integer IS NULL OR my.model_year = $3)
         AND (o.model_year_id IS NULL OR my.model_year BETWEEN $5 AND $6)
         AND ($4::boolean IS NOT TRUE OR (
           (o.valid_from IS NULL OR o.valid_from <= $1::date)
           AND (o.valid_until IS NULL OR o.valid_until >= $1::date)
         ))
       ORDER BY o.valid_until NULLS LAST, o.title`,
      [asOf, model ? normalizeModelKey(model) : null, modelYear ?? null, activeOnly,
        MIN_SUPPORTED_MODEL_YEAR, MAX_SUPPORTED_MODEL_YEAR],
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      ...row,
      modelName: row.model_name,
      modelYear: row.model_year,
      sourceUrl: row.source_url,
      modelUrl: row.model_url,
      benefits: row.benefits ?? [],
      termsAndConditions: row.conditions,
      validityStatus: getOfferValidityStatus(
        {
          validFrom: row.valid_from as string | undefined,
          validUntil: row.valid_until as string | undefined,
        },
        asOf,
      ),
      dataQualityWarnings: getOfferDataQualityWarnings(
        row.metadata as Record<string, unknown>,
      ),
    }));
  }
}

export class ComparisonService {
  constructor(private readonly pool: Pool) {}

  async compareTrims(model: string, year: number, trims: string[]): Promise<unknown> {
    const result = await this.pool.query(
      `SELECT m.name AS model, my.model_year AS year, v.id AS variant_id,
              v.name AS trim, v.price, v.currency,
              (SELECT model_page.url FROM ford.variants model_variant
               JOIN ford.pages model_page ON model_page.id = model_variant.source_page_id
               WHERE model_variant.model_year_id = my.id AND model_page.page_type = 'model'
               ORDER BY model_page.crawled_at DESC NULLS LAST, model_page.id DESC
               LIMIT 1) AS model_page_url,
              (SELECT technical_page.url FROM ford.specifications model_spec
               JOIN ford.pages technical_page ON technical_page.id = model_spec.source_page_id
               WHERE model_spec.model_year_id = my.id AND technical_page.page_type = 'technical_sheet'
               ORDER BY technical_page.crawled_at DESC NULLS LAST, technical_page.id DESC
               LIMIT 1) AS technical_sheet_url,
              (SELECT comparison_page.url
               FROM ford.comparisons c
               JOIN ford.pages comparison_page ON comparison_page.id = c.source_page_id
               WHERE c.variant_id = v.id
               ORDER BY comparison_page.url LIMIT 1) AS comparison_url,
              (SELECT price_spec_page.url
               FROM ford.specifications price_spec
               LEFT JOIN ford.pages price_spec_page ON price_spec_page.id = price_spec.source_page_id
               WHERE price_spec.variant_id = v.id
                 AND price_spec.normalized_name = 'precio'
               ORDER BY price_spec.id DESC LIMIT 1) AS price_source_url,
              coalesce(jsonb_agg(jsonb_build_object(
                'category', s.category, 'name', s.name,
                'normalizedName', s.normalized_name, 'value', s.value_text,
                'numericValue', s.value_numeric, 'unit', s.unit,
                'sourceUrl', p.url
              ) ORDER BY s.category NULLS LAST, s.name)
                FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb) AS specifications
       FROM ford.model_years my
       JOIN ford.models m ON m.id = my.model_id
       JOIN ford.variants v ON v.model_year_id = my.id
       LEFT JOIN ford.specifications s ON s.variant_id = v.id
       LEFT JOIN ford.pages p ON p.id = s.source_page_id
       WHERE m.normalized_name = $1 AND my.model_year = $2
         AND my.model_year BETWEEN $4 AND $5
         AND v.normalized_name = ANY($3::text[])
       GROUP BY m.name, my.id, my.model_year, v.id
       ORDER BY v.name`,
      [
        normalizeModelKey(model),
        year,
        [...new Set(trims.flatMap(trim => {
          const fullName = normalizeModelKey(trim);
          const trimName = normalizeTrimForModel(model, trim);
          return fullName === trimName ? [fullName] : [fullName, trimName];
        }))],
        MIN_SUPPORTED_MODEL_YEAR,
        MAX_SUPPORTED_MODEL_YEAR,
      ],
    );
    const foundTrims = result.rows.map(row => {
      const facts = Array.isArray(row.specifications)
        ? row.specifications as Array<Record<string, unknown>>
        : [];
      const excludedSourceFacts = facts
        .filter(fact => isInvalidQuantitativeBoolean(fact.name, fact.value))
        .map(fact => ({
          ...fact,
          excludedReason: 'A quantitative specification is recorded as a yes/no value; do not use as a trim difference.',
        }));
      return {
        ...row,
        specifications: facts.filter(
          fact => !isInvalidQuantitativeBoolean(fact.name, fact.value),
        ),
        excluded_source_facts: excludedSourceFacts,
      };
    });
    const pairs: Array<Record<string, unknown>> = [];
    for (let leftIndex = 0; leftIndex < foundTrims.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < foundTrims.length; rightIndex += 1) {
        const left = foundTrims[leftIndex];
        const right = foundTrims[rightIndex];
        const leftFacts = new Map(
          (left.specifications as Array<Record<string, unknown>>).map(fact => [
            String(fact.normalizedName), fact,
          ]),
        );
        const rightFacts = new Map(
          (right.specifications as Array<Record<string, unknown>>).map(fact => [
            String(fact.normalizedName), fact,
          ]),
        );
        const sharedChanges = [...leftFacts.entries()]
          .filter(([key, fact]) => {
            const counterpart = rightFacts.get(key);
            return (
              counterpart &&
              key !== 'precio' &&
              comparisonValueKind(fact.value) !== 'missing' &&
              comparisonValueKind(fact.value) === comparisonValueKind(counterpart.value) &&
              !isInvalidQuantitativeBoolean(fact.name, fact.value) &&
              !isInvalidQuantitativeBoolean(counterpart.name, counterpart.value) &&
              !String(fact.value).includes('|') &&
              !String(counterpart.value).includes('|') &&
              fact.value !== counterpart.value
            );
          })
          .map(([key, fact]) => {
            const counterpart = rightFacts.get(key)!;
            return {
              normalizedName: key,
              name: fact.name,
              left: {trim: left.trim, value: fact.value, sourceUrl: fact.sourceUrl},
              right: {trim: right.trim, value: counterpart.value, sourceUrl: counterpart.sourceUrl},
            };
          });
        const priceDelta =
          left.price === null || right.price === null
            ? undefined
            : Number(right.price) - Number(left.price);
        pairs.push({
          leftTrim: left.trim,
          rightTrim: right.trim,
          priceDifferenceMxn: priceDelta,
          priceSources: {
            left: left.price_source_url ?? null,
            right: right.price_source_url ?? null,
          },
          sharedFactDifferences: sharedChanges,
          note: 'Only values stated for both trims are compared; a missing value is unknown, not an upgrade or omission.',
        });
      }
    }
    return {
      model,
      year,
      modelPageUrl: foundTrims.find(row => row.model_page_url)?.model_page_url,
      technicalSheetUrl: foundTrims.find(row => row.technical_sheet_url)?.technical_sheet_url,
      requestedTrims: trims,
      foundTrims,
      trimPairs: pairs,
      missingTrims: trims.filter(trim =>
        !foundTrims.some(row =>
          normalizeTrimForModel(model, String(row.trim)) ===
          normalizeTrimForModel(model, trim),
        ),
      ),
      note: 'Only source-backed variant facts are included; absent values are unknown.',
    };
  }

  async compareModelYears(model: string, years: number[]): Promise<unknown> {
    const result = await this.pool.query(
      `SELECT m.name AS model, my.model_year AS year, my.starting_price AS price,
              my.currency, model_page.url AS model_page_url,
              technical_sheet.url AS technical_sheet_url,
              price_page.url AS price_source_url,
              coalesce((SELECT jsonb_agg(jsonb_build_object(
                'name', s.name, 'normalizedName', s.normalized_name,
                'value', s.value_text, 'numericValue', s.value_numeric, 'unit', s.unit,
                'sourceUrl', spec_page.url
              ) ORDER BY s.name)
                FROM ford.specifications s
                LEFT JOIN ford.pages spec_page ON spec_page.id = s.source_page_id
                WHERE s.model_year_id = my.id AND s.variant_id IS NULL), '[]'::jsonb)
                AS specifications,
              coalesce((SELECT jsonb_agg(jsonb_build_object(
                'title', o.title, 'discountAmount', o.discount_amount,
                'cashPrice', o.cash_price, 'validFrom', o.valid_from,
                'validUntil', o.valid_until, 'conditions', o.conditions,
                'benefits', o.metadata->'benefits', 'sourceUrl', offer_page.url,
                'modelUrl', coalesce(o.metadata->>'modelUrl', model_page.url)
              ) ORDER BY o.valid_until NULLS LAST)
                FROM ford.offers o
                LEFT JOIN ford.pages offer_page ON offer_page.id = o.source_page_id
                WHERE o.model_year_id = my.id AND o.offer_type = 'promotion'
                  AND (o.valid_from IS NULL OR o.valid_from <= current_date)
                  AND (o.valid_until IS NULL OR o.valid_until >= current_date)), '[]'::jsonb)
                AS active_promotions
              ,coalesce((SELECT jsonb_agg(jsonb_build_object(
                'trim', v.name, 'normalizedTrim', v.normalized_name,
                'price', v.price, 'sourceUrl', variant_page.url,
                'comparisonUrl', (SELECT comparison_page.url
                  FROM ford.comparisons c
                  JOIN ford.pages comparison_page ON comparison_page.id = c.source_page_id
                  WHERE c.variant_id = v.id
                  ORDER BY comparison_page.url LIMIT 1),
                'specifications', coalesce(variant_specs.specifications, '[]'::jsonb)
              ) ORDER BY v.name)
                FROM ford.variants v
                LEFT JOIN LATERAL (
                  SELECT p.url FROM ford.pages p
                  WHERE p.id = v.source_page_id
                  LIMIT 1
                ) variant_page ON true
                LEFT JOIN LATERAL (
                  SELECT jsonb_agg(jsonb_build_object(
                    'name', vs.name, 'normalizedName', vs.normalized_name,
                    'value', vs.value_text, 'numericValue', vs.value_numeric,
                    'unit', vs.unit, 'sourceUrl', spec_variant_page.url
                  ) ORDER BY vs.name) AS specifications
                  FROM ford.specifications vs
                  LEFT JOIN ford.pages spec_variant_page ON spec_variant_page.id = vs.source_page_id
                  WHERE vs.variant_id = v.id
                ) variant_specs ON true
                WHERE v.model_year_id = my.id), '[]'::jsonb) AS variants
       FROM ford.model_years my
       JOIN ford.models m ON m.id = my.model_id
       LEFT JOIN ford.pages price_page ON price_page.id = my.source_page_id
       LEFT JOIN LATERAL (
         SELECT p.url, p.id
         FROM ford.pages p
         WHERE p.page_type = 'model'
           AND (p.id = my.source_page_id OR EXISTS (
             SELECT 1 FROM ford.variants source_variant
             WHERE source_variant.model_year_id = my.id
               AND source_variant.source_page_id = p.id
           ))
         ORDER BY (p.id = my.source_page_id) DESC,
           p.crawled_at DESC NULLS LAST, p.id DESC LIMIT 1
       ) model_page ON true
       LEFT JOIN LATERAL (
         SELECT p.url
         FROM ford.specifications s
         JOIN ford.pages p ON p.id = s.source_page_id
         WHERE s.model_year_id = my.id AND p.page_type = 'technical_sheet'
         ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC LIMIT 1
       ) technical_sheet ON true
       WHERE m.normalized_name = $1 AND my.model_year = ANY($2::int[])
         AND my.model_year BETWEEN $3 AND $4
       ORDER BY my.model_year`,
      [normalizeModelKey(model), years, MIN_SUPPORTED_MODEL_YEAR, MAX_SUPPORTED_MODEL_YEAR],
    );
    const pairs: Array<Record<string, unknown>> = [];
    for (let leftIndex = 0; leftIndex < result.rows.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < result.rows.length; rightIndex += 1) {
        const left = result.rows[leftIndex];
        const right = result.rows[rightIndex];
        const leftFacts = new Map(
          (left.specifications as Array<Record<string, unknown>>).map(fact => [String(fact.normalizedName), fact]),
        );
        const rightFacts = new Map(
          (right.specifications as Array<Record<string, unknown>>).map(fact => [String(fact.normalizedName), fact]),
        );
        const changes = [...leftFacts.entries()]
          .filter(([key, fact]) => {
            const counterpart = rightFacts.get(key);
            const isComparableValue = (value: unknown) =>
              typeof value === 'string' &&
              value.trim() !== '' &&
              !/^(?:[-—]|n\/?a|no disponible)$/i.test(value.trim()) &&
              !value.includes('|');
            return (
              counterpart &&
              isComparableValue(fact.value) &&
              isComparableValue(counterpart.value) &&
              fact.value !== counterpart.value
            );
          })
          .map(([key, fact]) => {
            const counterpart = rightFacts.get(key)!;
            return {
              normalizedName: key,
              name: fact.name,
              older: {year: left.year, value: fact.value, sourceUrl: fact.sourceUrl},
              newer: {year: right.year, value: counterpart.value, sourceUrl: counterpart.sourceUrl},
            };
          });
        const leftVariants = Array.isArray(left.variants)
          ? left.variants as Array<Record<string, unknown>>
          : [];
        const rightVariants = Array.isArray(right.variants)
          ? right.variants as Array<Record<string, unknown>>
          : [];
        const rightVariantsByName = new Map(rightVariants.map(variant => [
          String(variant.normalizedTrim ?? normalizeModelKey(String(variant.trim ?? ''))),
          variant,
        ]));
        const leftTrimNames = leftVariants.map(variant => ({
          name: String(variant.trim ?? ''),
          key: String(variant.normalizedTrim ?? normalizeModelKey(String(variant.trim ?? ''))),
        }));
        const rightTrimNames = rightVariants.map(variant => ({
          name: String(variant.trim ?? ''),
          key: String(variant.normalizedTrim ?? normalizeModelKey(String(variant.trim ?? ''))),
        }));
        const trimChanges = leftVariants.flatMap(leftVariant => {
          const trim = String(leftVariant.trim ?? '');
          const normalizedTrim = String(
            leftVariant.normalizedTrim ?? normalizeModelKey(trim),
          );
          const rightVariant = rightVariantsByName.get(normalizedTrim);
          if (!rightVariant) return [];
          const variantFacts = (variant: Record<string, unknown>) =>
            Array.isArray(variant.specifications)
              ? variant.specifications as Array<Record<string, unknown>>
              : [];
          const leftVariantFacts = new Map(variantFacts(leftVariant).map(fact => [
            String(fact.normalizedName), fact,
          ]));
          const rightVariantFacts = new Map(variantFacts(rightVariant).map(fact => [
            String(fact.normalizedName), fact,
          ]));
          const changedVariantFacts = [...leftVariantFacts.entries()]
            .filter(([key, fact]) => {
              const counterpart = rightVariantFacts.get(key);
              const comparable = (value: unknown) =>
                typeof value === 'string' && value.trim() !== '' &&
                !/^(?:[-—]|n\/?a|no disponible)$/i.test(value.trim()) &&
                !value.includes('|');
              return counterpart && comparable(fact.value) &&
                comparable(counterpart.value) && fact.value !== counterpart.value;
            })
            .map(([key, fact]) => {
              const counterpart = rightVariantFacts.get(key)!;
              return {
                normalizedName: key,
                name: fact.name,
                older: {year: left.year, value: fact.value, sourceUrl: fact.sourceUrl},
                newer: {year: right.year, value: counterpart.value, sourceUrl: counterpart.sourceUrl},
              };
            });
          return [{
            trim,
            priceDifferenceMxn:
              leftVariant.price === null || leftVariant.price === undefined ||
              rightVariant.price === null || rightVariant.price === undefined
                ? null
                : Number(rightVariant.price) - Number(leftVariant.price),
            sourceUrls: {from: leftVariant.sourceUrl, to: rightVariant.sourceUrl},
            changedFacts: changedVariantFacts,
          }];
        });
        pairs.push({
          fromYear: left.year,
          toYear: right.year,
          priceDifferenceMxn:
            left.price === null || right.price === null
              ? null
              : Number(right.price) - Number(left.price),
          priceSourceUrls: {from: left.price_source_url, to: right.price_source_url},
          changedFacts: changes,
          trimChanges,
          unmatchedTrims: {
            from: leftTrimNames.filter(trim => !rightVariantsByName.has(trim.key)).map(trim => trim.name),
            to: rightTrimNames.filter(trim => !leftTrimNames.some(leftTrim => leftTrim.key === trim.key)).map(trim => trim.name),
          },
          note: 'Only differing single values present for both years are compared. Placeholder and multi-trim grouped values remain in foundYears as source facts but are not treated as year changes.',
        });
      }
    }
    return {
      model,
      requestedYears: [...years].sort((a, b) => a - b),
      foundYears: result.rows,
      missingYears: years.filter(year => !result.rows.some(row => Number(row.year) === year)),
      yearPairs: pairs,
    };
  }

  async getVariantComparisons(model: string, year: number, trim?: string): Promise<unknown> {
    const modelPageResult = await this.pool.query(
      `SELECT p.url AS model_page_url,
              (SELECT technical_page.url
               FROM ford.specifications s
               JOIN ford.pages technical_page ON technical_page.id = s.source_page_id
               WHERE s.model_year_id = my.id AND technical_page.page_type = 'technical_sheet'
               ORDER BY technical_page.crawled_at DESC NULLS LAST, technical_page.id DESC
               LIMIT 1) AS technical_sheet_url
       FROM ford.model_years my
       JOIN ford.models m ON m.id = my.model_id
       JOIN ford.variants v ON v.model_year_id = my.id
       JOIN ford.pages p ON p.id = v.source_page_id AND p.page_type = 'model'
       WHERE m.normalized_name = $1 AND my.model_year = $2
         AND my.model_year BETWEEN $3 AND $4
       ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC
       LIMIT 1`,
      [normalizeModelKey(model), year, MIN_SUPPORTED_MODEL_YEAR, MAX_SUPPORTED_MODEL_YEAR],
    );
    const modelPageUrl = modelPageResult.rows[0]?.model_page_url;
    const technicalSheetUrl = modelPageResult.rows[0]?.technical_sheet_url;
    const result = await this.pool.query(
      `SELECT m.name AS model, my.model_year AS year, v.name AS ford_trim,
              c.competitor_make, c.competitor_model, c.competitor_year,
              c.competitor_variant, c.raw_data,
              ford_page.url AS comparison_url,
              c.raw_data->'images'->>'ford' AS ford_image_url,
              c.raw_data->'images'->>'competitor' AS competitor_image_url
       FROM ford.comparisons c
       JOIN ford.model_years my ON my.id = c.model_year_id
       JOIN ford.models m ON m.id = my.model_id
       JOIN ford.variants v ON v.id = c.variant_id
       JOIN ford.pages ford_page ON ford_page.id = c.source_page_id
       WHERE m.normalized_name = $1 AND my.model_year = $2
         AND my.model_year BETWEEN $4 AND $5
         AND ($3::text IS NULL OR v.normalized_name = $3)
       ORDER BY v.name, c.competitor_make, c.competitor_model`,
      [normalizeModelKey(model), year, trim ? normalizeModelKey(trim) : null,
        MIN_SUPPORTED_MODEL_YEAR, MAX_SUPPORTED_MODEL_YEAR],
    );
    const comparisons = result.rows.map(row => {
      const classified = classifyComparisonRows(row.raw_data);
      return {
        ...row,
        raw_data: classified.rawData,
        paired_facts: classified.comparableFacts,
        excluded_source_rows: classified.excludedRows,
        data_quality_warning: classified.excludedRows.length
          ? `${classified.excludedRows.length} source row(s) omitted from paired_facts because their values are missing or not like-for-like. See the original page for the full table.`
          : null,
      };
    });
    return {
      model,
      year,
      trim: trim ?? null,
      modelPageUrl,
      technicalSheetUrl,
      comparisons,
      count: result.rowCount,
      note: comparisons.length
        ? 'Use paired_facts for like-for-like comparisons. excluded_source_rows preserves values that should not be compared directly. The original Ford Uruapan page remains linked.'
        : 'No Ford Uruapan Comparativo records were found for this model/year. This does not mean competitors or differences do not exist.',
    };
  }
}

export class CatalogStatusService {
  constructor(private readonly pool: Pool) {}

  async status(): Promise<unknown> {
    const result = await this.pool.query(`
      SELECT
        (SELECT count(*)::int FROM ford.pages) AS pages,
        (SELECT count(*)::int FROM ford.model_years) AS vehicles,
        (SELECT count(*)::int FROM ford.documents) AS documents,
        (SELECT count(*)::int FROM ford.document_embeddings WHERE status = 'ready') AS embedded,
        (SELECT count(*)::int FROM ford.document_embeddings WHERE status = 'pending') AS pending,
        (SELECT max(crawled_at) FROM ford.pages) AS latest_crawled_at
    `);
    return result.rows[0];
  }
}
