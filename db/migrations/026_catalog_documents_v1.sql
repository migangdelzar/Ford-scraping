CREATE OR REPLACE VIEW ford_read.catalog_documents_v1
WITH (security_barrier = true)
AS
SELECT d.id AS document_id,
       d.document_key AS document_key,
       d.model_id AS model_id,
       d.model_year_id AS model_year_id,
       d.variant_id AS variant_id,
       d.offer_id AS offer_id,
       d.document_type AS document_type,
       d.title AS title,
       coalesce(nullif(btrim(d.semantic_content), ''), d.content) AS semantic_content,
       d.search_vector AS search_vector,
       e.embedding AS embedding,
       e.embedding_model AS embedding_model,
       e.status AS embedding_status,
       source.url AS source_url,
       source.crawled_at AS observed_at
FROM ford.documents AS d
LEFT JOIN ford.document_embeddings AS e ON e.document_id = d.id
JOIN ford.pages AS source ON source.id = d.page_id
WHERE btrim(coalesce(nullif(btrim(d.semantic_content), ''), d.content)) <> ''
  AND source.url IS NOT NULL
  AND source.crawled_at IS NOT NULL;

COMMENT ON VIEW ford_read.catalog_documents_v1 IS
  'Versioned source-backed catalog document, search-vector, and optional embedding evidence for read-only retrieval.';
