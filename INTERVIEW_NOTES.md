# Interview notes

These notes match the code in this repository.

## Why Next.js App Router

The assessment requires Next.js, React, and Node.js. The App Router keeps pages, route handlers, and the auth proxy in one TypeScript project. Server components read the session. Client components are limited to forms, filters, and the import panel. There is no separate Express or Python service.

## Server and client components

`src/app/tasks/page.tsx` is a server component. It checks the Supabase session and renders the dashboard. `TaskDashboard`, `TaskForm`, `AuthForm`, and `ImportPanel` are client components because they use state, React Hook Form, and browser events. The CSV parser and database writes stay on the server in the route handlers.

## How authentication works

The browser uses `@supabase/ssr` `createBrowserClient` for sign-up, sign-in, and sign-out. Cookies hold the session. `src/proxy.ts` calls `supabase.auth.getClaims()` on each matched request so the access token is refreshed and verified. Route handlers call `getClaims()` again and take the user id from `claims.sub`. The request body is never trusted for `user_id`.

Sign-up sends users back through `/auth/callback`, which exchanges the email confirmation code. If the Supabase project requires confirmation and no session is returned, the form tells the user to check email.

## Why frontend filtering is not a security boundary

The publishable key is visible in the browser. A person can call the Supabase REST API directly and skip React. Filters in the dashboard only change the query this app sends. They do not stop another client from asking for rows.

## How RLS protects tenant data

`public.tasks` has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. Policies for `authenticated` compare `user_id` to `auth.uid()`:

- `SELECT` returns only the caller's rows.
- `INSERT` `WITH CHECK` requires `user_id = auth.uid()` and `deleted_at IS NULL`.
- `UPDATE` `USING` allows only the caller's active rows. `WITH CHECK` keeps `user_id` equal to `auth.uid()`.
- `DELETE` allows only the caller's rows. A `BEFORE DELETE` trigger then rejects physical deletion, so the supported path is setting `deleted_at`.

PostgreSQL also checks `SELECT` policies against the new version of an updated row. If `SELECT` hid soft-deleted rows, the soft-delete update would fail its own policy. The `SELECT` policy therefore allows the owner to see their deleted rows. `list_my_tasks` and the API still exclude `deleted_at IS NOT NULL` from the normal list. Another user still cannot see them.

The Next.js handlers also check the session. That is defense in depth. RLS still applies when someone uses the publishable key outside this app.

## CSV parsing

`csv-parse` parses the file. It understands quoted commas, escaped quotes, and CR, LF, or CRLF. The code does not split on commas. `info.lines` is stored as `rowNumber`: the 1-based physical line where the record ends. For a normal one-line record that is the spreadsheet row, including the header. A quoted field that spans lines uses the last physical line of that record. Blank lines become rejected rows with the reason `Blank row`. A parser exception becomes a 400 response and does not crash the process.

## Date validation

Dates must match `YYYY-MM-DD`. The components are checked with `Date.UTC` and then compared back to the year, month, and day. `2026-02-30` rolls into March, the comparison fails, and the row is rejected. PostgreSQL also rejects impossible dates when the value is cast to `date` inside `import_tasks`.

## Duplicate detection

A key is the ASCII-lowercased trimmed title plus the exact date. The same function, `public.normalize_task_title`, backs the partial unique index on active rows. JavaScript uses the same trim set and ASCII case fold. The tests compare the two.

Inside one file, the first valid row wins. Later matches are `Duplicate title and due date in CSV`. A match against an active account task is `Task already exists in account`. Soft-deleted tasks are not part of that set, and the unique index ignores them, so the same title and date can be imported again after a soft delete.

The same title on a different date is a different task. A different title on the same date is a different task.

## Why the import uses a transaction

`public.import_tasks` is one PL/pgSQL function. Postgres runs it in the caller's transaction. It checks the session with `auth.uid()`, ignores any `user_id` in the JSON, rechecks duplicates, and inserts every candidate. Any raised error aborts the function and rolls back its inserts. The API reports `importedCount: 0` in that case. It does not claim a partial batch succeeded. Rows rejected by the parser are not sent to the function.

## Concurrent imports

The function takes `pg_advisory_xact_lock(hashtext(user id))` so two imports for the same user queue. It locks matching active rows with `FOR UPDATE` and the partial unique index rejects a duplicate that still gets through. A unique violation is turned into `duplicate active task; import rolled back`, and the batch is undone.

PGlite has one session, so `npm test` does not open two connections at the same time. It does prove the rollback, the repeated-import rejection, and the unique-index normalization. A two-connection race needs a Postgres server with two sessions.

## Soft deletion

`DELETE /api/tasks/[id]` sets `deleted_at`. It does not call SQL `DELETE`. Deleted tasks leave the default list and the duplicate set. The record remains. The UI asks for confirmation first. Physical `DELETE` raises `physical deletion is not allowed`.

## How the tests prove RLS

`tests/integration/database.test.ts` loads the migration into PGlite, which is the PostgreSQL engine compiled to WebAssembly, not a mocked query builder. It creates two users, sets `request.jwt.claim.sub`, and `SET ROLE authenticated`. User A cannot read, update, soft-delete, or insert as User B. The anon role has no table privilege. The same file runs `import_tasks` and checks rollback.

`tests/unit/api.test.ts` mocks the Supabase client. Those tests cover HTTP status codes only. They are not the RLS proof.

## Known limits

- Sign-in needs a real Supabase project. This machine's PostgreSQL 17 server required a password that was not available, so the UI was not exercised against a hosted project.
- The automated RLS test uses PGlite rather than two network connections.
- There is no pagination.
- There is no Playwright run.
- The owner can still select their own soft-deleted rows with a direct SQL or API query. The application list does not show them.
- Title comparison lowercases ASCII letters only.

## A small live coding change

Change the active list so priority 1 appears before priority 5, and the due date breaks ties.

1. In `public.list_my_tasks` inside `supabase/migrations/20261022120000_tasks.sql`, change the end of the query from `ORDER BY tasks.due_date ASC, tasks.created_at ASC, tasks.id ASC` to `ORDER BY tasks.priority ASC, tasks.due_date ASC, tasks.created_at ASC, tasks.id ASC`.
2. In `compareTasks` in `src/app/api/tasks/route.ts`, compare `priority` first. The route sorts again after the RPC, so changing only the SQL would not change the API response.
3. Re-apply the migration on a database that does not already have the function, or replace the function, then reload the task page.

A second small change is a "Next 7 days" due filter: add the value to the Zod enum, the SQL `p_due` check, the `due_date` range, and the `<select>` in `task-dashboard.tsx`.

## Likely questions

**Where is the user id set?** In `POST /api/tasks`, from `claims.sub`. The CSV function uses `auth.uid()` and drops any `user_id` field in the JSON.

**What happens if two valid rows and one bad row are in one file?** The bad row is listed as rejected. The valid rows go to `import_tasks` and commit together.

**What if the header is wrong?** The whole file is rejected. Nothing is inserted.

**What if the import crashes halfway?** The function raises, Postgres rolls back, and the response says no rows from the file were saved.

**Can the service-role key leak?** The app does not read it. Only the URL and the publishable or anon key are used, and they are public by design. RLS is what makes that safe.

**Why not filter deleted rows in the SELECT policy?** PostgreSQL applies that policy to the updated row. Soft delete would then fail. The list function filters them instead.
