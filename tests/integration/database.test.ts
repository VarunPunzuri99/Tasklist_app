import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { planCsvImport } from "@/lib/csv/plan-import";
import { normalizeTaskTitle } from "@/lib/tasks/normalize";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261022120000_tasks.sql"),
    "utf8",
  );
  await db.exec(sql);
  await db.query("INSERT INTO auth.users (id) VALUES ($1), ($2)", [userA, userB]);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  await db.exec("TRUNCATE public.tasks");
});

describe("row-level security", () => {
  it("lets each user read only their own active tasks", async () => {
    await asUser(userA);
    await insertTask(userA, "A task", "2026-11-01");
    await asUser(userB);
    await insertTask(userB, "B task", "2026-11-02");

    await asUser(userA);
    const visibleToA = await db.query<{ title: string }>("SELECT title FROM public.tasks ORDER BY title");
    expect(visibleToA.rows.map((row) => row.title)).toEqual(["A task"]);

    await asUser(userB);
    const visibleToB = await db.query<{ title: string }>("SELECT title FROM public.tasks ORDER BY title");
    expect(visibleToB.rows.map((row) => row.title)).toEqual(["B task"]);
  });

  it("stops user A from updating, soft-deleting, or inserting user B's task", async () => {
    await asUser(userB);
    const created = await insertTask(userB, "Private", "2026-11-03");

    await asUser(userA);
    const updated = await db.query("UPDATE public.tasks SET title = 'Hacked' WHERE id = $1 RETURNING id", [
      created.id,
    ]);
    expect(updated.rows).toEqual([]);

    const softDeleted = await db.query(
      "UPDATE public.tasks SET deleted_at = now() WHERE id = $1 RETURNING id",
      [created.id],
    );
    expect(softDeleted.rows).toEqual([]);

    await expect(
      db.query(
        "INSERT INTO public.tasks (user_id, title, due_date, priority) VALUES ($1, 'Pretend', '2026-11-04', 1)",
        [userB],
      ),
    ).rejects.toThrow(/row-level security/i);

    await asUser(null);
    const stored = await db.query<{ title: string; deleted_at: string | null }>(
      "SELECT title, deleted_at FROM public.tasks WHERE id = $1",
      [created.id],
    );
    expect(stored.rows[0]).toMatchObject({ title: "Private", deleted_at: null });
  });

  it("removes soft-deleted tasks from the active list and blocks physical deletion", async () => {
    await asUser(userA);
    const created = await insertTask(userA, "Gone", "2026-11-05");
    await db.query("UPDATE public.tasks SET deleted_at = now() WHERE id = $1", [created.id]);
    const listed = await db.query("SELECT id FROM public.list_my_tasks()");
    expect(listed.rows).toEqual([]);
    const ownHistory = await db.query("SELECT id FROM public.tasks WHERE id = $1", [created.id]);
    expect(ownHistory.rows).toHaveLength(1);

    await expect(db.query("DELETE FROM public.tasks WHERE id = $1", [created.id])).rejects.toThrow(
      /physical deletion is not allowed/i,
    );

    const other = await db.query<{ id: string }>(
      "INSERT INTO public.tasks (user_id, title, due_date, priority) VALUES ($1, 'Other', '2026-11-06', 2) RETURNING id",
      [userA],
    );
    await asUser(userB);
    const crossDelete = await db.query("DELETE FROM public.tasks WHERE id = $1", [other.rows[0]?.id]);
    expect(crossDelete.rows).toEqual([]);

    await asUser(null);
    const stillThere = await db.query("SELECT id FROM public.tasks WHERE id = $1", [other.rows[0]?.id]);
    expect(stillThere.rows).toHaveLength(1);
  });

  it("does not let the anon role read tasks", async () => {
    await asUser(userA);
    await insertTask(userA, "Secret", "2026-11-07");
    await db.exec("RESET ROLE");
    await db.exec("SET ROLE anon");
    await expect(db.query("SELECT * FROM public.tasks")).rejects.toThrow(/permission denied/i);
  });
});

