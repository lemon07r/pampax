# PAMPAX – Protocol for Augmented Memory of Project Artifacts Extended

**Enhanced fork** with native support for OpenAI-compatible APIs (OpenAI, LM Studio, llama.cpp, Azure, Novita.ai, etc.) and flexible reranking models (local Transformers.js or remote APIs). Performance benchmarks show significant improvements with advanced reranking—perfect scores with Qwen3-Reranker-8B. This fork also includes several important bug fixes, better handling of large files, and immproved performance. For detailed changes, see [CHANGELOG.md](CHANGELOG.md) or [RELEASE_SUMMARY_v1.13.md](RELEASE_SUMMARY_v1.13.md).

**Version 1.14.0** · **Token-Based Chunking** · **Semantic Search** · **MCP Compatible** · **Node.js**

<p align="center">
  <img src="assets/pampax_banner.png" alt="Agent Rules Kit Logo" width="729" />
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/pampax.svg" alt="Version" />
  <img src="https://img.shields.io/github/license/lemon07r/pampax" alt="License" />
  <img src="https://img.shields.io/github/last-commit/lemon07r/pampax" alt="Last Commit" />
</p>

Give your AI agents an always-updated, queryable memory of any codebase – with **intelligent semantic search** and **automatic learning** – in one `npx` command.

> 🇺🇸 **English Version** | 🇪🇸  **[Versión en Español](README_es.md)** | 🤖 **[Agent Version](README_FOR_AGENTS.md)**

## 🌟 What's New in v1.13 - Advanced Search & Multi-Project Support

🎯 **Scoped Search Filters** - Filter by `path_glob`, `tags`, `lang` for precise results

🔄 **Hybrid Search** - BM25 + Vector fusion with reciprocal rank blending (enabled by default)

🧠 **Cross-Encoder Re-Ranker** - Transformers.js reranker for precision boosts

👀 **File Watcher** - Real-time incremental indexing with Merkle-like hashing

📦 **Context Packs** - Reusable search scopes with CLI + MCP integration

🛠️ **Multi-Project CLI** - `--project` and `--directory` aliases for clarity

🏆 **[Performance Analysis](BENCHMARK_v1.13.md)** - Architectural comparison with general-purpose IDE tools

**Major improvements:**

-   **40% faster indexing** with incremental updates
-   **60% better precision** with hybrid search + reranker
-   **3x faster multi-project** operations with explicit paths
-   **90% reduction in duplicate** function creation with symbol boost
-   **Specialized architecture** for semantic code search

## 🌟 Why PAMPAX?

Large language model agents can read thousands of tokens, but projects easily reach millions of characters. Without an intelligent retrieval layer, agents:

-   **Recreate functions** that already exist
-   **Misname APIs** (newUser vs. createUser)
-   **Waste tokens** loading repetitive code (`vendor/`, `node_modules/`...)
-   **Fail** when the repository grows

PAMPAX solves this by turning your repository into a **semantic code memory graph**:

1. **Chunking** – Each function/class becomes an atomic chunk
2. **Semantic Tagging** – Automatic extraction of semantic tags from code context
3. **Embedding** – Enhanced chunks are vectorized with advanced embedding models
4. **Learning** – System learns from successful searches and caches intentions
5. **Indexing** – Vectors + semantic metadata live in local SQLite
6. **Codemap** – A lightweight `pampax.codemap.json` commits to git so context follows the repo
7. **Serving** – An MCP server exposes intelligent search and retrieval tools

Any MCP-compatible agent (Cursor, Claude, etc.) can now search with natural language, get instant responses for learned patterns, and stay synchronized – without scanning the entire tree.

## 🤖 For AI Agents & Humans

> **🤖 If you're an AI agent:** Read the [complete setup guide for agents →](README_FOR_AGENTS.md)
> or
> **👤 If you're human:** Share the [agent setup guide](README_FOR_AGENTS.md) with your AI assistant to automatically configure PAMPAX!

## 📚 Table of Contents

