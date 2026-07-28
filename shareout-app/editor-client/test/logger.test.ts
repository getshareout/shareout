import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../src/editor/logger';

describe('createLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefixes messages with scope', () => {
    const log = createLogger('canvas');
    log.info('ready');
    expect(console.info).toHaveBeenCalledWith('[Editor:canvas] ready');
  });

  it('respects minimum log level', () => {
    const log = createLogger('test', 'warn');
    log.info('hidden');
    log.warn('shown');
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });
});
