import { isTerminalKindeCallbackError, privateRedirect } from "@/lib/auth/session-continuity";
import { loginPath } from "@/lib/auth/redirects";

const STATE_NOT_FOUND_RESPONSE_PATTERN = new RegExp(
  "^Error: State not found\\.\\n"
  + "To resolve this error please visit our docs "
  + "https://docs\\.kinde\\.com/developer-tools/sdks/backend/nextjs-sdk/"
  + "#state-not-found-errorAuthentication flow: Received: ([^|\\s]+) "
  + "\\| Expected: State not found$"
);

type KindeCallbackHandler = (
  request: Request,
  context: { params: Promise<{ kindeAuth: "kinde_callback" }> }
) => Promise<Response>;

/**
 * Route-level adapter around the pinned Kinde callback handler. The SDK currently
 * returns its terminal state mismatch as JSON 500 instead of throwing it.
 */
export async function handleKindeCallbackRequest(
  request: Request,
  callbackHandler: KindeCallbackHandler
) {
  try {
    const response = await callbackHandler(request, {
      params: Promise.resolve({ kindeAuth: "kinde_callback" })
    });
    return await isReturnedStateNotFound(response)
      ? privateRedirect(loginPath("/studio"))
      : response;
  } catch (error) {
    if (isTerminalKindeCallbackError(error)) {
      return privateRedirect(loginPath("/studio"));
    }
    throw error;
  }
}

async function isReturnedStateNotFound(response: Response) {
  if (response.status !== 500) return false;
  const mediaType = response.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return false;
  }

  try {
    const value = JSON.parse(await response.clone().text()) as unknown;
    if (!isPlainObject(value) || Object.keys(value).length !== 1) return false;
    const error = value.error;
    return typeof error === "string"
      && STATE_NOT_FOUND_RESPONSE_PATTERN.test(error);
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
