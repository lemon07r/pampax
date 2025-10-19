/**
 * PAMPA Core Service
 * 
 * This module contains the core business logic for PAMPA
 * separated from presentation concerns (logging, console output).
 * Functions are agnostic and return structured data.
 */

import crypto from 'crypto';
import fg from 'fast-glob';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import Parser from 'tree-sitter';
import LangBash from 'tree-sitter-bash';
import LangC from 'tree-sitter-c';
import LangCSharp from 'tree-sitter-c-sharp';
import LangCpp from 'tree-sitter-cpp';
import LangCSS from 'tree-sitter-css';
import LangElixir from 'tree-sitter-elixir';
import LangGo from 'tree-sitter-go';
import LangHaskell from 'tree-sitter-haskell';
import LangHTML from 'tree-sitter-html';
import LangJava from 'tree-sitter-java';
import LangJS from 'tree-sitter-javascript';
import LangJSON from 'tree-sitter-json';
import LangKotlin from '@tree-sitter-grammars/tree-sitter-kotlin';
import LangLua from 'tree-sitter-lua';
import LangOCaml from 'tree-sitter-ocaml';
import LangPHP from 'tree-sitter-php';
import LangPython from 'tree-sitter-python';
import LangRuby from 'tree-sitter-ruby';
import LangRust from 'tree-sitter-rust';
import LangScala from 'tree-sitter-scala';
import LangSwift from 'tree-sitter-swift';
import LangTSX from 'tree-sitter-typescript/bindings/node/tsx.js';
import LangTS from 'tree-sitter-typescript/bindings/node/typescript.js';
import { promisify } from 'util';
import { createEmbeddingProvider, getModelProfile, countChunkSize, getSizeLimits } from './providers.js';
import {  analyzeNodeForChunking, extractParentContext, yieldStatementChunks } from './chunking/semantic-chunker.js';
import { readCodemap, writeCodemap } from './codemap/io.js';
import { normalizeChunkMetadata } from './codemap/types.js';
import { applyScope, normalizeScopeFilters } from './search/applyScope.js';
import { BM25Index } from './search/bm25Index.js';
import { reciprocalRankFusion } from './search/hybrid.js';
import { rerankCrossEncoder } from './ranking/crossEncoderReranker.js';
import { applySymbolBoost } from './ranking/boostSymbols.js';
import { hasScopeFilters } from './types/search.js';
import {
    cloneMerkle,
    computeFastHash,
    loadMerkle,
    normalizeToProjectPath,
    removeMerkleEntry,
    saveMerkle
} from './indexer/merkle.js';
import { extractSymbolMetadata } from './symbols/extract.js';
import { attachSymbolGraphToCodemap } from './symbols/graph.js';
import {
    resolveEncryptionPreference,
    writeChunkToDisk,
    readChunkFromDisk,
    removeChunkArtifacts
} from './storage/encryptedChunks.js';

function resolveTreeSitterLanguage(module, preferredKey = null) {
    if (!module) {
        return null;
    }

    if (module.default) {
        return resolveTreeSitterLanguage(module.default, preferredKey);
    }

    if (preferredKey && module[preferredKey]) {
        return resolveTreeSitterLanguage(module[preferredKey], null);
    }

    if (typeof module === 'object' && module !== null) {
        if (module.language && typeof module.language === 'object') {
            return module;
        }

        const values = Object.values(module);
        for (const value of values) {
            const resolved = resolveTreeSitterLanguage(value, null);
            if (resolved && resolved.language && typeof resolved.language === 'object') {
                return resolved;
            }
        }
    }

    return module;
}

const RESOLVED_LANGUAGES = {
    bash: resolveTreeSitterLanguage(LangBash),
    c: resolveTreeSitterLanguage(LangC),
    csharp: resolveTreeSitterLanguage(LangCSharp),
    cpp: resolveTreeSitterLanguage(LangCpp),
    css: resolveTreeSitterLanguage(LangCSS),
    elixir: resolveTreeSitterLanguage(LangElixir),
    go: resolveTreeSitterLanguage(LangGo),
    haskell: resolveTreeSitterLanguage(LangHaskell),
    html: resolveTreeSitterLanguage(LangHTML),
    java: resolveTreeSitterLanguage(LangJava),
    javascript: resolveTreeSitterLanguage(LangJS, 'javascript'),
    json: resolveTreeSitterLanguage(LangJSON),
    kotlin: resolveTreeSitterLanguage(LangKotlin),
    lua: resolveTreeSitterLanguage(LangLua),
    ocaml: resolveTreeSitterLanguage(LangOCaml, 'ocaml'),
    php: resolveTreeSitterLanguage(LangPHP, 'php'),
    python: resolveTreeSitterLanguage(LangPython),
    ruby: resolveTreeSitterLanguage(LangRuby),
    rust: resolveTreeSitterLanguage(LangRust),
    scala: resolveTreeSitterLanguage(LangScala),
    swift: resolveTreeSitterLanguage(LangSwift),
    tsx: resolveTreeSitterLanguage(LangTSX),
    typescript: resolveTreeSitterLanguage(LangTS)
};

