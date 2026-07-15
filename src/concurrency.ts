/** Runs `worker` over every item with at most `limit` in flight at once. */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;

  async function next(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      await worker(item);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
}
