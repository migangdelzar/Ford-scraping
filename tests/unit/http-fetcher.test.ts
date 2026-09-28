import {describe, expect, it} from 'vitest';
import {
  HttpPageFetcher,
  HttpStatusError,
} from '../../src/crawl/http-fetcher.js';

describe('HttpPageFetcher', () => {
  it('sends browser-like headers and returns a hashed HTML page', async () => {
    const requests: RequestInit[] = [];
    const fetcher = new HttpPageFetcher(async (_input, init) => {
      requests.push(init ?? {});
      return new Response('<html>Ford</html>', {
        status: 200,
        headers: {'content-type': 'text/html; charset=utf-8'},
      });
    });

    const page = await fetcher.fetch('https://www.forduruapan.mx/Todos/', {
      referer: 'https://www.forduruapan.mx/',
    });

    expect(page.status).toBe(200);
    expect(page.rawHtml).toBe('<html>Ford</html>');
    expect(page.contentHash).toHaveLength(64);
    expect(requests[0]?.headers).toEqual(
      expect.objectContaining({
        accept: expect.stringContaining('text/html'),
        'accept-language': expect.stringContaining('es-MX'),
        referer: 'https://www.forduruapan.mx/',
        'user-agent': expect.stringContaining('Mozilla/5.0'),
      }),
    );
  });

  it('retries a transient response and preserves session cookies', async () => {
    let attempts = 0;
    const requests: RequestInit[] = [];
    const fetcher = new HttpPageFetcher(async (_input, init) => {
      attempts += 1;
      requests.push(init ?? {});
      if (attempts === 1) return new Response('busy', {status: 503});
      return new Response('ok', {
        status: 200,
        headers: {
          'set-cookie': 'ASP.NET_SessionId=session-1; Path=/; HttpOnly',
        },
      });
    });

    await fetcher.fetch('https://www.forduruapan.mx/Financiamiento/');
    await fetcher.fetch('https://www.forduruapan.mx/info/consultas.ashx');

    expect(attempts).toBe(3);
    expect(requests[1]?.headers).not.toEqual(
      expect.objectContaining({cookie: expect.any(String)}),
    );
    expect(requests[2]?.headers).toEqual(
      expect.objectContaining({cookie: 'ASP.NET_SessionId=session-1'}),
    );
  });

  it('rejects non-success responses after retry attempts', async () => {
    const fetcher = new HttpPageFetcher(
      async () => new Response('not found', {status: 404}),
    );

    await expect(
      fetcher.fetch('https://www.forduruapan.mx/missing'),
    ).rejects.toBeInstanceOf(HttpStatusError);
  });

  it('supports a read-only form POST while reusing the HTTP session', async () => {
    const requests: RequestInit[] = [];
    const fetcher = new HttpPageFetcher(async (_input, init) => {
      requests.push(init ?? {});
      if (requests.length === 1)
        return new Response('page', {
          status: 200,
          headers: {'set-cookie': 'ASP.NET_SessionId=session-2; Path=/'},
        });
      return Response.json({LiAutos: []});
    });

    await fetcher.fetch('https://www.forduruapan.mx/Seminuevos/');
    await expect(
      fetcher.postJson(
        'https://www.forduruapan.mx/SeminuevosMotorV3/info/consultas.aspx',
        {
          r: 'CheckDist',
        },
      ),
    ).resolves.toEqual({LiAutos: []});
    expect(requests[1]?.method).toBe('POST');
    expect(requests[1]?.headers).toEqual(
      expect.objectContaining({
        cookie: 'ASP.NET_SessionId=session-2',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      }),
    );
  });
});
