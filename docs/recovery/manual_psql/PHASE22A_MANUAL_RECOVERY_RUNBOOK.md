# Phase 22A: manual DEV recovery runbook (Windows PowerShell + psql)

- **Target:** Supabase project **Roicians India LMS Dev** (`nqeaehqzhjhhgsilrgeo`) only.
- **Reviewed commit:** `56c73406c1c4bf506d71d677b1f16f8787672c6a`
- **Recovery file:** `docs/recovery/phase22a_dev_recovery.sql`, SHA-256 `018f460fabad4d5d273035b295185a53827f5e6089161892f164470d6b21a562`

Steps A, B, C and E are **read-only**. Step D is the only write, and it is
**not authorized** until you approve it.

Never type or paste the database password into a command, a connection
string, a file or this conversation. Type it only at psql's own
`Password for user …:` prompt.

---

## Files

| File | Where to get it | SHA-256 |
|---|---|---|
| `phase22a_dev_recovery.sql` | Commit-pinned raw link (step A1); also attached | `018f460fabad4d5d273035b295185a53827f5e6089161892f164470d6b21a562` |
| `phase22a_B_identity_check.sql` | Attached | `e866df9fe1e5844334a4a4a1b2f826d7af2b82c0b97f04934efd8e1362c6b171` |
| `phase22a_C_preflight_check.sql` | Attached | `aa1aae6c2aba0d32625408a7586b80985c0f6497b1b0f1f868e27f7ff1a08b01` |
| `phase22a_E_post_recovery_check.sql` | Attached | `57759caa2e12e1f0b2cd849b68fc335303161455ced3bcef417e1e3bb1225f64` |

**How the check scripts work**
- B, C and E each run inside `BEGIN TRANSACTION … READ ONLY` and end with `ROLLBACK`, so they cannot change the database.
- They are not in the repository, because no commits were authorized.
- Their fingerprint queries were copied byte-for-byte from the reviewed recovery file.
- They were tested on disposable local PostgreSQL 17.6 databases (never DEV) in three states:
  - **Pre-recovery copy:** C passes every schema and history check.
  - **Recovered copy:** E passes every schema and history check.
  - **Wrong state:** both refuse.
  - The only expected local failures were the cluster identity and the existing-data baseline, because the local test data differs from DEV.

Do **not** open and re-save any of these files in an editor. Editors can change
line endings or add a byte-order mark, which changes the checksum.

---

## Step 0: Prerequisite checks (non-writing)

Open a **new** PowerShell window and use it for every step.

```powershell
$PSVersionTable.PSVersion
Get-Command psql -All -ErrorAction SilentlyContinue | Format-List Source, Version
Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue | Select-Object FullName
```

**If psql was found**, pin its full path and print its version:

```powershell
$Psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'   # <- use the FullName printed above
& $Psql --version
```

Version 16 or 17 is suitable. The rehearsal ran psql 16.13 against PostgreSQL 17.6, and DEV runs PostgreSQL 17.6.

**If psql is missing:** install the PostgreSQL client tools yourself, after review.
1. Use the official page <https://www.postgresql.org/download/windows/>, which links to the EDB installer.
2. In the component selection, choose only **Command Line Tools**. Clear Server, pgAdmin and Stack Builder.
3. After installing, set `$Psql` to the installed `...\bin\psql.exe` path, as above.

I could not open postgresql.org from my sandbox, so check the current wording on that page yourself.

**Check for psql settings that could change behaviour.** This prints variable **names only**, never values:

```powershell
Get-ChildItem Env: | Where-Object Name -like 'PG*' | Select-Object Name
Test-Path Env:PSQLRC
```

Step B sets the `PG*` variables it needs. If `PGOPTIONS`, `PGSERVICE`,
`PGTZ` or `PGDATESTYLE` exist, clear them **for this window only**:

```powershell
Remove-Item Env:PGOPTIONS, Env:PGSERVICE, Env:PGTZ, Env:PGDATESTYLE -ErrorAction SilentlyContinue
```

`PSQLRC` and `%APPDATA%\postgresql\psqlrc.conf` are ignored anyway, because every command below uses `-X`.

