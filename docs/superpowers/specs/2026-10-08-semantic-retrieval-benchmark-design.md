# Semantic Retrieval Benchmark Design

## Goal

Measure whether local BGE-M3 vectors retrieve the intended Ford catalog documents for paraphrased Spanish questions, compare current hybrid score blending with Reciprocal Rank Fusion (RRF), and check evidence coverage independently of answer-model behavior.

## Current findings

- The local catalog has 847 document embeddings: 844 use `bge-m3`; 3 are leftover `test-model` fixtures.
- Vehicle documents and offer documents share `model_year_id`. Vehicle full-text and vector queries currently admit offer documents, which caused financing plans to rank for a vehicle search.
- The existing 192-question catalog QA set mostly calls `get_vehicle`; it does not measure document retrieval quality.
- The RAGAS judge remains stopped. The benchmark must run without an LLM judge or hosted API.

## Design

1. Exclude offer-linked documents from vehicle keyword and vector retrieval (`d.offer_id IS NULL`). Offer retrieval continues to select offer-linked documents by `offer_id`.
2. Add a small, reviewed JSONL set of paraphrased Spanish catalog queries. Each row names the exact relevant `ford.documents.document_key` values and expected answer facts from the live catalog.
3. Add a local-only runner that embeds each query with the configured loopback Ollama endpoint, retrieves keyword and vector candidates, and compares current normalized 30/70 score blending with entity-level RRF. Report Hit@k, Precision@k, Recall@k, MRR, nDCG, answer-fact evidence coverage, and non-configured fixture hits.
4. Keep the runner read-only. It does not delete or rewrite the three test fixture rows; it reports when they appear in ranked results.
5. Keep LLM answer quality separate. The benchmark tests retriever quality and whether the retrieved context contains the authored answer facts; it does not start Gemma or another judge.

## Acceptance criteria

- Vehicle search keyword/vector paths never return offer-linked documents.
- Offer search behavior remains scoped to offer documents.
- The integration regression test proves the vehicle search boundary.
- The runner refuses non-loopback embedding endpoints and non-loopback database hosts.
- Every benchmark query has at least one valid relevant document key and an answer fact from that source.
- The report records ranked keys and per-query plus aggregate retrieval metrics, including any `test-model` hit.
- The report compares current blending and RRF using the same entity-level relevance judgments.
- A local run uses Postgres and Ollama on this workstation only and makes no database writes.
