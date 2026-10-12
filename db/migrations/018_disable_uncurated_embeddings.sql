UPDATE ford.documents
SET semantic_content = '', semantic_content_hash = ''
WHERE semantic_content IS NULL;

DELETE FROM ford.document_embeddings e
USING ford.documents d
WHERE d.id = e.document_id AND d.semantic_content = '';
