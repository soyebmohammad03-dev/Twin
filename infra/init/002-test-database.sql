-- A separate database for the API's integration tests, so test runs
-- never touch dev data. Only takes effect on a fresh volume (Postgres
-- init scripts run once, when the data directory is first created) —
-- see README.md for how to create it manually against an existing
-- container.
CREATE DATABASE twin_test;
\c twin_test
CREATE EXTENSION IF NOT EXISTS vector;
