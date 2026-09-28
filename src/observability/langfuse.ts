import {trace, type Tracer} from '@opentelemetry/api';
import {NodeSDK} from '@opentelemetry/sdk-node';
import {isDefaultExportSpan, LangfuseSpanProcessor} from '@langfuse/otel';
import type {AppConfig} from '../config.js';
import {
  NoopSearchObservability,
  type SearchObservation,
  type SearchObservability,
} from './search-observability.js';

export interface LangfuseTelemetry {
  readonly enabled: boolean;
  readonly observability: SearchObservability;
  start(): Promise<void>;
  shutdown(): Promise<void>;
}

class OpenTelemetrySearchObservability implements SearchObservability {
  constructor(private readonly tracer: Tracer) {}

  async record(observation: SearchObservation): Promise<void> {
    const span = this.tracer.startSpan(observation.operation);
    span.setAttributes({
      'search.query': observation.query,
      'search.filters': JSON.stringify(observation.filters),
      'search.latency_ms': observation.latencyMs,
      'search.candidate_count': observation.candidateCount,
      'search.result_count': observation.resultCount,
      'search.semantic_search': observation.semanticSearch,
      ...(observation.topResultId
        ? {'search.top_result_id': observation.topResultId}
        : {}),
      ...(observation.topScore === undefined
        ? {}
        : {'search.top_score': observation.topScore}),
    });

    if (observation.error) {
      span.recordException(observation.error);
      span.setStatus({code: 2, message: observation.error});
    }

    span.end();
  }
}

export function createLangfuseTelemetry(
  config: AppConfig['langfuse'],
): LangfuseTelemetry {
  if (!config.enabled || !config.publicKey || !config.secretKey) {
    return {
      enabled: false,
      observability: new NoopSearchObservability(),
      async start(): Promise<void> {},
      async shutdown(): Promise<void> {},
    };
  }

  const processor = new LangfuseSpanProcessor({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl.toString().replace(/\/$/, ''),
    environment: config.environment,
    mediaUploadEnabled: false,
    shouldExportSpan: ({otelSpan}) =>
      otelSpan.name.startsWith('search.') || isDefaultExportSpan(otelSpan),
  });
  const sdk = new NodeSDK({spanProcessors: [processor]});
  const tracer = trace.getTracer('ford-uruapan-mcp');

  return {
    enabled: true,
    observability: new OpenTelemetrySearchObservability(tracer),
    async start(): Promise<void> {
      try {
        sdk.start();
      } catch {
        // Observability must never prevent MCP/API startup.
      }
    },
    async shutdown(): Promise<void> {
      try {
        await sdk.shutdown();
      } catch {
        // Best-effort flush; process shutdown must remain safe.
      }
    },
  };
}
