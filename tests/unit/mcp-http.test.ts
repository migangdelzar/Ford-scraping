import {describe, expect, it, vi} from 'vitest';
import type {McpServices} from '../../src/mcp/server.js';
import {startMcpHttpServer, type McpHttpConfig} from '../../src/mcp/http.js';

function services(): McpServices {
  return {
    search: {
      search: vi.fn().mockResolvedValue({
        query: 'SUV',
        results: [],
        semanticSearch: 'unavailable',
      }),
    },
    vehicles: {
      getByModelYear: vi.fn(),
      getAvailableModelYears: vi.fn().mockResolvedValue([]),
      compare: vi.fn(),
    },
    provenance: {get: vi.fn()},
    links: {getPageLinks: vi.fn().mockResolvedValue(null)},
    promotions: {list: vi.fn()},
    offers: {
      searchOffers: vi.fn().mockResolvedValue({
        query: 'financing',
        results: [],
        semanticSearch: 'unavailable',
      }),
    },
    catalog: {status: vi.fn()},
    comparisons: {
      compareTrims: vi.fn(),
      compareModelYears: vi.fn(),
      getVariantComparisons: vi.fn(),
    },
  };
}

const config: McpHttpConfig = {
  host: '127.0.0.1',
  port: 0,
  bearerToken: 'test-token',
  allowedOrigins: ['https://assistant.example'],
  allowedHosts: ['127.0.0.1'],
};

async function endpoint(
  server: Awaited<ReturnType<typeof startMcpHttpServer>>,
) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}/mcp`;
}

describe('MCP Streamable HTTP server', () => {
  it('rejects requests without the configured bearer token', async () => {
    const server = await startMcpHttpServer(services(), config);
    try {
      const response = await fetch(await endpoint(server), {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize'}),
      });

      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('serves MCP initialization over HTTP with valid auth and origin', async () => {
    const server = await startMcpHttpServer(services(), config);
    try {
      const response = await fetch(await endpoint(server), {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
          origin: 'https://assistant.example',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: {name: 'test-client', version: '1.0.0'},
          },
        }),
      });

      expect(response.status).toBe(200);
      const responseText = await response.text();
      const dataLine = responseText
        .split('\n')
        .find(line => line.startsWith('data: '));
      const body = JSON.parse(dataLine?.slice('data: '.length) ?? '{}') as {
        result?: {serverInfo?: {name?: string}};
      };
      expect(body.result?.serverInfo?.name).toBe('ford-uruapan-hybrid-search');
    } finally {
      await server.close();
    }
  });

  it('rejects a disallowed origin', async () => {
    const server = await startMcpHttpServer(services(), config);
    try {
      const response = await fetch(await endpoint(server), {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
          origin: 'https://untrusted.example',
        },
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize'}),
      });

      expect(response.status).toBe(403);
    } finally {
      await server.close();
    }
  });
});
