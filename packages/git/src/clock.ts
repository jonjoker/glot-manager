/**
 * An injectable clock. Commit timestamps must never come from `Date.now()`
 * directly — threading a {@link Clock} through the engine keeps commits
 * reproducible (identical inputs → identical SHAs) and lets tests pin time.
 */
export interface Clock {
  now(): Date;
}

/** The real wall clock. */
export const systemClock: Clock = {
  now: () => new Date(),
};

/** A frozen clock that always returns the same instant. Handy in tests. */
export function fixedClock(at: Date | string): Clock {
  const date = typeof at === 'string' ? new Date(at) : at;
  return { now: () => new Date(date.getTime()) };
}
