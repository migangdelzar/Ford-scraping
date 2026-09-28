ALTER TABLE ford.documents ADD COLUMN IF NOT EXISTS document_key TEXT;

UPDATE ford.documents
SET document_key = id::text
WHERE document_key IS NULL;

ALTER TABLE ford.documents ALTER COLUMN document_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS documents_document_key_idx
  ON ford.documents(document_key);
