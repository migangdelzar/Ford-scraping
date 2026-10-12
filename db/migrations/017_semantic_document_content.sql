ALTER TABLE ford.documents
  ADD COLUMN IF NOT EXISTS semantic_content TEXT,
  ADD COLUMN IF NOT EXISTS semantic_content_hash TEXT;

UPDATE ford.documents
SET semantic_content_hash = content_hash
WHERE semantic_content_hash IS NULL;
