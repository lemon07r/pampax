import chokidar from 'chokidar';
import path from 'path';
import { updateIndex } from './update.js';
import { toPosixPath } from './merkle.js';
import { getSupportedLanguageExtensions } from '../service.js';
import { createEmbeddingProvider } from '../providers.js';

const DEFAULT_DEBOUNCE_MS = 500;
const IGNORED_DIRS = [
    'node_modules',
    '.git',
    '.pampa',
    '.pampax',
    'dist',
    'build',
    'tmp',
    '.tmp',
    'vendor'
];

export function startWatch({
    repoPath = '.',
    provider = 'auto',
    debounceMs = DEFAULT_DEBOUNCE_MS,
    onBatch = null,
    logger = console,
    encrypt = undefined
} = {}) {
    const root = path.resolve(repoPath);
    const supportedExtensions = new Set(
        (getSupportedLanguageExtensions() || []).map(ext => ext.toLowerCase())
    );

    const effectiveDebounce = Number.isFinite(Number.parseInt(debounceMs, 10))
        ? Math.max(Number.parseInt(debounceMs, 10), 50)
        : DEFAULT_DEBOUNCE_MS;

    // Chokidar 5.x removed glob support - use ignored function instead
    // Only ignore directories here, extension filtering happens in recordChange
    const ignoredFn = (filePath) => {
        // Get relative path from root to check only project-relative directories
        const relativePath = path.relative(root, filePath);
        if (!relativePath) {
            // This is the root itself, don't ignore
            return false;
        }
        
        // Check if relative path contains any ignored directory
        const pathParts = relativePath.split(path.sep);
        for (const dir of IGNORED_DIRS) {
            if (pathParts.includes(dir)) {
                return true;
            }
        }
        return false;
    };

    const watcher = chokidar.watch(root, {
        ignoreInitial: true,
        ignored: ignoredFn,
        awaitWriteFinish: {
            stabilityThreshold: Math.max(effectiveDebounce, 100),
            pollInterval: 50
        },
        persistent: true
    });

    const ready = new Promise(resolve => {
        watcher.once('ready', resolve);
    });

    const pendingChanges = new Set();
    const pendingDeletes = new Set();
    let timer = null;
    let processing = false;
    let embeddingProviderInstance = null;
    let embeddingProviderInitPromise = null;
    let providerInitErrorLogged = false;

    async function getEmbeddingProviderInstance() {
        if (embeddingProviderInstance) {
            return embeddingProviderInstance;
        }

        if (!embeddingProviderInitPromise) {
            embeddingProviderInitPromise = (async () => {
                const instance = createEmbeddingProvider(provider);
                if (instance.init) {
                    await instance.init();
                }
                embeddingProviderInstance = instance;
                return instance;
            })();
        }

        try {
            return await embeddingProviderInitPromise;
        } catch (error) {
            embeddingProviderInitPromise = null;
            embeddingProviderInstance = null;
            throw error;
        }
    }

    function scheduleFlush() {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            void flush();
        }, effectiveDebounce);
    }

    function recordChange(type, filePath) {
        // Convert absolute path to relative path from root
        const relativePath = path.relative(root, filePath);
        const normalized = toPosixPath(relativePath);
        if (!normalized) {
            return;
        }

        const ext = path.extname(normalized).toLowerCase();
        if (supportedExtensions.size > 0 && !supportedExtensions.has(ext)) {
            return;
        }

        if (type === 'unlink') {
            pendingDeletes.add(normalized);
            pendingChanges.delete(normalized);
        } else {
            pendingChanges.add(normalized);
            pendingDeletes.delete(normalized);
        }

        scheduleFlush();
    }

    async function flush() {
        if (processing) {
            scheduleFlush();
            return;
        }

        if (pendingChanges.size === 0 && pendingDeletes.size === 0) {
            return;
        }

        const changed = Array.from(pendingChanges);
        const deleted = Array.from(pendingDeletes);
        pendingChanges.clear();
        pendingDeletes.clear();

        processing = true;
        try {
            let embeddingProviderOverride = null;

            try {
                embeddingProviderOverride = await getEmbeddingProviderInstance();
            } catch (providerError) {
                if (!providerInitErrorLogged && logger && typeof logger.error === 'function') {
                    logger.error('PAMPA watch provider initialization failed:', providerError);
                    providerInitErrorLogged = true;
                }
            }

            await updateIndex({
                repoPath: root,
                provider,
                changedFiles: changed,
                deletedFiles: deleted,
                embeddingProvider: embeddingProviderOverride,
                encrypt
            });

            if (typeof onBatch === 'function') {
                await onBatch({ changed, deleted });
            } else if (logger && typeof logger.log === 'function') {
                logger.log(
                    `PAMPA watch: indexed ${changed.length} changed / ${deleted.length} deleted files`
                );
            }
        } catch (error) {
            if (logger && typeof logger.error === 'function') {
                logger.error('PAMPA watch update failed:', error);
            }
        } finally {
            processing = false;
            if (pendingChanges.size > 0 || pendingDeletes.size > 0) {
                scheduleFlush();
            }
        }
    }

    async function waitForProcessing() {
        while (processing) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    const settleDelay = Math.min(effectiveDebounce, 200);

    async function drainPending() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }

        await flush();
        await waitForProcessing();

        if (pendingChanges.size > 0 || pendingDeletes.size > 0 || timer) {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            await flush();
            await waitForProcessing();
            return;
        }

        if (settleDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, settleDelay));
        }

        if (timer) {
            clearTimeout(timer);
            timer = null;
        }

        if (pendingChanges.size > 0 || pendingDeletes.size > 0) {
            await flush();
            await waitForProcessing();
        }
    }

    watcher.on('add', file => recordChange('add', file));
    watcher.on('change', file => recordChange('change', file));
    watcher.on('unlink', file => recordChange('unlink', file));
    watcher.on('error', error => {
        if (logger && typeof logger.error === 'function') {
            logger.error('PAMPA watch error:', error);
        }
    });

    return {
        watcher,
        ready,
        async close() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            await watcher.close();
        },
        flush: drainPending
    };
}
