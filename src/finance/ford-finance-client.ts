import {load} from 'cheerio';

export interface FinanceVehicleReference {
  modelName: string;
  modelYear: number;
  vehicleKey: string;
}

export interface FinanceBootstrap {
  dealerId: string;
  vehicles: FinanceVehicleReference[];
}

export interface FinanceClientOptions {
  baseUrl: URL;
  fetcher?: FinanceFetcher;
}

export type FinanceFetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ActiveVehicleKeyResponse {
  xsID?: Array<string | {xsID?: string}>;
}

export interface ActiveVersionResponse {
  Versiones?: Array<Record<string, unknown>>;
}

export interface FinancingPlanResponse {
  Planes?: Array<Record<string, unknown>>;
  Plazos?: Array<Record<string, unknown>>;
  Seguros?: Array<Record<string, unknown>>;
  Mensaje?: Array<Record<string, unknown>>;
}

type FinanceSession = FinanceBootstrap & {token: string};

export class FordFinanceClient {
  private readonly baseUrl: URL;
  private readonly fetcher: FinanceFetcher;
  private session?: FinanceSession;
  private cookie = '';

  constructor(options: FinanceClientOptions) {
    this.baseUrl = new URL(options.baseUrl.toString());
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async loadBootstrap(): Promise<FinanceBootstrap> {
    const session = await this.getSession();
    return {dealerId: session.dealerId, vehicles: session.vehicles};
  }

  async getActiveVehicleKeys(): Promise<string[]> {
    const response = await this.postAction<ActiveVehicleKeyResponse>(
      'GetPlanesActivosPorClaveGen',
    );
    return [
      ...new Set(
        (response.xsID ?? [])
          .map(value => (typeof value === 'string' ? value : value.xsID))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
  }

  async getVersionsByVehicleKey(
    vehicleKey: string,
  ): Promise<ActiveVersionResponse> {
    return this.postAction<ActiveVersionResponse>(
      'GetPlanesActivosPorVersion',
      {clavegen: vehicleKey},
    );
  }

  async getPlansByVersion(versionId: string): Promise<FinancingPlanResponse> {
    return this.postAction<FinancingPlanResponse>('GetPlanes', {
      idclaveversion: versionId,
    });
  }

  async getPromotions(): Promise<Array<Record<string, unknown>>> {
    const session = await this.getSession();
    const response = await this.postAction<unknown>('CargaPromociones', {
      claveDisid: session.dealerId,
    });
    return Array.isArray(response) ? response.filter(isRecord) : [];
  }

  private async getSession(): Promise<FinanceSession> {
    if (this.session) return this.session;

    const response = await this.request(
      new URL('/Financiamiento/', this.baseUrl),
    );
    if (!response.ok) {
      throw new Error(`Financing page returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);
    const token = $('#htkn').attr('value')?.trim() ?? '';
    const dealerId = $('#hDisId').attr('value')?.trim();
    if (!dealerId) {
      throw new Error('Financing page is missing its required session fields');
    }

    const vehicles = parseVehicleReferences($('#hAutos').attr('value'));
    this.session = {token, dealerId, vehicles};
    return this.session;
  }

  private async postAction<T>(
    action: string,
    parameters: Record<string, string> = {},
  ): Promise<T> {
    const session = await this.getSession();
    const body = new URLSearchParams({
      r: action,
      ...parameters,
      x: Math.random().toString(),
    });
    const response = await this.request(
      new URL('/info/consultas.ashx', this.baseUrl),
      {
        method: 'POST',
        headers: {
          stkn: session.token,
          accept: 'application/json, text/plain, */*',
          referer: new URL('/Financiamiento/', this.baseUrl).toString(),
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body,
      },
    );
    if (!response.ok) {
      throw new Error(`Financing endpoint returned HTTP ${response.status}`);
    }

    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Financing action ${action} returned invalid JSON`);
    }
  }

  private async request(
    input: string | URL,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('accept', headers.get('accept') ?? 'text/html, */*');
    headers.set(
      'accept-language',
      headers.get('accept-language') ?? 'es-MX,es;q=0.9,en;q=0.8',
    );
    headers.set(
      'user-agent',
      headers.get('user-agent') ??
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36 FordUruapanSync/1.0',
    );
    if (this.cookie) headers.set('cookie', this.cookie);

    const response = await this.fetcher(input, {...init, headers});
    this.captureCookies(response.headers);
    return response;
  }

  private captureCookies(headers: Headers): void {
    const setCookies =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : splitSetCookieHeader(headers.get('set-cookie'));
    if (setCookies.length === 0) return;

    const values = new Map<string, string>();
    for (const cookie of this.cookie.split('; ').filter(Boolean)) {
      const separator = cookie.indexOf('=');
      if (separator > 0) values.set(cookie.slice(0, separator), cookie);
    }
    for (const cookie of setCookies) {
      const value = cookie.split(';', 1)[0]?.trim();
      const separator = value?.indexOf('=') ?? -1;
      if (value && separator > 0) {
        values.set(value.slice(0, separator), value);
      }
    }
    this.cookie = [...values.values()].join('; ');
  }
}

function splitSetCookieHeader(value: string | null): string[] {
  return value ? value.split(/,(?=[^;,]+=)/) : [];
}

function parseVehicleReferences(
  rawValue: string | undefined,
): FinanceVehicleReference[] {
  if (!rawValue) return [];
  try {
    const values: unknown = JSON.parse(rawValue);
    if (!Array.isArray(values)) return [];
    return values.flatMap(value => {
      if (!isRecord(value)) return [];
      const modelName = asString(value.modelo);
      const vehicleKey = asString(value.claveGen);
      const rawYear = asString(value.anio);
      const modelYear = rawYear
        ? rawYear.length === 2
          ? Number(`20${rawYear}`)
          : Number(rawYear)
        : NaN;
      return modelName && vehicleKey && Number.isInteger(modelYear)
        ? [{modelName, modelYear, vehicleKey}]
        : [];
    });
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : undefined;
}
