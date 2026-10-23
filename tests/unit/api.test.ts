import { beforeEach, describe, expect, it, vi } from "vitest";

const { envState, createClient } = vi.hoisted(() => ({
  envState: { configured: true },
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseEnv: () => (envState.configured ? { url: "http://localhost:54321", key: "public-test-key" } : null),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient,
}));

import { DELETE, PATCH } from "@/app/api/tasks/[id]/route";
import { POST as importTasks } from "@/app/api/tasks/import/route";
import { GET, POST } from "@/app/api/tasks/route";

const userId = "11111111-1111-4111-8111-111111111111";
const taskId = "33333333-3333-4333-8333-333333333333";

function query(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const chain = Promise.resolve(result);
  return new Proxy(chain, {
    get(target, property) {
      if (property in target) {
        const value = target[property as keyof typeof target];
        return typeof value === "function" ? value.bind(target) : value;
      }
      return () => query(result);
    },
  });
}

function mockClient(options: {
  userId?: string | null;
  queryResult?: { data: unknown; error: { code?: string; message: string } | null };
  rpc?: ReturnType<typeof vi.fn>;
}) {
  const rpc = options.rpc ?? vi.fn(async () => ({ data: [], error: null }));
  createClient.mockResolvedValue({
    auth: {
      getClaims: async () =>
        options.userId
          ? { data: { claims: { sub: options.userId, email: "a@example.com" } }, error: null }
          : { data: null, error: null },
    },
    from: () => query(options.queryResult ?? { data: [], error: null }),
    rpc,
  });
  return rpc;
}

describe("API authorization and validation", () => {
  beforeEach(() => {
    envState.configured = true;
    createClient.mockReset();
  });

  it("rejects unauthenticated task reads and writes", async () => {
    mockClient({ userId: null });
    const getResponse = await GET(new Request("http://localhost/api/tasks"));
    const postResponse = await POST(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title: "A", notes: "", dueDate: "2026-11-01", priority: 1 }),
      }),
    );
    const patchResponse = await PATCH(new Request("http://localhost/api/tasks/x", { method: "PATCH", body: "{}" }), {
      params: Promise.resolve({ id: taskId }),
    });
    const deleteResponse = await DELETE(new Request("http://localhost/api/tasks/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: taskId }),
    });

    for (const response of [getResponse, postResponse, patchResponse, deleteResponse]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Authentication required." });
    }
  });

  it("rejects invalid task input before writing", async () => {
    const rpc = mockClient({ userId });
    const response = await POST(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "   ", notes: "", dueDate: "2026-02-30", priority: "high" }),
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.fieldErrors.title).toMatch(/required/i);
    expect(body.fieldErrors.dueDate).toMatch(/calendar date/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not reveal another user's task when the row is hidden", async () => {
    mockClient({ userId, queryResult: { data: null, error: null } });
    const response = await PATCH(
      new Request(`http://localhost/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      }),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: "Task not found." });
    expect(JSON.stringify(body)).not.toMatch(/other user|user_id/i);
  });

  it("returns a safe response for a malformed CSV", async () => {
    const rpc = mockClient({ userId, queryResult: { data: [], error: null } });
    const form = new FormData();
    form.set("file", new File(['title,due_date,priority,notes\nA,2026-11-01,1,"unterminated'], "tasks.csv", { type: "text/csv" }));
    const response = await importTasks(new Request("http://localhost/api/tasks/import", { method: "POST", body: form }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/malformed/i);
    expect(body.error).not.toMatch(/stack|secret|password/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns escaped rejected CSV from the import response", async () => {
    const rpc = mockClient({
      userId,
      queryResult: { data: [], error: null },
      rpc: vi.fn(async () => ({
        data: { inserted_count: 1, inserted_ids: [taskId] },
        error: null,
      })),
    });
    const csv = [
      "title,due_date,priority,notes",
      'Keep,2026-11-01,1,"fine, really"',
      'Bad,2026-11-02,high,"say ""no"", please"',
    ].join("\n");
    const form = new FormData();
    form.set("file", new File([csv], "tasks.csv", { type: "text/csv" }));
    const response = await importTasks(new Request("http://localhost/api/tasks/import", { method: "POST", body: form }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.importedCount).toBe(1);
    expect(body.rejected[0].reason).toMatch(/Priority/);
    expect(body.rejectedCsv).toContain('"say ""no"", please"');
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("reports missing configuration without querying tasks", async () => {
    envState.configured = false;
    const response = await GET(new Request("http://localhost/api/tasks"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Server is missing Supabase configuration." });
    expect(createClient).not.toHaveBeenCalled();
  });
});
