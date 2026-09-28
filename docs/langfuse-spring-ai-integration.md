# Langfuse and Spring AI Integration

## Responsibility split

The TypeScript MCP server emits retrieval observations:

- `search.vehicles` and `search.offers` spans.
- Deterministic filter metadata.
- Candidate and result counts.
- Semantic-search availability.
- Retrieval latency.
- Top result ID and score.

The Spring AI application emits model/orchestration observations:

- End-to-end request latency.
- Chat model latency and token usage.
- MCP tool-call timing.
- Selected tool names.
- Final response latency.

Do not copy the vehicle catalog into Spring AI prompts or logs. The MCP server and PostgreSQL remain the source of current vehicle and financing facts.

## TypeScript MCP configuration

```dotenv
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_ENVIRONMENT=development
```

The credentials are optional. The MCP starts normally without them and uses a no-op telemetry implementation.

## Spring AI configuration

Use Spring AI's MCP client starter to discover the TypeScript server tools and attach them to `ChatClient`. Keep prompt/completion and tool argument/result content disabled unless the data policy explicitly allows it. Record IDs, durations, status, and trace metadata by default.

For local process integration, use the stdio MCP transport. For a separately deployed service, use Streamable HTTP behind authentication and TLS. Do not expose an unauthenticated HTTP MCP endpoint.

## Trace correlation

Independent Spring AI and MCP traces are acceptable for the first deployment. When the transport/client supports MCP metadata propagation, propagate W3C trace context through MCP `_meta` so the Langfuse UI can show one linked request tree. Never put credentials in `_meta`.

## Evaluation

Use Langfuse datasets and scores for golden search cases and human/automated relevance judgments. Keep catalog facts and sync state in PostgreSQL; keep trace, prompt, score, and experiment telemetry in Langfuse. This avoids a second custom query-telemetry schema.

