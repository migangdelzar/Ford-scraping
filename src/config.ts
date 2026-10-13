import {z} from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  FORD_BASE_URL: z.string().url(),
  EMBEDDING_PROVIDER: z.enum(['ollama', 'openai']).default('ollama'),
  EMBEDDING_API_URL: z.string().url().optional(),
  EMBEDDING_API_KEY: z.string().min(1).optional(),
  EMBEDDING_MODEL: z.string().min(1).optional(),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1024),
  CRAWL_MAX_PAGES: z.coerce.number().int().positive().default(1000),
  CRAWL_CONCURRENCY: z.coerce.number().int().positive().default(3),
  SYNC_SCHEDULE: z.string().default('0 12 1 * *'),
  SYNC_TIMEZONE: z.string().default('America/Mexico_City'),
  LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
  LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
  LANGFUSE_BASE_URL: z.string().url().default('https://cloud.langfuse.com'),
  LANGFUSE_ENVIRONMENT: z.string().min(1).default('development'),
  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_PORT: z.coerce.number().int().positive().default(3000),
  MCP_HTTP_HOST: z.string().default('127.0.0.1'),
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(3001),
  MCP_HTTP_BEARER_TOKEN: z.string().min(1).optional(),
  MCP_HTTP_ALLOWED_ORIGINS: z.string().default(''),
  MCP_HTTP_ALLOWED_HOSTS: z.string().default('127.0.0.1,localhost'),
});

export interface AppConfig {
  databaseUrl: string;
  fordBaseUrl: URL;
  embedding: {
    provider: 'ollama' | 'openai';
    apiUrl: URL;
    apiKey?: string;
    model: string;
    dimensions: number;
  };
  crawl: {
    maxPages: number;
    concurrency: number;
  };
  sync: {
    schedule: string;
    timezone: string;
  };
  langfuse: {
    enabled: boolean;
    publicKey?: string;
    secretKey?: string;
    baseUrl: URL;
    environment: string;
  };
  http: {
    host: string;
    port: number;
  };
  mcpHttp: {
    host: string;
    port: number;
    bearerToken?: string;
    allowedOrigins: string[];
    allowedHosts: string[];
  };
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.parse(env);

  if (parsed.EMBEDDING_DIMENSIONS !== 1024) {
    throw new Error('The pgvector schema requires EMBEDDING_DIMENSIONS=1024');
  }

  const isOllama = parsed.EMBEDDING_PROVIDER === 'ollama';
  const apiUrl =
    parsed.EMBEDDING_API_URL ??
    (isOllama
      ? 'http://127.0.0.1:11434/api/embed'
      : 'https://api.openai.com/v1/embeddings');

  return {
    databaseUrl: parsed.DATABASE_URL,
    fordBaseUrl: new URL(parsed.FORD_BASE_URL),
    embedding: {
      provider: parsed.EMBEDDING_PROVIDER,
      apiUrl: new URL(apiUrl),
      apiKey: parsed.EMBEDDING_API_KEY,
      model:
        parsed.EMBEDDING_MODEL ??
        (isOllama ? 'bge-m3' : 'text-embedding-3-small'),
      dimensions: parsed.EMBEDDING_DIMENSIONS,
    },
    crawl: {
      maxPages: parsed.CRAWL_MAX_PAGES,
      concurrency: parsed.CRAWL_CONCURRENCY,
    },
    sync: {
      schedule: parsed.SYNC_SCHEDULE,
      timezone: parsed.SYNC_TIMEZONE,
    },
    langfuse: {
      enabled: Boolean(
        parsed.LANGFUSE_PUBLIC_KEY && parsed.LANGFUSE_SECRET_KEY,
      ),
      publicKey: parsed.LANGFUSE_PUBLIC_KEY,
      secretKey: parsed.LANGFUSE_SECRET_KEY,
      baseUrl: new URL(parsed.LANGFUSE_BASE_URL),
      environment: parsed.LANGFUSE_ENVIRONMENT,
    },
    http: {
      host: parsed.HTTP_HOST,
      port: parsed.HTTP_PORT,
    },
    mcpHttp: {
      host: parsed.MCP_HTTP_HOST,
      port: parsed.MCP_HTTP_PORT,
      bearerToken: parsed.MCP_HTTP_BEARER_TOKEN,
      allowedOrigins: parseList(parsed.MCP_HTTP_ALLOWED_ORIGINS),
      allowedHosts: parseList(parsed.MCP_HTTP_ALLOWED_HOSTS),
    },
  };
}
