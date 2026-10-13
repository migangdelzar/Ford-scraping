import type {Pool} from 'pg';
import {hashOffer} from '../domain/offers.js';
import type {
  OfferCandidate,
  OfferFilters,
  StoredPage,
} from '../domain/contracts.js';
import {normalizeModelKey} from '../domain/normalization.js';

export interface OfferRef {
  offerId: string;
  modelId?: string;
  modelYearId?: string;
  variantId?: string;
}

export class OfferRepository {
  constructor(private readonly pool: Pool) {}

  async listForDocumentRefresh(): Promise<
    Array<{
      ref: OfferRef;
      pageId?: number;
      candidate: OfferCandidate & {id: string; variantName?: string};
    }>
  > {
    const result = await this.pool.query(
      `SELECT o.id, o.model_year_id, o.variant_id, my.model_id,
              m.name AS model_name, my.model_year, v.name AS variant_name,
              o.title, o.description,
              o.offer_type, o.provider, o.cash_price, o.discount_amount,
              o.discount_percent, o.down_payment_amount, o.down_payment_percent,
              o.monthly_payment, o.term_months, o.months_without_interest,
              o.annual_interest_rate, o.cat_percent, o.currency,
              o.tax_rate_percent, o.opening_commission_rate_percent,
              o.maximum_down_payment_percent, o.life_insurance_price,
              o.valid_from, o.valid_until, o.requires_credit_approval,
              o.conditions, o.metadata, o.source_page_id, page.url AS source_url
       FROM ford.offers o
       LEFT JOIN ford.model_years my ON my.id = o.model_year_id
       LEFT JOIN ford.models m ON m.id = my.model_id
       LEFT JOIN ford.variants v ON v.id = o.variant_id
       LEFT JOIN ford.pages page ON page.id = o.source_page_id
       ORDER BY o.id`,
    );
    const optionalNumber = (value: unknown): number | undefined =>
      value === null || value === undefined ? undefined : Number(value);
    return result.rows.map(row => ({
      ref: {
        offerId: String(row.id),
        modelId: row.model_id ?? undefined,
        modelYearId: row.model_year_id ?? undefined,
        variantId: row.variant_id ?? undefined,
      },
      pageId:
        row.source_page_id === null ? undefined : Number(row.source_page_id),
      candidate: {
        id: String(row.id),
        modelName: row.model_name ?? undefined,
        modelYear: row.model_year === null ? undefined : Number(row.model_year),
        variantName: row.variant_name ?? undefined,
        title: String(row.title),
        description: row.description ?? undefined,
        offerType: row.offer_type,
        provider: row.provider ?? undefined,
        cashPrice: optionalNumber(row.cash_price),
        discountAmount: optionalNumber(row.discount_amount),
        discountPercent: optionalNumber(row.discount_percent),
        downPaymentAmount: optionalNumber(row.down_payment_amount),
        downPaymentPercent: optionalNumber(row.down_payment_percent),
        monthlyPayment: optionalNumber(row.monthly_payment),
        termMonths: optionalNumber(row.term_months),
        monthsWithoutInterest: optionalNumber(row.months_without_interest),
        annualInterestRate: optionalNumber(row.annual_interest_rate),
        catPercent: optionalNumber(row.cat_percent),
        taxRatePercent: optionalNumber(row.tax_rate_percent),
        openingCommissionRatePercent: optionalNumber(
          row.opening_commission_rate_percent,
        ),
        maximumDownPaymentPercent: optionalNumber(
          row.maximum_down_payment_percent,
        ),
        lifeInsurancePrice: optionalNumber(row.life_insurance_price),
        currency: String(row.currency).trim(),
        validFrom: row.valid_from ?? undefined,
        validUntil: row.valid_until ?? undefined,
        requiresCreditApproval: Boolean(row.requires_credit_approval),
        conditions: row.conditions ?? undefined,
        sourceUrl: row.source_url ?? '',
        metadata: row.metadata ?? {},
      },
    }));
  }

