/** Evaluate an editor script string and return the global class it registers. */
export function loadEditorClass<T>(
  script: string,
  globalName: string,
): new (...args: unknown[]) => T {
  // eslint-disable-next-line no-eval
  eval(script);
  const ctor = (globalThis as Record<string, unknown>)[globalName];
  if (typeof ctor !== 'function') {
    throw new Error(`Expected ${globalName} on globalThis after eval`);
  }
  return ctor as new (...args: unknown[]) => T;
}

/** DashboardEditor renders widget bodies on the next animation frame. */
export async function flushAnimationFrames(count = 2): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}
