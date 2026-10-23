export type TaskStatus = "pending" | "completed";

export type Task = {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string;
  priority: number;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
};

export type TaskCounts = {
  total: number;
  pending: number;
  completed: number;
  overdue: number;
  showing: number;
};

export type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  due_date: string;
  priority: number;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
};

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    dueDate: row.due_date.slice(0, 10),
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
