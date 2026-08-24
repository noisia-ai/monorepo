export const dynamic = "force-dynamic";

/**
 * The SDK setup endpoint can refresh tokens and return raw token material. Studio
 * does not use that frontend bootstrap contract, so the exact route is closed.
 */
export async function GET() {
  return Response.json(
    { error: "not_found" },
    {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Vary": "Cookie"
      }
    }
  );
}
