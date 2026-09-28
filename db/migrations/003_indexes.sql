CREATE INDEX IF NOT EXISTS pages_page_type_idx ON ford.pages(page_type);
CREATE INDEX IF NOT EXISTS pages_content_hash_idx ON ford.pages(content_hash);
CREATE INDEX IF NOT EXISTS models_name_trgm_idx ON ford.models USING gin (normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS model_years_year_idx ON ford.model_years(model_year);
CREATE INDEX IF NOT EXISTS model_years_price_idx ON ford.model_years(starting_price);
CREATE INDEX IF NOT EXISTS specifications_variant_idx ON ford.specifications(variant_id);
CREATE INDEX IF NOT EXISTS specifications_name_idx ON ford.specifications(normalized_name);
CREATE INDEX IF NOT EXISTS documents_search_vector_idx ON ford.documents USING gin(search_vector);
CREATE INDEX IF NOT EXISTS document_embeddings_hnsw_idx
  ON ford.document_embeddings USING hnsw (embedding vector_cosine_ops);
