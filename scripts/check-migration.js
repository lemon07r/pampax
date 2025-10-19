#!/usr/bin/env node

/**
 * PAMPAX Migration Checker
 * 
 * Analyzes your index and detects potential migration issues
 */

import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { createEmbeddingProvider, getModelProfile } from '../src/providers.js';

const DB_PATH = path.join(process.cwd(), '.pampa/pampa.db');
const CODEMAP_PATH = path.join(process.cwd(), 'pampa.codemap.json');

async function checkMigration() {
    console.log('🔍 PAMPAX Migration Checker\n');
    console.log('='.repeat(60));
    
    // Check if index exists
    if (!fs.existsSync(DB_PATH)) {
        console.log('\n✅ No existing index found');
        console.log('   → No migration needed');
        console.log('   → Just run: pampax index\n');
        return;
    }
    
    console.log('\n📊 Analyzing existing index...\n');
    
    const db = new sqlite3.Database(DB_PATH);
    const all = promisify(db.all.bind(db));
    
    try {
        // Get dimension distribution
        const dimensionStats = await all(`
            SELECT embedding_provider, embedding_dimensions, COUNT(*) as chunk_count
            FROM code_chunks
            GROUP BY embedding_provider, embedding_dimensions
            ORDER BY chunk_count DESC
        `);
        
        console.log('Current Index State:');
        console.log('-'.repeat(60));
        dimensionStats.forEach(stat => {
            console.log(`  ${stat.embedding_provider} (${stat.embedding_dimensions}D): ${stat.chunk_count} chunks`);
        });
        
        // Check for mixed dimensions
        const uniqueDimensions = [...new Set(dimensionStats.map(s => s.embedding_dimensions))];
        const uniqueProviders = [...new Set(dimensionStats.map(s => s.embedding_provider))];
        
        console.log('\n');
        
        if (uniqueDimensions.length > 1 || uniqueProviders.length > 1) {
            console.log('⚠️  WARNING: Mixed Configuration Detected!');
            console.log('='.repeat(60));
            console.log(`  Found ${uniqueProviders.length} different provider(s)`);
            console.log(`  Found ${uniqueDimensions.length} different dimension(s)`);
            console.log('\n  This means searches will NOT return all chunks!');
            console.log('  Only chunks matching current provider/dimensions are searchable.\n');
        } else {
            console.log('✅ Consistent Configuration');
            console.log('   All chunks have same provider and dimensions\n');
        }
        
        // Get current provider configuration
        console.log('Current Provider Configuration:');
        console.log('-'.repeat(60));
        
        const provider = process.env.PAMPAX_PROVIDER || 'auto';
        const embeddingProvider = createEmbeddingProvider(provider);
        
        if (embeddingProvider.init) {
            await embeddingProvider.init();
        }
        
        const providerName = embeddingProvider.getName();
        const modelName = embeddingProvider.getModelName ? embeddingProvider.getModelName() : null;
        const currentDimensions = embeddingProvider.getDimensions();
        const modelProfile = await getModelProfile(providerName, modelName || providerName);
        
        console.log(`  Provider: ${providerName}`);
        if (modelName) console.log(`  Model: ${modelName}`);
        console.log(`  Dimensions: ${currentDimensions}`);
        console.log(`  Token-aware: ${modelProfile.useTokens ? 'Yes' : 'No'}`);
        
        // Check if current config matches database
        const matchingChunks = dimensionStats.find(
            s => s.embedding_provider === providerName && s.embedding_dimensions === currentDimensions
        );
        
        console.log('\n');
        
        if (!matchingChunks) {
            console.log('❌ CRITICAL: Configuration Mismatch!');
            console.log('='.repeat(60));
            console.log(`  Database has: ${dimensionStats.map(s => `${s.embedding_provider}/${s.embedding_dimensions}D`).join(', ')}`);
            console.log(`  Current config: ${providerName}/${currentDimensions}D`);
            console.log('\n  ⚠️  SEARCHES WILL RETURN ZERO RESULTS!\n');
            
            console.log('Recommended Actions:');
            console.log('  1. Match current provider/dimensions to database:');
            dimensionStats.forEach(stat => {
                console.log(`     export PAMPAX_DIMENSIONS=${stat.embedding_dimensions}`);
                console.log(`     pampax search "your query" --provider ${stat.embedding_provider.toLowerCase()}`);
            });
            console.log('\n  2. OR full re-index with current config:');
            console.log('     rm -rf .pampa pampa.codemap.json');
            console.log('     pampax index\n');
            
        } else {
            const percentage = (matchingChunks.chunk_count / dimensionStats.reduce((sum, s) => sum + s.chunk_count, 0) * 100).toFixed(1);
            
            if (uniqueDimensions.length > 1 || uniqueProviders.length > 1) {
                console.log('⚠️  Partial Match');
                console.log('='.repeat(60));
                console.log(`  ${matchingChunks.chunk_count} chunks (${percentage}%) match current config`);
                console.log(`  ${dimensionStats.reduce((sum, s) => sum + s.chunk_count, 0) - matchingChunks.chunk_count} chunks INVISIBLE to searches\n`);
                
                console.log('Recommended Actions:');
                console.log('  1. Full re-index (clean slate):');
                console.log('     rm -rf .pampa pampa.codemap.json');
                console.log('     pampax index');
                console.log('\n  2. Update to re-index outdated files:');
                console.log('     pampax update');
                console.log('     (Note: Only updates changed files, may still have mixed state)\n');
                
            } else {
                console.log('✅ Perfect Match!');
                console.log('='.repeat(60));
                console.log('   All chunks match current configuration');
                console.log('   No migration needed\n');
            }
        }
        
        // Check token-based chunking status
        console.log('Token-Based Chunking Status:');
        console.log('-'.repeat(60));
        
        if (modelProfile.useTokens && modelProfile.tokenCounter) {
            console.log('  ✅ Token counting ENABLED');
            console.log(`     Using ${modelProfile.tokenizerType} tokenizer`);
            console.log(`     Optimal chunk size: ${modelProfile.optimalTokens} tokens`);
        } else {
            console.log('  ℹ️  Token counting DISABLED');
            console.log('     Using character estimation');
            console.log('     Install tiktoken for better accuracy:');
            console.log('       npm install tiktoken');
        }
        
        console.log('\n');
        
        // File coverage analysis
        const fileStats = await all(`
            SELECT file_path, embedding_provider, embedding_dimensions
            FROM code_chunks
            GROUP BY file_path, embedding_provider, embedding_dimensions
        `);
        
        const filesWithMultipleDimensions = {};
        fileStats.forEach(stat => {
            if (!filesWithMultipleDimensions[stat.file_path]) {
                filesWithMultipleDimensions[stat.file_path] = [];
            }
            filesWithMultipleDimensions[stat.file_path].push({
                provider: stat.embedding_provider,
                dimensions: stat.embedding_dimensions
            });
        });
        
        const duplicateFiles = Object.entries(filesWithMultipleDimensions)
            .filter(([_, configs]) => configs.length > 1);
        
        if (duplicateFiles.length > 0) {
            console.log('⚠️  Files Indexed Multiple Times:');
            console.log('-'.repeat(60));
            duplicateFiles.slice(0, 10).forEach(([file, configs]) => {
                console.log(`  ${file}`);
                configs.forEach(config => {
                    console.log(`    → ${config.provider} (${config.dimensions}D)`);
                });
            });
            if (duplicateFiles.length > 10) {
                console.log(`  ... and ${duplicateFiles.length - 10} more files`);
            }
            console.log('\n  This creates duplicate search results!');
            console.log('  Recommend: Full re-index to clean up\n');
        }
        
        // Summary and recommendations
        console.log('\n' + '='.repeat(60));
        console.log('SUMMARY & RECOMMENDATIONS');
        console.log('='.repeat(60) + '\n');
        
        if (uniqueDimensions.length === 1 && uniqueProviders.length === 1 && matchingChunks) {
            console.log('✅ Your index is in good shape!');
            console.log('   → No migration needed');
            console.log('   → Continue using normally');
            
            if (!modelProfile.useTokens) {
                console.log('\n💡 Tip: Install tiktoken for even better chunking:');
                console.log('   npm install tiktoken');
            }
        } else {
            console.log('⚠️  Migration Recommended');
            console.log('\nQuick Fix (when convenient):');
            console.log('  rm -rf .pampa pampa.codemap.json');
            console.log('  pampax index');
            console.log('\nThis will:');
            console.log('  • Remove mixed dimensions');
            console.log('  • Use token-based chunking');
            console.log('  • Improve search quality');
            console.log('  • Fix duplicate file issues');
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('\nFor detailed migration guide, see: MIGRATION_GUIDE.md\n');
        
    } catch (error) {
        console.error('Error analyzing index:', error.message);
        process.exit(1);
    } finally {
        db.close();
    }
}

checkMigration().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
