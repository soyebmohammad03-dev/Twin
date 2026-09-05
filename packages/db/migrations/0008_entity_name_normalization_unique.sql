-- Phase 7 entity resolution: real database-level duplicate protection,
-- not just an application-layer check-then-insert (which has a race
-- window under concurrent requests). Mirrors
-- apps/api/src/modules/graph/entityResolution.ts's normalizeEntityName
-- exactly — case, whitespace, and the specific punctuation classes
-- named in the phase brief (apostrophes/curly quotes, periods,
-- hyphens/dashes) are treated as the same name; nothing fuzzier than
-- that. Keep this function and the TypeScript version in sync if
-- either changes.
CREATE OR REPLACE FUNCTION normalize_entity_name(input text) RETURNS text AS $$
  SELECT trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(trim(input)), '[''‘’‚‛]', '', 'g'),
        '\.', '', 'g'
      ),
      '[-–—]', ' ', 'g'
    ),
    '\s+', ' ', 'g'
  ));
$$ LANGUAGE sql IMMUTABLE;

-- Partial (WHERE archived_at IS NULL): an archived entity's name must
-- not block creating a new active entity with the same name — archiving
-- is meant to retire a node, not permanently reserve its name.
CREATE UNIQUE INDEX IF NOT EXISTS entities_user_type_normalized_name_unique
  ON entities (user_id, entity_type, normalize_entity_name(name))
  WHERE archived_at IS NULL;
