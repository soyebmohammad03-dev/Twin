-- Phase 6 retrieval indexes. Hand-written (not drizzle-kit generated)
-- because drizzle's schema DSL doesn't model HNSW vector indexes or
-- functional/expression indexes.
--
-- HNSW over cosine distance: matches the `<=>` operator used by
-- semantic search (retrieval.service.ts). Built with pgvector's
-- defaults (m=16, ef_construction=64) — reasonable for a small/medium
-- per-user corpus; revisit if row counts grow large enough to matter.
-- Partial (WHERE embedding IS NOT NULL) since most existing rows have
-- no embedding yet and there is no value indexing NULLs.
CREATE INDEX IF NOT EXISTS memories_embedding_hnsw_cosine_idx
  ON memories USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- Lexical search signal (retrieval.service.ts's lexical component) —
-- GIN over an English tsvector expression, so ts_rank/@@ queries
-- against to_tsvector('english', content) can use an index instead of
-- scanning + computing to_tsvector per row.
CREATE INDEX IF NOT EXISTS memories_content_fts_idx
  ON memories USING gin (to_tsvector('english', content));
