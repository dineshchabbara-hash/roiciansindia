-- Human-readable ID sequences (DATABASE_SCHEMA.md §3 "ID Strategy").
-- Postgres sequences are atomic under concurrency, which is what makes
-- Student ID / Enrollment ID / Payment ID / Receipt / Certificate numbering
-- concurrency-safe (REQUIREMENTS.md §92/§93) without any application-level
-- locking. Numbers are minted inside the same transaction as the owning row
-- insert (see the trigger functions below and the domain layer built in
-- later phases).

-- Student ID starts at 10001 per REQUIREMENTS.md §7 / brief §7.
create sequence if not exists student_id_seq
  start with 10001
  increment by 1;

create sequence if not exists enrollment_id_seq
  start with 1
  increment by 1;

create sequence if not exists payment_id_seq
  start with 1
  increment by 1;

-- Receipt/certificate numbers are formatted as PREFIX-YEAR-000001 by the
-- application layer (format itself configurable in company_settings), but
-- the underlying numeric sequence is global and monotonic — never reset by
-- calendar year at the database level, since sequence "resets" are an
-- application-layer formatting/reporting concern, not a storage concern.
-- (If the resolved answer to DECISIONS_NEEDED.md D7 requires numbers to
-- restart each year, that is implemented by including the year in the
-- sequence name or in a composite key at that time — deferred until D7 is
-- confirmed, since either choice is a compatible evolution of this
-- migration.)
create sequence if not exists receipt_number_seq
  start with 1
  increment by 1;

create sequence if not exists certificate_number_seq
  start with 1
  increment by 1;
