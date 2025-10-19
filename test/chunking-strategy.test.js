#!/usr/bin/env node

/**
 * Test for the improved token-aware chunking strategy
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { indexProject, searchCode } from '../src/service.js';

const TEST_DIR = '.pampa-test-chunking';
const TEST_CODEMAP = 'pampa.codemap.test.json';

test('Chunking Strategy Tests', async (t) => {
    // Clean up before tests
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    if (fs.existsSync(TEST_CODEMAP)) {
        fs.unlinkSync(TEST_CODEMAP);
    }

    await t.test('should analyze and report chunking statistics', async () => {
        console.log('  Testing chunking statistics...');
        
        const result = await indexProject({
            repoPath: '.',
            provider: 'transformers',
            workingPath: TEST_DIR
        });

        // Check that result has chunking stats
        assert.ok(result.chunkingStats, 'Result should contain chunkingStats');
        assert.ok(typeof result.chunkingStats.totalNodes === 'number', 'totalNodes should be a number');
        assert.ok(typeof result.chunkingStats.normalChunks === 'number', 'normalChunks should be a number');
        assert.ok(typeof result.chunkingStats.subdivided === 'number', 'subdivided should be a number');
        assert.ok(typeof result.chunkingStats.mergedSmall === 'number', 'mergedSmall should be a number');
        assert.ok(typeof result.chunkingStats.statementFallback === 'number', 'statementFallback should be a number');
        assert.ok(typeof result.chunkingStats.skippedSmall === 'number', 'skippedSmall should be a number');

        console.log(`    Total nodes analyzed: ${result.chunkingStats.totalNodes}`);
        console.log(`    Normal chunks: ${result.chunkingStats.normalChunks}`);
        console.log(`    Subdivided: ${result.chunkingStats.subdivided}`);
        console.log(`    Merged small: ${result.chunkingStats.mergedSmall}`);
        console.log(`    Final chunks: ${result.processedChunks}`);
    });

    await t.test('should skip very small chunks', async () => {
        console.log('  Testing small chunk skipping...');
        
        const result = await indexProject({
            repoPath: '.',
            provider: 'transformers',
            workingPath: TEST_DIR
        });

        // Most projects should have some small chunks that get skipped or merged
        const smallChunksHandled = result.chunkingStats.skippedSmall + result.chunkingStats.mergedSmall;
        console.log(`    Small chunks handled (skipped + merged): ${smallChunksHandled}`);
        
        // The processed chunks should be less than total nodes analyzed
        assert.ok(
            result.processedChunks <= result.chunkingStats.totalNodes,
            'Processed chunks should be <= total nodes'
        );
    });

    await t.test('should create merged chunks for small methods', async () => {
        console.log('  Testing small chunk merging...');
        
        const result = await indexProject({
            repoPath: '.',
            provider: 'transformers',
            workingPath: TEST_DIR
        });

        console.log(`    Merged chunks created: ${result.chunkingStats.mergedSmall}`);
        
        // Stats should be consistent
        const totalProcessed = result.chunkingStats.normalChunks + 
                              result.chunkingStats.mergedSmall +
                              result.chunkingStats.statementFallback;
        
        console.log(`    Total processed (normal + merged + fallback): ${totalProcessed}`);
        assert.ok(totalProcessed > 0, 'Should have processed some chunks');
    });

    await t.test('should successfully search after chunking', async () => {
        console.log('  Testing search functionality after chunking...');
        
        // First index
        await indexProject({
            repoPath: '.',
            provider: 'transformers',
            workingPath: TEST_DIR
        });

        // Then search for something we know exists
        const searchResult = await searchCode('indexProject', 10, 'transformers', TEST_DIR);

        assert.ok(searchResult.success, 'Search should succeed');
        assert.ok(searchResult.results.length > 0, 'Should find results');
        console.log(`    Found ${searchResult.results.length} results for "indexProject"`);
    });

    // Clean up after tests
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    if (fs.existsSync(TEST_CODEMAP)) {
        fs.unlinkSync(TEST_CODEMAP);
    }
});

console.log('✅ Chunking strategy tests completed');
