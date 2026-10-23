import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseEnv } from "@/lib/supabase/env";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const env = getSupabaseEnv();

  if (!env) {
    return supabaseResponse;
  }

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value);
        });
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims.sub);
  const path = request.nextUrl.pathname;
  const isAuthPage = path === "/login" || path === "/signup";
  const isProtectedPage = path.startsWith("/tasks");

  if (!signedIn && isProtectedPage) {
    return copyProxyResponse(supabaseResponse, NextResponse.redirect(new URL("/login", request.url)));
  }

  if (signedIn && isAuthPage) {
    return copyProxyResponse(supabaseResponse, NextResponse.redirect(new URL("/tasks", request.url)));
  }

  return supabaseResponse;
}

function copyProxyResponse(source: NextResponse, target: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(header);
    if (value) {
      target.headers.set(header, value);
    }
  }
  return target;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|csv)$).*)"],
};
