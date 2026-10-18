import {describe, expect, it} from 'vitest';
import {loadConfig} from '../../src/config.js';

describe('loadConfig', () => {
  it('accepts a database and base URL without embedding credentials', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/ford',
      FORD_BASE_URL: 'https://www.forduruapan.mx',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3',
      EMBEDDING_DIMENSIONS: '1024',
    });

    expect(config.embedding.apiKey).toBeUndefined();
    expect(config.embedding.provider).toBe('ollama');
    expect(config.embedding.model).toBe('bge-m3');
    expect(config.embedding.dimensions).toBe(1024);
    expect(config.crawl.maxPages).toBe(1000);
    expect(config.sync.schedule).toBe('0 12 1 * *');
    expect(config.sync.timezone).toBe('America/Mexico_City');
    expect(config.langfuse.enabled).toBe(false);
  });

  it('loads optional Langfuse configuration when credentials are present', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/ford',
      FORD_BASE_URL: 'https://www.forduruapan.mx',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_DIMENSIONS: '1024',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      LANGFUSE_BASE_URL: 'https://cloud.langfuse.com',
      LANGFUSE_ENVIRONMENT: 'test',
    });

    expect(config.langfuse).toEqual({
      enabled: true,
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      baseUrl: new URL('https://cloud.langfuse.com'),
      environment: 'test',
    });
  });

  it('rejects a dimension that does not match the pgvector schema', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/ford',
        FORD_BASE_URL: 'https://www.forduruapan.mx',
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_MODEL: 'custom-model',
        EMBEDDING_DIMENSIONS: '768',
      }),
    ).toThrow(/1024/);
  });
});
