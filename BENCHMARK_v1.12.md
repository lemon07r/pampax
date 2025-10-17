# 🏆 PAMPA v1.12 Performance Analysis

## 📊 Overview

This document analyzes PAMPA v1.12's semantic search capabilities and compares architectural approaches with general-purpose IDE semantic search tools.

**Test Environment:**

-   **PAMPA Version**: v1.12.0
-   **Test Project**: Medium-scale web application (~680 indexed functions)
-   **Test Date**: September 25, 2025
-   **Languages**: PHP, TypeScript, JavaScript

## 🎯 Architectural Comparison

### PAMPA v1.12 Approach

**Specialized Code Search Engine:**

-   **Pre-built Index**: Persistent SQLite database with code-specific embeddings
-   **Hybrid Search**: BM25 + Vector similarity fusion
-   **Code-Aware**: Symbol extraction, function signatures, AST analysis
-   **Advanced Ranking**: Cross-encoder reranking, symbol boosting
-   **Scoped Search**: Filter by file paths, languages, tags

### General IDE Semantic Search

**Real-time Text Search:**

-   **On-demand Processing**: Searches files as needed
-   **General Embeddings**: Text-based semantic matching
-   **Workspace Scope**: Limited to current project context
-   **Basic Ranking**: Primary similarity-based ordering

### Test Queries

Common code search scenarios tested:

1. `"create checkout session"`
2. `"payment processing"`
3. `"user authentication"`
4. `"database operations"`
5. `"email notifications"`

## 📈 Performance Analysis

### PAMPA v1.12 Results

**Strengths:**

-   **Consistent Results**: Reliable semantic matching with similarity scores 0.45-0.65
-   **Fast Response**: ~1-2 seconds average (pre-indexed)
-   **Advanced Features**: Scoped search, hybrid ranking, multi-project support
-   **Code Specialization**: Function-level granularity, symbol awareness

**Sample Query Performance:**

```bash
pampa search "create checkout session"
✅ Found 5 results in 1.2s
- ServiceClass::createSession (similarity: 0.57)
- CheckoutController::create (similarity: 0.54)
- PaymentService::initSession (similarity: 0.52)
```

### IDE Semantic Search Comparison

**General IDE Approach:**

-   **Variable Performance**: Depends on project size and indexing state
-   **Real-time Processing**: No persistent index, searches on demand
-   **Broad Scope**: Full-text semantic matching across all file types
-   **Simple Interface**: Integrated with IDE workflow

**Trade-offs:**

-   ⚡ **PAMPA**: Faster, specialized, requires setup
-   🔄 **IDE**: Integrated, general-purpose, no setup required

## 🔬 Technical Architecture Analysis

### PAMPA v1.12 Specialized Features

**🎯 Scoped Search Filters:**

```bash
# Search only in specific directories for PHP files
pampa search "database operations" --path_glob "app/Models/**" --lang php
✅ Results: 5 relevant model files

# Multi-language search with tagging
pampa search "user authentication" --lang php,ts --tags auth
✅ Results: Cross-language authentication implementations
```

**🔄 Hybrid Search (BM25 + Vector):**

```bash
# Enhanced recall with keyword + semantic fusion
pampa search "checkout flow" --hybrid on --reranker transformers
✅ Results: Higher precision with cross-encoder reranking
```

**🛠️ Multi-Project Support:**

```bash
# Work seamlessly across different projects
pampa search "payment processing" --project /path/to/project-a
pampa search "payment processing" --project /path/to/project-b
✅ Results: Instant context switching between codebases
```

## 📊 Performance Metrics

### PAMPA v1.12 Measured Performance

**Synthetic Benchmark Results (Default Configuration):**

```
Benchmark results
| setting    | P@1   | MRR@5 | nDCG@10 |
| ---        | ---   | ---   | ---     |
| Base       | 0.750 | 0.833 | 0.863   |
| Hybrid     | 0.875 | 0.917 | 0.934   |
| Hybrid+CE  | 1.000 | 0.958 | 0.967   |
```

