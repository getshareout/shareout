// @vitest-environment node
/** Per-test cleanup — imported by every slides handler suite. */
import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});