---

## Step A: Local files and checksums

**A1. Create a working folder and download the recovery file from the pinned commit.**
The repository is public, so this needs no token. The link is pinned to the
commit, so it cannot change.

```powershell
$Dir = Join-Path $HOME 'phase22a'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$Url = 'https://raw.githubusercontent.com/dineshchabbara-hash/roiciansindia/56c73406c1c4bf506d71d677b1f16f8787672c6a/docs/recovery/phase22a_dev_recovery.sql'
Invoke-WebRequest -Uri $Url -OutFile (Join-Path $Dir 'phase22a_dev_recovery.sql') -UseBasicParsing
```

If the download fails, use the attached copy of `phase22a_dev_recovery.sql`.
Either way, the checksum in A3 decides whether the file can be used.

**A2. Save the three attached check scripts into the same folder (`$Dir`).**

**A3. Verify every file. Any mismatch stops the process.**

```powershell
$Expected = [ordered]@{
  'phase22a_dev_recovery.sql'          = '018f460fabad4d5d273035b295185a53827f5e6089161892f164470d6b21a562'
  'phase22a_B_identity_check.sql'      = 'e866df9fe1e5844334a4a4a1b2f826d7af2b82c0b97f04934efd8e1362c6b171'
  'phase22a_C_preflight_check.sql'     = 'aa1aae6c2aba0d32625408a7586b80985c0f6497b1b0f1f868e27f7ff1a08b01'
  'phase22a_E_post_recovery_check.sql' = '57759caa2e12e1f0b2cd849b68fc335303161455ced3bcef417e1e3bb1225f64'
}
foreach ($Name in $Expected.Keys) {
  $Path = Join-Path $Dir $Name
  if (-not (Test-Path -LiteralPath $Path)) { throw "MISSING: $Name - STOP." }
  $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected[$Name]) { throw "CHECKSUM MISMATCH: $Name is $Actual - STOP. Do not edit or normalise the file." }
  "OK  $Name  $Actual"
}
(Get-Item (Join-Path $Dir 'phase22a_dev_recovery.sql')).Length   # must be 58190
```

**Pass:** four `OK` lines and `58190`. Any `MISSING` or `CHECKSUM MISMATCH` means stop.
Don't edit the file to make it match.

---

## Connection setup (no secrets)

Supabase's documentation describes two options:
- **Direct connection** is recommended for migrations and single sessions, but it is IPv6-only unless the project has the IPv4 add-on.
- **Session pooler** (Supavisor, port 5432) is the alternative from IPv4-only networks.

Don't use the transaction pooler (port 6543).

**1. Find the connection details for the correct project.**
- In the Supabase Dashboard, open **Roicians India LMS Dev**.
- Check that the browser address contains `nqeaehqzhjhhgsilrgeo`.
- Click **Connect** at the top of the page.
- Note the **host, port, database and user** of the **Direct connection**. Write these four values down, not the password.

**2. Check whether that host is reachable from your network (non-writing):**

```powershell
Test-NetConnection -ComputerName '<direct host from the Connect panel>' -Port 5432
```

If `TcpTestSucceeded` is `True`, use the Direct connection. Otherwise, go back
to **Connect**, choose **Session pooler**, and use its host, port (5432) and
user. The pooler user has the form `postgres.<project-ref>`.

**3. Download the server root certificate.**
In the Dashboard, go to **Database Settings → SSL Configuration → Download certificate**,
and save it into `$Dir`. It is a public CA certificate, not a secret.

**4. Set the session variables.** None of these are secret, and they last only for this window:

```powershell
$env:PGHOST           = '<host from the Connect panel>'
$env:PGPORT           = '5432'
$env:PGDATABASE       = 'postgres'
$env:PGUSER           = '<user from the Connect panel>'
$env:PGSSLMODE        = 'verify-full'                      # encrypted + CA + hostname verified
$env:PGSSLROOTCERT    = (Join-Path $Dir '<downloaded certificate file name>')
$env:PGCLIENTENCODING = 'UTF8'                             # the file is UTF-8
$env:PGAPPNAME        = 'phase22a_manual_recovery'         # identifies the session in pg_stat_activity
```

