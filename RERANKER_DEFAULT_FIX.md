# Fix: Reranker Not Being Called Even When Configured

## Problem
The user had configured the Novita reranker API with `PAMPAX_RERANK_API_URL` and `PAMPAX_RERANK_API_KEY`, but the reranker was never being called. Their Novita dashboard showed 0 usage despite using pampax all day.

## Root Cause
The reranker parameter in PAMPAX defaults to `'off'` in the MCP server and CLI. Even when the reranker API is properly configured, the reranker code is only invoked when explicitly passing `reranker: 'api'` (or `reranker: 'transformers'`) in search requests.

### Code Flow
1. **MCP Server** (`src/mcp-server.js` line 224): 
   ```javascript
   reranker: z.enum(['off', 'transformers', 'api']).optional().default('off')
   ```

2. **Service** (`src/service.js` line 2228-2243):
   ```javascript
   if (vectorResults.length > 1 && 
       (normalizedScope.reranker === 'transformers' || normalizedScope.reranker === 'api')) {
       // Only then is the reranker called
   }
   ```

3. **Types** (`src/types/search.js`):
   ```javascript
   export const DEFAULT_RERANKER = 'off';
   ```

## Solution
Added a new environment variable `PAMPAX_RERANKER_DEFAULT` that allows users to set the default reranker mode globally.

### Changes Made

#### 1. Modified `src/types/search.js`
```javascript
export const RERANKER_OPTIONS = ['off', 'transformers', 'api'];

// Get default reranker from environment variable, fallback to 'off'
function getDefaultReranker() {
    const envValue = process.env.PAMPAX_RERANKER_DEFAULT;
    if (envValue && RERANKER_OPTIONS.includes(envValue.toLowerCase())) {
        return envValue.toLowerCase();
    }
    return 'off';
}

export const DEFAULT_RERANKER = getDefaultReranker();
```

#### 2. Updated Documentation
- **README.md**: Added `PAMPAX_RERANKER_DEFAULT` to reranker configuration section
- **README_FOR_AGENTS.md**: Added to reranking configuration options
- Updated MCP configuration example to include the new variable

#### 3. Added Tests
Created `test/reranker-default.test.js` with comprehensive test coverage:
- ✅ Defaults to "off" when not set
- ✅ Uses "api" when set to "api"
- ✅ Uses "transformers" when set to "transformers"
- ✅ Falls back to "off" for invalid values
- ✅ Case-insensitive handling

#### 4. Updated CHANGELOG.md
Added entry in [Unreleased] section documenting the new feature.

## Usage

### For MCP Users (Recommended)
Add to your Claude Desktop or Cursor configuration:

```json
{
  "mcpServers": {
    "pampax": {
      "command": "npx",
      "args": ["-y", "pampax", "mcp"],
      "env": {
        "OPENAI_API_KEY": "your-api-key",
        "OPENAI_BASE_URL": "https://api.novita.ai/openai",
        "PAMPAX_OPENAI_EMBEDDING_MODEL": "qwen/qwen3-embedding-8b",
        "PAMPAX_RERANK_API_URL": "https://api.novita.ai/openai/v1/rerank",
        "PAMPAX_RERANK_API_KEY": "your-api-key",
        "PAMPAX_RERANK_MODEL": "qwen/qwen3-reranker-8b",
        "PAMPAX_RERANKER_DEFAULT": "api"
      }
    }
  }
}
```

### For CLI Users
```bash
export PAMPAX_RERANKER_DEFAULT=api
pampax search "your query"  # Will now use API reranker by default
```

### For Environment Files
```bash
# .env
PAMPAX_RERANKER_DEFAULT=api
```

## Benefits
1. **No manual intervention**: Users with configured reranker APIs no longer need to pass `reranker: 'api'` in every search
2. **API usage tracking**: The reranker API will now be called automatically, showing usage in dashboards
3. **Flexible override**: Users can still override the default on a per-search basis
4. **Backward compatible**: Defaults to 'off' if not set, maintaining existing behavior

## Testing
All tests pass successfully:
```
✅ PASS MCP Server Basic Test
✅ PASS Search Code Validation Test
✅ PASS Database Error Handling Test
✅ PASS Scoped Search Filters Test
✅ PASS Hybrid Search Fusion Test
✅ PASS Cross-Encoder Reranker Test
✅ PASS PAMPAX_RERANKER_DEFAULT environment variable (5 tests)
```

## Next Steps for User
To fix your issue, update your MCP configuration to include:
```json
"PAMPAX_RERANKER_DEFAULT": "api"
```

After restarting your MCP client, all searches will automatically use the reranker, and you should see usage in your Novita dashboard.
