export function canClaimSignalTopicExecutionV1(status: string, recoverInterruptedAttempt: boolean) {
  return status === "queued" || status === "failed"
    || (status === "running" && recoverInterruptedAttempt);
}
