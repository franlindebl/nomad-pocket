// Country maps and routing packs arrive in parts that are appended into a temp copy while
// the parts are still on disk: each assembly needs its archive's size again. They run one
// at a time, so a country download needs room for its biggest archive only (countryNeed in
// country-core.ts), however many it brings (the USA: a map and several packs).

let tail: Promise<unknown> = Promise.resolve();

/** Runs `copy` once every assembly queued before it has finished, failed or not. */
export function oneAssemblyAtATime<T>(copy: () => Promise<T>): Promise<T> {
  const run = tail.then(copy, copy);
  tail = run.catch(() => {});
  return run;
}
