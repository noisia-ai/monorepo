export function splitSignalPulseMetaForMerge(meta: Record<string, unknown>) {
  const { signal_pulse: signalPulseMeta, ...rootMeta } = meta;
  return {
    signalPulseMeta,
    rootMeta
  };
}
