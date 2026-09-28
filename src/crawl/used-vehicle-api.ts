import {parseMoney, sanitizeText} from './text-normalization.js';
import type {UsedVehicleCandidate} from '../domain/contracts.js';

export interface UsedVehicleApiRow {
  AutId?: string;
  Marca?: string;
  Modelo?: string;
  Version?: string;
  Precio?: string;
  Kilometraje?: string;
  Transmision?: string;
  RegAuto?: string;
  Directorio?: string;
  UrlDist?: string;
  ClaveMarca?: string;
  PathWZ?: string;
  Extension?: string;
}

export interface UsedVehicleApiResponse {
  LiAutos?: UsedVehicleApiRow[];
}

export type UsedVehicleApiRequest = () => Promise<UsedVehicleApiResponse>;

export class UsedVehicleInventoryClient {
  constructor(
    private readonly request: UsedVehicleApiRequest,
    private readonly sourceUrl: string,
  ) {}

  async fetch(): Promise<UsedVehicleCandidate[]> {
    const response = await this.request();
    return (response.LiAutos ?? []).flatMap(row => {
      const inventoryId = sanitizeText(row.AutId);
      const model = sanitizeText(row.Modelo);
      if (!inventoryId || !model) return [];
      const brand = sanitizeText(row.Marca);
      const version = sanitizeText(row.Version);
      const title = [brand, model, version].filter(Boolean).join(' ');
      return [
        {
          inventoryId,
          title,
          price: parseMoney(row.Precio),
          currency: 'MXN',
          mileageKm: parseNumeric(row.Kilometraje),
          transmission: parseTransmission(row.Transmision),
          imageUrls: [buildImageUrl(row)],
          detailUrl: `${new URL('/Seminuevos/', this.sourceUrl).toString()}${inventoryId}`,
          sourceUrl: this.sourceUrl,
          metadata: {extraction: 'seminuevos-checkdist'},
        },
      ];
    });
  }
}

function buildImageUrl(row: UsedVehicleApiRow): string {
  const url = new URL(
    '/SeminuevosMotorV3/BuscaFoto/BF2.ashx',
    row.UrlDist ? `https://${row.UrlDist}` : 'https://www.forduruapan.mx',
  );
  url.search = new URLSearchParams({
    AutoID: row.AutId ?? '',
    tumb: '0',
    numFoto: '0',
    id: row.RegAuto ?? '',
    dir: row.Directorio ?? '',
    url: row.UrlDist ?? '',
    mar: row.ClaveMarca ?? '',
    pwz: row.PathWZ ?? '',
    ext: row.Extension ?? '',
  }).toString();
  return url.toString();
}

function parseNumeric(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTransmission(
  value: string | undefined,
): UsedVehicleCandidate['transmission'] {
  const normalized = sanitizeText(value)?.toLocaleLowerCase('es-MX');
  if (!normalized) return undefined;
  if (normalized.includes('autom')) return 'automatic';
  if (normalized.includes('manual')) return 'manual';
  return 'other';
}
