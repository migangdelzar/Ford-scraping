import type {
  OfferSearchRequest,
  OfferSearchResponse,
  OfferSearchCandidate,
} from '../domain/contracts.js';
import type {EmbeddingProvider} from '../embeddings/provider.js';
import {
  NoopSearchObservability,
  type SearchObservability,
} from '../observability/search-observability.js';
import {fuseOfferScores} from './ranking.js';
import {SearchRepository} from '../storage/search-repository.js';

export class OfferSearchService {
  constructor(
    private readonly repository: SearchRepository,
    private readonly embeddingProvider?: EmbeddingProvider,
    private readonly observability: SearchObservability = new NoopSearchObservability(),
  ) {}

  async searchOffers(
    request: OfferSearchRequest,
  ): Promise<OfferSearchResponse> {
    const started = performance.now();
    let candidateCount = 0;
    let semanticSearch: OfferSearchResponse['semanticSearch'] = 'unavailable';
    let response: OfferSearchResponse | undefined;
    let failure: unknown;
    const limit = Math.min(Math.max(request.limit ?? 20, 1), 50);
    const filters = {
      ...request.filters,
      activeOnly: request.filters?.activeOnly ?? true,
      asOf: request.filters?.asOf ?? new Date().toISOString().slice(0, 10),
    };
    try {
      const candidates = await this.repository.findOfferCandidates(filters);
      candidateCount = candidates.length;
      const candidateMap = new Map<string, OfferSearchCandidate>(
        candidates.map(candidate => [candidate.offerId, candidate]),
      );
      const keywordHits = await this.repository.searchOfferKeyword(
        request.query,
        candidates,
        limit * 3,
      );
      let semanticHits = [] as Awaited<
        ReturnType<SearchRepository['searchOfferSemantic']>
      >;

      if (this.embeddingProvider?.available) {
        try {
          const [embedding] = await this.embeddingProvider.embed([
            request.query,
          ]);
          semanticHits = await this.repository.searchOfferSemantic(
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
        results: fuseOfferScores(keywordHits, semanticHits, candidateMap, {
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
          operation: 'search.offers',
          query: request.query,
          filters,
          latencyMs: Math.round((performance.now() - started) * 100) / 100,
          candidateCount,
          resultCount: response?.results.length ?? 0,
          semanticSearch,
          topResultId: response?.results[0]?.offerId,
          topScore: response?.results[0]?.finalScore,
          error: failure instanceof Error ? failure.message : undefined,
        })
        .catch(() => undefined);
    }
  }
}
