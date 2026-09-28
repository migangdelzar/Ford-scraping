import {describe, expect, it, vi} from 'vitest';
import {EmbeddingWorker} from '../../src/embeddings/worker.js';
import type {EmbeddingProvider} from '../../src/embeddings/provider.js';

function vector(): number[] {
  return Array.from({length: 1024}, () => 0);
}

describe('EmbeddingWorker', () => {
  it('sends bounded batches instead of one oversized request', async () => {
    const jobs = Array.from({length: 35}, (_, index) => ({
      documentId: `doc-${index}`,
      content: `Document ${index}`,
    }));
    const repository = {
      listPending: vi.fn().mockResolvedValue(jobs),
      saveReady: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
    const embed = vi.fn(async (texts: string[]) => texts.map(() => vector()));
    const provider: EmbeddingProvider = {
      model: 'test-model',
      dimensions: 1024,
      available: true,
      embed,
    };

    const result = await new EmbeddingWorker(repository, provider).run({
      limit: 100,
    });

    expect(embed.mock.calls.map(([batch]) => batch.length)).toEqual([
      16, 16, 3,
    ]);
    expect(result).toEqual({pending: 0, embedded: 35, failed: 0});
    expect(repository.saveReady).toHaveBeenCalledTimes(35);
  });

  it('continues after one failed batch and marks only that batch failed', async () => {
    const jobs = Array.from({length: 20}, (_, index) => ({
      documentId: `doc-${index}`,
      content: `Document ${index}`,
    }));
    const repository = {
      listPending: vi.fn().mockResolvedValue(jobs),
      saveReady: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
    const embed = vi
      .fn(async (texts: string[]) => texts.map(() => vector()))
      .mockRejectedValueOnce(new Error('temporary provider error'));
    const provider: EmbeddingProvider = {
      model: 'test-model',
      dimensions: 1024,
      available: true,
      embed,
    };

    const result = await new EmbeddingWorker(repository, provider).run({
      limit: 100,
    });

    expect(result).toEqual({pending: 0, embedded: 4, failed: 16});
    expect(repository.markFailed).toHaveBeenCalledTimes(16);
    expect(repository.saveReady).toHaveBeenCalledTimes(4);
  });
});
