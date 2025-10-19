/**
 * File-Level Grouping Strategy for Semantic Chunking
 * 
 * Groups multiple functions/methods from the same file into larger semantic chunks
 * to preserve context and dramatically reduce chunk count.
 * 
 * Inspired by:
 * - Sweep.dev's hierarchical chunking approach
 * - AST-based semantic grouping strategies
 * - Context preservation for better embeddings
 */

import { analyzeCodeSize, batchAnalyzeCodeSize } from './token-counter.js';

/**
 * Group AST nodes by file/class/module for optimal context preservation
 * 
 * Strategy:
 * 1. Collect all top-level nodes (functions, classes, etc.)
 * 2. Group them by semantic relationship (same class, same file section)
 * 3. Combine groups until reaching optimal token size
 * 4. Only split if a group exceeds max token size
 * 
 * IMPORTANT: Only groups when beneficial (saves significant chunks)
 * - Small files (<10 functions): Keep functions separate for symbol accuracy
 * - Large files (>10 functions): Group to preserve context
 * 
 * @param {Array} nodes - Array of AST nodes to group
 * @param {string} source - Source code
 * @param {object} profile - Model profile with token limits
 * @param {object} rule - Language rule
 * @returns {Array} - Array of node groups ready for chunking
 */
export async function groupNodesForChunking(nodes, source, profile, rule) {
    if (!nodes || nodes.length === 0) return [];
    
    const limits = getSizeLimits(profile);
    
    // For small files, don't group - preserve individual function symbols
    // This maintains symbol-aware features and test compatibility
    if (nodes.length <= 10) {
        return nodes.map(node => ({
            nodes: [node],
            totalSize: 0,
            groupInfo: []
        }));
    }
    
    // Step 1: Analyze all nodes to understand their sizes
    const nodeAnalyses = await batchAnalyzeNodes(nodes, source, profile);
    
    // Step 2: Identify semantic relationships (classes, modules, etc.)
    const semanticGroups = identifySemanticGroups(nodes, source, nodeAnalyses, rule);
    
    // Step 3: Combine groups to reach optimal size
    const optimalGroups = await combineGroupsToOptimalSize(
        semanticGroups,
        source,
        profile,
        limits
    );
    
    return optimalGroups;
}

/**
 * Analyze all nodes in batch for better performance
 */
async function batchAnalyzeNodes(nodes, source, profile) {
    const codes = nodes.map(node => source.slice(node.startIndex, node.endIndex));
    const limits = getSizeLimits(profile);
    
    if (profile.useTokens && profile.tokenCounter) {
        const analyses = await batchAnalyzeCodeSize(codes, limits, profile.tokenCounter, false);
        return nodes.map((node, i) => ({
            node,
            size: analyses[i].size,
            code: codes[i]
        }));
    }
    
    // Fallback to character count
    return nodes.map((node, i) => ({
        node,
        size: codes[i].length,
        code: codes[i]
    }));
}

/**
 * Identify semantic relationships between nodes
 * Groups by:
 * - Same class (methods in a class stay together)
 * - Same module/namespace
 * - Sequential related functions (helper functions near their callers)
 * - File sections (comments, imports, etc.)
 */
function identifySemanticGroups(nodes, source, nodeAnalyses, rule) {
    const groups = [];
    let currentGroup = {
        type: 'file_section',
        nodes: [],
        analyses: [],
        parentNode: null
    };
    
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const analysis = nodeAnalyses[i];
        
        // Check if this node is a class/module that should group its children
        if (isContainerNode(node, rule)) {
            // Start new group for this class/module
            if (currentGroup.nodes.length > 0) {
                groups.push(currentGroup);
            }
            
            currentGroup = {
                type: 'container',
                containerType: node.type,
                nodes: [node],
                analyses: [analysis],
                parentNode: node
            };
            
            groups.push(currentGroup);
            
            // Start fresh group for following nodes
            currentGroup = {
                type: 'file_section',
                nodes: [],
                analyses: [],
                parentNode: null
            };
        } else {
            // Add to current group
            currentGroup.nodes.push(node);
            currentGroup.analyses.push(analysis);
        }
    }
    
    // Add final group
    if (currentGroup.nodes.length > 0) {
        groups.push(currentGroup);
    }
    
    return groups;
}

