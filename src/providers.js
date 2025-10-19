/**
 * Embedding Providers for PAMPA
 * 
 * This module contains all embedding provider implementations
 * for generating vector embeddings from code chunks.
 */

import { createRateLimiter } from './utils/rate-limiter.js';

// ============================================================================
// BASE PROVIDER CLASS
// ============================================================================

export class EmbeddingProvider {
    async generateEmbedding(text) {
        throw new Error('generateEmbedding must be implemented by subclass');
    }

    getDimensions() {
        throw new Error('getDimensions must be implemented by subclass');
    }

    getName() {
        throw new Error('getName must be implemented by subclass');
    }
}

let testProviderFactory = null;

export function __setTestProviderFactory(factory) {
    testProviderFactory = typeof factory === 'function' ? factory : null;
}

export function __resetTestProviderFactory() {
    testProviderFactory = null;
}

// ============================================================================
// TOKEN COUNTERS - For accurate token-based chunking
// ============================================================================

let tiktokenEncoder = null;
let transformersTokenizers = new Map();

async function getTokenCounter(modelName) {
    // OpenAI models: use tiktoken
    if (modelName.includes('text-embedding') || modelName.includes('ada-002')) {
        if (!tiktokenEncoder) {
            try {
                const tiktoken = await import('tiktoken');
                tiktokenEncoder = tiktoken.encoding_for_model('text-embedding-3-large');
            } catch (error) {
                console.warn('tiktoken not available, falling back to character estimation');
                return null;
            }
        }
        return (text) => tiktokenEncoder.encode(text).length;
    }
    
    // Transformers.js: use model's tokenizer
    if (modelName.includes('Xenova/')) {
        if (!transformersTokenizers.has(modelName)) {
            try {
                const { AutoTokenizer } = await import('@xenova/transformers');
                const tokenizer = await AutoTokenizer.from_pretrained(modelName);
                transformersTokenizers.set(modelName, tokenizer);
            } catch (error) {
                console.warn(`Transformers tokenizer not available for ${modelName}, falling back to estimation`);
                return null;
            }
        }
        const tokenizer = transformersTokenizers.get(modelName);
        return async (text) => {
            const encoded = await tokenizer.encode(text);
            return encoded.length;
        };
    }
    
    // Fallback: estimate tokens from characters (4:1 ratio for code)
    return (text) => Math.ceil(text.length / 4);
}

// ============================================================================
// MODEL PROFILES - Token limits and optimal chunking sizes
// ============================================================================

