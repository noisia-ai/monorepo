export type StudioSearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function resolveSearchParams(searchParams?: StudioSearchParams) {
  return (await searchParams) ?? {};
}

export function getSearchParam(
  params: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function getPositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
