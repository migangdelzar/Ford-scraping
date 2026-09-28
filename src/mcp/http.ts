import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {createMcpHandler} from '@modelcontextprotocol/server';
import {hostHeaderValidation, toNodeHandler} from '@modelcontextprotocol/node';
import {buildMcpServer, type McpServices} from './server.js';

export interface McpHttpConfig {
  host: string;
  port: number;
  bearerToken?: string;
  allowedOrigins: string[];
  allowedHosts: string[];
}

export interface McpHttpServerHandle {
  address(): {host: string; port: number};
  close(): Promise<void>;
}

const MCP_PATH = '/mcp';

function validBearerToken(
  request: IncomingMessage,
  configuredToken: string,
): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return false;

  const receivedToken = authorization.slice('Bearer '.length);
  const expected = Buffer.from(configuredToken);
  const received = Buffer.from(receivedToken);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

function reject(
  response: ServerResponse,
  statusCode: number,
  message: string,
): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({error: message}));
}

function validOrigin(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: string[],
): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;

  if (allowedOrigins.includes(origin)) return true;

  reject(response, 403, 'Origin is not allowed');
  return false;
}

function createRequestHandler(
  services: McpServices,
  config: McpHttpConfig,
): (request: IncomingMessage, response: ServerResponse) => void {
  const bearerToken = config.bearerToken;
  if (!bearerToken) {
    throw new Error('MCP_HTTP_BEARER_TOKEN is required for MCP HTTP');
  }

  const handler = createMcpHandler(() => buildMcpServer(services));
  const nodeHandler = toNodeHandler(handler);
  const validateHost = hostHeaderValidation(config.allowedHosts);

  return (request, response) => {
    const pathname = new URL(
      request.url ?? '/',
      `http://${request.headers.host ?? 'localhost'}`,
    ).pathname;

    if (pathname !== MCP_PATH) {
      reject(response, 404, 'Not found');
      return;
    }

    if (!validBearerToken(request, bearerToken)) {
      response.setHeader('www-authenticate', 'Bearer');
      reject(response, 401, 'Unauthorized');
      return;
    }

    if (!validateHost(request, response)) return;
    if (!validOrigin(request, response, config.allowedOrigins)) return;

    void nodeHandler(request, response);
  };
}

export async function startMcpHttpServer(
  services: McpServices,
  config: McpHttpConfig,
): Promise<McpHttpServerHandle> {
  const requestHandler = createRequestHandler(services, config);
  const server = createServer(requestHandler);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(config.port, config.host);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw new Error('MCP HTTP server did not expose a TCP address');
  }

  return {
    address: () => ({host: config.host, port: address.port}),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      }),
  };
}
