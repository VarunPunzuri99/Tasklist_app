export function SetupRequired() {
  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium text-teal-800">Task List</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Supabase is not configured</h1>
      <p className="mt-4 text-stone-700">
        Copy <code className="rounded bg-white px-1">.env.example</code> to{" "}
        <code className="rounded bg-white px-1">.env.local</code> and set the project URL and
        publishable or anon key. Restart the dev server after saving the file.
      </p>
    </main>
  );
}
