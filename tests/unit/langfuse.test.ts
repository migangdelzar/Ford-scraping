import {describe, expect, it} from 'vitest';
import {createLangfuseTelemetry} from '../../src/observability/langfuse.js';

describe('createLangfuseTelemetry', () => {
  it('creates a no-op telemetry lifecycle when Langfuse is disabled', async () => {
    const telemetry = createLangfuseTelemetry({
      enabled: false,
      baseUrl: new URL('https://cloud.langfuse.com'),
      environment: 'test',
    });

    expect(telemetry.enabled).toBe(false);
    await expect(telemetry.start()).resolves.toBeUndefined();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });
});
