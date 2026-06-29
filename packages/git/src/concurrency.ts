/**
 * Run `task` over `items` with at most `limit` concurrent executions, preserving
 * input order in the result. Keeps backends from firing hundreds of simultaneous
 * requests (GitHub rate limits) or child processes (system git) at once.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await task(items[index] as T, index);
    }
  };
  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}
