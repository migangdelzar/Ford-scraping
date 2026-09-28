# Langfuse Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Instrument the TypeScript MCP search service with optional Langfuse/OpenTelemetry tracing and document the Spring AI integration contract without adding a custom telemetry table.

**Architecture:** The MCP process creates an OpenTelemetry `NodeSDK` with Langfuse's span processor when credentials are configured. Search services receive an injected observation port and create spans containing safe search metadata. Without Langfuse credentials, a no-op observer keeps local MCP behavior unchanged. Spring AI remains responsible for model and end-to-end tool-call tracing.

**Tech Stack:** TypeScript, Node.js 22, `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@langfuse/otel`, Vitest.

## Global Constraints

- Do not store a custom query-telemetry table in PostgreSQL.
- Do not log user identifiers, authentication tokens, or full retrieved catalog payloads in telemetry.
- Langfuse must be optional; missing credentials must not prevent MCP/API startup.
- Search behavior and result ranking must remain unchanged.
- Use protocol-based dependency injection and test doubles.
- Add tests before production changes.

---

### Task 1: Add optional Langfuse configuration and observability ports ✅

**Files:**
- Modify: `src/config.ts`
- Create: `src/observability/search-observability.ts`
- Create: `tests/unit/observability.test.ts`

**Interfaces:**
- `SearchObservation` contains operation name, query, filters, latency, result count, semantic status, top result ID, and error.
- `SearchObservability.observe<T>(observation: SearchObservation, operation: () => Promise<T>): Promise<T>` wraps a search operation and never changes its business result.

- [ ] Write a failing test proving the no-op observer returns the operation result and does not throw.
- [ ] Run `npx vitest run tests/unit/observability.test.ts`; expect failure because the observer is missing.
- [ ] Implement the `SearchObservability` protocol and no-op implementation.
- [ ] Add optional `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, and `LANGFUSE_ENVIRONMENT` parsing without making them required.
- [ ] Run the focused test and configuration tests.

### Task 2: Add the Langfuse OpenTelemetry exporter ✅

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/observability/langfuse.ts`
- Create: `tests/unit/langfuse.test.ts`

**Interfaces:**
- `createLangfuseTelemetry(config): LangfuseTelemetry` returns `start()`, `shutdown()`, and a `SearchObservability` implementation.

- [ ] Write a failing test proving missing credentials produce a no-op telemetry instance.
- [ ] Run the focused test and confirm the expected missing-implementation failure.
- [ ] Install the current Langfuse OpenTelemetry packages and Node OpenTelemetry SDK.
- [ ] Implement `LangfuseSpanProcessor` registration with `NodeSDK`; start only when both credentials exist.
- [x] Create search spans with `@opentelemetry/api`, setting query metadata and result metrics while excluding full result content.
- [ ] Catch exporter/shutdown failures so telemetry cannot crash the MCP process.
- [ ] Run focused tests and build.

### Task 3: Instrument vehicle and offer search ✅

**Files:**
- Modify: `src/search/search-service.ts`
- Modify: `src/search/offer-search-service.ts`
- Modify: `src/composition-root.ts`
- Create or modify: `tests/unit/search-observability.test.ts`

**Interfaces:**
- Search services accept an optional `SearchObservability` port after the existing repository and embedding-provider dependencies.

- [ ] Write failing tests proving vehicle and offer searches call the observer with operation name, latency, result count, semantic state, and top result metadata.
- [ ] Run the focused tests and confirm they fail before instrumentation exists.
- [ ] Wrap the existing search logic with the injected observer without changing candidate filtering or ranking.
- [ ] Pass the configured Langfuse observer from the composition root.
- [ ] Run all unit search tests.

### Task 4: Wire lifecycle into MCP/API commands and document Spring AI usage ✅

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md`
- Create: `docs/langfuse-spring-ai-integration.md`
- Modify: `.env.example`
- Create or modify: `tests/unit/cli-observability.test.ts`

**Interfaces:**
- CLI startup starts Langfuse telemetry before application creation.
- CLI termination shuts down telemetry after the command exits.

- [ ] Write a failing lifecycle test around the injected start/shutdown functions or the extracted command lifecycle helper.
- [ ] Run it and confirm failure before wiring exists.
- [ ] Wire telemetry into MCP, API, sync, scheduler, embed, and crawl command lifecycles.
- [ ] Document Cloud/self-hosted configuration, privacy defaults, Spring AI Micrometer/OpenTelemetry, and stdio versus Streamable HTTP.
- [ ] Document Langfuse as the observability/evaluation platform and retain PostgreSQL only for catalog and `sync_runs` state.
- [ ] Run format, lint, unit tests, build, and a live MCP smoke query with credentials absent to prove graceful no-op behavior.

### Task 5: Final verification 🔵

**Files:**
- No source changes expected.

- [ ] Run `npm run format`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run test:unit`.
- [ ] Run `npm run build`.
- [ ] Start the real MCP process without Langfuse credentials and execute vehicle and offer searches.
- [ ] Confirm no custom telemetry table or catalog mutation was introduced.
