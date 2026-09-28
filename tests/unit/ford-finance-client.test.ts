import {describe, expect, it, vi} from 'vitest';
import {FordFinanceClient} from '../../src/finance/ford-finance-client.js';

describe('FordFinanceClient', () => {
  it('loads the financing page and calls the read-only financing actions with its token', async () => {
    const requests: Array<{url: string; init?: RequestInit}> = [];
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({url: String(input), init});
      if (String(input).includes('/Financiamiento/')) {
        return new Response(
          `
          <input id="htkn" value="secret-token">
          <input id="hDisId" value="dealer-123">
          <input id="hAutos" value='[{"modelo":"Territory","anio":"26","claveGen":"TERR26"}]'>
        `,
          {
            status: 200,
            headers: {
              'set-cookie': 'ASP.NET_SessionId=finance-session; Path=/',
            },
          },
        );
      }

      const body = String(init?.body);
      if (body.includes('GetPlanesActivosPorClaveGen')) {
        return Response.json({xsID: [{xsID: 'TERR26'}]});
      }
      if (body.includes('GetPlanesActivosPorVersion')) {
        return Response.json({
          Versiones: [
            {
              VersionJato: 'Titanium',
              precioLista: 789900,
              IDClaveVersion: 'VERSION-1',
            },
          ],
        });
      }
      if (body.includes('GetPlanes')) {
        return Response.json({
          Planes: [
            {
              plaID: 1,
              plaNombre: 'Enganche desde 10%',
              plaBono: 0,
              plaIva1: 0,
              plaInv: 0,
              plaEngMax: 80,
            },
          ],
          Plazos: [{plaid: 1, tasa: 13.79, EngancheMin: 10, plazo: 60}],
          Seguros: [{Precio: 0}, {Precio: 0}],
          Mensaje: [{Mensaje: 'Subject to credit approval.'}],
        });
      }
      if (body.includes('CargaPromociones')) {
        return Response.json([
          {Nombre: 'Bronco Sport', Corporativa: 'False', ListaDist: 'todas'},
        ]);
      }
      return new Response('[]', {status: 200});
    });

    const client = new FordFinanceClient({
      baseUrl: new URL('https://www.forduruapan.mx'),
      fetcher,
    });

    const bootstrap = await client.loadBootstrap();
    expect(bootstrap.dealerId).toBe('dealer-123');
    expect(bootstrap.vehicles).toEqual([
      {modelName: 'Territory', modelYear: 2026, vehicleKey: 'TERR26'},
    ]);

    await expect(client.getActiveVehicleKeys()).resolves.toEqual(['TERR26']);
    await expect(client.getVersionsByVehicleKey('TERR26')).resolves.toEqual({
      Versiones: [
        {
          VersionJato: 'Titanium',
          precioLista: 789900,
          IDClaveVersion: 'VERSION-1',
        },
      ],
    });
    await expect(client.getPlansByVersion('VERSION-1')).resolves.toMatchObject({
      Planes: [{plaNombre: 'Enganche desde 10%'}],
      Plazos: [{tasa: 13.79, plazo: 60}],
    });
    await expect(client.getPromotions()).resolves.toEqual([
      {Nombre: 'Bronco Sport', Corporativa: 'False', ListaDist: 'todas'},
    ]);

    expect(requests[1].url).toBe(
      'https://www.forduruapan.mx/info/consultas.ashx',
    );
    const headers = new Headers(requests[1].init?.headers);
    expect(headers.get('stkn')).toBe('secret-token');
    expect(headers.get('accept')).toBe('application/json, text/plain, */*');
    expect(headers.get('cookie')).toBe('ASP.NET_SessionId=finance-session');
    expect(headers.get('referer')).toBe(
      'https://www.forduruapan.mx/Financiamiento/',
    );
    expect(String(requests[1].init?.body)).toContain(
      'r=GetPlanesActivosPorClaveGen',
    );
    expect(String(requests[1].init?.body)).toContain('x=');
  });

  it('does not expose the token when the financing endpoint fails', async () => {
    const fetcher = vi.fn(async (_input: string | URL) => {
      if (String(_input).includes('/Financiamiento/'))
        return new Response(
          '<input id="htkn" value="secret-token"><input id="hDisId" value="dealer">',
          {status: 200},
        );
      return new Response('upstream failure', {status: 503});
    });
    const client = new FordFinanceClient({
      baseUrl: new URL('https://www.forduruapan.mx'),
      fetcher,
    });

    await expect(client.getActiveVehicleKeys()).rejects.toThrow(
      'Financing endpoint returned HTTP 503',
    );
    expect(fetcher.mock.results[1]?.value).toBeDefined();
  });

  it('continues when the current SSR page omits the optional token field', async () => {
    let actionHeaders: Headers | undefined;
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/Financiamiento/'))
        return new Response(
          '<input id="hDisId" value="dealer"><input id="hAutos" value="[]">',
          {status: 200},
        );
      actionHeaders = new Headers(init?.headers);
      return Response.json({xsID: ['TERR26']});
    });
    const client = new FordFinanceClient({
      baseUrl: new URL('https://www.forduruapan.mx'),
      fetcher,
    });

    await expect(client.getActiveVehicleKeys()).resolves.toEqual(['TERR26']);
    expect(actionHeaders?.get('stkn')).toBe('');
  });
});
