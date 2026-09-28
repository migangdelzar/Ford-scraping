export interface SearchObservation {
  operation: 'search.vehicles' | 'search.offers';
  query: string;
  filters: Record<string, unknown>;
  latencyMs: number;
  candidateCount: number;
  resultCount: number;
  semanticSearch: 'ready' | 'unavailable';
  topResultId?: string;
  topScore?: number;
  error?: string;
}

export interface SearchObservability {
  record(observation: SearchObservation): Promise<void>;
}

export class NoopSearchObservability implements SearchObservability {
  async record(observation: SearchObservation): Promise<void> {
    void observation;
  }
}
