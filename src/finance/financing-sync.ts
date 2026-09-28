import type {
  DocumentCandidate,
  OfferCandidate,
  StoredPage,
} from '../domain/contracts.js';
import {buildOfferDocument} from '../domain/offers.js';
import type {OfferRef} from '../storage/offer-repository.js';
import type {
  ActiveVersionResponse,
  FinanceBootstrap,
  FordFinanceClient,
  FinancingPlanResponse,
} from './ford-finance-client.js';
import {normalizeFinancingOffers} from './financing-offers.js';

export interface FinancingClientPort {
  loadBootstrap(): Promise<FinanceBootstrap>;
  getActiveVehicleKeys(): Promise<string[]>;
  getVersionsByVehicleKey(vehicleKey: string): Promise<ActiveVersionResponse>;
  getPlansByVersion(versionId: string): Promise<FinancingPlanResponse>;
}

export interface OfferWriter {
  upsertOffer(candidate: OfferCandidate, page: StoredPage): Promise<OfferRef>;
}

export interface OfferDocumentWriter {
  upsertOfferDocument(
    ref: OfferRef,
    document: DocumentCandidate,
    pageId?: number,
  ): Promise<void>;
}

export interface FinancingSyncSummary {
  activeVehicles: number;
  versions: number;
  offers: number;
}

export class FinancingSyncService {
  constructor(
    private readonly client: FinancingClientPort | FordFinanceClient,
    private readonly offers: OfferWriter,
    private readonly documents: OfferDocumentWriter,
  ) {}

  async sync(page: StoredPage): Promise<FinancingSyncSummary> {
    const bootstrap = await this.client.loadBootstrap();
    const activeVehicleKeys = await this.client.getActiveVehicleKeys();
    const versionsByVehicleKey = new Map<string, ActiveVersionResponse>();
    const plansByVersionId = new Map<string, FinancingPlanResponse>();
    let versionCount = 0;

    for (const vehicleKey of activeVehicleKeys) {
      const versions = await this.client.getVersionsByVehicleKey(vehicleKey);
      versionsByVehicleKey.set(vehicleKey, versions);
      versionCount += versions.Versiones?.length ?? 0;
      for (const version of versions.Versiones ?? []) {
        const versionId = asString(version.IDClaveVersion);
        if (!versionId) continue;
        plansByVersionId.set(
          versionId,
          await this.client.getPlansByVersion(versionId),
        );
      }
    }

    const candidates = normalizeFinancingOffers({
      sourceUrl: page.url,
      vehicles: bootstrap.vehicles,
      versionsByVehicleKey,
      plansByVersionId,
    });

    for (const candidate of candidates) {
      const ref = await this.offers.upsertOffer(candidate, page);
      await this.documents.upsertOfferDocument(
        ref,
        buildOfferDocument({id: ref.offerId, ...candidate}),
        page.id,
      );
    }

    return {
      activeVehicles: activeVehicleKeys.length,
      versions: versionCount,
      offers: candidates.length,
    };
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : undefined;
}
