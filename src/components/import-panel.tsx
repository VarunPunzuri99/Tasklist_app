"use client";

import { useState } from "react";

import type { RejectedCsvRow } from "@/lib/csv/plan-import";

type ImportResult = {
  importedCount: number;
  rejectedCount: number;
  rejected: RejectedCsvRow[];
  rejectedCsv: string;
  message?: string;
  error?: string;
};

export function ImportPanel({ onImported }: { onImported: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || pending) {
      return;
    }

    setPending(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);

    try {
      const response = await fetch("/api/tasks/import", { method: "POST", body });
      const payload = (await response.json()) as ImportResult & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "The CSV could not be imported.");
        setResult(payload.rejected ? payload : null);
        return;
      }
      setResult(payload);
      setFile(null);
      await onImported();
    } catch {
      setError("The server could not be reached.");
    } finally {
      setPending(false);
    }
  }

  function downloadRejected() {
    if (!result?.rejectedCsv) {
      return;
    }
    const blob = new Blob([result.rejectedCsv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rejected-tasks.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold">Import CSV</h2>
      <p className="mt-1 text-sm text-stone-600">
        Headers must be <span className="font-mono text-xs">title,due_date,priority,notes</span>.
        Limit: 1 MB and 1,000 data rows.
      </p>
      <p className="mt-2 text-sm">
        <a className="font-medium text-teal-800 underline" href="/samples/import-edge-cases.csv">
          Download the edge-case sample
        </a>
        . Create an active task titled “Existing roadmap review” due 2026-10-01 before importing it
        if you want that row to be rejected as an account duplicate.
      </p>
      <form className="mt-4 space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm font-medium" htmlFor="csv-file">
          CSV file
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            className="mt-1 block w-full text-sm"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-teal-800 px-4 py-2 text-sm font-medium text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending || !file}
        >
          {pending ? "Importing…" : "Import"}
        </button>
      </form>
      {pending ? (
        <p className="mt-3 text-sm text-stone-600" role="status">
          Parsing and saving the file. Valid rows are saved together.
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-rose-800" role="alert">
          {error}
        </p>
      ) : null}
      {result && !error ? (
        <div className="mt-4" role="status" aria-live="polite">
          <p className="text-sm font-medium text-teal-900">{result.message}</p>
          <p className="mt-1 text-sm text-stone-700">
            Imported {result.importedCount}. Rejected {result.rejectedCount}.
          </p>
        </div>
      ) : null}
      {result && result.rejected.length > 0 ? (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Rejected rows</h3>
            <button
              type="button"
              className="rounded-md border border-stone-300 px-3 py-1 text-sm hover:bg-stone-50"
              onClick={downloadRejected}
            >
              Download rejected CSV
            </button>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <caption className="sr-only">CSV rows that were not imported</caption>
              <thead className="text-stone-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Row</th>
                  <th className="py-1 pr-3 font-medium">Title</th>
                  <th className="py-1 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {result.rejected.map((row) => (
                  <tr key={`${row.rowNumber}-${row.reason}`} className="border-t border-stone-100">
                    <td className="py-2 pr-3">{row.rowNumber}</td>
                    <td className="max-w-40 truncate py-2 pr-3">{row.title || "—"}</td>
                    <td className="py-2">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
