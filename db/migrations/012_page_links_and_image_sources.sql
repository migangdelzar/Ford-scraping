ALTER TABLE ford.images
  ADD COLUMN IF NOT EXISTS source_page_id BIGINT REFERENCES ford.pages(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS ford.page_links (
  id BIGSERIAL PRIMARY KEY,
  source_page_id BIGINT NOT NULL REFERENCES ford.pages(id) ON DELETE CASCADE,
  href TEXT NOT NULL,
  target_url TEXT NOT NULL,
  anchor_text TEXT NOT NULL DEFAULT '',
  rel TEXT,
  is_internal BOOLEAN NOT NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('internal', 'external', 'email', 'phone', 'other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_page_id, href, anchor_text)
);

CREATE INDEX IF NOT EXISTS page_links_source_page_idx
  ON ford.page_links(source_page_id, is_internal, link_type);
CREATE INDEX IF NOT EXISTS page_links_target_url_idx
  ON ford.page_links(target_url);
