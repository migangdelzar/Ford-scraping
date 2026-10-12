import type {SearchRequest, SearchResponse} from '../domain/contracts.js';
import type {EmbeddingProvider} from '../embeddings/provider.js';
import {
  NoopSearchObservability,
  type SearchObservability,
} from '../observability/search-observability.js';
import {fuseScores} from './ranking.js';
import {SearchRepository} from '../storage/search-repository.js';

export class SearchService {
  constructor(
    private readonly repository: SearchRepository,
    private readonly embeddingProvider?: EmbeddingProvider,
    private readonly observability: SearchObservability = new NoopSearchObservability(),
  ) {}

  async search(request: SearchRequest): Promise<SearchResponse> {
    const started = performance.now();
    let candidateCount = 0;
    let semanticSearch: SearchResponse['semanticSearch'] = 'unavailable';
    let response: SearchResponse | undefined;
    let failure: unknown;
    const limit = Math.min(Math.max(request.limit ?? 20, 1), 50);
    try {
      const candidates = await this.repository.findCandidates(request.filters);
      candidateCount = candidates.length;
      const candidateMap = new Map(
        candidates.map(candidate => [candidate.modelYearId, candidate]),
      );
      const keywordHits = await this.repository.searchKeyword(
        request.query,
        candidates,
        limit * 3,
      );
      let semanticHits = [] as Awaited<
        ReturnType<SearchRepository['searchSemantic']>
      >;

      if (this.embeddingProvider?.available) {
        try {
          const [embedding] = await this.embeddingProvider.embed([
            request.query,
          ]);
          semanticHits = await this.repository.searchSemantic(
            embedding,
            candidates,
            limit * 3,
            this.embeddingProvider.model,
          );
          semanticSearch = 'ready';
        } catch {
          semanticSearch = 'unavailable';
        }
      }

      response = {
        query: request.query,
        semanticSearch,
        results: fuseScores(keywordHits, semanticHits, candidateMap, {
          keyword: 0.3,
          semantic: 0.7,
        }).slice(0, limit),
      };
      return response;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      await this.observability
        .record({
          operation: 'search.vehicles',
          query: request.query,
          filters: request.filters ?? {},
          latencyMs: Math.round((performance.now() - started) * 100) / 100,
          candidateCount,
          resultCount: response?.results.length ?? 0,
          semanticSearch,
          topResultId: response?.results[0]?.modelYearId,
          topScore: response?.results[0]?.finalScore,
          error: failure instanceof Error ? failure.message : undefined,
        })
        .catch(() => undefined);
    }
  }
}
