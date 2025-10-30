export const RERANKER_OPTIONS = ['off', 'transformers', 'api'];

// Get default reranker from environment variable, fallback to 'off'
function getDefaultReranker() {
    const envValue = process.env.PAMPAX_RERANKER_DEFAULT;
    if (envValue && RERANKER_OPTIONS.includes(envValue.toLowerCase())) {
        return envValue.toLowerCase();
    }
    return 'off';
}

export const DEFAULT_RERANKER = getDefaultReranker();

export function hasScopeFilters(scope = {}) {
    if (!scope) {
        return false;
    }

    return Boolean(
        (Array.isArray(scope.path_glob) && scope.path_glob.length > 0) ||
        (Array.isArray(scope.tags) && scope.tags.length > 0) ||
        (Array.isArray(scope.lang) && scope.lang.length > 0)
    );
}
