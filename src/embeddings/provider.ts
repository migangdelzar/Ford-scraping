export interface EmbeddingJobRepository {
  listPending(
    limit: number,
  ): Promise<Array<{documentId: string; content: string}>>;
  saveReady(
    documentId: string,
    embedding: number[],
    model: string,
  ): Promise<void>;
  markFailed(documentId: string, error: string): Promise<void>;
}

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  readonly available: boolean;
  embed(texts: string[]): Promise<number[][]>;
}

export class EmbeddingUnavailableError extends Error {
  constructor() {
    super('Embedding provider is unavailable because no API key is configured');
    this.name = 'EmbeddingUnavailableError';
  }
}

interface EmbeddingProviderOptions {
  provider?: 'ollama' | 'openai';
  apiKey?: string;
  apiUrl?: URL;
  model?: string;
  dimensions?: number;
  fetchImpl?: typeof fetch;
}

export function createEmbeddingProvider(
  options: EmbeddingProviderOptions,
): EmbeddingProvider {
  const provider = options.provider ?? 'openai';
  const model =
    options.model ??
    (provider === 'ollama' ? 'bge-m3' : 'text-embedding-3-small');
  const dimensions = options.dimensions ?? 1024;
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl =
    options.apiUrl ??
    new URL(
      provider === 'ollama'
        ? 'http://127.0.0.1:11434/api/embed'
        : 'https://api.openai.com/v1/embeddings',
    );
  return {
    model,
    dimensions,
    available: provider === 'ollama' || Boolean(options.apiKey),
    async embed(texts: string[]): Promise<number[][]> {
      if (provider === 'openai' && !options.apiKey)
        throw new EmbeddingUnavailableError();
      const response = await fetchImpl(apiUrl, {
        method: 'POST',
        headers: {
          ...(provider === 'openai'
            ? {authorization: `Bearer ${options.apiKey}`}
            : {}),
          'content-type': 'application/json',
        },
        body: JSON.stringify(
          provider === 'ollama'
            ? {model, input: texts}
            : {model, input: texts, dimensions},
        ),
      });
      if (!response.ok)
        throw new Error(`Embedding provider returned HTTP ${response.status}`);
      const body = (await response.json()) as {
        data?: Array<{embedding?: number[]}>;
        embeddings?: number[][];
      };
      const vectors =
        provider === 'ollama'
          ? (body.embeddings ?? [])
          : (body.data?.map(item => item.embedding ?? []) ?? []);
      if (
        vectors.length !== texts.length ||
        vectors.some(vector => vector.length !== dimensions)
      ) {
        throw new Error(
          'Embedding provider returned an unexpected vector shape',
        );
      }
      return vectors;
    },
  };
}
