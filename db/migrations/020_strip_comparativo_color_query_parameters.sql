DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT regexp_replace(url, '[?].*$', '') AS clean_url, count(*) AS total
      FROM ford.pages
      WHERE url ~* '/(20[0-9]{2}|[0-9]{2})/Comparativo/[^/?#]+/?[?]'
        AND url ~* '[?&](exterior|interior)='
      GROUP BY 1
    ) dirty
    WHERE dirty.total > 1
       OR EXISTS (SELECT 1 FROM ford.pages clean WHERE clean.url = dirty.clean_url)
  ) THEN
    RAISE EXCEPTION 'Comparativo page URL cleanup would violate ford.pages.url uniqueness';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ford.page_links dirty
    JOIN ford.page_links clean
      ON clean.source_page_id = dirty.source_page_id
     AND clean.href = regexp_replace(dirty.href, '[?].*$', '')
     AND clean.anchor_text = dirty.anchor_text
    WHERE dirty.href ~* '/(20[0-9]{2}|[0-9]{2})/Comparativo/[^/?#]+/?[?]'
      AND dirty.href ~* '[?&](exterior|interior)='
  ) THEN
    RAISE EXCEPTION 'Comparativo page-link cleanup would violate ford.page_links uniqueness';
  END IF;
END $$;

UPDATE ford.pages
SET url = regexp_replace(url, '[?].*$', ''),
    canonical_url = CASE
      WHEN canonical_url ~* '/(20[0-9]{2}|[0-9]{2})/Comparativo/[^/?#]+/?[?]'
       AND canonical_url ~* '[?&](exterior|interior)='
      THEN regexp_replace(canonical_url, '[?].*$', '')
      ELSE canonical_url
    END
WHERE url ~* '/(20[0-9]{2}|[0-9]{2})/Comparativo/[^/?#]+/?[?]'
  AND url ~* '[?&](exterior|interior)=';

UPDATE ford.page_links
SET href = CASE
      WHEN href ~* '/(20[0-9]{2}|[0-9]{2})/Comparativo/[^/?#]+/?[?]'
       AND href ~* '[?&](exterior|interior)='
      THEN regexp_replace(href, '[?].*$', '')
      ELSE href
    END,
    target_url = CASE
      WHEN target_url ~* '/(20[0-9]{2}|[0-9]{2})/Comparativo/[^/?#]+/?[?]'
       AND target_url ~* '[?&](exterior|interior)='
      THEN regexp_replace(target_url, '[?].*$', '')
      ELSE target_url
    END
WHERE (href ~* '/(20[0-9]{2}|[0-9]{2})/Comparativo/[^/?#]+/?[?]'
       AND href ~* '[?&](exterior|interior)=')
   OR (target_url ~* '/(20[0-9]{2}|[0-9]{2})/Comparativo/[^/?#]+/?[?]'
       AND target_url ~* '[?&](exterior|interior)=');