/**
 * Combine small groups to reach optimal chunk size
 * This is where we dramatically reduce chunk count!
 */
async function combineGroupsToOptimalSize(semanticGroups, source, profile, limits) {
    const optimalGroups = [];
    let currentCombinedGroup = {
        nodes: [],
        totalSize: 0,
        groupInfo: []
    };
    
    for (const group of semanticGroups) {
        const groupTotalSize = group.analyses.reduce((sum, a) => sum + a.size, 0);
        
        // If this single group is already larger than optimal, keep it separate
        if (groupTotalSize > limits.optimal) {
            // Flush current combined group
            if (currentCombinedGroup.nodes.length > 0) {
                optimalGroups.push(currentCombinedGroup);
            }
            
            // Add large group as-is (will be subdivided later if needed)
            optimalGroups.push({
                nodes: group.nodes,
                totalSize: groupTotalSize,
                groupInfo: [group]
            });
            
            // Reset combined group
            currentCombinedGroup = {
                nodes: [],
                totalSize: 0,
                groupInfo: []
            };
            continue;
        }
        
        // Check if adding this group would exceed max size
        if (currentCombinedGroup.totalSize + groupTotalSize > limits.max) {
            // Flush current combined group
            if (currentCombinedGroup.nodes.length > 0) {
                optimalGroups.push(currentCombinedGroup);
            }
            
            // Start new combined group with this group
            currentCombinedGroup = {
                nodes: group.nodes,
                totalSize: groupTotalSize,
                groupInfo: [group]
            };
            continue;
        }
        
        // Add to current combined group
        currentCombinedGroup.nodes.push(...group.nodes);
        currentCombinedGroup.totalSize += groupTotalSize;
        currentCombinedGroup.groupInfo.push(group);
        
        // If we've reached optimal size, flush the group
        if (currentCombinedGroup.totalSize >= limits.optimal * 0.9) {
            optimalGroups.push(currentCombinedGroup);
            currentCombinedGroup = {
                nodes: [],
                totalSize: 0,
                groupInfo: []
            };
        }
    }
    
    // Add final combined group
    if (currentCombinedGroup.nodes.length > 0) {
        optimalGroups.push(currentCombinedGroup);
    }
    
    return optimalGroups;
}

/**
 * Check if node is a container (class, module, namespace)
 * that should group its children together
 */
function isContainerNode(node, rule) {
    const containerTypes = [
        'class_declaration',
        'class_definition',
        'interface_declaration',
        'module_declaration',
        'namespace_declaration',
        'trait_declaration',
        'enum_declaration'
    ];
    
    return containerTypes.includes(node.type);
}

/**
 * Get size limits from profile
 */
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

/**
 * Create a combined chunk from multiple nodes
 * Preserves context by keeping related code together
 */
export function createCombinedChunk(nodeGroup, source, filerel) {
    if (!nodeGroup.nodes || nodeGroup.nodes.length === 0) {
        return null;
    }
    
    // Extract code from all nodes
    const codes = nodeGroup.nodes.map(node => 
        source.slice(node.startIndex, node.endIndex)
    );
    
    // Combine with appropriate separators
    const combinedCode = codes.join('\n\n');
    
    // Create metadata
    const firstNode = nodeGroup.nodes[0];
    const lastNode = nodeGroup.nodes[nodeGroup.nodes.length - 1];
    
    return {
        code: combinedCode,
        node: {
            ...firstNode,
            type: `${firstNode.type}_group_${nodeGroup.nodes.length}`,
            endIndex: lastNode.endIndex
        },
        metadata: {
            isGroup: true,
            nodeCount: nodeGroup.nodes.length,
            totalSize: nodeGroup.totalSize,
            groupTypes: nodeGroup.groupInfo?.map(g => g.type) || ['combined']
        }
    };
}
