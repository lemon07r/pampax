#!/usr/bin/env node

/**
 * Performance test for optimized token counting
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { analyzeCodeSize, batchAnalyzeCodeSize, getTokenCountStats, resetTokenCountStats } from '../src/chunking/token-counter.js';

// Mock token counter (simulates tiktoken/transformers tokenizer)
function mockTokenCounter(text) {
    // Simulate ~4 chars per token
    return Math.ceil(text.length / 4);
}

const sampleCodes = [
    'function small() { return 42; }',  // Small
    'function medium() {\n  const x = 10;\n  const y = 20;\n  return x + y;\n}'.repeat(5),  // Medium
    'function large() {\n  // Large function\n  const data = [];\n  for (let i = 0; i < 100; i++) {\n    data.push(i);\n  }\n  return data;\n}'.repeat(20),  // Large
];

test('Token Counter Performance Tests', async (t) => {
    await t.test('should tokenize by default for data integrity', async () => {
        resetTokenCountStats();
        
        const limits = { min: 100, max: 2000, optimal: 500, unit: 'tokens' };
        const smallCode = 'const x = 1;';  // ~3 tokens
        
        // Default: always tokenize (data integrity)
        const result = await analyzeCodeSize(smallCode, limits, mockTokenCounter);
        
        assert.strictEqual(result.decision, 'too_small');
        assert.strictEqual(result.method, 'tokenized');  // Always tokenized!
        
        const stats = getTokenCountStats();
        assert.strictEqual(stats.charFilterSkips, 0);  // No skips
        assert.strictEqual(stats.actualTokenizations, 1);  // Tokenized
    });

    await t.test('should use estimates when explicitly allowed (subdivision optimization)', async () => {
        resetTokenCountStats();
        
        const limits = { min: 100, max: 500, optimal: 300, unit: 'tokens' };
        const largeCode = 'x'.repeat(3000);  // ~750 tokens
        
        // With allowEstimateForSkip = true (subdivision optimization)
        const result = await analyzeCodeSize(largeCode, limits, mockTokenCounter, true);
        
        assert.strictEqual(result.decision, 'too_large');
        assert.strictEqual(result.method, 'char_estimate');  // Estimated when allowed
        
        const stats = getTokenCountStats();
        assert.strictEqual(stats.charFilterSkips, 1);
        assert.strictEqual(stats.actualTokenizations, 0);
    });

    await t.test('should cache token counts for repeated code', async () => {
        resetTokenCountStats();
        
        const limits = { min: 5, max: 500, optimal: 200, unit: 'tokens' };
        const code = 'function test() { return 42; }';  // ~7 tokens, in borderline range
        
        // First call - should tokenize
        await analyzeCodeSize(code, limits, mockTokenCounter);
        
        // Second call - should use cache
        await analyzeCodeSize(code, limits, mockTokenCounter);
        
        // Third call - should use cache
        await analyzeCodeSize(code, limits, mockTokenCounter);
        
        const stats = getTokenCountStats();
        assert.strictEqual(stats.actualTokenizations, 1, 'Should tokenize once');
        assert.strictEqual(stats.cacheHits, 2, 'Should have 2 cache hits');
    });

    await t.test('should efficiently batch analyze with subdivision flag', async () => {
        resetTokenCountStats();
        
        const limits = { min: 50, max: 2000, optimal: 500, unit: 'tokens' };
        const codes = [
            'x',  // Too small
            'function test() { return 42; }'.repeat(50),  // Medium
            'y'.repeat(10000),  // Too large
            'function another() { return "test"; }'.repeat(40),  // Medium
        ];
        
        // With allowEstimateForSkip = true (subdivision mode)
        const results = await batchAnalyzeCodeSize(codes, limits, mockTokenCounter, true);
        
        assert.strictEqual(results.length, 4);
        assert.strictEqual(results[0].method, 'tokenized');  // Small: always tokenized
        assert.strictEqual(results[1].method, 'tokenized');
        assert.strictEqual(results[2].method, 'char_estimate');  // Large: can estimate
        assert.strictEqual(results[3].method, 'tokenized');
        
        const stats = getTokenCountStats();
        assert.strictEqual(stats.charFilterSkips, 1);  // Only large filtered
        assert.strictEqual(stats.actualTokenizations, 3);  // Small + mediums tokenized
    });

    await t.test('should show performance improvement with caching', async () => {
        resetTokenCountStats();
        
        const limits = { min: 5, max: 2000, optimal: 500, unit: 'tokens' };
        
        // Use unique code to avoid cross-test caching
        const testCode = 'function uniqueTestFunction_' + Date.now() + '() { return 42; }';
        
        // First call: should tokenize
        const startTokenizations = getTokenCountStats().actualTokenizations;
        await analyzeCodeSize(testCode, limits, mockTokenCounter);
        const afterFirst = getTokenCountStats();
        assert.strictEqual(afterFirst.actualTokenizations, startTokenizations + 1, 'First call should tokenize');
        
        // Next 10 calls: should all hit cache
        for (let i = 0; i < 10; i++) {
            await analyzeCodeSize(testCode, limits, mockTokenCounter);
        }
        
        const stats = getTokenCountStats();
        
        // Should have only 1 new tokenization despite 11 total calls
        const newTokenizations = stats.actualTokenizations - startTokenizations;
        const cacheHitsForThisTest = stats.cacheHits - (afterFirst.cacheHits || 0);
        
        console.log(`\n  Performance Results (Caching):`);
        console.log(`    Total calls for this test: 11`);
        console.log(`    New tokenizations: ${newTokenizations}`);
        console.log(`    Cache hits: ${cacheHitsForThisTest}`);
        
        // Should tokenize once, cache 10 times
        assert.strictEqual(newTokenizations, 1, 'Should only tokenize once');
        assert.strictEqual(cacheHitsForThisTest, 10, 'Should have 10 cache hits');
    });

    await t.test('should handle edge cases correctly', async () => {
        resetTokenCountStats();
        
        const limits = { min: 50, max: 500, optimal: 200, unit: 'tokens' };
        
        // Empty string
        const empty = await analyzeCodeSize('', limits, mockTokenCounter);
        assert.strictEqual(empty.decision, 'too_small');
        
        // Exactly at boundary
        const boundary = 'x'.repeat(200);  // ~50 tokens, at min boundary
        const boundaryResult = await analyzeCodeSize(boundary, limits, mockTokenCounter);
        assert.ok(['too_small', 'optimal'].includes(boundaryResult.decision));
    });
});

console.log('✅ Token counter performance tests completed');