**Rules for the connection:**
- Leave `PGPASSWORD` unset and never put the password in a URL. psql will prompt, and that typed input is not saved in PowerShell history.
- Never lower `sslmode` below `verify-full`. If verification fails, stop and report.

---

## Step B: Connection and DEV identity check (read-only)

```powershell
& $Psql -X -v ON_ERROR_STOP=1 -P pager=off -f (Join-Path $Dir 'phase22a_B_identity_check.sql') -L (Join-Path $Dir 'B_identity.log')
"psql exit code: $LASTEXITCODE"
```

**Pass when all of these hold:**
- `\conninfo` shows the expected host and user, and an **SSL connection** with a TLS protocol.
- Rows 1–7 all say `PASS`: cluster `7678069749886157684`, database `postgres`, version 17, user `postgres`, read-only, UTF8.
- Row 999 says `ALL CHECKS PASS`.
- Exit code is 0.

The informational `pg_stat_ssl` row may show the pooler-to-database link when you use the Session pooler.

**Anything else means stop.**

---

## Step C: Fresh preflight and existing-data baseline (read-only)

Run this immediately before D, in the same window.

```powershell
& $Psql -X -v ON_ERROR_STOP=1 -P pager=off -f (Join-Path $Dir 'phase22a_C_preflight_check.sql') -L (Join-Path $Dir 'C_preflight.log')
"psql exit code: $LASTEXITCODE"
```

**Pass when all 30 rows say `PASS`, row 999 says `ALL CHECKS PASS`, and the exit code is 0.** The checks are:

- **Identity:** same as B.
- **History:** 39 rows, fingerprint `7ee3ee94…`, nothing for 40–42.
- **Schema state:** the 10-line partial migration-40 fingerprint (shown as `md5:2ab242ec664dbd329ea1c26a0f9eb58a`), plus every other recovery precondition.
- **No prior Phase 22A use:** website tables and bucket empty, no Phase 22A audit rows.
- **Quiet:** no other active client sessions, advisory locks, or locks on migration history.
- **Business-data baseline:** row count and row hash per table, captured read-only today.

| Table | Rows | Hash |
|---|---|---|
| programs | 2 | `c1834eb9…` |
| program_modules | 0 | — |
| batches | 3 | `5e3e0131…` |
| enrollments | 11 | `460f5386…` |
| students | 11 | `a464f8b8…` |
| payments | 0 | — |
| certificates | 0 | — |
| audit_logs | 185 | `89e62499…` |

**Any `FAIL` means stop.** Send me the output; I will investigate read-only.
- A "quiet" row can fail on a momentary platform query. You may re-run C once.
- Never relax a check.

---

## Step D: The one-time recovery execution

> ## ⛔ DO NOT RUN UNTIL THE OWNER EXPLICITLY APPROVES THIS HANDOFF.

**Before you run it, all of these must be true:**
- A passed: the file's SHA-256 is `018f460f…a562`.
- B passed.
- C passed, a few minutes ago, in this same window.
- No one else is using DEV.

```powershell
& $Psql -X -v ON_ERROR_STOP=1 -b -P pager=off -f (Join-Path $Dir 'phase22a_dev_recovery.sql') -L (Join-Path $Dir 'D_recovery.log')
$RecoveryExit = $LASTEXITCODE
"psql exit code: $RecoveryExit"
```

**Why these exact options:**

| Option | Effect |
|---|---|
| `-f <verified file>` | Runs the file unchanged. Its own `begin; … commit;` is the single transaction. |
| `-v ON_ERROR_STOP=1` | Stops at the first SQL error. The open transaction is then never committed: the server rolls it back. |
| `-X` | Doesn't load any psqlrc startup commands. |
| `-b` | Echoes the failing statement if there is an error. |
| `-L` | Keeps a log of the session. |
| (no `-1` / `--single-transaction`) | That flag would wrap the file's own BEGIN/COMMIT in a second transaction, so it is deliberately left out. |
| (no history command) | The file itself writes the three history rows 40–42, after its postconditions pass. Nothing else touches migration history: no `db push`, `repair` or `reset`. |
| (no retry) | Run it **once**. Never re-run it, even after an error. |

