import {describe, expect, it} from 'vitest';
import {syncCommandExitCode} from '../../src/cli-sync-result.js';

describe('syncCommandExitCode', () => {
  it('returns success when crawling and embedding have no failures', () => {
    expect(syncCommandExitCode({pagesFailed: 0, embeddingFailures: 0})).toBe(0);
  });

  it('returns failure when any crawl page failed', () => {
    expect(syncCommandExitCode({pagesFailed: 1, embeddingFailures: 0})).toBe(1);
  });

  it('returns failure when any embedding failed', () => {
    expect(syncCommandExitCode({pagesFailed: 0, embeddingFailures: 2})).toBe(1);
  });
});