  async upsertOffer(
    candidate: OfferCandidate,
    page: StoredPage,
  ): Promise<OfferRef> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const modelYear =
        candidate.modelName && candidate.modelYear
          ? await client.query<{model_id: string; model_year_id: string}>(
              `SELECT m.id AS model_id, my.id AS model_year_id
           FROM ford.model_years my
           JOIN ford.models m ON m.id = my.model_id
           WHERE m.normalized_name = $1 AND my.model_year = $2`,
              [normalizeModelKey(candidate.modelName), candidate.modelYear],
            )
          : ({rowCount: 0, rows: []} as {
              rowCount: number;
              rows: Array<{model_id: string; model_year_id: string}>;
            });
      const modelId = modelYear.rows[0]?.model_id;
      const modelYearId = modelYear.rows[0]?.model_year_id;
      const contentHash = hashOffer(candidate);
      const externalKey = asExternalKey(candidate.metadata);
      const existing = await client.query<{id: string}>(
        externalKey
          ? `SELECT id FROM ford.offers
             WHERE offer_type = $1 AND external_key = $2
             LIMIT 1`
          : `SELECT id FROM ford.offers
             WHERE source_page_id IS NOT DISTINCT FROM $1
               AND model_year_id IS NOT DISTINCT FROM $2
               AND offer_type = $3
               AND title = $4
             LIMIT 1`,
        externalKey
          ? [candidate.offerType, externalKey]
          : [
              page.id ?? null,
              modelYearId ?? null,
              candidate.offerType,
              candidate.title,
            ],
      );
      const values = [
        modelYearId ?? null,
        candidate.title,
        candidate.description ?? null,
        candidate.validFrom ?? null,
        candidate.validUntil ?? null,
        page.id ?? null,
        candidate.offerType,
        candidate.provider ?? null,
        candidate.cashPrice ?? null,
        candidate.discountAmount ?? null,
        candidate.discountPercent ?? null,
        candidate.downPaymentAmount ?? null,
        candidate.downPaymentPercent ?? null,
        candidate.monthlyPayment ?? null,
        candidate.termMonths ?? null,
        candidate.monthsWithoutInterest ?? null,
        candidate.annualInterestRate ?? null,
        candidate.catPercent ?? null,
        candidate.currency,
        candidate.requiresCreditApproval,
        candidate.conditions ?? null,
        contentHash,
        JSON.stringify(candidate.metadata),
        externalKey,
        candidate.taxRatePercent ?? null,
        candidate.openingCommissionRatePercent ?? null,
        candidate.maximumDownPaymentPercent ?? null,
        candidate.lifeInsurancePrice ?? null,
      ];
      let offerId: string;
      if (!existing.rowCount) {
        const inserted = await client.query<{id: string}>(
          `INSERT INTO ford.offers
             (model_year_id, title, description, valid_from, valid_until, source_page_id,
              offer_type, provider, cash_price, discount_amount, discount_percent,
              down_payment_amount, down_payment_percent, monthly_payment, term_months,
              months_without_interest, annual_interest_rate, cat_percent, currency,
              requires_credit_approval, conditions, content_hash, metadata,
              external_key, tax_rate_percent, opening_commission_rate_percent,
              maximum_down_payment_percent, life_insurance_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                   $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
                   $25, $26, $27, $28)
           RETURNING id`,
          values,
        );
        offerId = inserted.rows[0].id;
      } else {
        offerId = existing.rows[0].id;
        await client.query(
          `UPDATE ford.offers SET
             model_year_id = $2, title = $3, description = $4, valid_from = $5, valid_until = $6,
             source_page_id = $7, offer_type = $8, provider = $9, cash_price = $10,
             discount_amount = $11, discount_percent = $12, down_payment_amount = $13,
             down_payment_percent = $14, monthly_payment = $15, term_months = $16,
             months_without_interest = $17, annual_interest_rate = $18, cat_percent = $19,
             currency = $20, requires_credit_approval = $21, conditions = $22,
             content_hash = $23, metadata = $24, external_key = $25,
             tax_rate_percent = $26, opening_commission_rate_percent = $27,
             maximum_down_payment_percent = $28, life_insurance_price = $29,
             updated_at = now()
           WHERE id = $1`,
          [offerId, ...values],
        );
      }
      await client.query('COMMIT');
      return {offerId, modelId, modelYearId};
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async list(filters: OfferFilters = {}): Promise<unknown[]> {
    const result = await this.pool.query(
      `SELECT o.*, m.name AS model_name, my.model_year
       FROM ford.offers o
       LEFT JOIN ford.model_years my ON my.id = o.model_year_id
       LEFT JOIN ford.models m ON m.id = my.model_id
       WHERE ($1::text IS NULL OR o.offer_type = $1)
         AND ($2::text IS NULL OR lower(coalesce(o.provider, '')) = lower($2))
         AND ($3::integer IS NULL OR my.model_year = $3)
         AND ($4::numeric IS NULL OR o.cash_price <= $4)
         AND ($5::numeric IS NULL OR o.monthly_payment <= $5)
         AND ($6::integer IS NULL OR o.months_without_interest >= $6)
         AND ($7::integer IS NULL OR o.term_months = $7)
         AND ($8::date IS NULL OR o.valid_from IS NULL OR o.valid_from <= $8::date)
         AND ($8::date IS NULL OR o.valid_until IS NULL OR o.valid_until >= $8::date)
       ORDER BY o.valid_until NULLS LAST, o.title`,
      [
        filters.offerType ?? null,
        filters.provider ?? null,
        filters.modelYear ?? null,
        filters.maxCashPrice ?? null,
        filters.maxMonthlyPayment ?? null,
        filters.minimumMonthsWithoutInterest ?? null,
        filters.termMonths ?? null,
        filters.asOf ?? null,
      ],
    );
    return result.rows;
  }
}

function asExternalKey(metadata: Record<string, unknown>): string | undefined {
  const value = metadata.externalKey ?? metadata.externalPromotionId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
