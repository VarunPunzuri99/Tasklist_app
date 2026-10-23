type DatabaseErrorLike = {
  code?: string;
  message?: string;
};

export function logDatabaseError(scope: string, error: DatabaseErrorLike): void {
  console.error(`[${scope}] database error ${error.code ?? "unknown"}`);
}

export function importFailure(error: DatabaseErrorLike): { status: number; message: string } {
  const code = error.code ?? "";
  const message = error.message ?? "";

  if (code === "PGRST202" || /could not find the function/i.test(message)) {
    return {
      status: 500,
      message: "The database migration has not been applied. Import is unavailable until then.",
    };
  }

  if (code === "23505" || /import rolled back|duplicate/i.test(message)) {
    return {
      status: 409,
      message:
        "The import was rolled back because a matching active task already exists. No rows from this file were saved.",
    };
  }

  if (code === "28000" || /authentication required/i.test(message)) {
    return { status: 401, message: "Authentication required." };
  }

  return { status: 500, message: "The import could not be saved. No rows from this file were saved." };
}

export function taskWriteFailure(
  error: DatabaseErrorLike,
  duplicateMessage: string,
): { status: number; message: string } {
  if (error.code === "23505") {
    return { status: 409, message: duplicateMessage };
  }
  if (error.code === "28000") {
    return { status: 401, message: "Authentication required." };
  }
  if (error.code === "42501") {
    return { status: 403, message: "You do not have permission to change that task." };
  }
  return { status: 500, message: "The task could not be saved." };
}
