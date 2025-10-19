/**
 * Semantic Chunking Utilities
 * 
 * Hierarchical, AST-aware code chunking for better embedding quality
 */

// ============================================================================
// CORE SEMANTIC CHUNKING
// ============================================================================

export function findSemanticSubdivisions(node, rule) {
    if (!node || !rule) return [];
    
    const subdivisionTypes = rule.subdivisionTypes?.[node.type] || [];
    if (subdivisionTypes.length === 0) return [];
    
    const candidates = [];
    
    function walk(n, depth = 0) {
        if (depth > 0 && subdivisionTypes.includes(n.type)) {
            candidates.push(n);
            return; // Don't recurse into found subdivisions
        }
        
        for (let i = 0; i < n.childCount; i++) {
            const child = n.child(i);
            if (child) {
                walk(child, depth + 1);
            }
        }
    }
    
    walk(node);
    return candidates;
}

export function findLastCompleteBoundary(code, maxSize) {
    // Find last complete statement boundary before maxSize
    const boundaries = [
        { pattern: /\n\s*}\s*$/gm, priority: 1 },  // End of block
        { pattern: /;\s*$/gm, priority: 2 },       // End of statement
        { pattern: /\n\s*$/gm, priority: 3 }       // End of line
    ];
    
    for (const boundary of boundaries) {
        const matches = [...code.substring(0, maxSize).matchAll(boundary.pattern)];
        if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            return lastMatch.index + lastMatch[0].length;
        }
    }
    
    return maxSize; // Fallback to hard limit
}

export function extractSignature(node, source) {
    // Extract just the function/class signature (first line)
    const code = source.slice(node.startIndex, node.endIndex);
    const firstBrace = code.indexOf('{');
    if (firstBrace !== -1) {
        return code.substring(0, firstBrace).trim() + ' {';
    }
    return code.split('\n')[0];
}

export function extractLinesBeforeNode(node, source, numLines) {
    const beforeCode = source.substring(0, node.startIndex);
    const lines = beforeCode.split('\n');
    return lines.slice(-numLines).join('\n');
}

export function extractParentContext(node, source) {
    // Extract minimal parent context (signature only)
    return {
        signature: extractSignature(node, source),
        startLine: getLineNumber(node.startIndex, source),
        endLine: getLineNumber(node.endIndex, source)
    };
}

export function getLineNumber(byteOffset, source) {
    const before = source.substring(0, byteOffset);
    return before.split('\n').length;
}

// ============================================================================
// CHUNK ANALYSIS
// ============================================================================

export async function analyzeNodeForChunking(node, source, rule, profile) {
    const size = node.endIndex - node.startIndex;
    const code = source.slice(node.startIndex, node.endIndex);
    
    // Get size in appropriate units (tokens or chars)
    let actualSize;
    if (profile.useTokens && profile.tokenCounter) {
        const result = profile.tokenCounter(code);
        actualSize = result instanceof Promise ? await result : result;
    } else {
        actualSize = size;
    }
    
    const limits = getSizeLimits(profile);
    
    return {
        isSingleChunk: actualSize <= limits.optimal,
        needsSubdivision: actualSize > limits.optimal,
        subdivisionCandidates: findSemanticSubdivisions(node, rule),
        size: actualSize,
        unit: limits.unit,
        estimatedSubchunks: Math.ceil(actualSize / limits.optimal)
    };
}

function getSizeLimits(profile) {
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
// OVERLAP CONTEXT
// ============================================================================

export function addOverlapContext(chunk, parentNode, source, overlapLines = 5) {
    if (!parentNode) return chunk;
    
    const chunkCode = chunk.code;
    
    // Add parent signature
    const parentSignature = extractSignature(parentNode, source);
    
    // Add overlap from previous content
    const beforeContext = extractLinesBeforeNode(chunk.node, source, overlapLines);
    
    return {
        ...chunk,
        code: `${parentSignature}\n...\n${beforeContext}\n${chunkCode}`,
        metadata: {
            ...chunk.metadata,
            hasOverlap: true,
            parentSignature,
            overlapLines
        }
    };
}

// ============================================================================
// STATEMENT-LEVEL FALLBACK CHUNKING
// ============================================================================

export async function yieldStatementChunks(node, source, maxSize, overlapSize, profile) {
    const code = source.slice(node.startIndex, node.endIndex);
    const lines = code.split('\n');
    
    const chunks = [];
    let currentChunk = [];
    let currentSize = 0;
    
    for (const line of lines) {
        const lineSize = profile.useTokens && profile.tokenCounter 
            ? await profile.tokenCounter(line)
            : line.length;
        
        if (currentSize + lineSize > maxSize && currentChunk.length > 0) {
            // Emit current chunk
            chunks.push({
                code: currentChunk.join('\n'),
                size: currentSize,
                unit: profile.useTokens ? 'tokens' : 'characters'
            });
            
            // Start new chunk with overlap
            const overlapLines = Math.floor(currentChunk.length * 0.2); // 20% overlap
            currentChunk = currentChunk.slice(-overlapLines);
            currentSize = profile.useTokens && profile.tokenCounter
                ? await profile.tokenCounter(currentChunk.join('\n'))
                : currentChunk.join('\n').length;
        }
        
        currentChunk.push(line);
        currentSize += lineSize;
    }
    
    // Emit final chunk
    if (currentChunk.length > 0) {
        chunks.push({
            code: currentChunk.join('\n'),
            size: currentSize,
            unit: profile.useTokens ? 'tokens' : 'characters'
        });
    }
    
    return chunks;
}
