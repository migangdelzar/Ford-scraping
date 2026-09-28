# MCP Observability and Search Evaluation Design

Date: 2026-09-24

Status: Proposed

## Goal

Improve operational visibility and search-quality feedback for the Ford Uruapan MCP by using Langfuse/OpenTelemetry instead of building a custom query-telemetry platform or duplicating catalog knowledge in the Spring AI caller.

## Scope

This change covers three related capabilities:

1. Emit useful MCP search telemetry to Langfuse.
2. Use Langfuse datasets and scores for repeatable search-quality evaluations.
3. Expose daily synchronization health through the existing MCP status surface.

The existing daily scheduler and `ford.sync_runs` table remain the synchronization mechanism and source of truth.

## Architecture

```text
MCP tool call / API request
          |
          v
  SearchService / OfferSearchService
          |
          +--> OpenTelemetry spans --> Langfuse
          |
          +--> deterministic SQL filters
          |
          +--> full-text + pgvector retrieval
          |
          v
      ranked response

daily scheduler --> SiteSynchronizationService --> ford.sync_runs
                                                    |
                                                    v
                                      get_catalog_status / get_sync_status
```

Telemetry is recorded at the shared search-service boundary so MCP and HTTP API calls have the same measurements. No user identifier, authentication token, or request body is stored.

## Query telemetry

The TypeScript process uses `@opentelemetry/api`, `@opentelemetry/sdk-node`, and Langfuse's `LangfuseSpanProcessor`. Search services emit `search.vehicles` and `search.offers` spans containing:

- Natural-language query and structured filters.
- Retrieval latency in milliseconds.
- Candidate and returned-result counts.
- Semantic-search state.
- Top result identifier and score when available.
- Error status when a search fails.

The span does not include full retrieved catalog payloads, user identifiers, authentication tokens, or request bodies. Missing Langfuse credentials activate a no-op observer, so local MCP/API behavior is unchanged. Exporter failures never make a successful search fail.

## Search evaluation

Use Langfuse datasets and scores for versioned evaluation cases. Each case contains a natural-language query, deterministic filters, search kind, expected result IDs, and an acceptable rank. Evaluation runs can record hit-rate@1/3/5, empty-result rate, semantic availability, latency percentiles, and relevance judgments in Langfuse without introducing a second evaluation database.

## Synchronization status

Extend the existing catalog status response with:

- Latest synchronization run status, start/end timestamps, and counters.
- Current pending and failed embedding counts.
- Latest successful synchronization timestamp.

Extend the existing `get_catalog_status` response first to avoid unnecessary tool proliferation. Add a separate `get_sync_status` tool only if the status payload later diverges from catalog freshness.

The scheduler continues to run at `12:00` in `America/Mexico_City`, uses the existing advisory lock, and records each run in `ford.sync_runs`. Structured JSON summaries remain on stderr for container log collection.

## Documentation boundary

The MCP server is the authoritative contract. Tool names, input schemas, output shapes, provenance behavior, and operational status belong in MCP documentation and tool metadata.

Spring AI documentation should contain only:

- MCP client connection configuration.
- Transport choice: stdio for local deployment; Streamable HTTP for a separate service later.
- Tool-selection guidance and system-prompt rules.
- Error and freshness handling expectations.

The Spring AI model should not receive a copied vehicle catalog. It asks MCP for current structured and semantic data.

## Alternatives considered

### Custom PostgreSQL telemetry table

An in-house `ford.search_events` table would duplicate trace storage, retention, dashboards, and evaluation features already available in Langfuse. PostgreSQL remains the source of truth for catalog and synchronization state only.

### External metrics platform without Langfuse

Prometheus/OpenTelemetry alone would provide infrastructure metrics, but not the LLM traces, datasets, scores, and prompt/tool views needed for this application. OpenTelemetry remains the instrumentation standard; Langfuse is the initial backend.

### MCP-only telemetry

Logging only in MCP handlers would miss HTTP API searches and duplicate instrumentation. Shared search-service telemetry provides one consistent measurement point.

### Separate sync-status MCP tool immediately

An additional tool is explicit, but extending `get_catalog_status` is simpler and preserves the current MCP surface. A separate tool can be added later if status payloads diverge.

## Error handling

- Langfuse exporter failure: log and continue returning the search result.
- Evaluation case failure: record the case failure and continue evaluating the remaining cases.
- Missing expected entity: report a failed case; do not mutate catalog data.
- Sync status query failure: return a clear MCP error; do not hide stale status.
- Langfuse retention or score failure: report the observability failure without mutating catalog data.

## Acceptance criteria

- MCP and API searches create telemetry records with latency and result metadata.
- Telemetry failure cannot turn a successful search into a failed request.
- `evaluate-search` reports ranking and latency metrics for versioned cases.
- Catalog status exposes synchronization and embedding freshness.
- The daily scheduler remains idempotent and protected against overlap.
- MCP contract documentation is sufficient for a Spring AI client without copying catalog data.
- Unit tests cover telemetry success/failure isolation, evaluation metrics, and status mapping.