export const MODEL_PROFILES = {
    // OpenAI models
    // LESS AGGRESSIVE CHUNKING: Preserve more context by allowing larger chunks
    // - Increased minChunkTokens to merge more small functions
    // - Increased maxChunkTokens to keep whole functions/classes together
    'text-embedding-3-large': {
        maxTokens: 8191,
        optimalTokens: 4000,          // Target larger chunks for better context
        minChunkTokens: 400,          // Merge small functions (up from 100)
        maxChunkTokens: 6000,         // Only subdivide huge code (up from 2000)
        overlapTokens: 100,
        optimalChars: 16000,
        minChunkChars: 1600,
        maxChunkChars: 24000,
        overlapChars: 400,
        dimensions: 3072,
        useTokens: true,
        tokenizerType: 'tiktoken',
        encoding: 'cl100k_base'
    },
    'text-embedding-3-small': {
        maxTokens: 8191,
        optimalTokens: 4000,
        minChunkTokens: 400,
        maxChunkTokens: 6000,
        overlapTokens: 100,
        optimalChars: 16000,
        minChunkChars: 1600,
        maxChunkChars: 24000,
        overlapChars: 400,
        dimensions: 1536,
        useTokens: true,
        tokenizerType: 'tiktoken',
        encoding: 'cl100k_base'
    },
    'text-embedding-ada-002': {
        maxTokens: 8191,
        optimalTokens: 4000,
        minChunkTokens: 400,
        maxChunkTokens: 6000,
        overlapTokens: 100,
        optimalChars: 16000,
        minChunkChars: 1600,
        maxChunkChars: 24000,
        overlapChars: 400,
        dimensions: 1536,
        useTokens: true,
        tokenizerType: 'tiktoken',
        encoding: 'cl100k_base'
    },
    
    // Transformers.js models (local)
    'Xenova/all-MiniLM-L6-v2': {
        maxTokens: 256,
        optimalTokens: 200,        // Target chunk size for embeddings
        minChunkTokens: 50,        // Skip very small chunks
        maxChunkTokens: 512,       // Only subdivide truly large functions (2x max tokens)
        overlapTokens: 20,
        optimalChars: 800,
        minChunkChars: 200,
        maxChunkChars: 2048,       // 2x character limit for subdivision
        overlapChars: 80,
        dimensions: 384,
        useTokens: true,
        tokenizerType: 'transformers',
        modelName: 'Xenova/all-MiniLM-L6-v2'
    },
    'Xenova/all-mpnet-base-v2': {
        maxTokens: 384,
        optimalTokens: 300,        // Target chunk size
        minChunkTokens: 75,
        maxChunkTokens: 768,       // 2x max tokens - only subdivide huge functions
        overlapTokens: 30,
        optimalChars: 1200,
        minChunkChars: 300,
        maxChunkChars: 3072,       // 2x character limit
        overlapChars: 120,
        dimensions: 768,
        useTokens: true,
        tokenizerType: 'transformers',
        modelName: 'Xenova/all-mpnet-base-v2'
    },
    
    // Ollama models (use tiktoken for compatibility)
    'nomic-embed-text': {
        maxTokens: 8192,
        optimalTokens: 4000,
        minChunkTokens: 400,
        maxChunkTokens: 6000,
        overlapTokens: 100,
        optimalChars: 16000,
        minChunkChars: 1600,
        maxChunkChars: 24000,
        overlapChars: 400,
        dimensions: 768,
        useTokens: true,
        tokenizerType: 'tiktoken',
        encoding: 'cl100k_base'
    },
    
    // Cohere models
    'embed-english-v3.0': {
        maxTokens: 512,
        optimalTokens: 450,
        minChunkTokens: 75,
        maxChunkTokens: 480,
        overlapTokens: 30,
        optimalChars: 1800,
        minChunkChars: 300,
        maxChunkChars: 1920,
        overlapChars: 120,
        dimensions: 1024,
        useTokens: false,
        tokenizerType: 'estimate'
    },
    
    // Default fallback (conservative)
    'default': {
        maxTokens: 512,
        optimalTokens: 400,
        minChunkTokens: 50,
        maxChunkTokens: 480,
        overlapTokens: 30,
        optimalChars: 1600,
        minChunkChars: 200,
        maxChunkChars: 1920,
        overlapChars: 120,
        dimensions: 384,
        useTokens: false,
        tokenizerType: 'estimate'
    }
};

export async function getModelProfile(providerName, modelName) {
    // Try exact model match
    let profile = MODEL_PROFILES[modelName];
    
    // If no exact match, try provider defaults
    if (!profile) {
        const providerDefaults = {
            'OpenAI': MODEL_PROFILES['text-embedding-3-large'],
            'Transformers.js (Local)': MODEL_PROFILES['Xenova/all-MiniLM-L6-v2'],
            'Ollama': MODEL_PROFILES['nomic-embed-text'],
            'Cohere': MODEL_PROFILES['embed-english-v3.0']
        };
        profile = providerDefaults[providerName] || MODEL_PROFILES['default'];
    }
    
    // Clone profile to avoid modifying original
    profile = { ...profile };
    
    // Apply environment variable overrides
    if (process.env.PAMPAX_MAX_TOKENS) {
        const maxTokens = parseInt(process.env.PAMPAX_MAX_TOKENS, 10);
        if (!isNaN(maxTokens) && maxTokens > 0) {
            profile.maxTokens = maxTokens;
            profile.maxChunkTokens = Math.min(profile.maxChunkTokens, maxTokens);
            profile.optimalTokens = Math.min(profile.optimalTokens, Math.floor(maxTokens * 0.9));
            console.log(`Using custom max tokens: ${maxTokens}`);
        }
    }
    
    if (process.env.PAMPAX_DIMENSIONS) {
        const dimensions = parseInt(process.env.PAMPAX_DIMENSIONS, 10);
        if (!isNaN(dimensions) && dimensions > 0) {
            profile.dimensions = dimensions;
            console.log(`Using custom dimensions: ${dimensions}`);
        }
    }
    
    // Attach token counter if supported
    if (profile.useTokens) {
        profile.tokenCounter = await getTokenCounter(modelName);
        
        // If token counter failed, fall back to character mode
        if (!profile.tokenCounter) {
            console.warn(`Token counter unavailable for ${modelName}, using character estimation`);
            profile.useTokens = false;
        }
    }
    
    return profile;
}

