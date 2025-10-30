import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('PAMPAX_RERANKER_DEFAULT environment variable', () => {
    let originalEnv;

    before(() => {
        originalEnv = process.env.PAMPAX_RERANKER_DEFAULT;
    });

    after(() => {
        if (originalEnv !== undefined) {
            process.env.PAMPAX_RERANKER_DEFAULT = originalEnv;
        } else {
            delete process.env.PAMPAX_RERANKER_DEFAULT;
        }
    });

    it('should default to "off" when PAMPAX_RERANKER_DEFAULT is not set', async () => {
        delete process.env.PAMPAX_RERANKER_DEFAULT;
        
        // Use query parameter to force fresh import
        const { DEFAULT_RERANKER } = await import(`../src/types/search.js?v=${Date.now()}`);
        assert.equal(DEFAULT_RERANKER, 'off');
    });

    it('should use "api" when PAMPAX_RERANKER_DEFAULT is set to "api"', async () => {
        process.env.PAMPAX_RERANKER_DEFAULT = 'api';
        
        const { DEFAULT_RERANKER } = await import(`../src/types/search.js?v=${Date.now()}`);
        assert.equal(DEFAULT_RERANKER, 'api');
    });

    it('should use "transformers" when PAMPAX_RERANKER_DEFAULT is set to "transformers"', async () => {
        process.env.PAMPAX_RERANKER_DEFAULT = 'transformers';
        
        const { DEFAULT_RERANKER } = await import(`../src/types/search.js?v=${Date.now()}`);
        assert.equal(DEFAULT_RERANKER, 'transformers');
    });

    it('should fallback to "off" for invalid PAMPAX_RERANKER_DEFAULT values', async () => {
        process.env.PAMPAX_RERANKER_DEFAULT = 'invalid-mode';
        
        const { DEFAULT_RERANKER } = await import(`../src/types/search.js?v=${Date.now()}`);
        assert.equal(DEFAULT_RERANKER, 'off');
    });

    it('should be case-insensitive', async () => {
        process.env.PAMPAX_RERANKER_DEFAULT = 'API';
        
        const { DEFAULT_RERANKER } = await import(`../src/types/search.js?v=${Date.now()}`);
        assert.equal(DEFAULT_RERANKER, 'api');
    });
});