**With Novita.ai Qwen Models:**

```
Benchmark results
| Configuration                              | P@1   | MRR@5 | nDCG@10 |
| ---                                        | ---   | ---   | ---     |
| Qwen3-Embedding-8B + Transformers (local)  | 0.750 | 0.875 | 0.908   |
| Qwen3-Embedding-8B + Qwen3-Reranker-8B     | 1.000 | 1.000 | 1.000   |
```

**Key Findings:**

-   **Qwen3-Reranker-8B**: Achieves **perfect scores** (100%) across all metrics
-   **Precision@1**: 100% - Every top result is the most relevant
-   **Mean Reciprocal Rank**: 100% - Perfect ranking order
-   **Normalized DCG**: 100% - Optimal relevance distribution
-   **Response Time**: ~1-2 seconds (pre-indexed + API calls)

**Comparison Summary:**

| Reranker                    | P@1   | MRR@5 | nDCG@10 | Cost    | Speed   |
| ---                         | ---   | ---   | ---     | ---     | ---     |
| Transformers (local)        | 0.750 | 0.875 | 0.908   | Free    | Fast    |
| Qwen3-Reranker-8B (API)     | 1.000 | 1.000 | 1.000   | Paid    | Fast    |

**Recommendation:** Use **Qwen3-Reranker-8B** for production workloads requiring maximum precision. Use local Transformers reranker for development or cost-sensitive applications.

### Running Custom Benchmarks

You can run benchmarks with different configurations to test various reranking strategies:

**Basic benchmark (default scenarios):**
```bash
npm run bench
# Runs: Base, Hybrid, Hybrid+CE (local transformers reranker)
```

**Custom reranker configuration:**
```bash
# Use specific reranker mode
npm run bench -- --reranker=api
npm run bench -- --reranker=transformers
npm run bench -- --reranker=off

# Test specific scenarios
npm run bench -- --modes=hybrid,hybrid-ce
npm run bench -- --modes=base
```

**Using API-based rerankers (Novita.ai, Cohere, Jina):**
```bash
# Configure API reranker environment variables
export PAMPAX_RERANK_API_URL="https://api.novita.ai/openai/v1/rerank"
export PAMPAX_RERANK_API_KEY="your-api-key"
export PAMPAX_RERANK_MODEL="qwen/qwen3-reranker-8b"

# Run benchmark with API reranker
export PAMPA_BENCH_RERANKER=api
npm run bench
```

**Reproducing the Qwen3 perfect scores:**
```bash
# Set up Novita.ai with Qwen3 models
export OPENAI_BASE_URL="https://api.novita.ai/openai"
export OPENAI_API_KEY="your-novita-api-key"
export PAMPAX_OPENAI_EMBEDDING_MODEL="qwen/qwen3-embedding-8b"
export PAMPAX_RERANK_API_URL="https://api.novita.ai/openai/v1/rerank"
export PAMPAX_RERANK_API_KEY="your-novita-api-key"
export PAMPAX_RERANK_MODEL="qwen/qwen3-reranker-8b"

# Run with Qwen3-Reranker-8B (achieves 100% scores)
export PAMPA_BENCH_RERANKER=api
npm run bench

# Compare with local transformers reranker
export PAMPA_BENCH_RERANKER=transformers
npm run bench
```

**Available configuration options:**

*Command-line arguments:*
- `--reranker=<mode>` - Reranker mode: `off`, `transformers`, `api`
- `--modes=<list>` - Comma-separated scenarios: `base`, `hybrid`, `hybrid-ce`
- `--hybrid=<bool>` - Enable/disable hybrid search: `true`, `false`
- `--bm25=<bool>` - Enable/disable BM25: `true`, `false`

