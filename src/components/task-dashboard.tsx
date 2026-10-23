"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ImportPanel } from "@/components/import-panel";
import { TaskForm } from "@/components/task-form";
import { createClient } from "@/lib/supabase/client";
import { localIsoDate } from "@/lib/tasks/dates";
import type { TaskCreateInput } from "@/lib/tasks/schema";
import type { Task, TaskCounts } from "@/lib/tasks/types";

type Filters = {
  q: string;
  status: "all" | "pending" | "completed";
  priority: "all" | "1" | "2" | "3" | "4" | "5";
  due: "all" | "overdue" | "today" | "upcoming";
};

const EMPTY_FILTERS: Filters = { q: "", status: "all", priority: "all", due: "all" };

export function TaskDashboard({ email }: { email: string }) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [counts, setCounts] = useState<TaskCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);

  const loadTasks = useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.q.trim()) params.set("q", filters.q.trim());
    if (filters.status !== "all") params.set("status", filters.status);
    if (filters.priority !== "all") params.set("priority", filters.priority);
    if (filters.due !== "all") params.set("due", filters.due);
    params.set("today", localIsoDate());

    const response = await fetch(`/api/tasks?${params.toString()}`, { cache: "no-store" });
    const body = (await response.json()) as { tasks?: Task[]; counts?: TaskCounts; error?: string };
    if (!response.ok) {
      throw new Error(body.error ?? "Tasks could not be loaded.");
    }
    setTasks(body.tasks ?? []);
    setCounts(body.counts ?? null);
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    // Results are applied after fetch resolves. This rule treats any setState
    // reached from an effect as synchronous, including that async continuation.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload when filters change
    void loadTasks()
      .then(() => {
        if (!cancelled) {
          setListError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setListError(error instanceof Error ? error.message : "Tasks could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadTasks]);

  function applyFilters(update: (current: Filters) => Filters) {
    setLoading(true);
    setListError(null);
    setFilters(update);
  }

  async function refresh() {
    setListError(null);
    try {
      await loadTasks();
    } catch (error: unknown) {
      setListError(error instanceof Error ? error.message : "Tasks could not be loaded.");
    }
  }

  async function createTask(values: TaskCreateInput) {
    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setCreateError(body.error ?? "The task could not be created.");
        return;
      }
      setCreateKey((value) => value + 1);
      await refresh();
    } catch {
      setCreateError("The server could not be reached.");
    } finally {
      setCreating(false);
    }
  }

  async function updateTask(id: string, values: Partial<TaskCreateInput> & { status?: Task["status"] }) {
    setBusyId(id);
    setEditError(null);
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setEditError(body.error ?? "The task could not be updated.");
        return;
      }
      setEditingId(null);
      await refresh();
    } catch {
      setEditError("The server could not be reached.");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setBusyId(id);
    try {
      const response = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setListError(body.error ?? "The task could not be deleted.");
        return;
      }
      setPendingDelete(null);
      await refresh();
    } catch {
      setListError("The server could not be reached.");
    } finally {
      setBusyId(null);
    }
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const filtersActive =
    filters.q !== "" || filters.status !== "all" || filters.priority !== "all" || filters.due !== "all";
  const today = localIsoDate();

  return (
    <div className="mx-auto min-h-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-teal-800">Task List</p>
          <h1 className="text-2xl font-semibold tracking-tight">Your tasks</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-stone-600">{email}</span>
          <button
            type="button"
            className="rounded-md border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-50"
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Task counts">
        <Count label="Active" value={counts?.total} />
        <Count label="Pending" value={counts?.pending} />
        <Count label="Completed" value={counts?.completed} />
        <Count label="Overdue" value={counts?.overdue} />
        <Count label="Showing" value={counts?.showing} />
      </section>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section>
          <form className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:grid-cols-4" role="search">
            <label className="text-sm font-medium sm:col-span-4" htmlFor="search">
              Search title or notes
              <input
                id="search"
                value={filters.q}
                onChange={(event) => applyFilters((current) => ({ ...current, q: event.target.value }))}
                className={fieldClass}
              />
            </label>
            <label className="text-sm font-medium" htmlFor="status-filter">
              Status
              <select
                id="status-filter"
                value={filters.status}
                onChange={(event) =>
                  applyFilters((current) => ({ ...current, status: event.target.value as Filters["status"] }))
                }
                className={fieldClass}
              >
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
              </select>
            </label>
            <label className="text-sm font-medium" htmlFor="priority-filter">
              Priority
              <select
                id="priority-filter"
                value={filters.priority}
                onChange={(event) =>
                  applyFilters((current) => ({
                    ...current,
                    priority: event.target.value as Filters["priority"],
                  }))
                }
                className={fieldClass}
              >
                <option value="all">All</option>
                {[1, 2, 3, 4, 5].map((priority) => (
                  <option key={priority} value={String(priority)}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium" htmlFor="due-filter">
              Due date
              <select
                id="due-filter"
                value={filters.due}
                onChange={(event) =>
                  applyFilters((current) => ({ ...current, due: event.target.value as Filters["due"] }))
                }
                className={fieldClass}
              >
                <option value="all">All</option>
                <option value="overdue">Overdue</option>
                <option value="today">Today</option>
                <option value="upcoming">Upcoming</option>
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50 disabled:opacity-50"
                disabled={!filtersActive}
                onClick={() => applyFilters(() => EMPTY_FILTERS)}
              >
                Clear filters
              </button>
            </div>
          </form>

          <div className="mt-4" aria-live="polite">
            {loading ? <p className="text-sm text-stone-600">Loading tasks…</p> : null}
            {listError ? (
              <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
                {listError}
              </p>
            ) : null}
            {!loading && !listError && tasks.length === 0 && !filtersActive ? (
              <p className="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-8 text-sm text-stone-600">
                No tasks yet. Create one or import a CSV file.
              </p>
            ) : null}
            {!loading && !listError && tasks.length === 0 && filtersActive ? (
              <p className="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-8 text-sm text-stone-600">
                No tasks match these filters.
              </p>
            ) : null}
          </div>

          <ul className="mt-4 space-y-3">
            {tasks.map((task) => {
              const overdue = task.status === "pending" && task.dueDate < today;
              return (
                <li key={task.id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  {editingId === task.id ? (
                    <TaskForm
                      initial={{
                        title: task.title,
                        notes: task.notes ?? "",
                        dueDate: task.dueDate,
                        priority: task.priority,
                      }}
                      submitLabel="Save changes"
                      pending={busyId === task.id}
                      serverError={editError}
                      onCancel={() => {
                        setEditingId(null);
                        setEditError(null);
                      }}
                      onSubmit={(values) => updateTask(task.id, values)}
                    />
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="font-medium">{task.title}</h2>
                        {task.notes ? <p className="mt-1 text-sm text-stone-600">{task.notes}</p> : null}
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full bg-stone-100 px-2 py-1">Due {task.dueDate}</span>
                          <span className="rounded-full bg-teal-50 px-2 py-1 text-teal-900">
                            Priority {task.priority}
                          </span>
                          <span className="rounded-full bg-stone-100 px-2 py-1 capitalize">{task.status}</span>
                          {overdue ? (
                            <span className="rounded-full bg-rose-100 px-2 py-1 text-rose-800">Overdue</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={smallButton} onClick={() => setEditingId(task.id)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className={smallButton}
                          disabled={busyId === task.id}
                          onClick={() =>
                            updateTask(task.id, {
                              status: task.status === "completed" ? "pending" : "completed",
                            })
                          }
                        >
                          {task.status === "completed" ? "Reopen" : "Complete"}
                        </button>
                        <button
                          type="button"
                          className={smallButton}
                          onClick={() => setPendingDelete(task)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Create task</h2>
            <div className="mt-3">
              <TaskForm
                key={createKey}
                submitLabel="Create task"
                pending={creating}
                serverError={createError}
                onSubmit={createTask}
              />
            </div>
          </section>
          <ImportPanel onImported={refresh} />
        </aside>
      </div>

      {pendingDelete ? (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-stone-900/40 px-4" role="presentation">
          <div
            role="alertdialog"
            aria-labelledby="delete-title"
            aria-describedby="delete-body"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg"
          >
            <h2 id="delete-title" className="text-lg font-semibold">
              Delete this task?
            </h2>
            <p id="delete-body" className="mt-2 text-sm text-stone-600">
              “{pendingDelete.title}” will be hidden from your list. The record stays in the database
              and will not count as a duplicate.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={smallButton}
                autoFocus
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-rose-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                disabled={busyId === pendingDelete.id}
                onClick={confirmDelete}
              >
                {busyId === pendingDelete.id ? "Deleting…" : "Delete task"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-3 py-2">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="text-lg font-semibold">{value ?? "–"}</div>
    </div>
  );
}

const fieldClass =
  "mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-800 focus:ring-2 focus:ring-teal-800/20";

const smallButton =
  "rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50 disabled:opacity-60";
