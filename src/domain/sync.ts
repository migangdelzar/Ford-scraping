import {createHash} from 'node:crypto';
import type {UsedVehicleCandidate} from './contracts.js';

export interface UsedVehicleSyncSummary {
  seen: number;
  changed: number;
  deactivated: number;
}

export interface SyncRunCounters {
  pagesFetched?: number;
  pagesChanged?: number;
  pagesFailed?: number;
  vehiclesUpserted?: number;
  usedVehiclesSeen?: number;
  usedVehiclesDeactivated?: number;
  offersUpserted?: number;
  documentsPending?: number;
  embeddingsReady?: number;
  embeddingFailures?: number;
  [key: string]: number | undefined;
}

export function hashUsedVehicle(candidate: UsedVehicleCandidate): string {
  const identity = {
    inventoryId: candidate.inventoryId,
    title: candidate.title,
    price: candidate.price,
    currency: candidate.currency,
    mileageKm: candidate.mileageKm,
    transmission: candidate.transmission,
    imageUrls: candidate.imageUrls,
    detailUrl: candidate.detailUrl,
  };
  return createHash('sha256')
    .update(JSON.stringify(identity), 'utf8')
    .digest('hex');
}
