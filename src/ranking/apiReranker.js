/**
 * API-based Reranker for PAMPA
 * 
 * Supports any OpenAI-compatible reranking API including:
 * - Cohere Rerank API
 * - Jina AI Reranker
 * - Voyage AI Rerank
 * - Custom reranking endpoints
 */

let testRerankOverride = null;

/**
 * Get the API URL from environment (or empty string)
 */
function getAPIUrl() {
    return process.env.PAMPA_RERANK_API_URL || '';
}

/**
 * Get the API key from environment (or empty string)
 */
function getAPIKey() {
    return process.env.PAMPA_RERANK_API_KEY || '';
}

/**
 * Get the model name from environment (or default)
 */
function getModel() {
    return process.env.PAMPA_RERANK_MODEL || 'rerank-v3.5';
}

/**
 * Get max candidates from environment (or default)
 */
function getMaxFromEnv() {
    const envMax = Number.parseInt(process.env.PAMPA_RERANKER_MAX || '50', 10);
    return Number.isFinite(envMax) && envMax > 0 ? envMax : 50;
}

/**
 * Check if API reranking is configured
 */
export function isAPIRerankingConfigured() {
    const url = getAPIUrl();
    const key = getAPIKey();
    return Boolean(url && key);
}

/**
 * Get the default max candidates for API reranking
 */
function getDefaultMaxCandidates() {
    return getMaxFromEnv();
}

/**
 * Coerce max candidates to a valid number
 */
function coerceMaxCandidates(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    return getDefaultMaxCandidates();
}

/**
 * Build the document text for reranking
 */
function buildCandidateText(candidate, options) {
    if (!candidate) {
        return '';
    }

    if (typeof candidate.text === 'string') {
        return candidate.text;
    }

    if (options && typeof options.getText === 'function') {
        try {
            const text = options.getText(candidate);
            return typeof text === 'string' ? text : '';
        } catch (error) {
            return '';
        }
    }

    return '';
}

/**
 * Set candidate ranks and scores after reranking
 */
function setCandidateRanks(sortedCandidates) {
    sortedCandidates.forEach((entry, index) => {
        entry.candidate.rerankerScore = entry.score;
        entry.candidate.rerankerRank = index + 1;
    });
}

/**
 * Call the reranking API
 * 
 * @param {string} query - The search query
 * @param {Array<string>} documents - Array of document texts
 * @param {Object} config - API configuration
 * @returns {Promise<Array>} Results with index and relevance_score
 */
async function callRerankAPI(query, documents, config = {}) {
    const apiUrl = config.apiUrl || getAPIUrl();
    const apiKey = config.apiKey || getAPIKey();
    const model = config.model || getModel();

    if (!apiUrl) {
        throw new Error('PAMPA_RERANK_API_URL is not configured');
    }

    if (!apiKey) {
        throw new Error('PAMPA_RERANK_API_KEY is not configured');
    }

    // Build request body (compatible with Cohere, Jina AI, and similar APIs)
    const requestBody = {
        model: model,
        query: query,
        documents: documents,
        top_n: documents.length // Return all, we'll handle limiting ourselves
    };

    // Make API request
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Rerank API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // Handle different response formats
    // Cohere/Jina format: { results: [{ index: 0, relevance_score: 0.95 }] }
    if (data.results && Array.isArray(data.results)) {
        return data.results;
    }

    // Alternative format: { data: [...] }
    if (data.data && Array.isArray(data.data)) {
        return data.data;
    }

    // Direct array format
    if (Array.isArray(data)) {
        return data;
    }

    throw new Error('Unexpected rerank API response format');
}

/**
 * Main API reranking function
 * 
 * @param {string} query - The search query
 * @param {Array} candidates - Array of candidate objects
 * @param {Object} options - Reranking options
 * @returns {Promise<Array>} Reranked candidates
 */
export async function rerankWithAPI(query, candidates, options = {}) {
    if (!Array.isArray(candidates) || candidates.length <= 1) {
        return candidates;
    }

    // Test override for testing
    if (typeof testRerankOverride === 'function') {
        try {
            const overridden = await testRerankOverride(query, candidates, options);
            if (Array.isArray(overridden)) {
                return overridden;
            }
        } catch (error) {
            return candidates;
        }
    }

    const maxCandidates = Math.min(coerceMaxCandidates(options.max), candidates.length);
    if (maxCandidates <= 1) {
        return candidates;
    }

    const topCandidates = candidates.slice(0, maxCandidates);

    try {
        // Get document texts for all candidates
        let texts;
        try {
            const resolvedTexts = await Promise.all(
                topCandidates.map(async candidate => {
                    const text = options && typeof options.getTextAsync === 'function'
                        ? await options.getTextAsync(candidate)
                        : buildCandidateText(candidate, options);
                    return typeof text === 'string' ? text : '';
                })
            );
            texts = resolvedTexts;
        } catch (error) {
            console.error('Error resolving candidate texts:', error);
            return candidates;
        }

        // Call the reranking API
        const apiConfig = {
            apiUrl: options.apiUrl,
            apiKey: options.apiKey,
            model: options.model
        };

        const results = await callRerankAPI(query, texts, apiConfig);

        // Build scored candidates map
        const scoreMap = new Map();
        for (const result of results) {
            const index = result.index;
            const score = result.relevance_score || result.score || 0;
            scoreMap.set(index, score);
        }

        // Score and sort candidates
        const scored = topCandidates.map((candidate, index) => ({
            candidate,
            score: scoreMap.get(index) || 0
        })).sort((a, b) => b.score - a.score);

        // Set ranks
        setCandidateRanks(scored);

        // Return reranked top candidates + remaining candidates
        const rerankedTop = scored.map(entry => entry.candidate);
        const remainder = candidates.slice(maxCandidates);
        return [...rerankedTop, ...remainder];

    } catch (error) {
        console.error('API reranking failed:', error.message);
        // Fallback: return original order
        return candidates;
    }
}

/**
 * Test utilities
 */
export function __setTestRerankOverride(override) {
    testRerankOverride = typeof override === 'function' ? override : null;
}

export function __resetForTests() {
    testRerankOverride = null;
}
