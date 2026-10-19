export const workspaceTopicEditorialPollBaseDelayMsV1 = 5_000;
export const workspaceTopicEditorialPollMaxDelayMsV1 = 30_000;

export function workspaceTopicEditorialPollDelayMsV1(failures: number): number {
  const exponent = Number.isFinite(failures) ? Math.max(0, Math.floor(failures)) : 0;
  return Math.min(workspaceTopicEditorialPollMaxDelayMsV1,
    workspaceTopicEditorialPollBaseDelayMsV1 * 2 ** Math.min(exponent, 8));
}

export type WorkspaceTopicEditorialPollReadResultV1 = true | false | null;

export function startWorkspaceTopicEditorialPollV1(args: {
  read: () => Promise<WorkspaceTopicEditorialPollReadResultV1>;
  isBusy: () => boolean;
  isVisible: () => boolean;
  schedule: (callback: () => Promise<void>, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
  onVisibilityChange: (callback: () => void) => () => void;
}): () => void {
  let active = true;
  let failures = 0;
  let timer: unknown;
  let hasTimer = false;

  const cancelTimer = () => {
    if (!hasTimer) return;
    args.cancel(timer);
    hasTimer = false;
  };
  const schedule = (delayMs: number) => {
    if (!active || !args.isVisible() || hasTimer) return;
    hasTimer = true;
    timer = args.schedule(async () => {
      hasTimer = false;
      if (!active || !args.isVisible()) return;
      if (args.isBusy()) {
        schedule(workspaceTopicEditorialPollBaseDelayMsV1);
        return;
      }
      const result = await args.read();
      if (!active) return;
      if (result === true) failures = 0;
      else if (result === false) failures += 1;
      schedule(result === null ? workspaceTopicEditorialPollBaseDelayMsV1 : workspaceTopicEditorialPollDelayMsV1(failures));
    }, delayMs);
  };
  const visibilityChanged = () => {
    if (!args.isVisible()) cancelTimer();
    else schedule(0);
  };
  const unsubscribe = args.onVisibilityChange(visibilityChanged);
  schedule(workspaceTopicEditorialPollBaseDelayMsV1);

  return () => {
    active = false;
    cancelTimer();
    unsubscribe();
  };
}
