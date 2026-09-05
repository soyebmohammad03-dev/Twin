-- Enables the pgvector extension so it is available from day one.
-- No vector columns are defined yet (Phase 1 does not implement
-- semantic retrieval) — this only makes the extension ready for when
-- Phase 2 introduces embedding columns.
CREATE EXTENSION IF NOT EXISTS vector;
