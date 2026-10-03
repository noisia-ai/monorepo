import { ZodError } from "zod";

import { loginPath, sessionRefreshPath } from "@/lib/auth/redirects";

export function unauthorized(next = "/studio") {
  return Response.json(
    {
      error: "unauthorized",
      message: "Valid Kinde session required.",
      refresh_url: sessionRefreshPath(next),
      login_url: loginPath(next),
      retry_policy: {
        safe_get: "explicit_once_after_session_recovery",
        mutating_request: "operator_resubmission_required",
        automatic_replay: false
      }
    },
    {
      status: 401,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Vary": "Cookie"
      }
    }
  );
}

export function forbidden() {
  return Response.json(
    { error: "forbidden", message: "You do not have permission to perform this action." },
    { status: 403 }
  );
}

export function validationError(error: ZodError) {
  return Response.json(
    {
      error: "validation_error",
      message: "Request validation failed.",
      details: {
        fields: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      }
    },
    { status: 422 }
  );
}
