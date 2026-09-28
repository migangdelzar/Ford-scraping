import {describe, expect, it, vi} from 'vitest';
import {OfferSearchService} from '../../src/search/offer-search-service.js';
import type {SearchObservability} from '../../src/observability/search-observability.js';
import {SearchService} from '../../src/search/search-service.js';
import type {SearchRepository} from '../../src/storage/search-repository.js';

function observer(): SearchObservability & {
  record: ReturnType<typeof vi.fn>;
} {
  return {
    record: vi.fn().mockResolvedValue(undefined),
  };
}

describe('search observability', () => {
  it('records vehicle search metadata after ranking', async () => {
    const telemetry = observer();
    const repository = {
      findCandidates: vi.fn().mockResolvedValue([
        {
          modelId: 'model-1',
          modelYearId: 'year-1',
          modelName: 'Territory',
          modelYear: 2026,
          price: 559900,
        },
      ]),
      searchKeyword: vi.fn().mockResolvedValue([
        {
          documentId: 'doc-1',
          modelYearId: 'year-1',
          documentType: 'overview',
          title: 'Territory overview',
          content: 'familia',
          score: 0.8,
        },
      ]),
      searchSemantic: vi.fn().mockResolvedValue([]),
    } as unknown as SearchRepository;

    const service = new SearchService(repository, undefined, telemetry);
    const response = await service.search({query: 'familia', limit: 5});

    expect(response.results).toHaveLength(1);
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'search.vehicles',
        query: 'familia',
        candidateCount: 1,
        resultCount: 1,
        semanticSearch: 'unavailable',
        topResultId: 'year-1',
      }),
    );
  });

  it('records offer search metadata after ranking', async () => {
    const telemetry = observer();
    const repository = {
      findOfferCandidates: vi.fn().mockResolvedValue([
        {
          offerId: 'offer-1',
          title: 'Territory financing',
          offerType: 'financing',
          monthlyPayment: 10657.17,
        },
      ]),
      searchOfferKeyword: vi.fn().mockResolvedValue([
        {
          documentId: 'doc-1',
          modelYearId: '',
          offerId: 'offer-1',
          documentType: 'offer',
          title: 'Territory financing',
          content: 'mensualidad',
          score: 0.9,
        },
      ]),
      searchOfferSemantic: vi.fn().mockResolvedValue([]),
    } as unknown as SearchRepository;

    const service = new OfferSearchService(repository, undefined, telemetry);
    const response = await service.searchOffers({
      query: 'mensualidad',
      limit: 5,
    });

    expect(response.results).toHaveLength(1);
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'search.offers',
        query: 'mensualidad',
        candidateCount: 1,
        resultCount: 1,
        semanticSearch: 'unavailable',
        topResultId: 'offer-1',
      }),
    );
  });
});
