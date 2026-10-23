"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { taskCreateSchema, type TaskCreateInput } from "@/lib/tasks/schema";

type TaskFormProps = {
  initial?: TaskCreateInput;
  submitLabel: string;
  pending: boolean;
  serverError?: string | null;
  onSubmit: (values: TaskCreateInput) => Promise<void>;
  onCancel?: () => void;
};

export function TaskForm({
  initial,
  submitLabel,
  pending,
  serverError,
  onSubmit,
  onCancel,
}: TaskFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TaskCreateInput>({
    resolver: zodResolver(taskCreateSchema),
    defaultValues: initial ?? { title: "", notes: "", dueDate: "", priority: 3 },
  });

  return (
    <form className="space-y-3" onSubmit={handleSubmit(onSubmit)} noValidate>
      <label className="block text-sm font-medium" htmlFor={`${submitLabel}-title`}>
        Title
        <input id={`${submitLabel}-title`} className={fieldClass} {...register("title")} />
      </label>
      {errors.title ? <p className="text-sm text-rose-800">{errors.title.message}</p> : null}
      <label className="block text-sm font-medium" htmlFor={`${submitLabel}-notes`}>
        Notes
        <textarea id={`${submitLabel}-notes`} rows={3} className={fieldClass} {...register("notes")} />
      </label>
      {errors.notes ? <p className="text-sm text-rose-800">{errors.notes.message}</p> : null}
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium" htmlFor={`${submitLabel}-due`}>
          Due date
          <input id={`${submitLabel}-due`} type="date" className={fieldClass} {...register("dueDate")} />
        </label>
        <label className="block text-sm font-medium" htmlFor={`${submitLabel}-priority`}>
          Priority
          <select
            id={`${submitLabel}-priority`}
            className={fieldClass}
            {...register("priority", { valueAsNumber: true })}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={5}>5</option>
          </select>
        </label>
      </div>
      {errors.dueDate ? <p className="text-sm text-rose-800">{errors.dueDate.message}</p> : null}
      {errors.priority ? <p className="text-sm text-rose-800">{errors.priority.message}</p> : null}
      {serverError ? (
        <p className="text-sm text-rose-800" role="alert">
          {serverError}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" className={primaryClass} disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className={secondaryClass} onClick={onCancel} disabled={pending}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

const fieldClass =
  "mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-800 focus:ring-2 focus:ring-teal-800/20";

const primaryClass =
  "rounded-md bg-teal-800 px-4 py-2 text-sm font-medium text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60";

const secondaryClass =
  "rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-60";
