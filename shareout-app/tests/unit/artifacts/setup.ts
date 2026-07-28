// @vitest-environment node
/** Per-test cleanup — imported by every artifact handler suite. */
import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});
