# Rate Limiting in Pampax

## Overview

Pampax now includes intelligent rate limiting to prevent hitting API provider limits during indexing. This is especially important for cloud embedding providers like OpenAI and Cohere that have strict rate limits.

## Environment Variable

### `PAMPAX_RATE_LIMIT`

Set the maximum number of embedding API requests per minute.

```bash
export PAMPAX_RATE_LIMIT=50    # For OpenAI free tier
export PAMPAX_RATE_LIMIT=500   # For OpenAI paid tier
export PAMPAX_RATE_LIMIT=100   # For Cohere trial
```

## Default Rate Limits

If `PAMPAX_RATE_LIMIT` is not set, Pampax uses these defaults:

| Provider | Default RPM | Notes |
|----------|-------------|-------|
| OpenAI | 50 | Free tier limit |
| Cohere | 100 | Trial tier limit |
| Ollama | No limit | Local model |
| Transformers.js | No limit | Local model |

## How It Works

1. **Request Queue**: Embedding requests are queued and processed sequentially
2. **Throttling**: Requests are delayed to stay within the rate limit
3. **Automatic Retry**: 429 errors trigger exponential backoff retry (up to 4 attempts)
4. **Smart Detection**: Local models bypass rate limiting for maximum speed

## Features

### Exponential Backoff

When a 429 (rate limit) error occurs:
- 1st retry: Wait 1 second
- 2nd retry: Wait 2 seconds
- 3rd retry: Wait 5 seconds
- 4th retry: Wait 10 seconds

### Logs

During indexing, you'll see:

```
📊 Chunking Configuration:
  Provider: OpenAI
  Model: text-embedding-3-large
  ...
  🔒 Rate limiting: 50 requests/minute    # API providers

OR

  ⚡ Rate limiting: disabled (local model)  # Local models
```

If rate limiting triggers:
```
⚠️  Rate limit hit (429). Retrying in 1000ms... (attempt 1/4)
```

## Examples

### OpenAI with Custom Rate Limit

```bash
# Paid tier with higher limits
export PAMPAX_RATE_LIMIT=500
node src/cli.js index /path/to/project --provider auto
```

### Cohere with Trial Limits

```bash
export PAMPAX_RATE_LIMIT=100
export COHERE_API_KEY=your-key
node src/cli.js index /path/to/project --provider auto
```

### Local Model (No Limits)

```bash
# No rate limiting needed
node src/cli.js index /path/to/project --provider transformers
```

## Calculating Indexing Time

With rate limiting, you can estimate indexing time:

```
chunks = number of code chunks
rpm = requests per minute (from PAMPAX_RATE_LIMIT)
time_minutes = chunks / rpm

Example:
  49 chunks @ 50 RPM = ~1 minute
  500 chunks @ 50 RPM = ~10 minutes
  500 chunks @ 500 RPM = ~1 minute
```

## Troubleshooting

### Still Getting 429 Errors?

1. **Lower the rate limit**:
   ```bash
   export PAMPAX_RATE_LIMIT=30  # More conservative
   ```

2. **Check your provider tier**: Free tiers have lower limits

3. **Verify API key**: Wrong keys may have different limits

### Indexing Too Slow?

1. **Upgrade provider tier**: Get higher RPM limits
2. **Use local models**: No rate limits at all
   ```bash
   npm install @xenova/transformers
   node src/cli.js index . --provider transformers
   ```

## Technical Details

### Implementation

- **File**: `src/utils/rate-limiter.js`
- **Pattern**: Request queue with sliding window
- **Memory**: Tracks last 60 seconds of requests
- **Cleanup**: Automatic cleanup of old request timestamps

### Provider Integration

All embedding providers support rate limiting:
- `OpenAIProvider`
- `CohereProvider`  
- `OllamaProvider` (bypassed for local)
- `TransformersProvider` (bypassed for local)

### Error Handling

The rate limiter handles these errors:
- `status === 429`
- Error message contains "429"
- Error message contains "rate limit"
- Error message contains "too many requests"

## See Also

- [Chunking Strategy](OPTIMIZATION_SUMMARY.md) - How Pampax reduces chunk count
- [Provider Configuration](README.md#providers) - Setting up embedding providers
- [Environment Variables](README.md#environment-variables) - All configuration options
