#!/usr/bin/env node
/**
 * Integration tests with Novita.ai API
 * Tests actual API calls with Qwen embedding and reranking models
 */

import { OpenAIProvider } from '../src/providers.js';
import { rerankWithAPI, isAPIRerankingConfigured } from '../src/ranking/apiReranker.js';

console.log('🧪 Testing Novita.ai Integration with Qwen Models...\n');
console.log('═══════════════════════════════════════════════════════');
console.log('  Novita.ai + Qwen Models Integration Tests');
console.log('═══════════════════════════════════════════════════════\n');

const NOVITA_API_KEY = 'sk_your_novita_api_key_here'; // Replace with your Novita.ai API key
const NOVITA_BASE_URL = 'https://api.novita.ai/openai';

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

async function test(name, fn) {
    testsRun++;
    try {
        await fn();
        testsPassed++;
        console.log(`✅ ${name}`);
        return true;
    } catch (error) {
        testsFailed++;
        console.error(`❌ ${name}`);
        console.error(`   Error: ${error.message}`);
        if (error.stack) {
            console.error(`   Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
        }
        return false;
    }
}

// ============================================================================
// Test 1: Qwen Embedding Model Integration
// ============================================================================

console.log('Test 1: Qwen Embedding via Novita.ai\n');

await test('Novita.ai Qwen embedding model configuration', async () => {
    process.env.OPENAI_BASE_URL = NOVITA_BASE_URL;
    process.env.OPENAI_API_KEY = NOVITA_API_KEY;
    process.env.PAMPAX_OPENAI_EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';
    
    const provider = new OpenAIProvider();
    
    if (provider.model !== 'qwen/qwen3-embedding-8b') {
        throw new Error(`Expected model qwen/qwen3-embedding-8b but got ${provider.model}`);
    }
    
    console.log('   ℹ️  Model configured: qwen/qwen3-embedding-8b');
});

await test('Novita.ai Qwen embedding generation', async () => {
    const provider = new OpenAIProvider();
    await provider.init();
    
    const testText = 'This is a test sentence for embedding generation.';
    const embedding = await provider.generateEmbedding(testText);
    
    if (!Array.isArray(embedding)) {
        throw new Error('Embedding is not an array');
    }
    
    if (embedding.length === 0) {
        throw new Error('Embedding is empty');
    }
    
    if (typeof embedding[0] !== 'number') {
        throw new Error('Embedding values are not numbers');
    }
    
    console.log(`   ℹ️  Generated ${embedding.length}-dimensional embedding`);
    console.log(`   ℹ️  First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
});

await test('Novita.ai Qwen embedding with multiple texts', async () => {
    const provider = new OpenAIProvider();
    
    const texts = [
        'authentication and security',
        'database operations',
        'user interface components'
    ];
    
    const embeddings = await Promise.all(
        texts.map(text => provider.generateEmbedding(text))
    );
    
    if (embeddings.length !== 3) {
        throw new Error(`Expected 3 embeddings but got ${embeddings.length}`);
    }
    
    // Check that embeddings are different
    const areAllDifferent = embeddings.every((emb, i) => 
        embeddings.slice(i + 1).every(otherEmb => 
            emb[0] !== otherEmb[0] || emb[1] !== otherEmb[1]
        )
    );
    
    if (!areAllDifferent) {
        throw new Error('Embeddings are not unique');
    }
    
    console.log(`   ℹ️  Generated 3 unique embeddings successfully`);
});

// ============================================================================
// Test 2: Qwen Reranker Model Integration
// ============================================================================

console.log('\nTest 2: Qwen Reranker via Novita.ai\n');

await test('Novita.ai Qwen reranker configuration', async () => {
    process.env.PAMPAX_RERANK_API_URL = 'https://api.novita.ai/openai/v1/rerank';
    process.env.PAMPAX_RERANK_API_KEY = NOVITA_API_KEY;
    process.env.PAMPAX_RERANK_MODEL = 'qwen/qwen3-reranker-8b';
    
    const configured = isAPIRerankingConfigured();
    
    if (!configured) {
        throw new Error('API reranking not configured');
    }
    
    console.log('   ℹ️  Reranker API configured correctly');
});

await test('Novita.ai Qwen reranker with simple candidates', async () => {
    const candidates = [
        { text: 'authentication function for user login', id: 'auth-1' },
        { text: 'utility for formatting dates and times', id: 'util-1' },
        { text: 'security middleware for token validation', id: 'auth-2' },
        { text: 'database connection pooling', id: 'db-1' }
    ];
    
    const reranked = await rerankWithAPI('authentication and security', candidates, {
        getText: (c) => c.text,
        max: 4
    });
    
    if (!Array.isArray(reranked)) {
        throw new Error('Reranked result is not an array');
    }
    
    if (reranked.length !== 4) {
        throw new Error(`Expected 4 results but got ${reranked.length}`);
    }
    
    // Check that reranker scores exist
    const hasScores = reranked.every(c => typeof c.rerankerScore === 'number');
    if (!hasScores) {
        throw new Error('Not all candidates have reranker scores');
    }
    
    // Check that scores are in descending order
    for (let i = 0; i < reranked.length - 1; i++) {
        if (reranked[i].rerankerScore < reranked[i + 1].rerankerScore) {
            throw new Error('Reranker scores are not in descending order');
        }
    }
    
    console.log('   ℹ️  Reranked results:');
    reranked.forEach((c, i) => {
        console.log(`      ${i + 1}. [${c.id}] Score: ${c.rerankerScore.toFixed(4)} - ${c.text.substring(0, 40)}...`);
    });
});

await test('Novita.ai Qwen reranker relevance accuracy', async () => {
    const candidates = [
        { text: 'login authentication system with password validation', id: 'auth' },
        { text: 'weather forecast API integration service', id: 'weather' },
        { text: 'payment processing module', id: 'payment' }
    ];
    
    const reranked = await rerankWithAPI('user authentication', candidates, {
        getText: (c) => c.text,
        max: 3
    });
    
    // The authentication candidate should be ranked first
    if (reranked[0].id !== 'auth') {
        console.warn(`   ⚠️  Expected 'auth' as top result but got '${reranked[0].id}'`);
        console.warn(`   ⚠️  This may indicate the reranker is not working optimally`);
    } else {
        console.log(`   ℹ️  Correctly ranked authentication-related candidate first`);
    }
    
    // Top result should have higher score than last
    if (reranked[0].rerankerScore <= reranked[reranked.length - 1].rerankerScore) {
        throw new Error('Top result does not have higher score than bottom result');
    }
});

// ============================================================================
// Test 3: Full Pipeline Integration
// ============================================================================

console.log('\nTest 3: Full Pipeline (Embedding + Reranking)\n');

await test('Novita.ai full pipeline with Qwen models', async () => {
    // This test ensures both embedding and reranking work together
    const embeddingProvider = new OpenAIProvider();
    
    // Generate query embedding
    const queryEmbedding = await embeddingProvider.generateEmbedding('authentication');
    
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
        throw new Error('Failed to generate query embedding');
    }
    
    // Prepare candidates
    const candidates = [
        { text: 'user login and authentication system', id: '1' },
        { text: 'date formatting utility functions', id: '2' },
        { text: 'JWT token validation middleware', id: '3' }
    ];
    
    // Rerank candidates
    const reranked = await rerankWithAPI('authentication', candidates, {
        getText: (c) => c.text,
        max: 3
    });
    
    if (reranked.length !== 3) {
        throw new Error(`Expected 3 reranked results but got ${reranked.length}`);
    }
    
    // Check that authentication-related candidates are ranked higher
    const authCandidateIndices = [0, 2]; // indices of auth-related candidates
    const topTwoIds = reranked.slice(0, 2).map(c => parseInt(c.id) - 1);
    const authInTopTwo = topTwoIds.some(idx => authCandidateIndices.includes(idx));
    
    if (!authInTopTwo) {
        console.warn('   ⚠️  Authentication candidates not in top 2 positions');
    }
    
    console.log('   ℹ️  Pipeline test results:');
    console.log(`      Embedding dimensions: ${queryEmbedding.length}`);
    console.log(`      Reranked ${reranked.length} candidates`);
    console.log(`      Top result: [${reranked[0].id}] ${reranked[0].text}`);
});

// ============================================================================
// Test Summary
// ============================================================================

console.log('\n═══════════════════════════════════════════════════════');
console.log(`✅ Tests passed: ${testsPassed}/${testsRun}`);
console.log(`❌ Tests failed: ${testsFailed}/${testsRun}`);
console.log('═══════════════════════════════════════════════════════\n');

if (testsFailed > 0) {
    console.log('💥 Some integration tests failed!');
    process.exit(1);
}

console.log('🎉 All Novita.ai integration tests passed!\n');
console.log('📋 Summary:');
console.log('  ✅ Qwen embedding model working (3 tests)');
console.log('  ✅ Qwen reranker model working (3 tests)');
console.log('  ✅ Full pipeline integration working (1 test)');
console.log('');
console.log('🌐 Successfully tested with Novita.ai API:');
console.log('  • Embedding: qwen/qwen3-embedding-8b');
console.log('  • Reranker: qwen/qwen3-reranker-8b');
console.log('');