// Helper: Count tokens or estimate from characters
export function countChunkSize(text, profile) {
    if (profile.useTokens && profile.tokenCounter) {
        const result = profile.tokenCounter(text);
        // Handle async tokenizers
        return result instanceof Promise ? result : Promise.resolve(result);
    }
    // Fallback: character count
    return Promise.resolve(text.length);
}

// Helper: Get the appropriate size limits based on mode
export function getSizeLimits(profile) {
    if (profile.useTokens && profile.tokenCounter) {
        return {
            optimal: profile.optimalTokens,
            min: profile.minChunkTokens,
            max: profile.maxChunkTokens,
            overlap: profile.overlapTokens,
            unit: 'tokens'
        };
    }
    return {
        optimal: profile.optimalChars,
        min: profile.minChunkChars,
        max: profile.maxChunkChars,
        overlap: profile.overlapChars,
        unit: 'characters'
    };
}

// ============================================================================
// OPENAI PROVIDER
// ============================================================================

export class OpenAIProvider extends EmbeddingProvider {
    constructor() {
        super();
        // Dynamic import to avoid error if not installed
        this.openai = null;
        // Support model selection via environment variables
        // Priority: PAMPAX_OPENAI_EMBEDDING_MODEL > OPENAI_MODEL > default
        this.model = process.env.PAMPAX_OPENAI_EMBEDDING_MODEL 
                     || process.env.OPENAI_MODEL 
                     || 'text-embedding-3-large';
        // Initialize rate limiter for API throttling
        this.rateLimiter = createRateLimiter('OpenAI');
    }

    async init() {
        if (!this.openai) {
            const { OpenAI } = await import('openai');
            
            // Build configuration object
            const config = {};
            
            // Support custom API key (explicit or from environment)
            if (process.env.OPENAI_API_KEY) {
                config.apiKey = process.env.OPENAI_API_KEY;
            }
            
            // Support custom base URL for OpenAI-compatible APIs
            if (process.env.OPENAI_BASE_URL) {
                config.baseURL = process.env.OPENAI_BASE_URL;
            }
            
            this.openai = new OpenAI(config);
        }
    }

    async generateEmbedding(text) {
        await this.init();
        
        // Get model profile for accurate limits
        const profile = await getModelProfile(this.getName(), this.model);
        const limits = getSizeLimits(profile);
        const maxChars = profile.maxChunkChars || 8000;
        
        // Use rate limiter to prevent 429 errors
        return await this.rateLimiter.execute(async () => {
            const { data } = await this.openai.embeddings.create({
                model: this.model,
                input: text.slice(0, maxChars)
            });
            return data[0].embedding;
        });
    }

    getDimensions() {
        // Check for custom dimensions
        if (process.env.PAMPAX_DIMENSIONS) {
            const dims = parseInt(process.env.PAMPAX_DIMENSIONS, 10);
            if (!isNaN(dims) && dims > 0) return dims;
        }
        
        // Model-specific dimensions
        if (this.model.includes('3-small')) return 1536;
        if (this.model.includes('3-large')) return 3072;
        return 1536; // ada-002 default
    }

    getName() {
        return 'OpenAI';
    }
    
    getModelName() {
        return this.model;
    }
}

// ============================================================================
// TRANSFORMERS.JS PROVIDER (LOCAL)
// ============================================================================

export class TransformersProvider extends EmbeddingProvider {
    constructor() {
        super();
        this.pipeline = null;
        // Support model selection via environment variable
        this.model = process.env.PAMPAX_TRANSFORMERS_MODEL 
                     || 'Xenova/all-MiniLM-L6-v2';
        this.initialized = false;
        // No rate limiting for local models
        this.rateLimiter = createRateLimiter('Transformers.js (Local)');
    }

    async init() {
        if (!this.initialized && !this.pipeline) {
            try {
                const { pipeline } = await import('@xenova/transformers');
                this.pipeline = await pipeline('feature-extraction', this.model);
                this.initialized = true;
            } catch (error) {
                throw new Error('Transformers.js is not installed. Run: npm install @xenova/transformers');
            }
        }
    }

    async generateEmbedding(text) {
        if (!this.initialized) {
            await this.init();
        }
        
        // Get model profile for accurate limits
        const profile = await getModelProfile(this.getName(), this.model);
        const maxChars = profile.maxChunkChars || 960;
        
        const result = await this.pipeline(text.slice(0, maxChars), {
            pooling: 'mean',
            normalize: true
        });
        return Array.from(result.data);
    }

