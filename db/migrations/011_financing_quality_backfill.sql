UPDATE ford.offers
SET offer_type = CASE
      WHEN coalesce(months_without_interest, 0) > 0 THEN 'months_without_interest'
      ELSE 'financing'
    END,
    metadata = metadata || jsonb_build_object(
      'termConflict',
      CASE
        WHEN (regexp_match(
          coalesce(metadata->>'sourcePlanName', ''),
          '(\d+)\s+meses?',
          'i'
        ))[1] IS NOT NULL
        AND term_months IS NOT NULL
        AND ((regexp_match(
          coalesce(metadata->>'sourcePlanName', ''),
          '(\d+)\s+meses?',
          'i'
        ))[1])::integer <> term_months
        THEN jsonb_build_object(
          'labelMonths', ((regexp_match(
            coalesce(metadata->>'sourcePlanName', ''),
            '(\d+)\s+meses?',
            'i'
          ))[1])::integer,
          'structuredMonths', term_months
        )
        ELSE NULL
      END
    ),
    updated_at = now()
WHERE metadata->>'extraction' = 'financing-api';

WITH refreshed AS (
  SELECT d.id,
         concat(
           replace(d.content, 'Tipo: promotion', concat('Tipo: ', o.offer_type)),
           CASE
             WHEN o.metadata->'termConflict' IS NOT NULL
                  AND o.metadata->'termConflict' <> 'null'::jsonb
             THEN concat(
               E'\nAdvertencia: el nombre del plan indica ',
               o.metadata->'termConflict'->>'labelMonths',
               ' meses, pero el plazo estructurado es ',
               o.metadata->'termConflict'->>'structuredMonths',
               ' meses. Confirmar con el distribuidor.'
             )
             ELSE ''
           END,
           CASE
             WHEN o.valid_from IS NULL AND o.valid_until IS NULL
                  AND position('Vigencia no indicada por la fuente' IN d.content) = 0
             THEN E'\nVigencia no indicada por la fuente; confirmar vigencia.'
             ELSE ''
           END
         ) AS content
  FROM ford.documents d
  JOIN ford.offers o ON o.id = d.offer_id
  WHERE o.metadata->>'extraction' = 'financing-api'
)
UPDATE ford.documents d
SET content = refreshed.content,
    content_hash = encode(digest(refreshed.content, 'sha256'), 'hex'),
    updated_at = now()
FROM refreshed
WHERE d.id = refreshed.id;

UPDATE ford.document_embeddings e
SET embedding = NULL,
    status = 'pending',
    error = NULL,
    updated_at = now()
FROM ford.documents d
JOIN ford.offers o ON o.id = d.offer_id
WHERE e.document_id = d.id
  AND o.metadata->>'extraction' = 'financing-api';