const LANG_RULES = {
    '.php': {
        lang: 'php',
        ts: RESOLVED_LANGUAGES.php,
        nodeTypes: ['function_definition', 'method_declaration'],
        subdivisionTypes: {
            'class_declaration': ['method_declaration', 'function_definition'],
            'function_definition': ['function_definition', 'if_statement', 'try_statement'],
            'method_declaration': ['function_definition', 'if_statement', 'try_statement']
        },
        variableTypes: ['const_declaration', 'assignment_expression'],
        commentPattern: /\/\*\*[\s\S]*?\*\//g
    },
    '.py': {
        lang: 'python',
        ts: RESOLVED_LANGUAGES.python,
        nodeTypes: ['function_definition', 'class_definition'],
        subdivisionTypes: {
            'class_definition': ['function_definition'],
            'function_definition': ['function_definition', 'if_statement', 'try_statement', 'with_statement']
        },
        variableTypes: ['assignment', 'expression_statement'],
        commentPattern: /"""[\s\S]*?"""|'''[\s\S]*?'''/g
    },
    '.js': {
        lang: 'javascript',
        ts: RESOLVED_LANGUAGES.javascript,
        nodeTypes: ['function_declaration', 'method_definition', 'class_declaration'],
        subdivisionTypes: {
            'class_declaration': ['method_definition', 'field_definition'],
            'function_declaration': ['function_declaration', 'if_statement', 'try_statement'],
            'method_definition': ['function_declaration', 'if_statement', 'try_statement']
        },
        variableTypes: ['const_declaration', 'let_declaration', 'variable_declaration'],
        commentPattern: /\/\*\*[\s\S]*?\*\//g
    },
    '.jsx': {
        lang: 'tsx',
        ts: RESOLVED_LANGUAGES.tsx,
        nodeTypes: ['function_declaration', 'class_declaration'],
        variableTypes: ['const_declaration', 'let_declaration', 'variable_declaration'],
        commentPattern: /\/\*\*[\s\S]*?\*\//g
    },
    '.ts': {
        lang: 'typescript',
        ts: RESOLVED_LANGUAGES.typescript,
        nodeTypes: ['function_declaration', 'method_definition', 'class_declaration'],
        subdivisionTypes: {
            'class_declaration': ['method_definition', 'field_definition'],
            'function_declaration': ['function_declaration', 'if_statement', 'try_statement'],
            'method_definition': ['function_declaration', 'if_statement', 'try_statement']
        },
        variableTypes: ['const_declaration', 'let_declaration', 'variable_declaration'],
        commentPattern: /\/\*\*[\s\S]*?\*\//g
    },
    '.tsx': {
        lang: 'tsx',
        ts: RESOLVED_LANGUAGES.tsx,
        nodeTypes: ['function_declaration', 'class_declaration'],
        variableTypes: ['const_declaration', 'let_declaration', 'variable_declaration'],
        commentPattern: /\/\*\*[\s\S]*?\*\//g
    },
    '.go': {
        lang: 'go',
        ts: RESOLVED_LANGUAGES.go,
        nodeTypes: ['function_declaration', 'method_declaration'],
        variableTypes: ['const_declaration', 'var_declaration'],
        commentPattern: /\/\*[\s\S]*?\*\//g
    },
    '.java': {
        lang: 'java',
        ts: RESOLVED_LANGUAGES.java,
        nodeTypes: ['method_declaration', 'class_declaration'],
        variableTypes: ['variable_declaration', 'field_declaration'],
        commentPattern: /\/\*\*[\s\S]*?\*\//g
    },
    '.cs': {
        lang: 'csharp',
        ts: RESOLVED_LANGUAGES.csharp,
        nodeTypes: ['method_declaration', 'class_declaration', 'struct_declaration', 'interface_declaration'],
        subdivisionTypes: {
            'class_declaration': ['method_declaration', 'property_declaration', 'field_declaration'],
            'struct_declaration': ['method_declaration', 'property_declaration', 'field_declaration'],
            'interface_declaration': ['method_declaration', 'property_declaration'],
            'method_declaration': ['if_statement', 'try_statement', 'foreach_statement']
        },
        variableTypes: ['variable_declaration', 'field_declaration', 'property_declaration'],
        commentPattern: /\/\*\*[\s\S]*?\*\//g
    },
    '.rs': {
        lang: 'rust',
        ts: RESOLVED_LANGUAGES.rust,
        nodeTypes: ['function_item', 'impl_item', 'struct_item', 'enum_item', 'trait_item', 'mod_item'],
        subdivisionTypes: {
            'impl_item': ['function_item'],
            'mod_item': ['function_item', 'struct_item', 'enum_item', 'trait_item'],
            'trait_item': ['function_signature']
        },
        variableTypes: ['let_declaration', 'const_item', 'static_item'],
        commentPattern: /\/\/\/.*|\/\*\*[\s\S]*?\*\//g
    },
    '.rb': {
        lang: 'ruby',
        ts: RESOLVED_LANGUAGES.ruby,
        nodeTypes: ['method', 'class', 'module', 'singleton_method'],
        subdivisionTypes: {
            'class': ['method', 'singleton_method'],
            'module': ['method', 'singleton_method']
        },
        variableTypes: ['assignment', 'instance_variable', 'class_variable'],
        commentPattern: /#.*$/gm
    },
    '.cpp': {
        lang: 'cpp',
        ts: RESOLVED_LANGUAGES.cpp,
        nodeTypes: ['function_definition', 'class_specifier', 'struct_specifier', 'namespace_definition'],
        subdivisionTypes: {
            'class_specifier': ['function_definition', 'field_declaration'],
            'struct_specifier': ['function_definition', 'field_declaration'],
            'namespace_definition': ['function_definition', 'class_specifier', 'struct_specifier']
        },
        variableTypes: ['declaration', 'field_declaration'],
        commentPattern: /\/\*[\s\S]*?\*\//g
    },
    '.hpp': {
        lang: 'cpp',
        ts: RESOLVED_LANGUAGES.cpp,
        nodeTypes: ['function_definition', 'class_specifier', 'struct_specifier', 'namespace_definition'],
        subdivisionTypes: {
            'class_specifier': ['function_definition', 'field_declaration'],
            'struct_specifier': ['function_definition', 'field_declaration'],
            'namespace_definition': ['function_definition', 'class_specifier', 'struct_specifier']
        },
        variableTypes: ['declaration', 'field_declaration'],
        commentPattern: /\/\*[\s\S]*?\*\//g
    },
    '.cc': {
        lang: 'cpp',
        ts: RESOLVED_LANGUAGES.cpp,
        nodeTypes: ['function_definition', 'class_specifier', 'struct_specifier', 'namespace_definition'],
        subdivisionTypes: {
            'class_specifier': ['function_definition', 'field_declaration'],
            'struct_specifier': ['function_definition', 'field_declaration'],
            'namespace_definition': ['function_definition', 'class_specifier', 'struct_specifier']
        },
        variableTypes: ['declaration', 'field_declaration'],
        commentPattern: /\/\*[\s\S]*?\*\//g
    },
    '.c': {
        lang: 'c',
        ts: RESOLVED_LANGUAGES.c,
        nodeTypes: ['function_definition', 'struct_specifier', 'declaration'],
        subdivisionTypes: {
            'struct_specifier': ['field_declaration']
        },
        variableTypes: ['declaration'],
        commentPattern: /\/\*[\s\S]*?\*\//g
    },
    '.h': {
        lang: 'c',
        ts: RESOLVED_LANGUAGES.c,
        nodeTypes: ['function_definition', 'struct_specifier', 'declaration'],
        subdivisionTypes: {
            'struct_specifier': ['field_declaration']
        },
        variableTypes: ['declaration'],
        commentPattern: /\/\*[\s\S]*?\*\//g
    },
    '.scala': {
        lang: 'scala',
        ts: RESOLVED_LANGUAGES.scala,
        nodeTypes: ['function_definition', 'class_definition', 'object_definition', 'trait_definition'],
        subdivisionTypes: {
            'class_definition': ['function_definition', 'val_definition', 'var_declaration'],
            'object_definition': ['function_definition', 'val_definition'],
            'trait_definition': ['function_definition', 'function_declaration']
        },
        variableTypes: ['val_definition', 'var_declaration'],
        commentPattern: /\/\*\*[\s\S]*?\*\//g
    },
    '.swift': {
        lang: 'swift',
        ts: RESOLVED_LANGUAGES.swift,
        nodeTypes: ['function_declaration', 'class_declaration', 'struct_declaration', 'protocol_declaration'],
        subdivisionTypes: {
            'class_declaration': ['function_declaration', 'property_declaration'],
            'struct_declaration': ['function_declaration', 'property_declaration'],
            'protocol_declaration': ['function_declaration']
        },
        variableTypes: ['property_declaration', 'variable_declaration'],
        commentPattern: /\/\*\*[\s\S]*?\*\//g
    },
    '.sh': {
        lang: 'bash',
        ts: RESOLVED_LANGUAGES.bash,
        nodeTypes: ['function_definition', 'command'],
        subdivisionTypes: {
            'function_definition': ['command', 'if_statement', 'for_statement', 'while_statement']
        },
        variableTypes: ['variable_assignment'],
        commentPattern: /#.*$/gm
    },
    '.bash': {
        lang: 'bash',
        ts: RESOLVED_LANGUAGES.bash,
        nodeTypes: ['function_definition', 'command'],
        subdivisionTypes: {
            'function_definition': ['command', 'if_statement', 'for_statement', 'while_statement']
        },
        variableTypes: ['variable_assignment'],
        commentPattern: /#.*$/gm
    },
    '.kt': {
        lang: 'kotlin',
        ts: RESOLVED_LANGUAGES.kotlin,
        nodeTypes: ['function_declaration', 'property_declaration', 'class_declaration', 'object_declaration'],
        subdivisionTypes: {
            'class_declaration': ['function_declaration', 'property_declaration'],
            'object_declaration': ['function_declaration', 'property_declaration'],
            'function_declaration': ['if_expression', 'when_expression', 'try_expression']
        },
        variableTypes: ['property_declaration', 'variable_declaration'],
        commentPattern: /\/\*\*[\s\S]*?\*\//g
    },
    '.lua': {
        lang: 'lua',
        ts: RESOLVED_LANGUAGES.lua,
        nodeTypes: ['function_declaration', 'function_definition', 'function_call', 'table_constructor'],
        subdivisionTypes: {
            'function_definition': ['function_definition', 'if_statement', 'for_statement']
        },
        variableTypes: ['variable_declaration', 'assignment_statement'],
        commentPattern: /--.*$/gm
    },
    '.html': {
        lang: 'html',
        ts: RESOLVED_LANGUAGES.html,
        nodeTypes: ['element', 'start_tag', 'script_element', 'style_element'],
        subdivisionTypes: {
            'element': ['element']
        },
        variableTypes: [],
        commentPattern: /<!--[\s\S]*?-->/g
    },
    '.htm': {
        lang: 'html',
        ts: RESOLVED_LANGUAGES.html,
        nodeTypes: ['element', 'start_tag', 'script_element', 'style_element'],
        subdivisionTypes: {
            'element': ['element']
        },
        variableTypes: [],
        commentPattern: /<!--[\s\S]*?-->/g
    },
    '.css': {
        lang: 'css',
        ts: RESOLVED_LANGUAGES.css,
        nodeTypes: ['rule_set', 'declaration', 'selector'],
        subdivisionTypes: {
            'rule_set': ['declaration']
        },
        variableTypes: [],
        commentPattern: /\/\*[\s\S]*?\*\//g
    },
    '.json': {
        lang: 'json',
        ts: RESOLVED_LANGUAGES.json,
        nodeTypes: ['object', 'array', 'pair'],
        subdivisionTypes: {
            'object': ['pair'],
            'array': ['object', 'array']
        },
        variableTypes: [],
        commentPattern: null
    },
    '.ml': {
        lang: 'ocaml',
        ts: RESOLVED_LANGUAGES.ocaml,
        nodeTypes: ['value_definition', 'type_definition', 'module_definition', 'let_binding'],
        subdivisionTypes: {
            'module_definition': ['value_definition', 'type_definition'],
            'value_definition': ['let_binding']
        },
        variableTypes: ['let_binding', 'value_definition'],
        commentPattern: /\(\*[\s\S]*?\*\)/g
    },
    '.mli': {
        lang: 'ocaml',
        ts: RESOLVED_LANGUAGES.ocaml,
        nodeTypes: ['value_specification', 'type_definition', 'module_definition'],
        subdivisionTypes: {
            'module_definition': ['value_specification', 'type_definition']
        },
        variableTypes: ['value_specification'],
        commentPattern: /\(\*[\s\S]*?\*\)/g
    },
    '.hs': {
        lang: 'haskell',
        ts: RESOLVED_LANGUAGES.haskell,
        nodeTypes: ['function', 'type_signature', 'data_declaration', 'class_declaration'],
        subdivisionTypes: {
            'class_declaration': ['function', 'type_signature'],
            'data_declaration': ['constructor']
        },
        variableTypes: ['signature', 'bind'],
        commentPattern: /--.*$/gm
    },
    '.ex': {
        lang: 'elixir',
        ts: RESOLVED_LANGUAGES.elixir,
        nodeTypes: ['call', 'anonymous_function'],
        subdivisionTypes: {
            'call': ['call', 'anonymous_function']
        },
        variableTypes: ['identifier'],
        commentPattern: /#.*$/gm
    },
    '.exs': {
        lang: 'elixir',
        ts: RESOLVED_LANGUAGES.elixir,
        nodeTypes: ['call', 'anonymous_function'],
        subdivisionTypes: {
            'call': ['call', 'anonymous_function']
        },
        variableTypes: ['identifier'],
        commentPattern: /#.*$/gm
    }
};

export function getSupportedLanguageExtensions() {
    return Object.keys(LANG_RULES);
}

// Global context for paths - gets set by setBasePath()
let globalContext = {
    basePath: null,
    chunkDir: null,
    codemap: null,
    dbPath: null
};

const bm25IndexCache = new Map();
const chunkTextCache = new Map();

const envRerankMax = Number.parseInt(process.env.PAMPAX_RERANKER_MAX || '50', 10);
const RERANKER_MAX_CANDIDATES = Number.isFinite(envRerankMax) && envRerankMax > 0 ? envRerankMax : 50;
const RERANKER_SCORE_HINT_REGEX = /mockScore:([+-]?\d+(?:\.\d+)?)/i;

// Function to set the base path for all operations
export function setBasePath(basePath = '.') {
    const resolvedPath = path.resolve(basePath);
    if (globalContext.basePath && globalContext.basePath !== resolvedPath) {
        bm25IndexCache.clear();
        chunkTextCache.clear();
    }
    globalContext.basePath = resolvedPath;
    globalContext.chunkDir = path.join(resolvedPath, '.pampa/chunks');
    globalContext.codemap = path.join(resolvedPath, 'pampa.codemap.json');
    globalContext.dbPath = path.join(resolvedPath, '.pampa/pampa.db');
}

// Function to get current paths (with fallback to relative paths if not set)
function getPaths() {
    if (!globalContext.basePath) {
        // Fallback to relative paths if setBasePath() was not called
        return {
            chunkDir: '.pampa/chunks',
            codemap: 'pampa.codemap.json',
            dbPath: '.pampa/pampa.db'
        };
    }

    return {
        chunkDir: globalContext.chunkDir,
        codemap: globalContext.codemap,
        dbPath: globalContext.dbPath
    };
}

