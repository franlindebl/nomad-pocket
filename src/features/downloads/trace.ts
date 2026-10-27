// Timing lines for field measurements of downloads ("[dltrace] +12.3s …"): where each file's
// time goes (choosing sources, the transfer, moving, hashing, installing) and the total speed.
// They go to the system log, which `idevicesyslog` records from a phone on a Release build.

const t0 = Date.now();

export function trace(...parts: unknown[]) {
  console.log(`[dltrace] +${((Date.now() - t0) / 1000).toFixed(1)}s`, ...parts);
}

/** Runs `work` and traces how long it took, as `label <ms>`. */
export async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await work();
  } finally {
    trace(label, `${Date.now() - start} ms`);
  }
}
