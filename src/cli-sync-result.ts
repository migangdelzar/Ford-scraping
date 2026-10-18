import type {SyncRunCounters} from './domain/sync.js';

export function syncCommandExitCode(counters: SyncRunCounters): 0 | 1 {
  return (counters.pagesFailed ?? 0) > 0 ||
    (counters.embeddingFailures ?? 0) > 0
    ? 1
    : 0;
}
