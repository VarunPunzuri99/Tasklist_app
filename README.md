# Task List

A single-user task list with sign-in, soft delete, search, and a server-side CSV import. Each account's rows are isolated by PostgreSQL row-level security.

## Features

- Email and password sign-up, sign-in, and sign-out.
- Create, edit, complete, reopen, and soft-delete tasks.
- Search title and notes, and filter by status, priority, and due date.
- CSV import with quoted fields, Windows line endings, row-level rejection reasons, and a downloadable rejection file.
- Accepted rows are inserted in one Postgres function. A failure rolls the batch back.
- Unit tests for validation and a database test that runs the migration and the RLS policies.

## Technology stack

- TypeScript, React 19, Next.js 16 App Router, Node.js 22
- Tailwind CSS 4
- Supabase Auth and Postgres, using `@supabase/ssr` and `@supabase/supabase-js`
- Zod and React Hook Form
- `csv-parse` and `csv-stringify`
- Vitest, with PGlite for the database tests
- npm

The app does not use a second backend, mock data, or the Supabase service-role key.

## Architecture and request flow

```text
Browser form or CSV upload
  -> src/proxy.ts refreshes and verifies the session cookie
  -> route handler in src/app/api/tasks
  -> Zod validation and CSV planning
  -> Supabase client, using the signed-in user
  -> PostgreSQL RLS and import_tasks()
```

| Path | Role |
| --- | --- |
| `src/app/` | Pages and route handlers |
| `src/components/` | Forms, task list, and import panel |
| `src/lib/supabase/` | Browser client, server client, env check |
| `src/lib/tasks/` | Schemas, dates, duplicate keys |
| `src/lib/csv/` | Parse, validate, and build the rejection file |
| `supabase/migrations/` | Schema, indexes, policies, and functions |
| `tests/unit/` | Parser, duplicates, HTTP behavior with a mocked client |
| `tests/integration/` | Real RLS and import behavior on PGlite |
| `tests/fixtures/` | CSV files used by the tests and the demo |

Server components decide whether a page can render. Client components own the forms and filters. There is no extra client state library.

## Database schema

`public.tasks`

| Column | Rules |
| --- | --- |
| `id` | UUID primary key |
| `user_id` | UUID, required, defaults to `auth.uid()`, references `auth.users(id)` |
| `title` | Required text, 1–200 characters after trim |
| `notes` | Optional text, at most 5,000 characters |
| `due_date` | Required `date` |
| `priority` | Integer 1 through 5 |
| `status` | `pending` or `completed` |
| `created_at`, `updated_at` | Timestamps |
| `deleted_at` | Null until the task is soft-deleted |

Indexes support the active list, status, priority, due date, and a partial unique index on `(user_id, normalize_task_title(title), due_date)` where `deleted_at` is null.

## PostgreSQL RLS and tenant isolation

RLS is required even though the route handlers check the session. The browser has the publishable key, so someone can call Supabase without going through these routes. The policies still allow only `user_id = auth.uid()`.

`SELECT` allows an owner to read their own rows, including soft-deleted ones. PostgreSQL also applies `SELECT` policies to the new version of an updated row. Hiding deleted rows in that policy would make the soft-delete update fail. The normal list uses `list_my_tasks`, which skips deleted rows. Another user still cannot read them.

`INSERT` requires the new row's `user_id` to be `auth.uid()`. `UPDATE` can change only the caller's active rows and cannot move a row to someone else. `DELETE` is limited to the caller, and a trigger rejects the physical delete. The API sets `deleted_at` instead.

`import_tasks` and `list_my_tasks` are `SECURITY INVOKER` with a fixed search path. They call `auth.uid()` and do not accept an owner id.

## CSV validation and duplicate detection

Required headers, in any order: `title,due_date,priority,notes`.

- Missing, duplicate, or unexpected headers reject the file.
- A data row is validated on the server even if the browser checked it.
- Title is required after trim and must be at most 200 characters.
- `due_date` must be a real `YYYY-MM-DD` date. `2026-02-30` and `2026-13-01` are rejected. The check does not keep JavaScript's normalized date.
- Priority must be the whole number 1, 2, 3, 4, or 5. `high`, `1.5`, `0`, and `6` are rejected.
- Notes are optional and may contain commas inside quotes.
- A fully blank row is rejected with `Blank row`.
- One bad row does not stop the other rows.
- Limits: 1 MB (`1048576` bytes) and 1,000 data rows.

