import type {Pool} from 'pg';
import type {PageType, StoredPage} from '../domain/contracts.js';

export interface FetchedPage {
  sourceBaseUrl: string;
  sourceName: string;
  url: string;
  canonicalUrl: string;
  pageType: PageType;
  status: number;
  contentType?: string;
  title?: string;
  rawHtml: string;
  extractedText: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  crawlError?: string;
}

export interface PageChange {
  page: StoredPage;
  changed: boolean;
}

export class PageRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(input: FetchedPage): Promise<PageChange> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const source = await client.query<{id: number}>(
        `INSERT INTO ford.sources (base_url, name)
         VALUES ($1, $2)
         ON CONFLICT (base_url) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [input.sourceBaseUrl, input.sourceName],
      );
      const sourceId = source.rows[0].id;
      const existing = await client.query<{
        id: number;
        content_hash: string | null;
      }>('SELECT id, content_hash FROM ford.pages WHERE url = $1', [input.url]);
      const changed =
        existing.rowCount === 0 ||
        existing.rows[0].content_hash !== input.contentHash;
      const result = await client.query<{id: number}>(
        `INSERT INTO ford.pages (
           source_id, url, canonical_url, page_type, http_status, content_type,
           title, raw_html, extracted_text, content_hash, crawled_at,
           last_changed_at, crawl_error, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(),
           CASE WHEN $11 THEN now() ELSE NULL END, $12, $13)
         ON CONFLICT (url) DO UPDATE SET
           source_id = EXCLUDED.source_id,
           canonical_url = EXCLUDED.canonical_url,
           page_type = EXCLUDED.page_type,
           http_status = EXCLUDED.http_status,
           content_type = EXCLUDED.content_type,
           title = EXCLUDED.title,
           raw_html = EXCLUDED.raw_html,
           extracted_text = EXCLUDED.extracted_text,
           content_hash = EXCLUDED.content_hash,
           crawled_at = now(),
           last_changed_at = CASE WHEN ford.pages.content_hash IS DISTINCT FROM EXCLUDED.content_hash
             THEN now() ELSE ford.pages.last_changed_at END,
           crawl_error = EXCLUDED.crawl_error,
           metadata = EXCLUDED.metadata
         RETURNING id`,
        [
          sourceId,
          input.url,
          input.canonicalUrl,
          input.pageType,
          input.status,
          input.contentType ?? null,
          input.title ?? null,
          input.rawHtml,
          input.extractedText,
          input.contentHash,
          changed,
          input.crawlError ?? null,
          JSON.stringify(input.metadata),
        ],
      );
      await client.query('COMMIT');
      return {
        changed,
        page: {
          id: result.rows[0].id,
          url: input.url,
          canonicalUrl: input.canonicalUrl,
          pageType: input.pageType,
          title: input.title ?? '',
          rawHtml: input.rawHtml,
          extractedText: input.extractedText,
          contentHash: input.contentHash,
          metadata: input.metadata,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getByUrl(url: string): Promise<StoredPage | null> {
    const result = await this.pool.query<{
      id: number;
      url: string;
      canonical_url: string;
      page_type: PageType;
      title: string;
      raw_html: string;
      extracted_text: string;
      content_hash: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, url, canonical_url, page_type, coalesce(title, '') AS title,
              coalesce(raw_html, '') AS raw_html, coalesce(extracted_text, '') AS extracted_text,
              content_hash, metadata
       FROM ford.pages WHERE url = $1`,
      [url],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          url: row.url,
          canonicalUrl: row.canonical_url,
          pageType: row.page_type,
          title: row.title,
          rawHtml: row.raw_html,
          extractedText: row.extracted_text,
          contentHash: row.content_hash,
          metadata: row.metadata,
        }
      : null;
  }

  async list(limit = 100): Promise<StoredPage[]> {
    const result = await this.pool.query<{
      id: number;
      url: string;
      canonical_url: string;
      page_type: PageType;
      title: string;
      raw_html: string;
      extracted_text: string;
      content_hash: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, url, canonical_url, page_type, coalesce(title, '') AS title,
              coalesce(raw_html, '') AS raw_html, coalesce(extracted_text, '') AS extracted_text,
              content_hash, metadata
       FROM ford.pages ORDER BY crawled_at DESC NULLS LAST LIMIT $1`,
      [limit],
    );
    return result.rows.map(row => ({
      id: row.id,
      url: row.url,
      canonicalUrl: row.canonical_url,
      pageType: row.page_type,
      title: row.title,
      rawHtml: row.raw_html,
      extractedText: row.extracted_text,
      contentHash: row.content_hash,
      metadata: row.metadata,
    }));
  }
}
