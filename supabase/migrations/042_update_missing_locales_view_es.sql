-- Update contents_missing_locales view to include es (Spanish)
CREATE OR REPLACE VIEW contents_missing_locales AS
SELECT
  c.slug,
  array_agg(c.locale ORDER BY c.locale) AS existing_locales,
  ARRAY(
    SELECT l
    FROM unnest(ARRAY['en','ko','zh','ja','es']) AS l
    WHERE l NOT IN (SELECT locale FROM contents c2 WHERE c2.slug = c.slug AND c2.is_published = true)
  ) AS missing_locales
FROM contents c
WHERE c.is_published = true
GROUP BY c.slug
HAVING count(*) < 5;
