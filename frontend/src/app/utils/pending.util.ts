import type { WritableSignal } from '@angular/core';

export async function runWithPending<T>(
  pending: WritableSignal<boolean>,
  task: () => Promise<T>
): Promise<T | undefined> {
  if (pending()) return undefined;
  pending.set(true);
  try {
    return await task();
  } finally {
    pending.set(false);
  }
}
