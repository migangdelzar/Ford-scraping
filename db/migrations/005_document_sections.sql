ALTER TABLE ford.documents
  ADD COLUMN IF NOT EXISTS section_key TEXT NOT NULL DEFAULT 'default';

ALTER TABLE ford.documents
  ADD COLUMN IF NOT EXISTS chunk_index INTEGER NOT NULL DEFAULT 0;

UPDATE ford.documents
SET section_key = document_type
WHERE section_key = 'default';

UPDATE ford.documents
SET document_key = model_year_id::text || ':' || document_type || ':' || document_type || ':0'
WHERE model_year_id IS NOT NULL
  AND document_key = model_year_id::text || ':' || document_type;

UPDATE ford.documents
SET document_key = 'page:' || page_id::text || ':' || document_type || ':' || document_type || ':0'
WHERE page_id IS NOT NULL
  AND model_year_id IS NULL
  AND document_key = 'page:' || page_id::text || ':' || document_type;

ALTER TABLE ford.documents
  ADD CONSTRAINT documents_chunk_index_nonnegative CHECK (chunk_index >= 0);
