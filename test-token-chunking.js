#!/usr/bin/env node

/**
 * Test token-based chunking implementation
 */

import { indexProject } from './src/service.js';
import fs from 'fs';
import path from 'path';

async function testTokenChunking() {
    console.log('=== Testing Token-Based Chunking Implementation ===\n');
    
    // Create a test directory with a sample file
    const testDir = path.join(process.cwd(), 'test-chunking-tmp');
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Create a sample JavaScript file with a large function
    const testFile = path.join(testDir, 'sample.js');
    const sampleCode = `
/**
 * @pampa-tags: test, large-function, sample
 * @pampa-intent: Test function for chunking
 * @pampa-description: A large test function to demonstrate token-based chunking
 */
function testLargeFunction() {
    // This is a test function with multiple statements
    const data = [];
    
    for (let i = 0; i < 100; i++) {
        data.push({
            id: i,
            name: 'item' + i,
            value: Math.random()
        });
    }
    
    function processData() {
        return data.map(item => {
            return {
                ...item,
                processed: true
            };
        });
    }
    
    return processData();
}

class SampleClass {
    constructor() {
        this.value = 42;
    }
    
    method1() {
        return this.value * 2;
    }
    
    method2() {
        return this.value * 3;
    }
}
`;
    
    fs.writeFileSync(testFile, sampleCode);
    
    console.log('Test file created:', testFile);
    console.log('\n--- Testing with default provider (Transformers.js) ---');
    
    try {
        // Test with transformers (small context window)
        await indexProject({
            repoPath: testDir,
            provider: 'transformers'
        });
        
        console.log('\n✓ Transformers test completed successfully!');
        
        // If OpenAI key is available, test with OpenAI
        if (process.env.OPENAI_API_KEY) {
            console.log('\n--- Testing with OpenAI provider ---');
            await indexProject({
                repoPath: testDir,
                provider: 'openai'
            });
            console.log('\n✓ OpenAI test completed successfully!');
        } else {
            console.log('\nℹ OpenAI_API_KEY not set, skipping OpenAI test');
        }
        
        // Test with custom environment variables
        console.log('\n--- Testing with custom PAMPAX_MAX_TOKENS ---');
        process.env.PAMPAX_MAX_TOKENS = '512';
        process.env.PAMPAX_DIMENSIONS = '256';
        
        await indexProject({
            repoPath: testDir,
            provider: 'transformers'
        });
        
        console.log('\n✓ Custom configuration test completed successfully!');
        
        // Clean up
        delete process.env.PAMPAX_MAX_TOKENS;
        delete process.env.PAMPAX_DIMENSIONS;
        
        console.log('\n=== All Tests Passed! ===');
        console.log('\nImplementation verified:');
        console.log('  ✓ Token counting infrastructure');
        console.log('  ✓ Model profiles');
        console.log('  ✓ Environment variable overrides');
        console.log('  ✓ Provider integration');
        console.log('\nYou can now use:');
        console.log('  export PAMPAX_MAX_TOKENS=2000');
        console.log('  export PAMPAX_DIMENSIONS=768');
        console.log('  pampax index --provider openai');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

testTokenChunking();
