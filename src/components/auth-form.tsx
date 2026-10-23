"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { createClient } from "@/lib/supabase/client";
import { authFormSchema } from "@/lib/tasks/schema";

type AuthValues = {
  email: string;
  password: string;
};

export function AuthForm({ mode, notice }: { mode: "login" | "signup"; notice?: string | null }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(notice ?? null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AuthValues>({
    resolver: zodResolver(authFormSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: AuthValues) {
    setFormError(null);
    setInfo(null);
    const supabase = createClient();

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword(values);
      if (error) {
        setFormError("Email or password is incorrect, or the email address is not confirmed yet.");
        return;
      }
      router.push("/tasks");
      router.refresh();
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setFormError("The account could not be created. Check the email address and password.");
      return;
    }

    if (!data.session) {
      setInfo("Check your email to confirm the account, then sign in.");
      return;
    }

    router.push("/tasks");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium text-teal-800">Task List</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        {mode === "login" ? "Sign in" : "Create an account"}
      </h1>
      <p className="mt-2 text-sm text-stone-600">
        Tasks are stored for the signed-in account and isolated in PostgreSQL.
      </p>
      <form className="mt-8 space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <label className="block text-sm font-medium" htmlFor="email">
          Email
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={fieldClass}
            {...register("email")}
          />
        </label>
        {errors.email ? <p className="text-sm text-rose-800">{errors.email.message}</p> : null}
        <label className="block text-sm font-medium" htmlFor="password">
          Password
          <input
            id="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className={fieldClass}
            {...register("password")}
          />
        </label>
        {errors.password ? <p className="text-sm text-rose-800">{errors.password.message}</p> : null}
        {formError ? (
          <p className="text-sm text-rose-800" role="alert">
            {formError}
          </p>
        ) : null}
        {info ? (
          <p className="text-sm text-teal-900" role="status">
            {info}
          </p>
        ) : null}
        <button type="submit" className={primaryClass} disabled={isSubmitting}>
          {isSubmitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-sm text-stone-600">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link className="font-medium text-teal-800 underline" href="/signup">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link className="font-medium text-teal-800 underline" href="/login">
              Sign in
            </Link>
          </>
        )}
      </p>
    </main>
  );
}

const fieldClass =
  "mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-800 focus:ring-2 focus:ring-teal-800/20";

const primaryClass =
  "w-full rounded-md bg-teal-800 px-4 py-2 text-sm font-medium text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60";
