import {describe, expect, it, vi} from 'vitest';
import {
  buildDocuments,
  type VehicleAggregate,
} from '../../src/domain/documents.js';
import {
  createEmbeddingProvider,
  type EmbeddingJobRepository,
} from '../../src/embeddings/provider.js';
import {EmbeddingWorker} from '../../src/embeddings/worker.js';

const sampleVehicleAggregate: VehicleAggregate = {
  modelId: 'model-1',
  modelYearId: 'year-1',
  modelName: 'Territory',
  modelYear: 2026,
  startingPrice: 559900,
  currency: 'MXN',
  category: 'SUVs y Crossovers',
  description: 'Una SUV familiar con espacio.',
  sections: {
    technology: 'Pantalla y conectividad.',
    safety: 'Asistencia al conductor.',
  },
  specifications: [{name: 'Potencia', valueText: '190 hp'}],
};

describe('search documents and embeddings', () => {
  it('creates separate searchable sections for overview, technology, safety, specs, and pricing', () => {
    const docs = buildDocuments(sampleVehicleAggregate);
    expect(docs.map(doc => doc.documentType)).toEqual([
      'overview',
      'technology',
      'safety',
      'specifications',
      'pricing',
    ]);
    expect(docs.find(doc => doc.documentType === 'technology')).toMatchObject({
      sectionKey: 'technology',
      chunkIndex: 0,
    });
    expect(docs.find(doc => doc.documentType === 'pricing')?.content).toContain(
      '$559,900 MXN',
    );
  });

  it('marks embedding work pending when no API key is configured', async () => {
    const repository: EmbeddingJobRepository = {
      listPending: vi
        .fn()
        .mockResolvedValue([
          {documentId: 'doc-1', content: 'Territory tecnología'},
        ]),
      saveReady: vi.fn(),
      markFailed: vi.fn(),
    };
    const worker = new EmbeddingWorker(
      repository,
      createEmbeddingProvider({provider: 'openai', apiKey: undefined}),
    );

    const summary = await worker.run({limit: 10});

    expect(summary).toMatchObject({pending: 1, embedded: 0, failed: 0});
    expect(repository.saveReady).not.toHaveBeenCalled();
  });

  it('uses Ollama without an API key and validates local vectors', async () => {
    const vector = Array.from({length: 1024}, (_, index) => index / 1024);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({embeddings: [vector]}), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );
    const provider = createEmbeddingProvider({
      provider: 'ollama',
      apiUrl: new URL('http://ollama:11434/api/embed'),
      model: 'bge-m3',
      dimensions: 1024,
      fetchImpl,
    });

    const result = await provider.embed(['Territory tecnología']);

    expect(provider.available).toBe(true);
    expect(result[0]).toHaveLength(1024);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('http://ollama:11434/api/embed'),
      expect.objectContaining({
        body: JSON.stringify({
          model: 'bge-m3',
          input: ['Territory tecnología'],
        }),
      }),
    );
  });
});