**Expected success:**
- The output ends with `INSERT 0 3`, `DO`, `COMMIT`.
- The exit code is **0**.

The tested exit codes and what to do next:

| Exit code | Meaning | Next step |
|---|---|---|
| **0** with final `COMMIT` | Committed | Go to E |
| **3** | A check in the script refused, or SQL failed, so nothing was committed (exit code 3 was confirmed in a local test). | Do **not** re-run. Run C (read-only) and send me C plus the end of `D_recovery.log`. |
| **2**, **1**, a closed window, a hang, or a network drop | **Outcome unknown.** Don't assume a rollback. | Do **not** re-run. Open a new window, redo the connection setup, run **E and C** (read-only), and send me both outputs. |

**If it seems slow,** don't press Ctrl+C. The script limits itself to a 10-second wait for locks and 5 minutes per statement. If there is still no result after 10 minutes, follow the "outcome unknown" row.

---

## Step E: Post-recovery verification (read-only)

```powershell
& $Psql -X -v ON_ERROR_STOP=1 -P pager=off -f (Join-Path $Dir 'phase22a_E_post_recovery_check.sql') -L (Join-Path $Dir 'E_post_recovery.log')
"psql exit code: $LASTEXITCODE"
```

**Pass when all 36 rows say `PASS`, row 999 says `ALL CHECKS PASS`, and the exit code is 0.** The checks are:

- **History:** 42 rows, fingerprint `bf94f88d…`, versions and names 40–42, and provenance that records each migration's SHA-256.
- **Schema:** the 15-line final fingerprint equals a clean install of migrations 1–42.
- **Delete safeguards:** the discard function is present with its grants, and the corrected guard checks the function owner and the marker. The old policy `programs_delete_admin` is gone, and anon/authenticated have no direct Program DELETE.
- **Guard and evidence triggers:** all 5 are enabled, and none of the 17 internal helpers is executable by anon, authenticated or service_role.
- **Website content:** both page kinds are present; website tables are empty with RLS on; the bucket is private and empty; no Phase 22A audit rows were written.
- **Unchanged data:** quiet, and every business table and the audit history match the baseline.

Don't run `docs/recovery/phase22a_dev_post_recovery_verification.sql`. That
functional verification needs separate approval.

---

## What to send back (no secrets)

1. The A3 output.
2. The full output of B and C.
3. The D exit code and the last ~20 lines of `D_recovery.log`, if D was approved and run.
4. The full output of E.

These outputs contain hosts, users and check results, never the password.

## Unresolved risks and prerequisites

1. **Earlier connector requests: state unknown.**
   - Whether the 2026-10-20 15:15:24Z `execute_sql` request, or earlier superseded requests, still sit anywhere upstream can't be observed.
   - Its database effect was checked read-only: nothing committed, and nothing running at 15:19Z.
   - Protection:
     - The recovery file refuses unless DEV is exactly in the reviewed pre-state.
     - It takes an advisory lock and a NOWAIT lock on migration history.
     - C runs immediately before D.
     - A repeated or late run of the recovery refuses; this was rehearsed.
   - Not covered: a late execution of an *older, superseded* script after D. E would detect the drift, so re-run E (read-only) again later, for example the next day.
2. **Connector timeout cause is unconfirmed.** The missing confirmation-form theory is not established. The support summary is attached.
3. **Baseline hashes** depend on how rows are rendered as text. The check scripts pin the settings DEV used (UTC, ISO date style, `extra_float_digits=0`, hex bytea). If counts match but a hash differs, stop and report; I will investigate read-only.
4. **Network:**
   - The direct host may be unreachable over IPv4; use the Session pooler in that case.
   - If the project has network restrictions, your IP must be allowed. I did not check this.
5. **Database password:** if you don't know it, resetting it in the Dashboard is a configuration change. It also invalidates any other place that stores the old password, such as a `SUPABASE_DB_URL`. That is your decision; it is not part of this runbook.
6. **Quiet window:** C's activity checks see only the moment they run. Keep DEV unused from C until E.
