import { ZodError } from "zod";

export function unauthorized() {
  return Response.json(
    { error: "unauthorized", message: "Valid Kinde session required." },
    { status: 401 }
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
