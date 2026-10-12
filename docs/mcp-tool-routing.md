# MCP tool routing contract

Use one tool lane per user intent. Call more than one only when the user asks
for multiple distinct outputs (for example, a recommendation and financing).

| Intent | Tool | Boundary |
|---|---|---|
| Lifestyle fit, discovery, budget-filtered options | `search_vehicles` | Exact SQL filters first; semantic ranking within those candidates. Map SUV/crossover to `category`; use `bodyType` only for a specific body style. |
| Named vehicle facts, trims, direct page/image/spec links | `get_vehicle` | Exact model/year lookup; optional `trim` returns only that variant's sourced facts. Omitted year returns all stored years. |
| Different Ford nameplates | `compare_vehicles` | Model-level comparison. |
| Trims of one model in one year | `compare_trims` | Trim-level facts and deltas. |
| Same nameplate across years | `compare_model_years` | Year-over-year model facts, shared-trim deltas/prices, and unmatched trim names. |
| Ford trim against another brand | `get_variant_comparisons` | Ford's published Comparativo records and visual URL. |
| Dealer promotion cards | `list_promotions` | Promotion records only. |
| Financing/payment plans | `search_offers` | Source-backed terms and finance inputs. |
| Vehicle options plus financing in one request | `search_vehicle_and_offers` | Convenience route; one matching vehicle and one matching finance result. |
| Page routes not already in a result | `get_page_links` | Returns useful routes by default; `includeAssets: true` adds image/static asset URLs. |
| Source/crawl diagnostics | `get_vehicle_provenance` | Diagnostic fallback when a prior result lacks provenance. |
| Catalog freshness/record counts | `get_catalog_status` | Not physical inventory availability. |

## Comparison selection

- Same model + same year + different trims → `compare_trims`.
- Same model + different years → `compare_model_years`.
- Different Ford models → `compare_vehicles`.
- Ford vs competitor with a Ford Comparativo page → `get_variant_comparisons`.
- Do not call more than one comparison tool for the same comparison request.
- Keep source values paired; do not infer a missing feature or treat an unknown as
  a change. Return the direct comparison URL when present.

## Compact responses

- `search_vehicles` returns only the selected vehicle fields and up to 2 short
  evidence excerpts per result. Preserve any named model/variant. If it fails a
  stated budget, disclose that and label other results as alternatives; never
  silently replace it. Copy returned URLs exactly; never construct a route.
  Use `get_vehicle` for exact facts.
- `get_vehicle` returns up to 5 specs and features by default; use
  `detail: "full"` when the requested fact is omitted or the buyer asks for all
  details. Pass `trim` for an exact version lookup; only that variant's sourced
  specs/features and price are returned. A missing trim returns
  `trimStatus: "not_found"`, no trim price/specs, and the available trim and
  Comparativo links. Direct model, technical-sheet, trim, image, and
  Comparativo links remain available. If `modelPageUnavailable` is true, only
  cite the price source; do not present the catalog URL as a model page.
- `compare_trims` returns the model page and technical sheet links, each trim's
  exact Comparativo URL when published, and up to 5 differences per pair.
  `compare_model_years` returns prices, promotions, model and technical-sheet
  links, trim links and any published per-trim Comparativo URLs, unmatched
  trims, up to 5 model-level changes, and 2 shared-trim deltas per year pair
  by default. Each selected trim includes up to 3 facts. All published trim
  links are returned; the trim names are part of those link records. Use
  `trimOffset` and `trimLimit` to page through trim deltas; `detail: "full"`
  returns all facts for the selected page. Model-page URLs are emitted once
  per year; distinct Comparativo URLs stay attached to the relevant trim or
  fact.
- `get_variant_comparisons` returns the model page and technical sheet links,
  each exact Comparativo URL, and up to 5 paired facts by default; use
  `detail: "full"` for all paired facts. It returns 3 comparison pages by
  default; use `offset` and `limit` to page. The exact visual comparison URL is
  included in either mode.
- `list_promotions` returns 3 concise records per page by default. Pass
  `filters.offset` and `filters.limit` to page results, and
  `filters.detail: "full"` to include complete promotion terms.
- `get_page_links` returns 20 compact routes by default. Use `offset` and
  `limit` to fetch another page. Image and static asset links are excluded by
  default; linked Comparativo records are included and prioritized. Set
  `includeAssets: true` when asset URLs are needed.

## Search and citations

- Exact facts, model/year, price, and offer terms come from structured SQL rows.
- Semantic search finds lifestyle matches only after stated filters are applied.
- Return model page, price/offer source, spec source, and comparison page URLs as
  separate links. Never substitute a generic catalog URL for a model page.
- Comparativo citations use the clean route without `exterior`/`interior` color
  selector query parameters; the stored crawl URL remains unchanged.
- Keep image URLs as ordinary response links/metadata. Do not embed image URLs or
  image content in pgvector.

## Finance boundary

`ford.offers` already stores sourced price, term, down payment, annual rate, CAT,
validity, conditions, provider, and source page. Migration 019 promotes the
finance-feed tax factor, opening commission rate, maximum down payment, and
insurance input from raw metadata to nullable numeric columns. Missing source
values stay NULL. Keep raw feed metadata for auditability.

The MCP returns source-backed finance inputs and a plan payment derived from the
Ford feed formula; it does not calculate a new customer quote. Do not add generic interest, CAT, IVA,
eligibility, or lease defaults. A future calculator must use the selected
source-backed plan and disclose its assumptions. Do not treat a displayed
monthly payment as a Ford Credit approval or binding quote.

## Evaluation contract

The local LLM evaluation now includes lifestyle discovery, exact lookup, all
four comparison lanes, promotion/finance separation, and combined vehicle plus
finance. It records conflicting tool calls as failures, even when the expected
tool was also called. The local model run is a routing signal, not proof that
retrieval ranking is accurate; ranking still needs judged query/result pairs.
