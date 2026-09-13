-- Phase 9 schema-completion fix (not a new design decision): DATABASE_SCHEMA.md
-- §3 specifies enrollment_code = 'ENR-' || nextval('enrollment_id_seq') zero-
-- padded to 6 digits, assigned once at insert. No mechanism existed to do
-- this — only the immutability trigger blocking later UPDATEs (the exact same
-- schema-completion gap already fixed for students.student_code in
-- 20260101000019). A column DEFAULT is the correct, minimal way to let an
-- insert that omits enrollment_code get one assigned atomically by Postgres
-- itself, inside the same transaction as the insert.
--
-- Does not touch the existing enrollment_id_seq (no reset/recreate/renumber)
-- — it already starts at 1 (20260101000002_sequences.sql) and continues from
-- its current state; sequence gaps remain valid. No RLS/grant change; fully
-- backward-compatible (only affects future inserts that omit enrollment_code,
-- which is every application insert — nothing generates one in the browser).
-- No existing row is modified. The immutability trigger
-- (prevent_enrollment_code_change) is untouched and still applies.
--
-- A direct expression is used rather than a helper function — nothing here
-- needs SECURITY DEFINER or its own grant surface, so a function would only
-- add an object to maintain for no safety benefit.

alter table enrollments
  alter column enrollment_code
  set default ('ENR-' || lpad(nextval('public.enrollment_id_seq')::text, 6, '0'));
