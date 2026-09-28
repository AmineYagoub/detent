/**
 * C-2¹⁶, C-2²³ — `work` on each item, up to `size` at once, the next starting
 * as one ends. A failure stops the taking and lets what is in flight end, so a
 * session that finishes still commits what it made and records its spend; then
 * the first failure is thrown, as a session in sequence threw it. AUDIT's
 * claim checks run through it (PRDR-304), and VALIDATE's reviews (PRDR-313).
 */
export async function inBatches<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const failed: { error?: unknown } = {};
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined && !("error" in failed); item = queue.shift()) {
      try {
        await work(item);
      } catch (error) {
        if (!("error" in failed)) failed.error = error;
      }
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
  if ("error" in failed) throw failed.error;
}
