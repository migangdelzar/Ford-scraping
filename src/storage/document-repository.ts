import type {Pool} from 'pg';
import type {DocumentCandidate} from '../domain/contracts.js';
import {hashDocument} from '../domain/documents.js';
import type {ModelYearRef} from './catalog-repository.js';
import type {OfferRef} from './offer-repository.js';
import type {EmbeddingJobRepository} from '../embeddings/provider.js';

export class DocumentRepository implements EmbeddingJobRepository {
  constructor(private readonly pool: Pool) {}

  async pruneDocumentChunks(
    ref: ModelYearRef,
    documentType: string,
    sectionKey: string,
    firstStaleChunkIndex: number,
  ): Promise<void> {
    await this.pool.query(
      `DELETE FROM ford.documents
       WHERE model_year_id = $1 AND document_type = $2 AND section_key = $3
         AND chunk_index >= $4`,
      [ref.modelYearId, documentType, sectionKey, firstStaleChunkIndex],
    );
  }

  async upsertDocuments(
    ref: ModelYearRef,
    documents: DocumentCandidate[],
    pageId?: number,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const document of documents) {
        const sectionKey = document.sectionKey ?? document.documentType;
        const chunkIndex = document.chunkIndex ?? 0;
        const documentKey = `${ref.modelYearId}:${document.documentType}:${sectionKey}:${chunkIndex}${document.variantId ? `:${document.variantId}` : ''}`;
        const contentHash = hashDocument(document.content);
        const semanticContent = document.semanticContent === undefined
          ? document.content
          : document.semanticContent.trim();
        const semanticContentHash = hashDocument(semanticContent);
        const existing = await client.query<{
          id: string;
          content_hash: string;
          semantic_content_hash: string | null;
        }>(
          'SELECT id, content_hash, semantic_content_hash FROM ford.documents WHERE document_key = $1',
          [documentKey],
        );
        let documentId: string;
        let embeddingChanged = true;
        if (!existing.rowCount) {
          const inserted = await client.query<{id: string}>(
            `INSERT INTO ford.documents
              (model_id, model_year_id, variant_id, page_id, document_key, document_type, section_key, chunk_index,
               title, content, content_hash, semantic_content, semantic_content_hash, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING id`,
            [
              ref.modelId,
              ref.modelYearId,
              document.variantId ?? null,
              pageId ?? null,
              documentKey,
              document.documentType,
              sectionKey,
              chunkIndex,
              document.title,
              document.content,
              contentHash,
              document.semanticContent ?? null,
              semanticContentHash,
              JSON.stringify(document.metadata),
            ],
          );
          documentId = inserted.rows[0].id;
        } else {
          documentId = existing.rows[0].id;
          const contentChanged = existing.rows[0].content_hash !== contentHash;
          embeddingChanged = existing.rows[0].semantic_content_hash !== semanticContentHash;
          if (contentChanged || embeddingChanged || document.variantId) {
            await client.query(
              `UPDATE ford.documents
               SET title = $2, content = $3, content_hash = $4, page_id = $5,
                   section_key = $6, chunk_index = $7, metadata = $8,
                   variant_id = coalesce($9, variant_id), semantic_content = $10,
                   semantic_content_hash = $11, updated_at = now()
               WHERE id = $1`,
              [
                documentId,
                document.title,
                document.content,
                contentHash,
                pageId ?? null,
                sectionKey,
                chunkIndex,
                JSON.stringify(document.metadata),
                document.variantId ?? null,
                document.semanticContent ?? null,
                semanticContentHash,
              ],
            );
          }
        }

        if (!semanticContent) {
          await client.query(
            'DELETE FROM ford.document_embeddings WHERE document_id = $1',
            [documentId],
          );
        } else if (embeddingChanged) {
          await client.query(
            `INSERT INTO ford.document_embeddings (document_id, embedding_model, status, error)
             VALUES ($1, 'unconfigured', 'pending', NULL)
             ON CONFLICT (document_id) DO UPDATE SET status = 'pending', error = NULL, updated_at = now()`,
            [documentId],
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertPageDocument(
    pageId: number,
    document: DocumentCandidate,
  ): Promise<void> {
    const sectionKey = document.sectionKey ?? document.documentType;
    const chunkIndex = document.chunkIndex ?? 0;
    const documentKey = `page:${pageId}:${document.documentType}:${sectionKey}:${chunkIndex}`;
    const contentHash = hashDocument(document.content);
    const semanticContent = document.semanticContent === undefined
      ? document.content
      : document.semanticContent.trim();
    const semanticContentHash = hashDocument(semanticContent);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{
        id: string;
        content_hash: string;
        semantic_content_hash: string | null;
      }>(
        'SELECT id, content_hash, semantic_content_hash FROM ford.documents WHERE document_key = $1',
        [documentKey],
      );
      let documentId: string;
      let embeddingChanged = true;
      if (!existing.rowCount) {
        const inserted = await client.query<{id: string}>(
          `INSERT INTO ford.documents
             (page_id, document_key, document_type, section_key, chunk_index, title,
              content, content_hash, semantic_content, semantic_content_hash, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [
            pageId,
            documentKey,
            document.documentType,
            sectionKey,
            chunkIndex,
            document.title,
            document.content,
            contentHash,
            document.semanticContent ?? null,
            semanticContentHash,
            JSON.stringify(document.metadata),
          ],
        );
        documentId = inserted.rows[0].id;
      } else {
        documentId = existing.rows[0].id;
        const contentChanged = existing.rows[0].content_hash !== contentHash;
        embeddingChanged = existing.rows[0].semantic_content_hash !== semanticContentHash;
        if (contentChanged || embeddingChanged) {
          await client.query(
            `UPDATE ford.documents SET title = $2, content = $3, content_hash = $4,
             section_key = $5, chunk_index = $6, metadata = $7,
             semantic_content = $8, semantic_content_hash = $9, updated_at = now() WHERE id = $1`,
            [
              documentId,
              document.title,
              document.content,
              contentHash,
              sectionKey,
              chunkIndex,
              JSON.stringify(document.metadata),
              document.semanticContent ?? null,
              semanticContentHash,
            ],
          );
        }
      }
      if (!semanticContent) {
        await client.query(
          'DELETE FROM ford.document_embeddings WHERE document_id = $1',
          [documentId],
        );
      } else if (embeddingChanged) {
        await client.query(
          `INSERT INTO ford.document_embeddings (document_id, embedding_model, status, error)
           VALUES ($1, 'unconfigured', 'pending', NULL)
           ON CONFLICT (document_id) DO UPDATE SET status = 'pending', error = NULL, updated_at = now()`,
          [documentId],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertOfferDocument(
    ref: OfferRef,
    document: DocumentCandidate,
    pageId?: number,
  ): Promise<void> {
    const sectionKey = document.sectionKey ?? document.documentType;
    const chunkIndex = document.chunkIndex ?? 0;
    const documentKey = `offer:${ref.offerId}:${sectionKey}:${chunkIndex}`;
    const contentHash = hashDocument(document.content);
    const semanticContent = document.semanticContent === undefined
      ? document.content
      : document.semanticContent.trim();
    const semanticContentHash = hashDocument(semanticContent);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{
        id: string;
        content_hash: string;
        semantic_content_hash: string | null;
      }>(
        'SELECT id, content_hash, semantic_content_hash FROM ford.documents WHERE document_key = $1',
        [documentKey],
      );
      let documentId: string;
      let embeddingChanged = true;
      if (!existing.rowCount) {
        const inserted = await client.query<{id: string}>(
          `INSERT INTO ford.documents
             (model_id, model_year_id, variant_id, offer_id, page_id, document_key,
              document_type, section_key, chunk_index, title, content, content_hash,
              semantic_content, semantic_content_hash, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING id`,
          [
            ref.modelId ?? null,
            ref.modelYearId ?? null,
            ref.variantId ?? null,
            ref.offerId,
            pageId ?? null,
            documentKey,
            document.documentType,
            sectionKey,
            chunkIndex,
            document.title,
            document.content,
            contentHash,
            document.semanticContent ?? null,
            semanticContentHash,
            JSON.stringify(document.metadata),
          ],
        );
        documentId = inserted.rows[0].id;
      } else {
        documentId = existing.rows[0].id;
        const contentChanged = existing.rows[0].content_hash !== contentHash;
        embeddingChanged = existing.rows[0].semantic_content_hash !== semanticContentHash;
        if (contentChanged || embeddingChanged) {
          await client.query(
            `UPDATE ford.documents
             SET title = $2, content = $3, content_hash = $4, page_id = $5,
                 section_key = $6, chunk_index = $7, metadata = $8,
                 semantic_content = $9, semantic_content_hash = $10, updated_at = now()
             WHERE id = $1`,
            [
              documentId,
              document.title,
              document.content,
              contentHash,
              pageId ?? null,
              sectionKey,
              chunkIndex,
              JSON.stringify(document.metadata),
              document.semanticContent ?? null,
              semanticContentHash,
            ],
          );
        }
      }
      if (!semanticContent) {
        await client.query(
          'DELETE FROM ford.document_embeddings WHERE document_id = $1',
          [documentId],
        );
      } else if (embeddingChanged) {
        await client.query(
          `INSERT INTO ford.document_embeddings (document_id, embedding_model, status, error)
           VALUES ($1, 'unconfigured', 'pending', NULL)
           ON CONFLICT (document_id) DO UPDATE SET status = 'pending', error = NULL, updated_at = now()`,
          [documentId],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listPending(
    limit: number,
  ): Promise<Array<{documentId: string; content: string}>> {
    const result = await this.pool.query<{
      document_id: string;
      content: string;
    }>(
      `SELECT d.id AS document_id, coalesce(nullif(d.semantic_content, ''), d.content) AS content
       FROM ford.documents d
       LEFT JOIN ford.document_embeddings e ON e.document_id = d.id
       WHERE d.semantic_content IS NOT NULL AND d.semantic_content <> ''
         AND (e.document_id IS NULL OR e.status = 'pending')
       ORDER BY d.updated_at ASC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(row => ({
      documentId: row.document_id,
      content: row.content,
    }));
  }

  async saveReady(
    documentId: string,
    embedding: number[],
    model: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO ford.document_embeddings (document_id, embedding, embedding_model, status, error)
       VALUES ($1, $2::vector, $3, 'ready', NULL)
       ON CONFLICT (document_id) DO UPDATE SET embedding = EXCLUDED.embedding,
         embedding_model = EXCLUDED.embedding_model, status = 'ready', error = NULL, updated_at = now()`,
      [documentId, JSON.stringify(embedding), model],
    );
  }

  async markFailed(documentId: string, error: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ford.document_embeddings (document_id, embedding_model, status, error)
       VALUES ($1, 'unconfigured', 'failed', $2)
       ON CONFLICT (document_id) DO UPDATE SET status = 'failed', error = EXCLUDED.error, updated_at = now()`,
      [documentId, error],
    );
  }
}