describe("transactional import", () => {
  it("inserts every accepted row and leaves rejected rows out", async () => {
    await asUser(userA);
    await insertTask(userA, "Existing roadmap review", "2026-10-01");
    const existing = await db.query<{ title: string; due_date: string }>(
      "SELECT title, due_date::text FROM public.tasks",
    );
    const keys = new Set(existing.rows.map((row) => `${normalizeTaskTitle(row.title)}\u0000${row.due_date}`));
    const csv = readFileSync(path.join(process.cwd(), "tests/fixtures/import-edge-cases.csv"), "utf8");
    const plan = planCsvImport(csv, keys);

    const imported = await callImport(plan.accepted.map(toCandidate));
    expect(imported.inserted_count).toBe(plan.accepted.length);

    const stored = await db.query<{ title: string }>("SELECT title FROM public.tasks ORDER BY title, due_date");
    const titles = stored.rows.map((row) => row.title);
    expect(titles).toContain("Review payroll");
    expect(titles).not.toContain("Board slides");
    expect(titles).not.toContain("Impossible day");
    expect(titles.filter((title) => title === "Existing roadmap review")).toHaveLength(1);
    expect(stored.rows).toHaveLength(plan.accepted.length + 1);
  });

  it("rolls back the batch when a database failure happens during insertion", async () => {
    await asUser(null);
    await db.exec(`
      CREATE OR REPLACE FUNCTION public.test_fail_second_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $fn$
      BEGIN
        IF (SELECT count(*) FROM public.tasks) >= 1 THEN
          RAISE EXCEPTION 'simulated database failure';
        END IF;
        RETURN NEW;
      END;
      $fn$;
      DROP TRIGGER IF EXISTS test_fail_second_insert ON public.tasks;
      CREATE TRIGGER test_fail_second_insert
      BEFORE INSERT ON public.tasks
      FOR EACH ROW
      EXECUTE FUNCTION public.test_fail_second_insert();
    `);

    try {
      await asUser(userA);
      await expect(
        callImport([
          { title: "First", due_date: "2026-11-01", priority: 1, notes: null },
          { title: "Second", due_date: "2026-11-02", priority: 2, notes: null },
        ]),
      ).rejects.toThrow(/simulated database failure/i);

      await asUser(null);
      const remaining = await db.query("SELECT id FROM public.tasks");
      expect(remaining.rows).toEqual([]);
    } finally {
      await db.exec("RESET ROLE");
      await db.exec("DROP TRIGGER IF EXISTS test_fail_second_insert ON public.tasks");
    }
  });

  it("does not create a second active task when the same file is imported again", async () => {
    await asUser(userA);
    const candidates = [
      { title: "Pay Rent", due_date: "2026-11-01", priority: 2, notes: "First" },
      { title: "Other", due_date: "2026-11-02", priority: 3, notes: null },
    ];
    const first = await callImport(candidates);
    expect(first.inserted_count).toBe(2);
    await expect(callImport(candidates)).rejects.toThrow(/rolled back/i);
    const count = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM public.tasks");
    expect(count.rows[0]?.count).toBe("2");
  });

  it("allows a task that matches a soft-deleted row and ignores a supplied user id", async () => {
    await asUser(userA);
    const created = await insertTask(userA, "Pay Rent", "2026-11-01");
    await db.query("UPDATE public.tasks SET deleted_at = now() WHERE id = $1", [created.id]);
    const imported = await callImport([
      { title: "pay rent", due_date: "2026-11-01", priority: 4, notes: "Back", user_id: userB },
    ]);
    expect(imported.inserted_count).toBe(1);

    await asUser(null);
    const rows = await db.query<{ user_id: string; title: string; deleted_at: string | null }>(
      "SELECT user_id, title, deleted_at FROM public.tasks ORDER BY created_at",
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[1]).toMatchObject({ user_id: userA, title: "pay rent", deleted_at: null });
  });

  it("rejects a case-variant duplicate inside the database function", async () => {
    await asUser(userA);
    await expect(
      callImport([
        { title: "Pay Rent", due_date: "2026-12-01", priority: 1, notes: null },
        { title: "pay rent", due_date: "2026-12-01", priority: 1, notes: null },
      ]),
    ).rejects.toThrow(/rolled back/i);
    const count = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM public.tasks");
    expect(count.rows[0]?.count).toBe("0");
  });

  it("matches the SQL title normalization used by the unique index", async () => {
    for (const title of ["  Pay Rent \t", "PAY RENT", "Straße", "Already"]) {
      const result = await db.query<{ value: string }>("SELECT public.normalize_task_title($1) AS value", [title]);
      expect(result.rows[0]?.value).toBe(normalizeTaskTitle(title));
    }
  });

  it("filters search, status, priority, and due date together", async () => {
    await asUser(userA);
    await insertTask(userA, "100% done", "2026-10-01", { notes: "percent", status: "pending", priority: 1 });
    await insertTask(userA, "Pay Rent", "2026-11-20", { notes: "landlord", status: "pending", priority: 2 });
    await insertTask(userA, "Pay Rent archive", "2026-11-21", { notes: "done", status: "completed", priority: 2 });

    const overdue = await db.query<{ title: string }>(
      "SELECT title FROM public.list_my_tasks(NULL, 'pending', NULL, 'overdue', '2026-11-15')",
    );
    expect(overdue.rows.map((row) => row.title)).toEqual(["100% done"]);

    const combined = await db.query<{ title: string }>(
      "SELECT title FROM public.list_my_tasks('landlord', 'pending', 2, 'upcoming', '2026-11-15')",
    );
    expect(combined.rows.map((row) => row.title)).toEqual(["Pay Rent"]);

    const wildcard = await db.query<{ title: string }>(
      "SELECT title FROM public.list_my_tasks('%', NULL, NULL, NULL, '2026-11-15')",
    );
    expect(wildcard.rows.map((row) => row.title)).toEqual(["100% done"]);
  });

  it("requires authentication before importing", async () => {
    await asUser(null);
    await expect(
      callImport([{ title: "Nope", due_date: "2026-11-01", priority: 1, notes: null }]),
    ).rejects.toThrow(/authentication required/i);
    const count = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM public.tasks");
    expect(count.rows[0]?.count).toBe("0");
  });
});

async function asUser(userId: string | null) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  if (userId) {
    await db.exec("SET ROLE authenticated");
  }
}

async function insertTask(
  userId: string,
  title: string,
  dueDate: string,
  options: { notes?: string | null; status?: "pending" | "completed"; priority?: number } = {},
) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO public.tasks (user_id, title, notes, due_date, priority, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, title, options.notes ?? null, dueDate, options.priority ?? 3, options.status ?? "pending"],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Task insert did not return an id.");
  }
  return { id };
}

type Candidate = {
  title: string;
  due_date: string;
  priority: number;
  notes: string | null;
  user_id?: string;
};

async function callImport(candidates: Candidate[]) {
  const result = await db.query<{ result: { inserted_count: number; inserted_ids: string[] } }>(
    "SELECT public.import_tasks($1::jsonb) AS result",
    [JSON.stringify(candidates)],
  );
  const value = result.rows[0]?.result;
  if (!value) {
    throw new Error("import_tasks did not return a result.");
  }
  return value;
}

function toCandidate(row: { title: string; dueDate: string; priority: number; notes: string | null }): Candidate {
  return { title: row.title, due_date: row.dueDate, priority: row.priority, notes: row.notes };
}