    getDimensions() {
        // Check for custom dimensions
        if (process.env.PAMPAX_DIMENSIONS) {
            const dims = parseInt(process.env.PAMPAX_DIMENSIONS, 10);
            if (!isNaN(dims) && dims > 0) return dims;
        }
        
        // Model-specific dimensions
        if (this.model.includes('mpnet')) return 768;
        if (this.model.includes('MiniLM')) return 384;
        return 384; // default
    }

    getName() {
        return 'Transformers.js (Local)';
    }
    
    getModelName() {
        return this.model;
    }
}

// ============================================================================
// OLLAMA PROVIDER
// ============================================================================

export class OllamaProvider extends EmbeddingProvider {
    constructor(model = process.env.PAMPAX_OLLAMA_MODEL || 'nomic-embed-text') {
        super();
        this.model = model;
        this.ollama = null;
        // No rate limiting for local models
        this.rateLimiter = createRateLimiter('Ollama');
    }

    async init() {
        if (!this.ollama) {
            try {
                const ollama = await import('ollama');
                this.ollama = ollama.default;
            } catch (error) {
                throw new Error('Ollama is not installed. Run: npm install ollama');
            }
        }
    }

    async generateEmbedding(text) {
        await this.init();
        
        // Get model profile for accurate limits
        const profile = await getModelProfile('Ollama', this.model);
        const maxChars = profile.maxChunkChars || 8000;
        
        // Use rate limiter (though typically unlimited for local models)
        return await this.rateLimiter.execute(async () => {
            const response = await this.ollama.embeddings({
                model: this.model,
                prompt: text.slice(0, maxChars)
            });
            return response.embedding;
        });
    }

    getDimensions() {
        // Check for custom dimensions
        if (process.env.PAMPAX_DIMENSIONS) {
            const dims = parseInt(process.env.PAMPAX_DIMENSIONS, 10);
            if (!isNaN(dims) && dims > 0) return dims;
        }
        
        return 768; // nomic-embed-text (may vary by model)
    }

    getName() {
        return `Ollama`;
    }
    
    getModelName() {
        return this.model;
    }
}

// ============================================================================
// COHERE PROVIDER
// ============================================================================

export class CohereProvider extends EmbeddingProvider {
    constructor() {
        super();
        this.cohere = null;
        // Support model selection via environment variable
        this.model = process.env.PAMPAX_COHERE_MODEL 
                     || 'embed-english-v3.0';
        // Initialize rate limiter for API throttling
        this.rateLimiter = createRateLimiter('Cohere');
    }

    async init() {
        if (!this.cohere) {
            try {
                const { CohereClient } = await import('cohere-ai');
                this.cohere = new CohereClient({
                    token: process.env.COHERE_API_KEY
                });
            } catch (error) {
                throw new Error('Cohere is not installed. Run: npm install cohere-ai');
            }
        }
    }

    async generateEmbedding(text) {
        await this.init();
        
        // Get model profile for accurate limits
        const profile = await getModelProfile(this.getName(), this.model);
        const maxChars = profile.maxChunkChars || 1920;
        
        // Use rate limiter to prevent hitting Cohere limits
        return await this.rateLimiter.execute(async () => {
            const response = await this.cohere.embed({
                texts: [text.slice(0, maxChars)],
                model: this.model,
                inputType: 'search_document'
            });
            return response.embeddings[0];
        });
    }

    getDimensions() {
        // Check for custom dimensions
        if (process.env.PAMPAX_DIMENSIONS) {
            const dims = parseInt(process.env.PAMPAX_DIMENSIONS, 10);
            if (!isNaN(dims) && dims > 0) return dims;
        }
        
        return 1024; // embed-english-v3.0
    }

    getName() {
        return 'Cohere';
    }
    
    getModelName() {
        return this.model;
    }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createEmbeddingProvider(providerName = 'auto') {
    if (typeof testProviderFactory === 'function') {
        return testProviderFactory(providerName);
    }

    switch (providerName.toLowerCase()) {
        case 'openai':
            return new OpenAIProvider();
        case 'transformers':
        case 'local':
            return new TransformersProvider();
        case 'ollama':
            return new OllamaProvider();
        case 'cohere':
            return new CohereProvider();
        case 'auto':
        default:
            // Auto-detect best available provider
            if (process.env.OPENAI_API_KEY) {
                return new OpenAIProvider();
            } else if (process.env.COHERE_API_KEY) {
                return new CohereProvider();
            } else {
                return new TransformersProvider();
            }
    }
} 