`row_number` is the 1-based physical line where the CSV record ends. For a normal one-line record this is the spreadsheet row, including the header. A quoted field that spans several lines uses the last line of that record.

Duplicate key: trim spaces, tabs, and line breaks around the title, lowercase ASCII `A-Z`, and compare the exact date. The same rule is `public.normalize_task_title`. Soft-deleted tasks are ignored.

- The first valid copy in the file is accepted.
- A later copy is `Duplicate title and due date in CSV`.
- A copy of an active account task is `Task already exists in account`.
- The same title with another date, or another title on the same date, is kept.

## Transaction strategy

The parser builds the accepted list before any insert. Only that list is sent to `import_tasks(jsonb)`. The function locks the user with `pg_advisory_xact_lock`, checks duplicates again, and inserts all of the rows. If a duplicate or another database error is raised, Postgres rolls back the function and the API returns an error with `importedCount: 0`. Parser rejections are still returned so they can be downloaded. They were never part of the transaction.

## Environment setup

Create a free [Supabase](https://supabase.com) project. In Project Settings → API, copy the project URL and the publishable or anon key. Do not copy the service-role key.

```bash
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

`.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

The code also accepts `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as an alias for the same public key. `.env.example` uses the anon-key name.

In Authentication → URL configuration:

- Site URL: `http://localhost:3000`
- Redirect URL: `http://localhost:3000/auth/callback`

For a short demo, turn off "Confirm email" under Authentication → Providers → Email. If you leave it on, open the confirmation link before signing in. The link returns through `/auth/callback`.

Create two users from the sign-up page when you want to show isolation by hand. The automated RLS test creates its own users inside PGlite and does not need those accounts.

## Database migration

Run the SQL in `supabase/migrations/20261022120000_tasks.sql` on a clean database.

Supabase Dashboard → SQL Editor → paste the file → Run.

Or, with a direct Postgres connection string (this can be the Supabase pooler or direct connection, or local PostgreSQL):

```bash
# PowerShell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST:5432/postgres"
npm run db:migrate
```

The migration creates `authenticated` and a local `auth.uid()` only when they are missing, so it can run on Supabase and on plain PostgreSQL. Re-running it replaces functions and policies. `CREATE TABLE IF NOT EXISTS` will not change a table that already has a different shape. Use a clean database if the first run failed halfway.

Local PostgreSQL 17 is enough for the migration. Hosted Supabase is required for the app's sign-in. No paid plan is required.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

`.npmrc` sets `legacy-peer-deps=true` because `@hookform/resolvers` declares optional peers that conflict with each other. The app only uses its Zod resolver.

## Tests

```bash
npm test
```

This runs the unit tests and the PGlite integration tests. PGlite is PostgreSQL compiled for the process. The integration test applies the real migration, uses two user ids, switches to the `authenticated` role, and checks the policies. It is not a mocked Supabase response.

If PGlite cannot start, that test fails. It is not skipped.

`tests/unit/api.test.ts` mocks the server client. Those assertions are about HTTP responses, not RLS.

A two-session race is not part of `npm test` because PGlite has one connection. The unique index and advisory lock are still in the migration. To watch a real race you would need two sessions on a Postgres server.

## Database integration test prerequisites

- Node.js 22 and `npm install`
- No `DATABASE_URL` and no Docker are required for `npm test`
- Optional: `DATABASE_URL` and `npm run db:migrate` when you want the same SQL on Supabase or local PostgreSQL 17

This workspace had PostgreSQL 17 running, but the server asked for a password that was not available. The verified RLS run used PGlite instead. Do not describe that as a test against the local server.

## Build and lint

```bash
npm run lint
npm run typecheck
npm run build
npm start
```

Create `.env.local` before `npm run build`. Next.js includes `NEXT_PUBLIC_` values in the build. A build without them always shows the setup screen until you build again.

## Example CSV

```csv
title,due_date,priority,notes
Submit timesheet,2026-11-02,2,Weekly hours
Review payroll,2026-11-03,3,"Review payroll, then notify the manager"
```

The demo file is `tests/fixtures/import-edge-cases.csv` and is also served at `/samples/import-edge-cases.csv`. `tests/fixtures/account-duplicate.csv` contains only the account-duplicate row.

## Edge-case demonstration

1. Sign in.
2. Create a task titled `Existing roadmap review` with due date `2026-10-01`.
3. Import `tests/fixtures/import-edge-cases.csv`.

| Row | Data | Result |
| --- | --- | --- |
| 2 | Submit timesheet, 2026-11-02, priority 2 | Imported |
| 3 | Review payroll, notes contain a comma | Imported |
| 4 | Same title and date as row 2 | `Duplicate title and due date in CSV` |
| 5 | Blank line | `Blank row` |
| 6 | Priority `high` | `Priority must be a whole number from 1 to 5.` |
| 7 | Title of 201 characters | `Title must be 200 characters or fewer.` |
| 8 | `2026-02-30` | `Due date must be a real calendar date in YYYY-MM-DD format.` |
| 9 | Existing roadmap review, 2026-10-01 | `Task already exists in account` after step 2 |
| 10 | Notes contain a quoted quote | Imported |
| 11 | Submit timesheet on a different date | Imported |
| 12 | Different title on 2026-11-02 | Imported |
| 13 | `submit timesheet` on the same date as row 11 | `Duplicate title and due date in CSV` |
| 14 | Whitespace-only title | `Title is required.` |

If you skip step 2, row 9 is imported instead of rejected. Download "Rejected CSV" and confirm the `row_number` and `reason` columns. The automated version of this check is in `tests/unit/csv-validation.test.ts` and `tests/integration/database.test.ts`.

## Recording script

Recording link: not created yet. Replace this sentence with the real link after you record. Do not publish a placeholder URL.

Aim for 3–5 minutes.

- 0:00–0:30 — Open the app, sign in, and show the signed-in email.
- 0:30–1:15 — Create a task, edit it, mark it complete, search, filter, clear filters, and soft-delete it. Confirm it leaves the list.
- 1:15–2:30 — Create `Existing roadmap review` due `2026-10-01`. Upload the edge-case CSV.
- 2:30–3:15 — Show imported and rejected counts, the reasons, and the downloaded CSV.
- 3:15–4:00 — Say that RLS uses `auth.uid()`, validation runs on the server, `import_tasks` is one transaction, and `npm test` runs those policies on PGlite.

## Known limitations

- Sign-in was not executed against a hosted Supabase project in this environment.
- The RLS test uses one PGlite session, not two concurrent database connections.
- The owner can still select their own soft-deleted rows outside `list_my_tasks`.
- Task lists are not paginated.
- There is no Playwright suite.
- ASCII case folding does not lowercase letters outside `A-Z`.
- The AI transcript and the screen recording are not in the repo yet.
- The repository has not been published.

## What I would implement next

These are not implemented.

- Playwright coverage for sign-in, CRUD, filters, and the sample import.
- Audit logging for imports and auth failures, with retention and no CSV bodies in the logs.
- Keyset pagination and a narrower count query for large lists.
- Progress for files near the 1,000-row limit, and a clearer retry when a concurrent import rolls back.
- A pass with a screen reader on the delete dialog, filters, and rejection table.
- Deployment settings: hosted env vars, redirect URLs for the real origin, backups, and a job that purges old soft-deleted rows without using the browser's key.

## AI tool usage

Cursor Agent generated and revised this project in one session. The unedited transcript is not in the repo yet. See `ai-log/README.md` for the capture steps. Do not treat that README as the transcript.

## Submission checklist

- [ ] `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` pass on a clean install
- [ ] `.env.local` is not committed; `.env.example` has empty values only
- [ ] Migration file is in `supabase/migrations/`
- [ ] Two demo users exist in the Supabase project, or you can create them on camera
- [ ] Sample CSV import was run once on the hosted project
- [ ] Real AI transcript is in `ai-log/` and secrets are redacted
- [ ] Screen recording link in this README is a real recording
- [ ] Public GitHub repository is named `task-list-app`

Public repository URL: not published.
