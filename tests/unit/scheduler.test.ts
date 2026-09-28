import {describe, expect, it, vi} from 'vitest';
import {DailySyncScheduler} from '../../src/scheduler.js';

describe('DailySyncScheduler', () => {
  it('registers the sync at the configured local time zone', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const schedule = vi.fn().mockReturnValue({stop: vi.fn()});
    const scheduler = new DailySyncScheduler({schedule}, run);

    scheduler.start({schedule: '0 12 * * *', timezone: 'America/Mexico_City'});

    expect(schedule).toHaveBeenCalledWith('0 12 * * *', expect.any(Function), {
      timezone: 'America/Mexico_City',
      noOverlap: true,
    });
    const callback = schedule.mock.calls[0][1] as () => Promise<void>;
    await callback();
    expect(run).toHaveBeenCalledOnce();
  });
});
