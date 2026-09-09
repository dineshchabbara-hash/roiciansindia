-- Phase 5 schema-completion fix (not a new design decision): DATABASE_SCHEMA.md
-- §3 specifies student_code = nextval('student_id_seq') cast to text, assigned
-- once at insert. No mechanism existed to do this — only the immutability
-- trigger blocking later UPDATEs. PostgREST/supabase-js has no endpoint for a
-- bare nextval() call, so a column DEFAULT is the correct, minimal way to let
-- an insert that omits student_code get one assigned atomically by Postgres
-- itself, inside the same transaction as the insert. Does not touch the
-- existing student_id_seq (no reset/recreate/renumber) — it already starts at
-- 10001 (20260101000002_sequences.sql) and continues from its current state.
-- No RLS/grant change; fully backward-compatible (only affects future inserts
-- that omit student_code, which is every insert — the application never
-- supplies one).

alter table students
  alter column student_code set default nextval('student_id_seq')::text;
