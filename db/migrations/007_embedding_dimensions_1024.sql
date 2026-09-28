DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ford.document_embeddings
    WHERE embedding IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot change embedding dimensions while ready vectors exist; re-embed or clear them first';
  END IF;
END
$$;

DROP INDEX IF EXISTS ford.document_embeddings_hnsw_idx;

ALTER TABLE ford.document_embeddings
  ALTER COLUMN embedding TYPE vector(1024)
  USING NULL::vector(1024);

CREATE INDEX document_embeddings_hnsw_idx
  ON ford.document_embeddings USING hnsw (embedding vector_cosine_ops);