function getResolvedBasePath() {
    return globalContext.basePath ? globalContext.basePath : path.resolve('.');
}

function getBm25CacheKey(providerName, dimensions) {
    return `${getResolvedBasePath()}::${providerName || 'unknown'}::${dimensions || 0}`;
}

function getChunkCacheKey(sha) {
    return `${getResolvedBasePath()}::${sha}`;
}

function getOrCreateBm25Entry(providerName, dimensions) {
    const key = getBm25CacheKey(providerName, dimensions);
    let entry = bm25IndexCache.get(key);
    if (!entry) {
        entry = { index: new BM25Index(), added: new Set() };
        bm25IndexCache.set(key, entry);
    }

    return entry;
}

function readChunkTextCached(sha) {
    if (!sha) {
        return null;
    }

    const cacheKey = getChunkCacheKey(sha);
    if (chunkTextCache.has(cacheKey)) {
        return chunkTextCache.get(cacheKey);
    }

    const { chunkDir } = getPaths();

    try {
        const result = readChunkFromDisk({ chunkDir, sha });
        const code = result ? result.code : null;
        chunkTextCache.set(cacheKey, code);
        return code;
    } catch (error) {
        chunkTextCache.set(cacheKey, null);
        return null;
    }
}

function buildBm25Document(chunk, codeText) {
    if (!chunk) {
        return '';
    }

    const parts = [
        chunk.symbol,
        chunk.file_path,
        chunk.pampa_description,
        chunk.pampa_intent,
        codeText
    ].filter(value => typeof value === 'string' && value.trim().length > 0);

    return parts.join('\n');
}

function buildRerankerDocument(candidate) {
    if (!candidate) {
        return '';
    }

    const codeText = readChunkTextCached(candidate.sha) || '';
    return buildBm25Document(candidate, codeText);
}

function extractRerankerScoreHint(candidate) {
    if (!candidate) {
        return undefined;
    }

    const description = typeof candidate.pampa_description === 'string' ? candidate.pampa_description : '';
    const match = description.match(RERANKER_SCORE_HINT_REGEX);

    if (match) {
        const value = Number.parseFloat(match[1]);
        if (Number.isFinite(value)) {
            return value;
        }
    }

    return undefined;
}

function ensureBm25IndexForChunks(providerName, dimensions, chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
        return null;
    }

    const entry = getOrCreateBm25Entry(providerName, dimensions);
    const toAdd = [];

    for (const chunk of chunks) {
        if (!chunk || !chunk.id || entry.added.has(chunk.id)) {
            continue;
        }

        const codeText = readChunkTextCached(chunk.sha);
        const docText = buildBm25Document(chunk, codeText);

        if (docText && docText.trim().length > 0) {
            toAdd.push({ id: chunk.id, text: docText });
        }

        entry.added.add(chunk.id);
    }

    if (toAdd.length > 0) {
        entry.index.addDocuments(toAdd);
    }

    entry.index.consolidate();
    return entry.index;
}

// Function to clear the global context (useful for testing or cleanup)
export function clearBasePath() {
    globalContext = {
        basePath: null,
        chunkDir: null,
        codemap: null,
        dbPath: null
    };
    bm25IndexCache.clear();
    chunkTextCache.clear();
}

// ============================================================================
// DATABASE UTILITIES
// ============================================================================