*Environment variables:*
- `PAMPA_BENCH_RERANKER` - Default reranker mode
- `PAMPA_BENCH_MODES` - Default scenarios to run
- `PAMPA_BENCH_HYBRID` - Default hybrid setting
- `PAMPA_BENCH_BM25` - Default BM25 setting

*API Reranker configuration (used when --reranker=api):*
- `PAMPAX_RERANK_API_URL` - Reranking API endpoint
- `PAMPAX_RERANK_API_KEY` - API authentication key
- `PAMPAX_RERANK_MODEL` - Model name (e.g., `qwen/qwen3-reranker-8b`)
- `PAMPAX_RERANKER_MAX` - Max candidates to rerank (default: 50)

**Example: Benchmark with Cohere Rerank:**
```bash
export PAMPAX_RERANK_API_URL="https://api.cohere.ai/v1/rerank"
export PAMPAX_RERANK_API_KEY="your-cohere-key"
export PAMPAX_RERANK_MODEL="rerank-english-v3.0"
npm run bench -- --reranker=api
```

### Comparison Considerations

**PAMPA Advantages:**

-   ✅ Specialized for code search with persistent indexing
-   ✅ Advanced ranking algorithms (BM25 + Vector + Cross-encoder)
-   ✅ Code-aware features (symbol extraction, function signatures)
-   ✅ Multi-project support with context switching

**General IDE Advantages:**

-   ✅ Zero-setup, integrated workflow
-   ✅ Real-time file watching and updates
-   ✅ Broader file type support beyond code
-   ✅ Native IDE integration and shortcuts

## 🔬 Technical Architecture

### PAMPA v1.12 Stack

```
🏗️ Specialized Code Search Engine:
├── 📊 SQLite database with function-level indexing
├── 🎯 Code-specific embeddings (AST-aware)
├── 🔄 Hybrid search (BM25 + Vector fusion)
├── 🧠 Cross-encoder reranking pipeline
├── 🌲 Symbol-aware boosting algorithms
└── 📦 Context packs for domain scoping
```

### Key Differentiators

**1. Indexing Strategy:**

-   **PAMPA**: Persistent, function-level granularity
-   **General IDE**: On-demand, file-level processing

**2. Search Algorithms:**

-   **PAMPA**: Multi-modal (keyword + semantic + reranking)
-   **General IDE**: Primary semantic similarity

**3. Code Understanding:**

-   **PAMPA**: AST parsing, symbol extraction, signature matching
-   **General IDE**: Text-based semantic analysis

**4. Specialization:**

-   **PAMPA**: Purpose-built for code search workflows
-   **General IDE**: General-purpose text search with semantic layer

## 📈 PAMPA v1.12 New Features

### 🎯 Scoped Search

Filter results by file paths, languages, and custom tags for precise targeting.

### 🔄 Hybrid Search

BM25 keyword matching fused with vector similarity for improved recall and precision.

### 🧠 Cross-Encoder Reranking

Advanced neural reranking for higher quality result ordering.

### 🛠️ Multi-Project Support

Context switching between different codebases with `--project` flags.

### 📦 Context Packs

Reusable search profiles for domain-specific code discovery.

## 🎯 Use Case Recommendations

**Choose PAMPA when:**

-   Working with large, complex codebases
-   Need specialized code search features
-   Require multi-project context switching
-   Want persistent, optimized search performance

**Choose IDE Semantic Search when:**

-   Need integrated, zero-setup workflow
-   Working with mixed content (docs + code)
-   Prefer real-time file watching
-   Want simple, general-purpose search

## 🏆 Conclusion

PAMPA v1.12 represents a specialized approach to code search, optimized for developer productivity through advanced indexing, hybrid algorithms, and code-aware features. While general-purpose IDE tools excel at integration and simplicity, PAMPA fills the gap for teams requiring sophisticated semantic code discovery capabilities.

---

_Analysis based on synthetic benchmarks and architectural comparison. Performance may vary based on project size, configuration, and usage patterns._
