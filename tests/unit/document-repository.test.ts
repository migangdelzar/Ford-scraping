import {describe, expect, it, vi} from 'vitest';
import {DocumentRepository} from '../../src/storage/document-repository.js';

describe('DocumentRepository', () => {
  it('removes only stale chunks from the requested semantic section', async () => {
    const query = vi.fn().mockResolvedValue({rowCount: 2});
    const repository = new DocumentRepository({query} as never);

    await repository.pruneDocumentChunks(
      {modelId: 'model-1', modelYearId: 'year-1'},
      'vehicle_profile',
      'vehicle_profile',
      4,
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM ford.documents'),
      ['year-1', 'vehicle_profile', 'vehicle_profile', 4],
    );
  });
});
