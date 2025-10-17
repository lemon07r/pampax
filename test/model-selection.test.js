#!/usr/bin/env node
/**
 * Unit tests for environment variable model selection
 * Tests that embedding models can be configured via environment variables
 */

import assert from 'assert';
import { OpenAIProvider, TransformersProvider, OllamaProvider, CohereProvider } from '../src/providers.js';

console.log('🧪 Testing Model Selection via Environment Variables...\n');
console.log('═══════════════════════════════════════════════════════');
console.log('  Model Selection Tests');
console.log('═══════════════════════════════════════════════════════\n');

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
    testsRun++;
    try {
        fn();
        testsPassed++;
        console.log(`✅ ${name}`);
        return true;
    } catch (error) {
        testsFailed++;
        console.error(`❌ ${name}`);
        console.error(`   Error: ${error.message}`);
        return false;
    }
}

function cleanupEnv() {
    delete process.env.PAMPAX_OPENAI_EMBEDDING_MODEL;
    delete process.env.OPENAI_MODEL;
    delete process.env.PAMPAX_TRANSFORMERS_MODEL;
    delete process.env.PAMPAX_OLLAMA_MODEL;
    delete process.env.PAMPAX_COHERE_MODEL;
}

// ============================================================================
// Test Suite 1: OpenAI Model Selection
// ============================================================================

console.log('Test Suite 1: OpenAI Provider Model Selection\n');

cleanupEnv();
test('OpenAI uses default when no env var set', () => {
    const provider = new OpenAIProvider();
    assert.strictEqual(provider.model, 'text-embedding-3-large');
});

test('OpenAI model selection via PAMPAX_OPENAI_EMBEDDING_MODEL', () => {
    process.env.PAMPAX_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
    const provider = new OpenAIProvider();
    assert.strictEqual(provider.model, 'text-embedding-3-small');
    delete process.env.PAMPAX_OPENAI_EMBEDDING_MODEL;
});

test('OpenAI model selection via OPENAI_MODEL (alternative)', () => {
    process.env.OPENAI_MODEL = 'text-embedding-ada-002';
    const provider = new OpenAIProvider();
    assert.strictEqual(provider.model, 'text-embedding-ada-002');
    delete process.env.OPENAI_MODEL;
});

test('PAMPAX_OPENAI_EMBEDDING_MODEL takes precedence over OPENAI_MODEL', () => {
    process.env.PAMPAX_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
    process.env.OPENAI_MODEL = 'text-embedding-3-large';
    const provider = new OpenAIProvider();
    assert.strictEqual(provider.model, 'text-embedding-3-small');
    cleanupEnv();
});

test('OpenAI with Novita.ai Qwen model path', () => {
    process.env.PAMPAX_OPENAI_EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';
    const provider = new OpenAIProvider();
    assert.strictEqual(provider.model, 'qwen/qwen3-embedding-8b');
    cleanupEnv();
});

// ============================================================================
// Test Suite 2: Transformers.js Model Selection
// ============================================================================

console.log('\nTest Suite 2: Transformers.js Provider Model Selection\n');

cleanupEnv();
test('Transformers uses default when no env var set', () => {
    const provider = new TransformersProvider();
    assert.strictEqual(provider.model, 'Xenova/all-MiniLM-L6-v2');
});

test('Transformers model selection via PAMPAX_TRANSFORMERS_MODEL', () => {
    process.env.PAMPAX_TRANSFORMERS_MODEL = 'Xenova/all-mpnet-base-v2';
    const provider = new TransformersProvider();
    assert.strictEqual(provider.model, 'Xenova/all-mpnet-base-v2');
    cleanupEnv();
});

test('Transformers with custom model path', () => {
    process.env.PAMPAX_TRANSFORMERS_MODEL = 'custom-org/custom-model';
    const provider = new TransformersProvider();
    assert.strictEqual(provider.model, 'custom-org/custom-model');
    cleanupEnv();
});

// ============================================================================
// Test Suite 3: Ollama Model Selection
// ============================================================================

console.log('\nTest Suite 3: Ollama Provider Model Selection\n');

cleanupEnv();
test('Ollama uses default when no env var set', () => {
    const provider = new OllamaProvider();
    assert.strictEqual(provider.model, 'nomic-embed-text');
});

test('Ollama model selection via PAMPAX_OLLAMA_MODEL', () => {
    process.env.PAMPAX_OLLAMA_MODEL = 'llama2';
    const provider = new OllamaProvider();
    assert.strictEqual(provider.model, 'llama2');
    cleanupEnv();
});

test('Ollama model selection via constructor parameter', () => {
    const provider = new OllamaProvider('mistral');
    assert.strictEqual(provider.model, 'mistral');
});

test('Ollama env var takes precedence over constructor default', () => {
    process.env.PAMPAX_OLLAMA_MODEL = 'llama2';
    const provider = new OllamaProvider();
    assert.strictEqual(provider.model, 'llama2');
    cleanupEnv();
});

// ============================================================================
// Test Suite 4: Cohere Model Selection
// ============================================================================

console.log('\nTest Suite 4: Cohere Provider Model Selection\n');

cleanupEnv();
test('Cohere uses default when no env var set', () => {
    const provider = new CohereProvider();
    assert.strictEqual(provider.model, 'embed-english-v3.0');
});

test('Cohere model selection via PAMPAX_COHERE_MODEL', () => {
    process.env.PAMPAX_COHERE_MODEL = 'embed-multilingual-v3.0';
    const provider = new CohereProvider();
    assert.strictEqual(provider.model, 'embed-multilingual-v3.0');
    cleanupEnv();
});

// ============================================================================
// Test Summary
// ============================================================================

console.log('\n═══════════════════════════════════════════════════════');
console.log(`✅ Tests passed: ${testsPassed}/${testsRun}`);
console.log(`❌ Tests failed: ${testsFailed}/${testsRun}`);
console.log('═══════════════════════════════════════════════════════\n');

if (testsFailed > 0) {
    console.log('💥 Some tests failed!');
    process.exit(1);
}

console.log('🎉 All model selection tests passed!\n');
console.log('📋 Summary:');
console.log('  ✅ OpenAI model selection working (5 tests)');
console.log('  ✅ Transformers.js model selection working (3 tests)');
console.log('  ✅ Ollama model selection working (4 tests)');
console.log('  ✅ Cohere model selection working (2 tests)');
console.log('');
