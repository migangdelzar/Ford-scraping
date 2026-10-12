WITH cleaned_pages AS (
  SELECT id,
         regexp_replace(
           raw_html,
           $pattern$((https?://[^"'<>[:space:]]+)?/[^"'<>[:space:]]*/(20[0-9]{2}|[0-9]{2})/Comparativo/[^"'<>?[:space:]]+/?)[?][^"'<>[:space:]]*$pattern$,
           '\1', 'gi'
         ) AS clean_html
  FROM ford.pages
  WHERE raw_html ~* '[?][^"''<>[:space:]]*(exterior|interior)='
    AND raw_html ~* '/(20[0-9]{2}|[0-9]{2})/Comparativo/'
)
UPDATE ford.pages page
SET raw_html = cleaned.clean_html,
    content_hash = encode(digest(cleaned.clean_html, 'sha256'), 'hex')
FROM cleaned_pages cleaned
WHERE page.id = cleaned.id;

UPDATE ford.documents
SET metadata = jsonb_set(
      metadata,
      '{sourceUrl}',
      to_jsonb(regexp_replace(metadata->>'sourceUrl', '[?].*$', '')),
      false
    )
WHERE metadata->>'sourceUrl' ~* '/(20[0-9]{2}|[0-9]{2})/Comparativo/[^/?#]+/?[?]'
  AND metadata->>'sourceUrl' ~* '[?&](exterior|interior)=';
