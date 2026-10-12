/** Each page selects at most 200 roots. A Message Batch runs its requests concurrently. */
export function readMfpInFlightPages(value = process.env.NOISIA_MFP_IN_FLIGHT_PAGES): number {
  const parsed = Number(value ?? 1);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16) return 1;
  return parsed;
}