-   [🚀 MCP Installation (Recommended)](#-mcp-installation-recommended)
-   [🧠 Semantic Features](#-semantic-features)
-   [📝 Supported Languages](#-supported-languages)
-   [💻 Direct CLI Usage](#-direct-cli-usage)
-   [🧠 Embedding Providers](#-embedding-providers)
-   [🏆 Performance Benchmark](#-performance-benchmark)
-   [🏗️ Architecture](#️-architecture)
-   [🔧 Available MCP Tools](#-available-mcp-tools)
-   [📊 Available MCP Resources](#-available-mcp-resources)
-   [🎯 Available MCP Prompts](#-available-mcp-prompts)

## 🧠 Semantic Features

### 🏷️ Automatic Semantic Tagging

PAMPAX automatically extracts semantic tags from your code without any special comments:

```javascript
// File: app/Services/Payment/StripeService.php
function createCheckoutSession() { ... }
```

**Automatic tags:** `["stripe", "service", "payment", "checkout", "session", "create"]`

### 🎯 Intention-Based Direct Search

The system learns from successful searches and provides instant responses:

```bash
# First search (vector search)
"stripe payment session" → 0.9148 similarity

# System automatically learns and caches this pattern
# Next similar searches are instant:
"create stripe session" → instant response (cached)
"stripe checkout session" → instant response (cached)
```

### 📈 Adaptive Learning System

-   **Automatic Learning**: Saves successful searches (>80% similarity) as intentions
-   **Query Normalization**: Understands variations: `"create"` = `"crear"`, `"session"` = `"sesion"`
-   **Pattern Recognition**: Groups similar queries: `"[PROVIDER] payment session"`

### 🏷️ Optional @pampax-comments (Complementary)

Enhance search precision with optional JSDoc-style comments:

```javascript
/**
 * @pampax-tags: stripe-checkout, payment-processing, e-commerce-integration
 * @pampax-intent: create secure stripe checkout session for payments
 * @pampax-description: Main function for handling checkout sessions with validation
 */
async function createStripeCheckoutSession(sessionData) {
	// Your code here...
}
```

**Benefits:**

-   **+21% better precision** when present
-   **Perfect scores (1.0)** when query matches intent exactly
-   **Fully optional**: Code without comments works automatically
-   **Retrocompatible**: Existing codebases work without changes

### 📊 Search Performance Results

| Search Type     | Without @pampax | With @pampax | Improvement |
| --------------- | -------------- | ----------- | ----------- |
| Domain-specific | 0.7331         | 0.8874      | **+21%**    |
| Intent matching | ~0.6           | **1.0000**  | **+67%**    |
| General search  | 0.6-0.8        | 0.8-1.0     | **+32-85%** |

## 📝 Supported Languages

PAMPAX can index and search code in 21 languages out of the box:

### Programming Languages
-   **JavaScript / TypeScript** (`.js`, `.ts`, `.tsx`, `.jsx`)
-   **Python** (`.py`)
-   **Java** (`.java`)
-   **Kotlin** (`.kt`) ⭐ _NEW_
-   **Go** (`.go`)
-   **Rust** (`.rs`) ⭐ _NEW_
-   **C++** (`.cpp`, `.hpp`, `.cc`) ⭐ _NEW_
-   **C** (`.c`, `.h`) ⭐ _NEW_
-   **C#** (`.cs`) ⭐ _NEW_
-   **PHP** (`.php`)
-   **Ruby** (`.rb`) ⭐ _NEW_
-   **Scala** (`.scala`) ⭐ _NEW_
-   **Swift** (`.swift`) ⭐ _NEW_
-   **Lua** (`.lua`) ⭐ _NEW_
-   **OCaml** (`.ml`, `.mli`) ⭐ _NEW_
-   **Haskell** (`.hs`) ⭐ _NEW_
-   **Elixir** (`.ex`, `.exs`) ⭐ _NEW_

### Web & Data Formats
-   **HTML** (`.html`, `.htm`) ⭐ _NEW_
-   **CSS** (`.css`) ⭐ _NEW_
-   **JSON** (`.json`) ⭐ _NEW_

### Shell
-   **Bash** (`.sh`, `.bash`) ⭐ _NEW_

## 🆕 What's New in v1.14 - Token-Based Chunking

PAMPAX v1.14.0 introduces intelligent token-based chunking that automatically optimizes chunk sizes for your embedding model:

- 🎯 **Model-Aware**: Automatically detects your model and adjusts chunk sizes
- 🔢 **Token Counting**: Uses tiktoken for accurate token-based sizing  
- ⚙️ **Customizable**: Override via `PAMPAX_MAX_TOKENS` and `PAMPAX_DIMENSIONS`
- 🔄 **Backward Compatible**: Existing indexes continue to work
- 📈 **Better Quality**: +20-30% chunking accuracy improvement

**Quick Start:**
```bash
npm install tiktoken  # For best results
pampax index         # Automatic token-based chunking!
```

**Configuration Examples:**
```bash
# Custom token limit and dimensions
export PAMPAX_MAX_TOKENS=2000
export PAMPAX_DIMENSIONS=1536
pampax index --provider openai

# Or set in MCP config (see MCP Installation section)
```

See [TOKEN_CHUNKING_v1.14.md](TOKEN_CHUNKING_v1.14.md) for full documentation and [MIGRATION_GUIDE_v1.14.md](MIGRATION_GUIDE_v1.14.md) for upgrade instructions.

## 🚀 MCP Installation (Recommended)

### 1. Configure your MCP client

#### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

**Example with Novita.ai (Recommended - Absolute Maximum Quality):**
```json
{
	"mcpServers": {
		"pampax": {
			"command": "npx",
			"args": ["-y", "pampax", "mcp"],
			"env": {
				"OPENAI_API_KEY": "your-novita-api-key",
				"OPENAI_BASE_URL": "https://api.novita.ai/openai",
				"PAMPAX_OPENAI_EMBEDDING_MODEL": "qwen/qwen3-embedding-8b",
				"PAMPAX_MAX_TOKENS": "8192",
				"PAMPAX_DIMENSIONS": "4096"
			}
		}
	}
}
```

**Or use OpenAI directly:**
```json
{
	"mcpServers": {
		"pampax": {
			"command": "npx",
			"args": ["-y", "pampax", "mcp"],
			"env": {
				"OPENAI_API_KEY": "your-openai-api-key"
			}
		}
	}
}
```

**Environment Variables (optional):**

**Embedding & Chunking:**
- `PAMPAX_MAX_TOKENS` - Override maximum token limit for chunking (default: model-specific)
- `PAMPAX_DIMENSIONS` - Override embedding dimensions (default: model-specific)
- `OPENAI_API_KEY` - Your OpenAI API key (if using OpenAI provider)
- `PAMPAX_OPENAI_EMBEDDING_MODEL` - Model name (e.g., `text-embedding-3-small`)

**Reranker Configuration:**
- `PAMPAX_RERANKER_MODEL` - Reranker model (default: `Xenova/ms-marco-MiniLM-L-6-v2`)
- `PAMPAX_RERANKER_MAX` - Max candidates to rerank (default: 50)
- `PAMPAX_RERANKER_MAX_TOKENS` - Max tokens per document for reranker (default: 512)
- `PAMPAX_RERANK_API_URL` - API URL for remote reranking (e.g., Cohere, Jina AI)
- `PAMPAX_RERANK_API_KEY` - API key for remote reranking service
- `PAMPAX_RERANK_MODEL` - Model name for API reranker (default: `rerank-v3.5`)

**Note**: Using `npx` automatically downloads and runs the latest version from npm, no global installation needed.

**Optional**: Add `"--debug"` to args for detailed logging: `["-y", "pampax", "mcp", "--debug"]`

**With API Reranking (Absolute Maximum - Full 32K Context):**
```json
{
	"mcpServers": {
		"pampax": {
			"command": "npx",
			"args": ["-y", "pampax", "mcp"],
			"env": {
				"OPENAI_API_KEY": "your-novita-api-key",
				"OPENAI_BASE_URL": "https://api.novita.ai/openai",
				"PAMPAX_OPENAI_EMBEDDING_MODEL": "qwen/qwen3-embedding-8b",
				"PAMPAX_RERANK_API_URL": "https://api.novita.ai/openai/v1/rerank",
				"PAMPAX_RERANK_API_KEY": "your-novita-api-key",
				"PAMPAX_RERANK_MODEL": "qwen/qwen3-reranker-8b",
				"PAMPAX_MAX_TOKENS": "8192",
				"PAMPAX_DIMENSIONS": "4096",
				"PAMPAX_RERANKER_MAX": "200",
				"PAMPAX_RERANKER_MAX_TOKENS": "8192"
			}
		}
	}
}
```

#### Cursor

Configure Cursor by creating or editing the `mcp.json` file in your configuration directory:

**Example with Novita.ai:**
```json
{
	"mcpServers": {
		"pampax": {
			"command": "npx",
			"args": ["-y", "pampax", "mcp"],
			"env": {
				"OPENAI_API_KEY": "your-novita-api-key",
				"OPENAI_BASE_URL": "https://api.novita.ai/openai",
				"PAMPAX_OPENAI_EMBEDDING_MODEL": "qwen/qwen3-embedding-8b",
				"PAMPAX_MAX_TOKENS": "8192",
				"PAMPAX_DIMENSIONS": "4096",
				"PAMPAX_RERANKER_MAX": "200",
				"PAMPAX_RERANKER_MAX_TOKENS": "8192"
			}
		}
	}
}
```

**Tip:** You can use any OpenAI-compatible API by setting `OPENAI_BASE_URL`. Popular options include Novita.ai (recommended), OpenAI, LM Studio, Azure OpenAI, and LocalAI. See the environment variables list above for all available options.

### 2. Let your AI agent handle the indexing

**Your AI agent should automatically:**

-   Check if the project is indexed with `get_project_stats`
-   Index the project with `index_project` if needed
-   Keep it updated with `update_project` after changes

**Need to index manually?** See [Direct CLI Usage](#-direct-cli-usage) section.

### 3. Install the usage rule for your agent

**Additionally, install this rule in your application so it uses PAMPAX effectively:**

Copy the content from [RULE_FOR_PAMPAX_MCP.md](RULE_FOR_PAMPAX_MCP.md) into your agent or AI system instructions.

### 4. Ready! Your agent can now search code

Once configured, your AI agent can:

```
🔍 Search: "authentication function"
📄 Get code: Use the SHA from search results
📊 Stats: Get project overview and statistics
🔄 Update: Keep memory synchronized
```

## 💻 Direct CLI Usage

For direct terminal usage or manual project indexing:

### Install the CLI

```bash
# Install globally from npm (requires Node.js 16+)
npm install -g pampax

# Verify installation
pampax --help
```

**Alternative installations:**
```bash
# Install from GitHub (latest development version)
npm install -g git+https://github.com/lemon07r/pampax.git

# Use npx (no global installation required)
npx pampax index
```

### Index or update a project

```bash
# Index current repository with the best available provider
pampax index

# Force the local CPU embedding model (no API keys required)
pampax index --provider transformers

# Re-embed after code changes
pampax update

# Inspect indexed stats at any time
pampax info
```

> Indexing writes `.pampax/` (SQLite database + chunk store) and `pampax.codemap.json`. Commit the codemap to git so teammates and CI re-use the same metadata.

| Command                                  | Purpose                                                  |
| ---------------------------------------- | -------------------------------------------------------- | ----- | ------------------------------------------------- |
| `pampax index [path] [--provider X]`  | Create or refresh the full index at the provided path    |
| `pampax update [path] [--provider X]` | Force a full re-scan (helpful after large refactors)     |
| `pampax watch [path] [--provider X]`  | Incrementally update the index as files change           |
| `pampax search <query>`               | Hybrid BM25 + vector search with optional scoped filters |
| `pampax context <list                 | show                                                     | use>` | Manage reusable context packs for search defaults |
| `pampax mcp`                          | Start the MCP stdio server for editor/agent integrations |

### Search with scoped filters & ranking flags

`pampax search` supports the same filters used by MCP clients. Combine glob patterns, semantic tags, language filters, provider overrides, and ranking controls:

| Flag / option         | Effect                                                                |
| --------------------- | --------------------------------------------------------------------- | --------------- |
| `--path_glob`         | Limit results to matching files (`"app/Services/**"`)                 |
| `--tags`              | Filter by codemap tags (`stripe`, `checkout`)                         |
| `--lang`              | Filter by language (`php`, `ts`, `py`)                                |
| `--provider`          | Override embedding provider for the query (`openai`, `transformers`)  |
| `--reranker`          | Reorder top results with the Transformers cross-encoder (`off`        | `transformers`) |
| `--hybrid` / `--bm25` | Toggle reciprocal-rank fusion or the BM25 candidate stage (`on`       | `off`)          |
| `--symbol_boost`      | Toggle symbol-aware ranking boost that favors signature matches (`on` | `off`)          |
| `-k, --limit`         | Cap returned results (defaults to 10)                                 |

```bash
# Narrow to service files tagged stripe in PHP
pampax search "create checkout session" --path_glob "app/Services/**" --tags stripe --lang php

# Use OpenAI embeddings but keep hybrid fusion enabled
pampax search "payment intent status" --provider openai --hybrid on --bm25 on

# Reorder top candidates locally
pampax search "oauth middleware" --reranker transformers --limit 5

# Disable signature boosts for literal keyword hunts
pampax search "token validation" --symbol_boost off
```

> PAMPAX extracts function signatures and lightweight call graphs with tree-sitter. When symbol boosts are enabled, queries that mention a specific method, class, or a directly connected helper will receive an extra scoring bump.

> When a context pack is active, the CLI prints the pack name before executing the search. Any explicit flag overrides the pack defaults.

### Manage context packs

Store JSON packs in `.pampax/contextpacks/*.json` to capture reusable defaults:

```jsonc
// .pampax/contextpacks/stripe-backend.json
{
	"name": "Stripe Backend",
	"description": "Scopes searches to the Stripe service layer",
	"path_glob": ["app/Services/**"],
	"tags": ["stripe"],
	"lang": ["php"],
	"reranker": "transformers",
	"hybrid": "off"
}
```

```bash
# List packs and highlight the active one
pampax context list

# Inspect the full JSON definition
pampax context show stripe-backend

# Activate scoped defaults (flags still win if provided explicitly)
pampax context use stripe-backend

# Clear the active pack (use "none" or "clear")
pampax context use clear
```

**MCP tip:** The MCP tool `use_context_pack` mirrors the CLI. Agents can switch packs mid-session and every subsequent `search_code` call inherits those defaults until cleared.

### Watch and incrementally re-index

```bash
# Watch the repository with a 750 ms debounce and local embeddings
pampax watch --provider transformers --debounce 750
```

The watcher batches filesystem events, reuses the Merkle hash store in `.pampax/merkle.json`, and only re-embeds touched files. Press `Ctrl+C` to stop.

### Run the synthetic benchmark harness

```bash
npm run bench
```

The harness seeds a deterministic Laravel + TypeScript corpus and prints a summary table with Precision@1, MRR@5, and nDCG@10 for Base, Hybrid, and Hybrid+Cross-Encoder modes. Customise scenarios via flags or environment variables:

-   `npm run bench -- --hybrid=off` – run vector-only evaluation
-   `npm run bench -- --reranker=transformers` – force the cross-encoder
-   `PAMPAX_BENCH_MODES=base,hybrid npm run bench` – limit to specific modes
-   `PAMPAX_BENCH_BM25=off npm run bench` – disable BM25 candidate generation

Benchmark runs never download external models when `PAMPAX_MOCK_RERANKER_TESTS=1` (enabled by default inside the harness).

An end-to-end context pack example lives in [`examples/contextpacks/stripe-backend.json`](examples/contextpacks/stripe-backend.json).

## 🧠 Embedding Providers

PAMPAX supports multiple providers for generating code embeddings:

| Provider            | Cost                     | Privacy  | Installation                                               |
| ------------------- | ------------------------ | -------- | ---------------------------------------------------------- |
| **Transformers.js** | 🟢 Free                  | 🟢 Total | `npm install @xenova/transformers`                         |
| **Ollama**          | 🟢 Free                  | 🟢 Total | [Install Ollama](https://ollama.ai) + `npm install ollama` |
| **OpenAI**          | 🔴 ~$0.10/1000 functions | 🔴 None  | Set `OPENAI_API_KEY`                                       |
| **OpenAI-Compatible** | 🟡 Varies              | 🟡 Varies | Set `OPENAI_API_KEY` + `OPENAI_BASE_URL`                  |
| **Cohere**          | 🟡 ~$0.05/1000 functions | 🔴 None  | Set `COHERE_API_KEY` + `npm install cohere-ai`             |

**Recommendation:** Use **Transformers.js** for personal development (free and private) or **OpenAI** for maximum quality.

### Using OpenAI-Compatible APIs

PAMPAX supports any OpenAI-compatible API endpoint through environment variables:

```bash
# LM Studio (local)
export OPENAI_BASE_URL="http://localhost:1234/v1"
export OPENAI_API_KEY="lm-studio"  # Can be any value for local servers

# Azure OpenAI
export OPENAI_BASE_URL="https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT"
export OPENAI_API_KEY="your-azure-api-key"

# LocalAI
export OPENAI_BASE_URL="http://localhost:8080/v1"
export OPENAI_API_KEY="not-needed"

# Ollama with OpenAI compatibility
export OPENAI_BASE_URL="http://localhost:11434/v1"
export OPENAI_API_KEY="ollama"
```

Then index with the OpenAI provider:
```bash
pampax index --provider openai
```

### Selecting Embedding Models

You can configure which embedding model to use via environment variables:

**OpenAI Provider:**
```bash
# Use a specific OpenAI model
export PAMPAX_OPENAI_EMBEDDING_MODEL="text-embedding-3-small"  # Cheaper, faster
# or
export OPENAI_MODEL="text-embedding-3-large"  # Alternative env var

# Default: text-embedding-3-large
```

**Reranker Configuration:**
```bash
# Local Transformers.js reranker model
export PAMPAX_RERANKER_MODEL="Xenova/ms-marco-MiniLM-L-6-v2"

# Max candidates to rerank and max tokens per document
export PAMPAX_RERANKER_MAX=50
export PAMPAX_RERANKER_MAX_TOKENS=512

# Or use remote API reranker (Cohere, Jina AI, etc.)
export PAMPAX_RERANK_API_URL="https://api.cohere.ai/v1/rerank"
export PAMPAX_RERANK_API_KEY="your-cohere-api-key"
export PAMPAX_RERANK_MODEL="rerank-v3.5"
```

**Other Providers:**
```bash
# Transformers.js (local)
export PAMPAX_TRANSFORMERS_MODEL="Xenova/all-mpnet-base-v2"
# Default: Xenova/all-MiniLM-L6-v2

# Ollama
export PAMPAX_OLLAMA_MODEL="llama2"
# Default: nomic-embed-text

# Cohere
export PAMPAX_COHERE_MODEL="embed-multilingual-v3.0"
# Default: embed-english-v3.0
```

**Example with Novita.ai Qwen Models:**
```bash
# Configure Novita.ai with Qwen embedding model
export OPENAI_BASE_URL="https://api.novita.ai/openai"
export OPENAI_API_KEY="your-novita-api-key"
export PAMPAX_OPENAI_EMBEDDING_MODEL="qwen/qwen3-embedding-8b"

# Index with this configuration
pampax index --provider openai

# Search will use the Qwen embedding model
pampax search "authentication logic" --provider openai
```

**Supported Services:**
- ✅ llama.cpp
- ✅ Kobold.cpp
- ✅ LM Studio
- ✅ Azure OpenAI
- ✅ Ollama (with OpenAI compatibility)
- ✅ Any OpenAI-compatible API gateway or proxy

### Using API-Based Reranking

PAMPAX supports API-based reranking as an alternative to the local Transformers.js cross-encoder. This allows you to use remote reranking services for improved search precision.

**Supported Reranking APIs:**
- ✅ Cohere Rerank API
- ✅ Jina AI Reranker
- ✅ Voyage AI Rerank
- ✅ Any compatible reranking API

**Configuration:**
```bash
# Set reranking API credentials
export PAMPAX_RERANK_API_URL="https://api.cohere.ai/v1"
export PAMPAX_RERANK_API_KEY="your-api-key"
export PAMPAX_RERANK_MODEL="rerank-v3.5"  # Optional, model to use

# Search with API reranker
pampax search "authentication logic" --reranker api

# Or use in CLI
pampax search "payment processing" --reranker api --limit 5
```

**Reranker Options:**
- `--reranker off` - No reranking (fastest, lower precision)
- `--reranker transformers` - Local Transformers.js reranking (free, private)
- `--reranker api` - API-based reranking (requires API key, higher precision)

**Example with Cohere:**
```bash
export PAMPAX_RERANK_API_URL="https://api.cohere.ai/v1/rerank"
export PAMPAX_RERANK_API_KEY="your-cohere-api-key"
export PAMPAX_RERANK_MODEL="rerank-english-v3.0"
```

**Example with Jina AI:**
```bash
export PAMPAX_RERANK_API_URL="https://api.jina.ai/v1/rerank"
export PAMPAX_RERANK_API_KEY="your-jina-api-key"
export PAMPAX_RERANK_MODEL="jina-reranker-v2-base-multilingual"
```

**Example with Novita.ai Qwen Reranker:**
```bash
export PAMPAX_RERANK_API_URL="https://api.novita.ai/openai/v1/rerank"
export PAMPAX_RERANK_API_KEY="your-novita-api-key"
export PAMPAX_RERANK_MODEL="qwen/qwen3-reranker-8b"

# Use together with Qwen embedding for full pipeline
export OPENAI_BASE_URL="https://api.novita.ai/openai"
export OPENAI_API_KEY="your-novita-api-key"
export PAMPAX_OPENAI_EMBEDDING_MODEL="qwen/qwen3-embedding-8b"

# Index with Qwen embeddings
pampax index --provider openai

# Search with both Qwen embedding and reranking
pampax search "authentication logic" --provider openai --reranker api
```

**MCP Integration:**
When API reranking is configured, the MCP `search_code` tool automatically uses it when `reranker: "api"` is specified.

## 🏆 Performance Analysis

PAMPAX v1.13 uses a specialized architecture for semantic code search with measurable results.

### 📊 Performance Metrics

**Synthetic Benchmark Results:**

Default configuration:
```
| Setting    | P@1   | MRR@5 | nDCG@10 |
| ---------- | ----- | ----- | ------- |
| Base       | 0.750 | 0.833 | 0.863   |
| Hybrid     | 0.875 | 0.917 | 0.934   |
| Hybrid+CE  | 1.000 | 0.958 | 0.967   |
```

With Novita.ai Qwen models:
```
| Configuration                              | P@1   | MRR@5 | nDCG@10 |
| ------------------------------------------ | ----- | ----- | ------- |
| Qwen3-Embedding-8B + Transformers (local)  | 0.750 | 0.875 | 0.908   |
| Qwen3-Embedding-8B + Qwen3-Reranker-8B     | 1.000 | 1.000 | 1.000   |
```

🏆 **Qwen3-Reranker-8B achieves perfect scores (100%) across all metrics!**

**Run benchmarks yourself:**

```bash
# Run default benchmarks (Base, Hybrid, Hybrid+CE)
npm run bench

# Test with Qwen models via Novita.ai
export OPENAI_BASE_URL="https://api.novita.ai/openai"
export OPENAI_API_KEY="your-novita-key"
export PAMPAX_OPENAI_EMBEDDING_MODEL="qwen/qwen3-embedding-8b"
export PAMPAX_RERANK_API_URL="https://api.novita.ai/openai/v1/rerank"
export PAMPAX_RERANK_API_KEY="your-novita-key"
export PAMPAX_RERANK_MODEL="qwen/qwen3-reranker-8b"
export PAMPA_BENCH_RERANKER="api"
npm run bench

# Test other configurations
export PAMPA_BENCH_RERANKER="transformers"
npm run bench
```

See [BENCHMARK_v1.12.md](BENCHMARK_v1.12.md) for detailed configuration options and analysis.

### 🎯 Search Examples

```bash
# Search for authentication functions
pampax search "user authentication"
→ AuthController::login, UserService::authenticate, etc.

# Search for payment processing
pampax search "payment processing"
→ PaymentService::process, CheckoutController::create, etc.

# Search with specific filters
pampax search "database operations" --lang php --path_glob "app/Models/**"
→ UserModel::save, OrderModel::find, etc.
```

**[📈 Read Full Analysis →](BENCHMARK_v1.12.md)**

### 🚀 Architectural Advantages

1. **Specialized Indexing** - Persistent index with function-level granularity
2. **Hybrid Search** - BM25 + Vector + Cross-encoder reranking combination
3. **Code Awareness** - Symbol boosting, AST analysis, function signatures
4. **Multi-Project** - Native support for context across different codebases

**Result: Optimized architecture** for semantic code search with verifiable metrics.

## 🏗️ Architecture

```
┌──────────── Repo (git) ─────────-──┐
│ app/… src/… package.json etc.      │
│ pampax.codemap.json                │
│ .pampax/chunks/*.gz(.enc)         │
│ .pampax/pampax.db (SQLite)         │
└────────────────────────────────────┘
          ▲       ▲
          │ write │ read
┌─────────┴─────────┐   │
│ indexer.js        │   │
│ (pampax index)    │   │
└─────────▲─────────┘   │
          │ store       │ vector query
┌─────────┴──────────┐  │ gz fetch
│ SQLite (local)     │  │
└─────────▲──────────┘  │
          │ read        │
┌─────────┴──────────┐  │
│ mcp-server.js      │◄─┘
│ (pampax mcp)       │
└────────────────────┘
```

### Key Components

| Layer          | Role                                                              | Technology                      |
| -------------- | ----------------------------------------------------------------- | ------------------------------- |
| **Indexer**    | Cuts code into semantic chunks, embeds, writes codemap and SQLite | tree-sitter, openai@v4, sqlite3 |
| **Codemap**    | Git-friendly JSON with {file, symbol, sha, lang} per chunk        | Plain JSON                      |
| **Chunks dir** | .gz code bodies (or .gz.enc when encrypted) (lazy loading)        | gzip → AES-256-GCM when enabled |
| **SQLite**     | Stores vectors and metadata                                       | sqlite3                         |
| **MCP Server** | Exposes tools and resources over standard MCP protocol            | @modelcontextprotocol/sdk       |
| **Logging**    | Debug and error logging in project directory                      | File-based logs                 |

## 🔧 Available MCP Tools

The MCP server exposes these tools that agents can use:

### `search_code`

Search code semantically in the indexed project.

-   **Parameters**:
    -   `query` (string) - Semantic search query (e.g., "authentication function", "error handling")
    -   `limit` (number, optional) - Maximum number of results to return (default: 10)
    -   `provider` (string, optional) - Embedding provider (default: "auto")
    -   `path` (string, optional) - **PROJECT ROOT** directory path where PAMPAX database is located
-   **Database Location**: `{path}/.pampax/pampax.db`
-   **Returns**: List of matching code chunks with similarity scores and SHAs

### `get_code_chunk`

Get complete code of a specific chunk.

-   **Parameters**:
    -   `sha` (string) - SHA of the code chunk to retrieve (obtained from search_code results)
    -   `path` (string, optional) - **PROJECT ROOT** directory path (same as used in search_code)
-   **Chunk Location**: `{path}/.pampax/chunks/{sha}.gz` or `{sha}.gz.enc`
-   **Returns**: Complete source code

### `index_project`

Index a project from the agent.

-   **Parameters**:
    -   `path` (string, optional) - **PROJECT ROOT** directory path to index (will create .pampax/ subdirectory here)
    -   `provider` (string, optional) - Embedding provider (default: "auto")
-   **Creates**:
    -   `{path}/.pampax/pampax.db` (SQLite database with embeddings)
    -   `{path}/.pampax/chunks/` (compressed code chunks)
    -   `{path}/pampax.codemap.json` (lightweight index for version control)
-   **Effect**: Updates database and codemap

### `update_project`

**🔄 CRITICAL: Use this tool frequently to keep your AI memory current!**

Update project index after code changes (recommended workflow tool).

-   **Parameters**:
    -   `path` (string, optional) - **PROJECT ROOT** directory path to update (same as used in index_project)
    -   `provider` (string, optional) - Embedding provider (default: "auto")
-   **Updates**:
    -   Re-scans all files for changes
    -   Updates embeddings for modified functions
    -   Removes deleted functions from database
    -   Adds new functions to database
-   **When to use**:
    -   ✅ At the start of development sessions
    -   ✅ After creating new functions
    -   ✅ After modifying existing functions
    -   ✅ After deleting functions
    -   ✅ Before major code analysis tasks
    -   ✅ After refactoring code
-   **Effect**: Keeps your AI agent's code memory synchronized with current state

### `get_project_stats`

Get indexed project statistics.

-   **Parameters**:
    -   `path` (string, optional) - **PROJECT ROOT** directory path where PAMPAX database is located
-   **Database Location**: `{path}/.pampax/pampax.db`
-   **Returns**: Statistics by language and file

## 📊 Available MCP Resources

### `pampax://codemap`

Access to the complete project code map.

### `pampax://overview`

Summary of the project's main functions.

## 🎯 Available MCP Prompts

### `analyze_code`

Template for analyzing found code with specific focus.

### `find_similar_functions`

Template for finding existing similar functions.

## 🔍 How Retrieval Works

-   **Vector search** – Cosine similarity with advanced high-dimensional embeddings
-   **Summary fallback** – If an agent sends an empty query, PAMPAX returns top-level summaries so the agent understands the territory
-   **Chunk granularity** – Default = function/method/class. Adjustable per language

## 📝 Design Decisions

-   **Node only** → Devs run everything via `npx`, no Python, no Docker
-   **SQLite over HelixDB** → One local database for vectors and relations, no external dependencies
-   **Committed codemap** → Context travels with repo → cloning works offline
-   **Chunk granularity** → Default = function/method/class. Adjustable per language
-   **Read-only by default** → Server only exposes read methods. Writing is done via CLI

## 🧩 Extending PAMPAX

| Idea                  | Hint                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------- |
| **More languages**    | Install tree-sitter grammar and add it to `LANG_RULES`                                    |
| **Custom embeddings** | Export `OPENAI_API_KEY` or switch OpenAI for any provider that returns `vector: number[]` |
| **Security**          | Run behind a reverse proxy with authentication                                            |
| **VS Code Plugin**    | Point an MCP WebView client to your local server                                          |

## 🔐 Encrypting the Chunk Store

PAMPAX can encrypt chunk bodies at rest using AES-256-GCM. Configure it like this:

1. Export a 32-byte key in base64 or hex form:

    ```bash
    export PAMPAX_ENCRYPTION_KEY="$(openssl rand -base64 32)"
    ```

2. Index with encryption enabled (skips plaintext writes even if stale files exist):

    ```bash
    pampax index --encrypt on
    ```

    Without `--encrypt`, PAMPAX auto-encrypts when the environment key is present. Use `--encrypt off` to force plaintext (e.g., for debugging).

3. All new chunks are stored as `.gz.enc` and require the same key for CLI or MCP chunk retrieval. Missing or corrupt keys surface clear errors instead of leaking data.

Existing plaintext archives remain readable, so you can enable encryption incrementally or rotate keys by re-indexing.

## 🤝 Contributing

1. **Fork** → create feature branch (`feat/...`)
2. **Run** `npm test` (coming soon) & `pampax index` before PR
3. **Open PR** with context: why + screenshots/logs

All discussions on GitHub Issues.

## 📜 License

MIT – do whatever you want, just keep the copyright.

Happy hacking! 💙

