export interface ScheduledTask {
  stop(): void;
}

export interface CronSchedulerPort {
  schedule(
    expression: string,
    task: () => Promise<void>,
    options: {timezone: string; noOverlap: boolean},
  ): ScheduledTask;
}

export interface DailySchedule {
  schedule: string;
  timezone: string;
}

export class DailySyncScheduler {
  constructor(
    private readonly cron: CronSchedulerPort,
    private readonly run: () => Promise<void>,
  ) {}

  start(schedule: DailySchedule): ScheduledTask {
    return this.cron.schedule(schedule.schedule, this.run, {
      timezone: schedule.timezone,
      noOverlap: true,
    });
  }
}
