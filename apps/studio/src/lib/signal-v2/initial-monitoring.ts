/** Topics uses the monitoring-shaped object only for shell navigation/filter state.
 * Its real module payload is loaded separately; unrelated monitoring work and errors
 * must not delay or fail the Topics route. The native route already returns earlier. */
export function loadInitialSignalMonitoringV1<T>(args: {
  activeModule: "monitoring" | "mentions" | "topics" | "settings";
  loadMonitoring: () => Promise<T>; buildShellData: () => T;
}): Promise<T> {
  return args.activeModule === "topics"
    ? Promise.resolve(args.buildShellData())
    : args.loadMonitoring();
}
