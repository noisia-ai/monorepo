/** Read-only credential probe before explicitly admitting new paid work. */
export async function assertAnthropicProviderAccessV1(args: {
  api_key: string;
  enabled: boolean;
  fetch_impl?: typeof fetch;
}) {
  if (!args.enabled || !args.api_key.trim())
    throw new Error("anthropic_provider_access_unavailable");
  const response = await (args.fetch_impl ?? fetch)(
    "https://api.anthropic.com/v1/models",
    {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { "x-api-key": args.api_key, "anthropic-version": "2023-06-01" },
    },
  );
  await response.body?.cancel().catch(() => undefined);
  if (response.status !== 200)
    throw new Error("anthropic_provider_access_unavailable");
}
