import {createHash} from 'node:crypto';

export interface HttpFetchOptions {
  referer?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

export interface FetchedHttpPage {
  url: string;
  status: number;
  contentType?: string;
  rawHtml: string;
  contentHash: string;
}

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP GET ${url} returned status ${status}`);
    this.name = 'HttpStatusError';
  }
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  addFrom(response: Response): void {
    const headers = response.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const values = headers.getSetCookie?.() ?? [
      headers.get('set-cookie') ?? '',
    ];
    for (const value of values) {
      const [pair] = value.split(';', 1);
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      this.cookies.set(
        pair.slice(0, separator).trim(),
        pair.slice(separator + 1).trim(),
      );
    }
  }

  header(): string | undefined {
    if (!this.cookies.size) return undefined;
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
}

const DEFAULT_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'es-MX,es;q=0.9,en;q=0.8',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36 FordUruapanSync/1.0',
};

export class HttpPageFetcher {
  private readonly cookies = new CookieJar();

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async fetch(
    url: string,
    options: HttpFetchOptions = {},
  ): Promise<FetchedHttpPage> {
    const maxAttempts = Math.max(options.maxAttempts ?? 3, 1);
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxBodyBytes = options.maxBodyBytes ?? 10 * 1024 * 1024;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const cookie = this.cookies.header();
        const response = await this.fetcher(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            ...DEFAULT_HEADERS,
            ...(options.referer ? {referer: options.referer} : {}),
            ...(cookie ? {cookie} : {}),
          },
        });
        this.cookies.addFrom(response);
        const retryable = response.status === 429 || response.status >= 500;
        if (!response.ok) {
          if (!retryable || attempt === maxAttempts)
            throw new HttpStatusError(response.status, url);
          await this.delay(attempt);
          continue;
        }
        const rawHtml = await response.text();
        if (Buffer.byteLength(rawHtml, 'utf8') > maxBodyBytes)
          throw new Error(`HTTP response exceeded ${maxBodyBytes} bytes`);
        return {
          url,
          status: response.status,
          contentType: response.headers.get('content-type') ?? undefined,
          rawHtml,
          contentHash: createHash('sha256').update(rawHtml).digest('hex'),
        };
      } catch (error) {
        lastError = error;
        const retryable =
          !(error instanceof HttpStatusError) || error.status >= 500;
        if (!retryable || attempt === maxAttempts) throw error;
        await this.delay(attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async postJson<T>(
    url: string,
    body: Record<string, string>,
    options: HttpFetchOptions = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 30_000,
    );
    try {
      const cookie = this.cookies.header();
      const response = await this.fetcher(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          ...DEFAULT_HEADERS,
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          ...(options.referer ? {referer: options.referer} : {}),
          ...(cookie ? {cookie} : {}),
        },
        body: new URLSearchParams(body),
      });
      this.cookies.addFrom(response);
      if (!response.ok) throw new HttpStatusError(response.status, url);
      return JSON.parse(await response.text()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async delay(attempt: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 25 * 2 ** (attempt - 1)));
  }
}