export async function initDatabase(dimensions, basePath = '.') {
    // Set base path
    setBasePath(basePath);

    const { dbPath } = getPaths();
    const dbDir = path.dirname(dbPath);

    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    const db = new sqlite3.Database(dbPath);
    const run = promisify(db.run.bind(db));

    // Create table for code chunks with enhanced metadata
    await run(`
        CREATE TABLE IF NOT EXISTS code_chunks (
            id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            symbol TEXT NOT NULL,
            sha TEXT NOT NULL,
            lang TEXT NOT NULL,
            chunk_type TEXT DEFAULT 'function',
            embedding BLOB,
            embedding_provider TEXT,
            embedding_dimensions INTEGER,
            
            -- Enhanced semantic metadata
            pampa_tags TEXT,           -- JSON array of semantic tags
            pampa_intent TEXT,         -- Natural language intent description
            pampa_description TEXT,    -- Human-readable description
            doc_comments TEXT,         -- JSDoc/PHPDoc comments
            variables_used TEXT,       -- JSON array of important variables
            context_info TEXT,         -- Additional context metadata
            
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create semantic search table for intention mapping
    await run(`
        CREATE TABLE IF NOT EXISTS intention_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query_normalized TEXT NOT NULL,
            original_query TEXT NOT NULL,
            target_sha TEXT NOT NULL,
            confidence REAL DEFAULT 1.0,
            usage_count INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create table for frequent patterns
    await run(`
        CREATE TABLE IF NOT EXISTS query_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern TEXT NOT NULL UNIQUE,
            frequency INTEGER DEFAULT 1,
            typical_results TEXT, -- JSON array of common results
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create indexes for enhanced searches
    await run(`CREATE INDEX IF NOT EXISTS idx_file_path ON code_chunks(file_path)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_symbol ON code_chunks(symbol)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_lang ON code_chunks(lang)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_provider ON code_chunks(embedding_provider)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_chunk_type ON code_chunks(chunk_type)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_pampa_tags ON code_chunks(pampa_tags)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_pampa_intent ON code_chunks(pampa_intent)`);

    await run(`
        CREATE INDEX IF NOT EXISTS idx_lang_provider 
        ON code_chunks(lang, embedding_provider, embedding_dimensions)
    `);

    // Indexes for intention system
    await run(`CREATE INDEX IF NOT EXISTS idx_query_normalized ON intention_cache(query_normalized)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_target_sha ON intention_cache(target_sha)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_usage_count ON intention_cache(usage_count DESC)`);

    // Indexes for pattern analysis
    await run(`CREATE INDEX IF NOT EXISTS idx_pattern_frequency ON query_patterns(frequency DESC)`);

    db.close();
}

// Function to calculate cosine similarity
export function cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ============================================================================
// SEMANTIC METADATA EXTRACTION UTILITIES
// ============================================================================

/**
 * Extract pampa-specific metadata from JSDoc-style comments
 */
function extractPampaMetadata(commentText) {
    const metadata = {
        tags: [],
        intent: null,
        description: null
    };

    if (!commentText) return metadata;

    // Extract @pampa-tags
    const tagsMatch = commentText.match(/@pampa-tags:\s*([^\n]+)/);
    if (tagsMatch) {
        metadata.tags = tagsMatch[1].split(',').map(tag => tag.trim());
    }

    // Extract @pampa-intent
    const intentMatch = commentText.match(/@pampa-intent:\s*([^\n]+)/);
    if (intentMatch) {
        metadata.intent = intentMatch[1].trim();
    }

    // Extract @pampa-description
    const descMatch = commentText.match(/@pampa-description:\s*([^\n]+)/);
    if (descMatch) {
        metadata.description = descMatch[1].trim();
    }

    return metadata;
}

/**
 * Extract semantic tags automatically from code context
 */
function extractSemanticTags(filePath, symbolName, code) {
    const tags = new Set();

    // Extract from file path
    const pathParts = filePath.split('/').map(part => part.replace(/\.(php|js|ts|tsx)$/, ''));
    pathParts.forEach(part => {
        // Split camelCase and PascalCase
        const words = part.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_-]+/);
        words.forEach(word => {
            if (word.length > 2) { // Skip short words
                tags.add(word);
            }
        });
    });

    // Extract from symbol name
    if (symbolName) {
        const symbolWords = symbolName
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .toLowerCase()
            .split(/[\s_-]+/);

        symbolWords.forEach(word => {
            if (word.length > 2) {
                tags.add(word);
            }
        });
    }

    // Extract technical keywords from code
    const technicalKeywords = [
        'stripe', 'payment', 'session', 'checkout', 'purchase',
        'auth', 'authentication', 'login', 'register', 'middleware',
        'database', 'connection', 'pool', 'config', 'service',
        'controller', 'model', 'repository', 'test', 'api',
        'customer', 'user', 'admin', 'notification', 'email',
        'validation', 'request', 'response', 'http', 'route'
    ];

    const codeText = code.toLowerCase();
    technicalKeywords.forEach(keyword => {
        if (codeText.includes(keyword)) {
            tags.add(keyword);
        }
    });

    // Look for class/function patterns
    const patterns = [
        /class\s+(\w+)/gi,
        /function\s+(\w+)/gi,
        /const\s+(\w+)/gi,
        /interface\s+(\w+)/gi,
        /trait\s+(\w+)/gi
    ];

    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(code)) !== null) {
            const name = match[1];
            const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_-]+/);
            words.forEach(word => {
                if (word.length > 2) {
                    tags.add(word);
                }
            });
        }
    });

    return Array.from(tags).slice(0, 10); // Limit to 10 most relevant tags
}

/**
 * Extract important variables from a code node
 */
function extractImportantVariables(node, source, rule) {
    const variables = [];

    function walkForVariables(n) {
        // Only extract variables that seem "important" (const, config, etc.)
        if (rule.variableTypes && rule.variableTypes.includes(n.type)) {
            const varText = source.slice(n.startIndex, n.endIndex);

            // Filter for important-looking variables
            if (isImportantVariable(varText, n.type)) {
                variables.push({
                    type: n.type,
                    name: extractVariableName(n, source),
                    value: varText.length > 100 ? varText.substring(0, 100) + '...' : varText
                });
            }
        }

        for (let i = 0; i < n.childCount; i++) {
            walkForVariables(n.child(i));
        }
    }

    walkForVariables(node);
    return variables;
}

/**
 * Determine if a variable is "important" enough to index
 */
function isImportantVariable(varText, nodeType) {
    // Look for indicators of important variables
    const importantPatterns = [
        /const\s+\w*(config|setting|option|endpoint|url|key|secret|token)\w*/i,
        /const\s+\w*(api|service|client|provider)\w*/i,
        /const\s+[A-Z_]{3,}/,  // ALL_CAPS constants
        /export\s+const/,      // Exported constants
        /static\s+(final\s+)?[A-Z_]+/,  // Static final constants (Java)
    ];

    return importantPatterns.some(pattern => pattern.test(varText));
}

/**
 * Extract variable name from tree-sitter node
 */
function extractVariableName(node, source) {
    // Walk the node to find the identifier
    function findIdentifier(n) {
        if (n.type === 'identifier' || n.type === 'type_identifier') {
            return source.slice(n.startIndex, n.endIndex);
        }

        for (let i = 0; i < n.childCount; i++) {
            const result = findIdentifier(n.child(i));
            if (result) return result;
        }

        return null;
    }

    return findIdentifier(node) || 'unknown';
}

/**
 * Extract documentation comments preceding a code node
 */
function extractDocComments(source, node, rule) {
    const commentPattern = rule.commentPattern;
    if (!commentPattern) return null;

    // Look for comments in the 500 characters before the node
    const beforeNode = source.slice(Math.max(0, node.startIndex - 500), node.startIndex);
    const comments = beforeNode.match(commentPattern);

    if (comments && comments.length > 0) {
        // Return the last (closest) comment
        return comments[comments.length - 1];
    }

    return null;
}

/**
 * Generate enhanced embedding text by combining code with metadata
 */
function generateEnhancedEmbeddingText(code, metadata, variables, docComments) {
    let enhancedText = code;

    // Add documentation comments
    if (docComments) {
        enhancedText = docComments + '\n\n' + enhancedText;
    }

    // Add pampa metadata as natural language
    if (metadata.intent) {
        enhancedText += `\n\n// Intent: ${metadata.intent}`;
    }

    if (metadata.description) {
        enhancedText += `\n\n// Description: ${metadata.description}`;
    }

    if (metadata.tags.length > 0) {
        enhancedText += `\n\n// Tags: ${metadata.tags.join(', ')}`;
    }

    // Add important variables context
    if (variables.length > 0) {
        const varNames = variables.map(v => v.name).join(', ');
        enhancedText += `\n\n// Uses variables: ${varNames}`;
    }

    return enhancedText;
}

// ============================================================================
// MAIN SERVICE FUNCTIONS
// ============================================================================

export async function indexProject({
    repoPath = '.',
    provider = 'auto',
    onProgress = null,
    changedFiles = null,
    deletedFiles = [],
    embeddingProviderOverride = null,
    encryptMode = undefined
} = {}) {
    const repo = path.resolve(repoPath);

    // Ensure we're working in a valid directory and add more restrictive patterns
    if (!fs.existsSync(repo)) {
        throw new Error(`Directory ${repo} does not exist`);
    }

    const normalizedChanged = Array.isArray(changedFiles)
        ? Array.from(new Set(
            changedFiles
                .map(file => normalizeToProjectPath(repo, file))
                .filter(Boolean)
        ))
        : null;

    const normalizedDeleted = Array.from(new Set(
        (Array.isArray(deletedFiles) ? deletedFiles : [])
            .map(file => normalizeToProjectPath(repo, file))
            .filter(Boolean)
    ));

    const deletedSet = new Set(normalizedDeleted);
    const languagePatterns = getSupportedLanguageExtensions().map(ext => `**/*${ext}`);
    let files = [];

    if (normalizedChanged === null) {
        files = await fg(languagePatterns, {
            cwd: repo,
            absolute: false,
            followSymbolicLinks: false,
            ignore: [
                '**/vendor/**',
                '**/node_modules/**',
                '**/.git/**',
                '**/storage/**',
                '**/dist/**',
                '**/build/**',
                '**/tmp/**',
                '**/temp/**',
                '**/.npm/**',
                '**/.yarn/**',
                '**/Library/**',
                '**/System/**',
                '**/.Trash/**'
            ],
            onlyFiles: true,
            dot: false
        });
    } else {
        files = normalizedChanged.filter(rel => {
            const ext = path.extname(rel).toLowerCase();
            return !!LANG_RULES[ext];
        });
    }

    const uniqueFiles = [];
    const seenFiles = new Set();

    for (const rel of files) {
        if (!rel || seenFiles.has(rel)) {
            continue;
        }

        const absPath = path.join(repo, rel);
        if (!fs.existsSync(absPath)) {
            deletedSet.add(rel);
            continue;
        }

        seenFiles.add(rel);
        uniqueFiles.push(rel);
    }

    files = uniqueFiles;
    const isPartialUpdate = normalizedChanged !== null;

    // Create embedding provider ONCE ONLY
    const embeddingProvider = embeddingProviderOverride || createEmbeddingProvider(provider);

    // Initialize provider ONCE ONLY (if we created it here)
    if (!embeddingProviderOverride && embeddingProvider.init) {
        await embeddingProvider.init();
    }

    // Get model profile for token-aware chunking
    const providerName = embeddingProvider.getName();
    const modelName = embeddingProvider.getModelName ? embeddingProvider.getModelName() : null;
    const modelProfile = await getModelProfile(providerName, modelName || providerName);
    const limits = getSizeLimits(modelProfile);
    
    // Log chunking configuration
    console.log(`\n📊 Chunking Configuration:`);
    console.log(`  Provider: ${providerName}`);
    if (modelName) console.log(`  Model: ${modelName}`);
    console.log(`  Dimensions: ${embeddingProvider.getDimensions()}`);
    console.log(`  Chunking mode: ${limits.unit}`);
    console.log(`  Optimal size: ${limits.optimal} ${limits.unit}`);
    console.log(`  Min/Max: ${limits.min}-${limits.max} ${limits.unit}`);
    console.log(`  Overlap: ${limits.overlap} ${limits.unit}`);
    if (modelProfile.useTokens && modelProfile.tokenCounter) {
        console.log(`  ✓ Token counting enabled`);
    } else {
        console.log(`  ℹ Using character estimation (token counting unavailable)`);
    }
    console.log('');

    // Initialize database with the correct base path
    await initDatabase(embeddingProvider.getDimensions(), repo);

    const { codemap: codemapPath, chunkDir, dbPath } = getPaths();
    
    // Check for dimension/provider mismatches (migration detection)
    if (fs.existsSync(dbPath)) {
        const db = new sqlite3.Database(dbPath);
        const all = promisify(db.all.bind(db));
        
        try {
            const existingDimensions = await all(`
                SELECT DISTINCT embedding_provider, embedding_dimensions
                FROM code_chunks
                LIMIT 10
            `);
            
            if (existingDimensions.length > 0) {
                const currentProvider = embeddingProvider.getName();
                const currentDimensions = embeddingProvider.getDimensions();
                
                const hasMismatch = existingDimensions.some(
                    row => row.embedding_provider !== currentProvider || 
                           row.embedding_dimensions !== currentDimensions
                );
                
                if (hasMismatch) {
                    console.log('\n⚠️  WARNING: Dimension/Provider Mismatch Detected!');
                    console.log('='.repeat(60));
                    console.log('Existing index:');
                    existingDimensions.forEach(row => {
                        console.log(`  ${row.embedding_provider} (${row.embedding_dimensions}D)`);
                    });
                    console.log(`Current config: ${currentProvider} (${currentDimensions}D)`);
                    console.log('\nThis may cause issues:');
                    console.log('  • Searches will only return chunks matching current config');
                    console.log('  • Old chunks will be invisible');
                    console.log('  • Mixed results quality');
                    console.log('\nRecommendations:');
                    console.log('  1. Full re-index (clean slate):');
                    console.log('     rm -rf .pampa pampa.codemap.json && pampax index');
                    console.log('  2. Check migration status:');
                    console.log('     node scripts/check-migration.js');
                    console.log('  3. See MIGRATION_GUIDE.md for details');
                    console.log('='.repeat(60) + '\n');
                    
                    // Give user a moment to see the warning
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        } catch (error) {
            // Ignore errors in migration check (don't block indexing)
        } finally {
            db.close();
        }
    }
    const encryptionPreference = resolveEncryptionPreference({ mode: encryptMode, logger: console });
    let codemap = readCodemap(codemapPath);

    const merkle = loadMerkle(repo);
    const updatedMerkle = cloneMerkle(merkle);
    let merkleDirty = false;
    let indexMutated = false;

    const parser = new Parser();
    let processedChunks = 0;
    const errors = [];
    
    // Chunking statistics
    const chunkingStats = {
        totalNodes: 0,
        skippedSmall: 0,
        subdivided: 0,
        statementFallback: 0,
        normalChunks: 0,
        mergedSmall: 0
    };

    async function deleteChunks(chunkIds, metadataLookup = new Map()) {
        if (!Array.isArray(chunkIds) || chunkIds.length === 0) {
            return;
        }

        const db = new sqlite3.Database(dbPath);
        const run = promisify(db.run.bind(db));
        const placeholders = chunkIds.map(() => '?').join(', ');

        await run(`
            DELETE FROM code_chunks
            WHERE id IN (${placeholders})
        `, chunkIds);

        db.close();

        for (const chunkId of chunkIds) {
            const metadata = metadataLookup.get(chunkId) || codemap[chunkId];
            if (metadata && metadata.sha) {
                chunkTextCache.delete(getChunkCacheKey(metadata.sha));
                removeChunkArtifacts(chunkDir, metadata.sha);
            }
            delete codemap[chunkId];
        }
    }

    async function embedAndStore({
        code,
        enhancedEmbeddingText,
        chunkId,
        sha,
        lang,
        rel,
        symbol,
        chunkType,
        pampaMetadata,
        importantVariables,
        docComments,
        contextInfo,
        symbolData = null
    }) {
        try {
            const embedding = await embeddingProvider.generateEmbedding(enhancedEmbeddingText);

            const db = new sqlite3.Database(dbPath);
            const run = promisify(db.run.bind(db));

            await run(`
                INSERT OR REPLACE INTO code_chunks
                (id, file_path, symbol, sha, lang, chunk_type, embedding, embedding_provider, embedding_dimensions,
                 pampa_tags, pampa_intent, pampa_description, doc_comments, variables_used, context_info, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                chunkId,
                rel,
                symbol,
                sha,
                lang,
                chunkType,
                Buffer.from(JSON.stringify(embedding)),
                embeddingProvider.getName(),
                embeddingProvider.getDimensions(),
                JSON.stringify(pampaMetadata.tags),
                pampaMetadata.intent,
                pampaMetadata.description,
                docComments,
                JSON.stringify(importantVariables),
                JSON.stringify(contextInfo)
            ]);

            indexMutated = true;

            db.close();

            fs.mkdirSync(chunkDir, { recursive: true });
            const writeResult = writeChunkToDisk({
                chunkDir,
                sha,
                code,
                encryption: encryptionPreference
            });

            const previousMetadata = codemap[chunkId];
            codemap[chunkId] = normalizeChunkMetadata({
                file: rel,
                symbol,
                sha,
                lang,
                chunkType,
                provider: embeddingProvider.getName(),
                dimensions: embeddingProvider.getDimensions(),
                hasPampaTags: Array.isArray(pampaMetadata.tags) && pampaMetadata.tags.length > 0,
                hasIntent: !!pampaMetadata.intent,
                hasDocumentation: !!docComments,
                variableCount: Array.isArray(importantVariables) ? importantVariables.length : 0,
                encrypted: !!(writeResult && writeResult.encrypted),
                symbol_signature: symbolData && symbolData.signature ? symbolData.signature : undefined,
                symbol_parameters: symbolData && Array.isArray(symbolData.parameters) ? symbolData.parameters : undefined,
                symbol_return: symbolData && symbolData.returnType ? symbolData.returnType : undefined,
                symbol_calls: symbolData && Array.isArray(symbolData.calls) ? symbolData.calls : undefined
            }, previousMetadata);

        } catch (error) {
            errors.push({ type: 'indexing_error', chunkId, error: error.message });
            throw error;
        }
    }

    async function removeFileArtifacts(fileRel) {
        const entries = Object.entries(codemap)
            .filter(([, metadata]) => metadata && metadata.file === fileRel);

        if (entries.length > 0) {
            const metadataLookup = new Map(entries);
            await deleteChunks(entries.map(([chunkId]) => chunkId), metadataLookup);
            indexMutated = true;
        }

        if (removeMerkleEntry(updatedMerkle, fileRel)) {
            merkleDirty = true;
        }
    }

    for (const rel of files) {
        deletedSet.delete(rel);

        const abs = path.join(repo, rel);
        const ext = path.extname(rel).toLowerCase();
        const rule = LANG_RULES[ext];

        if (!rule) continue;

        const existingChunks = new Map(
            Object.entries(codemap)
                .filter(([, metadata]) => metadata && metadata.file === rel)
        );
        const staleChunkIds = new Set(existingChunks.keys());
        const chunkMerkleHashes = [];
        let fileHash = null;

        try {
            const source = fs.readFileSync(abs, 'utf8');
            fileHash = await computeFastHash(source);

            const previousMerkle = merkle[rel];
            if (previousMerkle && previousMerkle.shaFile === fileHash) {
                continue;
            }

            // Tree-sitter proper handling for large files using callback-based API
            // See: https://github.com/tree-sitter/tree-sitter/issues/3473
            // https://github.com/tree-sitter/node-tree-sitter/blob/master/README.md#parse-from-custom-data-structure
            const SIZE_THRESHOLD = 30000; // 30KB - use callback API for files larger than this
            const CHUNK_SIZE = 30000; // Parse in 30KB chunks
            
            let tree;
            try {
                parser.setLanguage(rule.ts);
                
                // Use callback-based parse for large files to avoid "Invalid argument" errors
                if (source.length > SIZE_THRESHOLD) {
                    tree = parser.parse((index, position) => {
                        if (index < source.length) {
                            return source.slice(index, Math.min(index + CHUNK_SIZE, source.length));
                        }
                        return null;
                    });
                } else {
                    tree = parser.parse(source);
                }
                
                // Validate tree
                if (!tree || !tree.rootNode) {
                    throw new Error('Failed to create syntax tree');
                }
            } catch (parseError) {
                // Genuine parse errors (not size-related)
                throw parseError;
            }

            // Track processed nodes to avoid double-processing from subdivision
            const processedNodes = new Set();
            
            async function walk(node) {
                // Skip if this node was already processed as part of a subdivision
                if (processedNodes.has(node.id)) {
                    return;
                }
                
                if (rule.nodeTypes.includes(node.type)) {
                    await yieldChunk(node);
                }
                for (let i = 0; i < node.childCount; i++) {
                    const child = node.child(i);
                    if (child) {
                        await walk(child);
                    }
                }
            }

            async function yieldChunk(node, parentNode = null) {
                chunkingStats.totalNodes++;
                
                // ===== TOKEN-AWARE CHUNKING: Check size before processing =====
                // Analyze the node to determine if it needs subdivision
                const analysis = await analyzeNodeForChunking(node, source, rule, modelProfile);
                
                // Skip chunks that are too small (unless they're top-level)
                if (analysis.size < limits.min && parentNode !== null) {
                    // Skip this chunk - it's too small and not a top-level symbol
                    chunkingStats.skippedSmall++;
                    return;
                }
                
                // If chunk is within optimal range, process normally
                // If chunk is too large, subdivide it
                if (analysis.needsSubdivision && analysis.subdivisionCandidates.length > 0) {
                    // Try to subdivide into smaller semantic chunks
                    chunkingStats.subdivided++;
                    
                    // Collect small chunks that will be skipped in subdivision
                    const smallChunks = [];
                    
                    for (const subNode of analysis.subdivisionCandidates) {
                        // Analyze each subdivision candidate
                        const subAnalysis = await analyzeNodeForChunking(subNode, source, rule, modelProfile);
                        
                        if (subAnalysis.size < limits.min) {
                            // This subdivision is too small - collect it for merging
                            const subCode = source.slice(subNode.startIndex, subNode.endIndex);
                            smallChunks.push({
                                node: subNode,
                                code: subCode,
                                size: subAnalysis.size
                            });
                            // Still mark as processed to avoid double-processing
                            processedNodes.add(subNode.id);
                        } else {
                            // Process normal-sized subdivisions
                            processedNodes.add(subNode.id);
                            await yieldChunk(subNode, node);
                        }
                    }
                    
                    // If we have small chunks, merge them into a single chunk
                    if (smallChunks.length > 0) {
                        const totalSmallSize = smallChunks.reduce((sum, c) => sum + c.size, 0);
                        
                        // If merged size is meaningful, create a combined chunk
                        if (totalSmallSize >= limits.min || smallChunks.length >= 3) {
                            const mergedCode = smallChunks.map(c => c.code).join('\n\n');
                            // Create a pseudo-node for the merged chunk using parent's position
                            const mergedNode = {
                                ...node,
                                type: `${node.type}_merged`,
                                startIndex: smallChunks[0].node.startIndex,
                                endIndex: smallChunks[smallChunks.length - 1].node.endIndex
                            };
                            const suffix = `small_methods_${smallChunks.length}`;
                            
                            chunkingStats.mergedSmall++;
                            await processChunk(mergedNode, mergedCode, suffix, parentNode);
                        } else {
                            // Still too small even when merged - truly skip
                            chunkingStats.skippedSmall += smallChunks.length;
                        }
                    }
                    
                    return;
                } else if (analysis.size > limits.max) {
                    // Node is too large but has no subdivision candidates
                    // Fall back to statement-level chunking
                    chunkingStats.statementFallback++;
                    const code = source.slice(node.startIndex, node.endIndex);
                    const statementChunks = await yieldStatementChunks(
                        node, 
                        source, 
                        limits.max, 
                        limits.overlap, 
                        modelProfile
                    );
                    
                    // Process each statement-level chunk
                    for (let i = 0; i < statementChunks.length; i++) {
                        const stmtChunk = statementChunks[i];
                        await processChunk(node, stmtChunk.code, `${i + 1}`, parentNode);
                    }
                    return;
                }
                
                // Chunk is good size - process it normally
                chunkingStats.normalChunks++;
                const code = source.slice(node.startIndex, node.endIndex);
                await processChunk(node, code, null, parentNode);
            }
            
            // Helper function to process a single chunk
            async function processChunk(node, code, suffix = null, parentNode = null) {
                // More robust function to extract symbol name
                function extractSymbolName(node, source) {
                    // Try different ways to get the name according to node type
                    if (node.type === 'function_declaration' || node.type === 'function_definition') {
                        // Look for first identifier after 'function'
                        for (let i = 0; i < node.childCount; i++) {
                            const child = node.child(i);
                            if (child && child.type === 'identifier') {
                                return source.slice(child.startIndex, child.endIndex);
                            }
                        }
                    }

                    if (node.type === 'method_declaration' || node.type === 'method_definition') {
                        // PHP method_declaration structure: [visibility] function name(params) { ... }
                        // Need to search deeper for the function name
                        function findMethodName(n) {
                            // Look for 'name' field in method_declaration
                            if (n.type === 'name' || n.type === 'identifier' || n.type === 'property_identifier') {
                                const text = source.slice(n.startIndex, n.endIndex);
                                // Skip keywords like 'public', 'private', 'function', etc.
                                if (!['public', 'private', 'protected', 'static', 'function', 'abstract', 'final'].includes(text)) {
                                    return text;
                                }
                            }

                            // Recursively search children
                            for (let i = 0; i < n.childCount; i++) {
                                const result = findMethodName(n.child(i));
                                if (result) return result;
                            }
                            return null;
                        }

                        const methodName = findMethodName(node);
                        if (methodName) return methodName;
                    }

                    if (node.type === 'class_declaration') {
                        // Look for class name
                        for (let i = 0; i < node.childCount; i++) {
                            const child = node.child(i);
                            if (child && (child.type === 'identifier' || child.type === 'type_identifier' || child.type === 'name')) {
                                const text = source.slice(child.startIndex, child.endIndex);
                                // Skip keyword 'class'
                                if (text !== 'class') {
                                    return text;
                                }
                            }
                        }
                    }

                    // Enhanced fallback: look for any meaningful identifier
                    function findAnyIdentifier(n) {
                        if (n.type === 'identifier' || n.type === 'name' || n.type === 'property_identifier') {
                            const text = source.slice(n.startIndex, n.endIndex);
                            // Skip common keywords
                            if (!['public', 'private', 'protected', 'static', 'function', 'class', 'abstract', 'final', 'const', 'var', 'let'].includes(text)) {
                                return text;
                            }
                        }

                        for (let i = 0; i < n.childCount; i++) {
                            const result = findAnyIdentifier(n.child(i));
                            if (result) return result;
                        }
                        return null;
                    }

                    const anyIdentifier = findAnyIdentifier(node);
                    if (anyIdentifier) return anyIdentifier;

                    // Last resort: try to extract from the code itself using regex
                    const code = source.slice(node.startIndex, node.endIndex);

                    // For PHP methods: public function methodName(
                    const phpMethodMatch = code.match(/(?:public|private|protected)?\s*(?:static)?\s*function\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
                    if (phpMethodMatch) return phpMethodMatch[1];

                    // For JS/TS functions: function functionName(
                    const jsFunctionMatch = code.match(/function\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
                    if (jsFunctionMatch) return jsFunctionMatch[1];

                    // For JS/TS methods: methodName(args) {
                    const jsMethodMatch = code.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*\{/);
                    if (jsMethodMatch) return jsMethodMatch[1];

                    // For class declarations: class ClassName
                    const classMatch = code.match(/class\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
                    if (classMatch) return classMatch[1];

                    // If we find nothing, use type + position
                    return `${node.type}_${node.startIndex}`;
                }

                let symbol = extractSymbolName(node, source);
                if (!symbol) return;
                
                // Add suffix for statement-level chunks
                if (suffix) {
                    symbol = `${symbol}_part${suffix}`;
                }

                // ===== ENHANCED METADATA EXTRACTION =====

                // Extract documentation comments
                const docComments = extractDocComments(source, node, rule);

                // Extract pampa-specific metadata from comments
                const pampaMetadata = extractPampaMetadata(docComments);

                // Extract semantic tags automatically from code context
                const automaticTags = extractSemanticTags(rel, symbol, code);

                // Combine manual tags with automatic tags
                const allTags = [...new Set([...pampaMetadata.tags, ...automaticTags])];
                pampaMetadata.tags = allTags;

                // Extract important variables used in this code
                const importantVariables = extractImportantVariables(node, source, rule);

                const symbolData = extractSymbolMetadata({ node, source, symbol });

                // Generate enhanced embedding text
                const enhancedEmbeddingText = generateEnhancedEmbeddingText(
                    code,
                    pampaMetadata,
                    importantVariables,
                    docComments
                );

                // Determine chunk type
                const chunkType = node.type.includes('class') ? 'class' :
                    node.type.includes('method') ? 'method' : 'function';

                // Create context information
                const contextInfo = {
                    nodeType: node.type,
                    startLine: source.slice(0, node.startIndex).split('\n').length,
                    endLine: source.slice(0, node.endIndex).split('\n').length,
                    codeLength: code.length,
                    hasDocumentation: !!docComments,
                    variableCount: importantVariables.length,
                    isSubdivision: !!suffix,
                    hasParentContext: !!parentNode
                };

                const sha = crypto.createHash('sha1').update(code).digest('hex');
                const chunkId = `${rel}:${symbol}:${sha.substring(0, 8)}`;
                const chunkMerkleHash = await computeFastHash(code);

                // Check if chunk already exists and hasn't changed
                if (codemap[chunkId]?.sha === sha) {
                    staleChunkIds.delete(chunkId);
                    chunkMerkleHashes.push(chunkMerkleHash);
                    return;
                }

                await embedAndStore({
                    code,
                    enhancedEmbeddingText,
                    chunkId,
                    sha,
                    lang: rule.lang,
                    rel,
                    symbol,
                    chunkType,
                    pampaMetadata,
                    importantVariables,
                    docComments,
                    contextInfo,
                    symbolData
                });
                staleChunkIds.delete(chunkId);
                chunkMerkleHashes.push(chunkMerkleHash);
                processedChunks++;

                // Progress callback
                if (onProgress) {
                    onProgress({ type: 'chunk_processed', file: rel, symbol, chunkId });
                }
            }

            await walk(tree.rootNode);

            if (staleChunkIds.size > 0) {
                await deleteChunks(Array.from(staleChunkIds), existingChunks);
                indexMutated = true;
            }

            if (fileHash) {
                updatedMerkle[rel] = {
                    shaFile: fileHash,
                    chunkShas: chunkMerkleHashes
                };
                merkleDirty = true;
            }
        } catch (error) {
            errors.push({ type: 'processing_error', file: rel, error: error.message });

            try {
                const abs = path.join(repo, rel);
                if (!fs.existsSync(abs)) {
                    continue;
                }

                const source = fs.readFileSync(abs, 'utf8');
                const fallbackSymbol = path.basename(rel) || rel;
                const sha = crypto.createHash('sha1').update(source).digest('hex');
                const chunkId = `${rel}:fallback:${sha.substring(0, 8)}`;
                const chunkMerkleHash = await computeFastHash(source);
                const fallbackMetadata = { tags: [], intent: null, description: null };
                const contextInfo = {
                    nodeType: 'file',
                    startLine: 1,
                    endLine: source.split('\n').length,
                    codeLength: source.length,
                    hasDocumentation: false,
                    variableCount: 0
                };

                await embedAndStore({
                    code: source,
                    enhancedEmbeddingText: source,
                    chunkId,
                    sha,
                    lang: rule.lang,
                    rel,
                    symbol: fallbackSymbol,
                    chunkType: 'file',
                    pampaMetadata: fallbackMetadata,
                    importantVariables: [],
                    docComments: null,
                    contextInfo,
                    symbolData: {
                        signature: `${fallbackSymbol}()`,
                        parameters: [],
                        returnType: null,
                        calls: []
                    }
                });

                processedChunks++;
                indexMutated = true;

                if (onProgress) {
                    onProgress({ type: 'chunk_processed', file: rel, symbol: fallbackSymbol, chunkId });
                }

                staleChunkIds.delete(chunkId);
                if (staleChunkIds.size > 0) {
                    await deleteChunks(Array.from(staleChunkIds), existingChunks);
                    indexMutated = true;
                }

                chunkMerkleHashes.length = 0;
                chunkMerkleHashes.push(chunkMerkleHash);
                fileHash = chunkMerkleHash;
                updatedMerkle[rel] = {
                    shaFile: chunkMerkleHash,
                    chunkShas: [...chunkMerkleHashes]
                };
                merkleDirty = true;
            } catch (fallbackError) {
                errors.push({ type: 'fallback_error', file: rel, error: fallbackError.message });
            }
        }
    }

    for (const fileRel of deletedSet) {
        await removeFileArtifacts(fileRel);
    }

    if (!isPartialUpdate) {
        const existingFilesSet = new Set(files);
        for (const fileRel of Object.keys(merkle)) {
            if (!existingFilesSet.has(fileRel)) {
                await removeFileArtifacts(fileRel);
            }
        }
    }

    if (merkleDirty) {
        saveMerkle(repo, updatedMerkle);
    }

    if (indexMutated) {
        bm25IndexCache.clear();
    }

    // Save updated codemap
    attachSymbolGraphToCodemap(codemap);
    codemap = writeCodemap(codemapPath, codemap);

    // Log chunking statistics
    if (chunkingStats.totalNodes > 0) {
        console.log(`\n📈 Chunking Statistics:`);
        console.log(`  Total AST nodes analyzed: ${chunkingStats.totalNodes}`);
        console.log(`  Normal chunks (optimal size): ${chunkingStats.normalChunks}`);
        console.log(`  Subdivided (too large): ${chunkingStats.subdivided}`);
        console.log(`  Merged small chunks: ${chunkingStats.mergedSmall}`);
        console.log(`  Statement-level fallback: ${chunkingStats.statementFallback}`);
        console.log(`  Skipped (too small): ${chunkingStats.skippedSmall}`);
        console.log(`  Final chunk count: ${processedChunks}`);
        
        const reductionRatio = chunkingStats.totalNodes > 0 
            ? ((1 - processedChunks / chunkingStats.totalNodes) * 100).toFixed(1)
            : 0;
        console.log(`  Chunk reduction: ${reductionRatio}% fewer chunks vs naive approach`);
        console.log('');
    }

    // Return structured result
    return {
        success: true,
        processedChunks,
        totalChunks: Object.keys(codemap).length,
        provider: embeddingProvider.getName(),
        errors,
        chunkingStats
    };
}

export async function searchCode(query, limit = 10, provider = 'auto', workingPath = '.', scopeOptions = {}) {
    // Set the base path for all operations
    setBasePath(workingPath);

    if (!query || !query.trim()) {
        return await getOverview(limit, workingPath);
    }

    const normalizedScope = normalizeScopeFilters(scopeOptions);
    const effectiveProvider = normalizedScope.provider || provider;
    const hybridEnabled = normalizedScope.hybrid !== false;
    const bm25Enabled = normalizedScope.bm25 !== false;
    const symbolBoostEnabled = normalizedScope.symbol_boost !== false;

    // Create provider for query - we need this early for consistent provider reporting
    const embeddingProvider = createEmbeddingProvider(effectiveProvider);

    try {
        // ===== PHASE 1: INTENTION-BASED SEARCH =====
        // First, try to find direct intention matches for instant results
        let intentionResults = [];
        let intentionResult = { success: false, directMatch: false };

        if (symbolBoostEnabled) {
            intentionResult = await searchByIntention(query, workingPath);

            if (intentionResult.success && intentionResult.directMatch) {
                // Found a direct intention match! Get the chunk and add to results
                const chunk = await getChunk(intentionResult.sha, workingPath);

                if (chunk.success) {
                    intentionResults = [{
                        type: 'code',
                        lang: intentionResult.lang,
                        path: intentionResult.filePath,
                        sha: intentionResult.sha,
                        data: chunk.code,
                        meta: {
                            symbol: intentionResult.symbol,
                            score: intentionResult.confidence,
                            searchType: 'intention'
                        }
                    }];
                }
            }
        }

        // ===== PHASE 2: RECORD QUERY PATTERN =====
        // Record this query pattern for future learning
        await recordQueryPattern(query, workingPath);

        // ===== PHASE 3: TRADITIONAL VECTOR SEARCH =====
        const { dbPath, codemap: codemapPath } = getPaths();

        // Check if database exists before trying to open it
        if (!fs.existsSync(dbPath)) {
            return {
                success: false,
                error: 'database_not_found',
                message: `Database not found at ${dbPath}. Project needs to be indexed first.`,
                suggestion: `Run index_project on directory: ${workingPath}`,
                provider: embeddingProvider.getName(),
                scope: normalizedScope,
                hybrid: { enabled: hybridEnabled, bm25Enabled },
                symbolBoost: { enabled: symbolBoostEnabled, boosted: false },
                reranker: normalizedScope.reranker,
                results: []
            };
        }

        const db = new sqlite3.Database(dbPath);
        const all = promisify(db.all.bind(db));

        // Enhanced search query to include semantic metadata
        const chunks = await all(`
            SELECT id, file_path, symbol, sha, lang, chunk_type, embedding, 
                   pampa_tags, pampa_intent, pampa_description, 
                   embedding_provider, embedding_dimensions
            FROM code_chunks 
            WHERE embedding_provider = ? AND embedding_dimensions = ?
            ORDER BY created_at DESC
        `, [embeddingProvider.getName(), embeddingProvider.getDimensions()]);

        db.close();

        const codemapData = readCodemap(codemapPath);

        if (chunks.length === 0) {
            return {
                success: false,
                error: 'no_chunks_found',
                message: `No indexed chunks found with ${embeddingProvider.getName()} in ${path.resolve(workingPath)}`,
                suggestion: `Run: npx pampa index --provider ${effectiveProvider} from ${path.resolve(workingPath)}`,
                provider: embeddingProvider.getName(),
                scope: normalizedScope,
                hybrid: { enabled: hybridEnabled, bm25Enabled },
                reranker: normalizedScope.reranker,
                results: []
            };
        }

        const scopedChunks = applyScope(chunks, normalizedScope);
        const scopedShaSet = new Set(scopedChunks.map(chunk => chunk.sha));
        const chunkIdBySha = new Map();
        const scopedIntentionResults = hasScopeFilters(normalizedScope)
            ? intentionResults.filter(result => scopedShaSet.has(result.sha))
            : intentionResults;

        // ===== PHASE 4: ENHANCED SIMILARITY CALCULATION =====
        const chunkInfoById = new Map();
        const results = [];

        let queryEmbedding = null;
        if (scopedChunks.length > 0) {
            queryEmbedding = await embeddingProvider.generateEmbedding(query);
        }

        for (const chunk of scopedChunks) {
            const embedding = JSON.parse(chunk.embedding.toString());
            const vectorSimilarity = queryEmbedding ? cosineSimilarity(queryEmbedding, embedding) : 0;

            // Boost score based on semantic metadata
            let boostScore = 0;

            // Boost if query matches pampa intent
            if (chunk.pampa_intent && query.toLowerCase().includes(chunk.pampa_intent.toLowerCase())) {
                boostScore += 0.2;
            }

            // Boost if query matches pampa tags
            if (chunk.pampa_tags) {
                try {
                    const tags = JSON.parse(chunk.pampa_tags || '[]');
                    const queryLower = query.toLowerCase();
                    tags.forEach(tag => {
                        if (typeof tag === 'string' && queryLower.includes(tag.toLowerCase())) {
                            boostScore += 0.1;
                        }
                    });
                } catch (error) {
                    // ignore tag parsing errors for BM25 pipeline
                }
            }

            // Final score combines vector similarity with semantic boosts
            const finalScore = Math.min(vectorSimilarity + boostScore, 1.0);

            const info = {
                id: chunk.id,
                file_path: chunk.file_path,
                symbol: chunk.symbol,
                sha: chunk.sha,
                lang: chunk.lang,
                chunk_type: chunk.chunk_type,
                pampa_intent: chunk.pampa_intent,
                pampa_description: chunk.pampa_description,
                score: finalScore,
                vectorScore: vectorSimilarity,
                boostScore: boostScore
            };

            chunkInfoById.set(chunk.id, info);
            chunkIdBySha.set(chunk.sha, chunk.id);
            results.push(info);
        }

        // ===== PHASE 5: PROGRESSIVE THRESHOLD SEARCH =====
        if (symbolBoostEnabled) {
            try {
                applySymbolBoost(results, { query, codemap: codemapData });
            } catch (error) {
                // Symbol boost should fail softly without interrupting search
            }
        }

        const sortedResults = results.sort((a, b) => b.score - a.score);

        // Exclude intention results to avoid duplicates
        const intentionChunkIds = new Set(
            scopedIntentionResults
                .map(result => chunkIdBySha.get(result.sha))
                .filter(Boolean)
        );
        const filteredResults = sortedResults.filter(result => !intentionChunkIds.has(result.id));

        const remainingSlots = Math.max(limit - scopedIntentionResults.length, 0);
        let vectorResults = [];
        let bm25Fused = false;
        let bm25CandidateCount = 0;

        if (remainingSlots > 0) {
            const selectionBudget = Math.max(remainingSlots, 60);
            const vectorPool = filteredResults.slice(0, selectionBudget);

            if (hybridEnabled && bm25Enabled) {
                const bm25Index = ensureBm25IndexForChunks(
                    embeddingProvider.getName(),
                    embeddingProvider.getDimensions(),
                    scopedChunks
                );

                if (bm25Index) {
                    const allowedIds = new Set(scopedChunks.map(chunk => chunk.id));
                    const bm25RawResults = bm25Index.search(query, selectionBudget);
                    const bm25Results = bm25RawResults.filter(result =>
                        allowedIds.has(result.id) && !intentionChunkIds.has(result.id)
                    );
                    bm25CandidateCount = bm25Results.length;

                    if (bm25Results.length > 0) {
                        const fused = reciprocalRankFusion({
                            vectorResults: vectorPool.map(item => ({ id: item.id, score: item.score })),
                            bm25Results: bm25Results.map(item => ({ id: item.id, score: item.score })),
                            limit: selectionBudget,
                            k: 60
                        });

                        if (fused.length > 0) {
                            bm25Fused = true;
                            vectorResults = fused
                                .map(entry => {
                                    const info = chunkInfoById.get(entry.id);
                                    if (!info) {
                                        return null;
                                    }

                                    info.hybridScore = entry.score;
                                    info.bm25Score = entry.bm25Score;
                                    info.bm25Rank = entry.bm25Rank;
                                    info.vectorRank = entry.vectorRank;
                                    return info;
                                })
                                .filter(Boolean);
                        }
                    }
                }
            }

            if (vectorResults.length === 0) {
                vectorResults = vectorPool;
            }

            const hasSymbolBoost = symbolBoostEnabled && vectorResults.some(
                candidate => typeof candidate.symbolBoost === 'number' && candidate.symbolBoost > 0
            );

            if (hasSymbolBoost && vectorResults.length > 1) {
                vectorResults.sort((a, b) => {
                    const scoreA = typeof a.score === 'number' ? a.score : 0;
                    const scoreB = typeof b.score === 'number' ? b.score : 0;
                    if (scoreB !== scoreA) {
                        return scoreB - scoreA;
                    }

                    const boostA = typeof a.symbolBoost === 'number' ? a.symbolBoost : 0;
                    const boostB = typeof b.symbolBoost === 'number' ? b.symbolBoost : 0;
                    if (boostB !== boostA) {
                        return boostB - boostA;
                    }

                    const hybridA = typeof a.hybridScore === 'number' ? a.hybridScore : Number.NEGATIVE_INFINITY;
                    const hybridB = typeof b.hybridScore === 'number' ? b.hybridScore : Number.NEGATIVE_INFINITY;
                    return hybridB - hybridA;
                });
            }

            vectorResults = vectorResults.slice(0, remainingSlots);

            if (vectorResults.length > 1 && normalizedScope.reranker === 'transformers') {
                try {
                    const reranked = await rerankCrossEncoder(query, vectorResults, {
                        max: Math.min(RERANKER_MAX_CANDIDATES, vectorResults.length),
                        getText: candidate => buildRerankerDocument(candidate),
                        getScoreHint: candidate => extractRerankerScoreHint(candidate)
                    });

                    if (Array.isArray(reranked) && reranked.length === vectorResults.length) {
                        vectorResults = reranked;
                    }
                } catch (error) {
                    // Silent fallback when reranker is unavailable or fails
                }
            }
        }

        // ===== PHASE 6: COMBINE RESULTS =====
        const vectorSearchType = bm25Fused ? 'hybrid' : 'vector';
        const combinedResults = [
            ...scopedIntentionResults,
            ...vectorResults.map(result => {
                const rawScore = typeof result.score === 'number' ? result.score : 0;
                const meta = {
                    id: result.id,
                    symbol: result.symbol,
                    score: Math.min(1, rawScore),
                    intent: result.pampa_intent,
                    description: result.pampa_description,
                    searchType: vectorSearchType,
                    vectorScore: result.vectorScore
                };

                if (typeof result.hybridScore === 'number') {
                    meta.hybridScore = result.hybridScore;
                }

                if (typeof result.bm25Score === 'number') {
                    meta.bm25Score = result.bm25Score;
                }

                if (typeof result.bm25Rank === 'number') {
                    meta.bm25Rank = result.bm25Rank;
                }

                if (typeof result.vectorRank === 'number') {
                    meta.vectorRank = result.vectorRank;
                }

                if (typeof result.rerankerScore === 'number') {
                    meta.rerankerScore = result.rerankerScore;
                }

                if (typeof result.rerankerRank === 'number') {
                    meta.rerankerRank = result.rerankerRank;
                }

                if (typeof result.symbolBoost === 'number' && result.symbolBoost > 0) {
                    meta.symbolBoost = result.symbolBoost;
                    if (Array.isArray(result.symbolBoostSources) && result.symbolBoostSources.length > 0) {
                        meta.symbolBoostSources = result.symbolBoostSources;
                    }
                }

                if (typeof rawScore === 'number' && rawScore > 1) {
                    meta.scoreRaw = rawScore;
                }

                return {
                    type: 'code',
                    lang: result.lang,
                    path: result.file_path,
                    sha: result.sha,
                    data: null, // Loaded on demand
                    meta
                };
            })
        ];

        // If we still don't have enough results, add a message about it
        if (combinedResults.length === 0) {
            return {
                success: false,
                error: 'no_relevant_matches',
                message: `No relevant matches found for "${query}"`,
                suggestion: 'Try broader search terms or check if the project is properly indexed',
                provider: embeddingProvider.getName(),
                scope: normalizedScope,
                hybrid: { enabled: hybridEnabled, bm25Enabled },
                symbolBoost: { enabled: symbolBoostEnabled, boosted: false },
                reranker: normalizedScope.reranker,
                results: []
            };
        }

        // ===== PHASE 7: LEARNING SYSTEM =====
        // If we found good results, record successful patterns for future learning
        if (symbolBoostEnabled && combinedResults.length > 0 && combinedResults[0].meta.score > 0.8) {
            // Record the top result as a successful intention mapping
            await recordIntention(query, combinedResults[0].sha, combinedResults[0].meta.score, workingPath);
        }

        return {
            success: true,
            query,
            searchType: bm25Fused || scopedIntentionResults.length > 0 ? 'hybrid' : 'vector',
            intentionResults: scopedIntentionResults.length,
            vectorResults: vectorResults.length,
            provider: embeddingProvider.getName(),
            scope: normalizedScope,
            reranker: normalizedScope.reranker,
            hybrid: {
                enabled: hybridEnabled,
                bm25Enabled,
                fused: bm25Fused,
                bm25Candidates: bm25CandidateCount
            },
            symbolBoost: {
                enabled: symbolBoostEnabled,
                boosted: symbolBoostEnabled && vectorResults.some(result => typeof result.symbolBoost === 'number' && result.symbolBoost > 0)
            },
            results: combinedResults
        };

    } catch (error) {
        console.error('Error in searchCode:', error);
        return {
            success: false,
            error: 'search_error',
            message: error.message,
            provider: embeddingProvider.getName(),
            scope: normalizedScope,
            hybrid: { enabled: hybridEnabled, bm25Enabled },
            symbolBoost: { enabled: symbolBoostEnabled, boosted: false },
            reranker: normalizedScope.reranker,
            results: []
        };
    }
}

// Function to get project overview
export async function getOverview(limit = 20, workingPath = '.') {
    // Set the base path for all operations
    setBasePath(workingPath);

    try {
        const { dbPath } = getPaths();

        // Check if database exists before trying to open it
        if (!fs.existsSync(dbPath)) {
            return {
                success: false,
                error: 'database_not_found',
                message: `Database not found at ${dbPath}. Project needs to be indexed first.`,
                suggestion: `Run index_project on directory: ${workingPath}`,
                results: []
            };
        }

        const db = new sqlite3.Database(dbPath);
        const all = promisify(db.all.bind(db));

        const chunks = await all(`
            SELECT id, file_path, symbol, sha, lang 
            FROM code_chunks 
            ORDER BY file_path, symbol 
            LIMIT ?
        `, [limit]);

        db.close();

        const results = chunks.map(chunk => ({
            type: 'code',
            lang: chunk.lang,
            path: chunk.file_path,
            sha: chunk.sha,
            data: null,
            meta: {
                id: chunk.id,
                symbol: chunk.symbol,
                score: 1.0
            }
        }));

        return {
            success: true,
            results
        };
    } catch (error) {
        return {
            success: false,
            error: 'overview_error',
            message: error.message,
            results: []
        };
    }
}

// Function to get chunk content
export async function getChunk(sha, workingPath = '.') {
    setBasePath(workingPath);
    const { chunkDir } = getPaths();

    try {
        const result = readChunkFromDisk({ chunkDir, sha });
        if (!result) {
            const plainPath = path.join(chunkDir, `${sha}.gz`);
            const encryptedPath = path.join(chunkDir, `${sha}.gz.enc`);
            throw new Error(`Chunk ${sha} not found at ${plainPath} or ${encryptedPath}`);
        }
        return { success: true, code: result.code };
    } catch (error) {
        if (error && error.code === 'ENCRYPTION_KEY_REQUIRED') {
            return {
                success: false,
                error: `Chunk ${sha} is encrypted. Configure PAMPAX_ENCRYPTION_KEY to decrypt.`
            };
        }
        return { success: false, error: error.message };
    }
}

// ============================================================================
// INTENTION CACHING AND PATTERN LEARNING SYSTEM
// ============================================================================

/**
 * Normalize a query to improve intention matching
 */
function normalizeQuery(query) {
    return query
        .toLowerCase()
        .trim()
        .replace(/[¿?]/g, '') // Remove question marks
        .replace(/\bcómo\b/g, 'como')  // Normalize Spanish
        .replace(/\bcreate\b/g, 'crear')
        .replace(/\bsession\b/g, 'sesion')
        .replace(/\bstripe\b/g, 'stripe')
        .replace(/\bcheckout\b/g, 'checkout')
        .replace(/\s+/g, ' '); // Normalize spaces
}

/**
 * Record a successful query-result mapping for future intention matching
 */
export async function recordIntention(originalQuery, targetSha, confidence = 1.0, workingPath = '.') {
    setBasePath(workingPath);
    const { dbPath } = getPaths();

    try {
        // Check if database exists before trying to open it
        if (!fs.existsSync(dbPath)) {
            return { success: false, error: 'database_not_found' };
        }

        const normalizedQuery = normalizeQuery(originalQuery);

        const db = new sqlite3.Database(dbPath);
        const run = promisify(db.run.bind(db));
        const get = promisify(db.get.bind(db));

        // Check if this intention already exists
        const existing = await get(`
            SELECT id, usage_count FROM intention_cache 
            WHERE query_normalized = ? AND target_sha = ?
        `, [normalizedQuery, targetSha]);

        if (existing) {
            // Update usage count and confidence
            await run(`
                UPDATE intention_cache 
                SET usage_count = usage_count + 1, 
                    confidence = ?, 
                    last_used = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [confidence, existing.id]);
        } else {
            // Create new intention mapping
            await run(`
                INSERT INTO intention_cache 
                (query_normalized, original_query, target_sha, confidence)
                VALUES (?, ?, ?, ?)
            `, [normalizedQuery, originalQuery, targetSha, confidence]);
        }

        db.close();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Search for direct intention matches before doing expensive vector search
 */
export async function searchByIntention(query, workingPath = '.') {
    setBasePath(workingPath);
    const { dbPath } = getPaths();

    try {
        // Check if database exists before trying to open it
        if (!fs.existsSync(dbPath)) {
            return { success: false, directMatch: false, error: 'database_not_found' };
        }

        const normalizedQuery = normalizeQuery(query);

        const db = new sqlite3.Database(dbPath);
        const get = promisify(db.get.bind(db));

        // Look for direct intention match WITH complete chunk information
        const intention = await get(`
            SELECT 
                i.target_sha, 
                i.confidence, 
                i.usage_count, 
                i.original_query,
                c.file_path,
                c.symbol,
                c.lang,
                c.chunk_type
            FROM intention_cache i
            LEFT JOIN code_chunks c ON i.target_sha = c.sha
            WHERE i.query_normalized = ?
            ORDER BY i.confidence DESC, i.usage_count DESC
            LIMIT 1
        `, [normalizedQuery]);

        db.close();

        if (intention) {
            return {
                success: true,
                directMatch: true,
                sha: intention.target_sha,
                confidence: intention.confidence,
                usageCount: intention.usage_count,
                originalQuery: intention.original_query,
                // Add complete chunk information
                filePath: intention.file_path || 'unknown',
                symbol: intention.symbol || 'direct_match',
                lang: intention.lang || 'detected',
                chunkType: intention.chunk_type || 'unknown'
            };
        }

        return { success: true, directMatch: false };

    } catch (error) {
        if (error && typeof error.message === 'string' && error.message.includes('no such table: intention_cache')) {
            return { success: false, directMatch: false, error: 'intention_cache_missing' };
        }

        console.error('Error in searchByIntention:', error);
        return { success: false, directMatch: false, error: error.message };
    }
}

/**
 * Update query pattern frequency for analytics
 */
export async function recordQueryPattern(query, workingPath = '.') {
    setBasePath(workingPath);
    const { dbPath } = getPaths();

    try {
        // Check if database exists before trying to open it
        if (!fs.existsSync(dbPath)) {
            return { success: false, error: 'database_not_found' };
        }

        // Extract pattern from query (remove specific names/values)
        const pattern = query
            .toLowerCase()
            .replace(/\b[\w-]+Session\b/gi, '[SESSION]')
            .replace(/\bstripe\b/gi, '[PAYMENT_PROVIDER]')
            .replace(/\b\w+Service\b/gi, '[SERVICE]')
            .replace(/\b\w+Controller\b/gi, '[CONTROLLER]')
            .trim();

        const db = new sqlite3.Database(dbPath);
        const run = promisify(db.run.bind(db));
        const get = promisify(db.get.bind(db));

        const existing = await get(`
            SELECT id, frequency FROM query_patterns WHERE pattern = ?
        `, [pattern]);

        if (existing) {
            await run(`
                UPDATE query_patterns 
                SET frequency = frequency + 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [existing.id]);
        } else {
            await run(`
                INSERT INTO query_patterns (pattern) VALUES (?)
            `, [pattern]);
        }

        db.close();
        return { success: true, pattern };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Get analytics about frequent query patterns
 */
export async function getQueryAnalytics(workingPath = '.') {
    setBasePath(workingPath);
    const { dbPath } = getPaths();

    try {
        // Check if database exists before trying to open it
        if (!fs.existsSync(dbPath)) {
            return {
                success: false,
                error: 'database_not_found',
                message: `Database not found at ${dbPath}. Project needs to be indexed first.`
            };
        }

        const db = new sqlite3.Database(dbPath);
        const all = promisify(db.all.bind(db));

        const patterns = await all(`
            SELECT pattern, frequency, updated_at
            FROM query_patterns 
            ORDER BY frequency DESC 
            LIMIT 10
        `);

        const intentions = await all(`
            SELECT query_normalized, COUNT(*) as count, AVG(confidence) as avg_confidence
            FROM intention_cache 
            GROUP BY query_normalized
            ORDER BY count DESC 
            LIMIT 10
        `);

        db.close();

        return {
            success: true,
            frequentPatterns: patterns,
            topIntentions: intentions
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
} 