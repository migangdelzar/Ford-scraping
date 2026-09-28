import {
  EmbeddingUnavailableError,
  type EmbeddingJobRepository,
  type EmbeddingProvider,
} from './provider.js';

const EMBEDDING_BATCH_SIZE = 16;

export interface EmbeddingRunSummary {
  pending: number;
  embedded: number;
  failed: number;
}

export class EmbeddingWorker {
  constructor(
    private readonly repository: EmbeddingJobRepository,
    private readonly provider: EmbeddingProvider,
  ) {}

  async run(options: {limit: number}): Promise<EmbeddingRunSummary> {
    const jobs = await this.repository.listPending(options.limit);
    if (!jobs.length) return {pending: 0, embedded: 0, failed: 0};
    if (!this.provider.available)
      return {pending: jobs.length, embedded: 0, failed: 0};

    let embedded = 0;
    let failed = 0;
    for (let offset = 0; offset < jobs.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = jobs.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      try {
        const vectors = await this.provider.embed(
          batch.map(job => job.content),
        );
        for (let index = 0; index < batch.length; index += 1) {
          await this.repository.saveReady(
            batch[index].documentId,
            vectors[index],
            this.provider.model,
          );
        }
        embedded += batch.length;
      } catch (error) {
        const message =
          error instanceof EmbeddingUnavailableError
            ? error.message
            : String(error);
        for (const job of batch)
          await this.repository.markFailed(job.documentId, message);
        failed += batch.length;
      }
    }
    return {pending: 0, embedded, failed};
  }
}
