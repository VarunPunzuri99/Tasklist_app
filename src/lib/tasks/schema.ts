import { z } from "zod";

import { isStrictIsoDate } from "@/lib/tasks/dates";
import { MAX_NOTES_LENGTH, MAX_TITLE_LENGTH } from "@/lib/tasks/limits";
import { trimTaskText } from "@/lib/tasks/normalize";

const titleSchema = z
  .string()
  .refine((value) => trimTaskText(value).length > 0, { error: "Title is required." })
  .refine((value) => trimTaskText(value).length <= MAX_TITLE_LENGTH, {
    error: "Title must be 200 characters or fewer.",
  });

const notesSchema = z
  .string()
  .max(MAX_NOTES_LENGTH, { error: "Notes must be 5000 characters or fewer." });

const dueDateSchema = z
  .string()
  .trim()
  .refine(isStrictIsoDate, {
    error: "Enter a real calendar date in YYYY-MM-DD format.",
  });

const prioritySchema = z
  .number()
  .int({ error: "Priority must be a whole number from 1 to 5." })
  .min(1, { error: "Priority must be a whole number from 1 to 5." })
  .max(5, { error: "Priority must be a whole number from 1 to 5." });

export const taskCreateSchema = z.object({
  title: titleSchema,
  notes: notesSchema,
  dueDate: dueDateSchema,
  priority: prioritySchema,
});

export const taskPatchSchema = z
  .object({
    title: titleSchema.optional(),
    notes: notesSchema.nullable().optional(),
    dueDate: dueDateSchema.optional(),
    priority: prioritySchema.optional(),
    status: z.enum(["pending", "completed"]).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    error: "Provide at least one field to update.",
  });

export const taskListQuerySchema = z.object({
  q: z.string().trim().max(200, { error: "Search must be 200 characters or fewer." }).optional(),
  status: z.enum(["all", "pending", "completed"]).optional(),
  priority: z.enum(["all", "1", "2", "3", "4", "5"]).optional(),
  due: z.enum(["all", "overdue", "today", "upcoming"]).optional(),
  today: z
    .string()
    .refine(isStrictIsoDate, {
      error: "Today must be a real calendar date in YYYY-MM-DD format.",
    })
    .optional(),
});

export const authFormSchema = z.object({
  email: z.email({ error: "Enter a valid email address." }).trim(),
  password: z
    .string()
    .min(8, { error: "Password must be at least 8 characters." })
    .max(72, { error: "Password must be 72 characters or fewer." }),
});

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskPatchInput = z.infer<typeof taskPatchSchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export function cleanCreate(input: TaskCreateInput): {
  title: string;
  notes: string | null;
  dueDate: string;
  priority: number;
} {
  const notes = trimTaskText(input.notes);
  return {
    title: trimTaskText(input.title),
    notes: notes.length === 0 ? null : notes,
    dueDate: input.dueDate.trim(),
    priority: input.priority,
  };
}

export function cleanPatch(input: TaskPatchInput): TaskPatchInput {
  const notes =
    typeof input.notes === "string" ? trimTaskText(input.notes) || null : input.notes;

  return {
    ...input,
    title: input.title === undefined ? undefined : trimTaskText(input.title),
    notes,
    dueDate: input.dueDate === undefined ? undefined : input.dueDate.trim(),
  };
}

export function fieldErrorMap(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "form";
    if (!result[key]) {
      result[key] = issue.message;
    }
  }
  return result;
}
