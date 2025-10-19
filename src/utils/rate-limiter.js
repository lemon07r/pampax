/**
 * Rate Limiter for API Requests
 * 
 * Prevents hitting provider rate limits by queueing requests
 * and throttling them based on requests per minute (RPM)
 */

export class RateLimiter {
    constructor(requestsPerMinute = null) {
        // Get rate limit from environment or use default
        // null = no limit (for local models)
        this.rpm = requestsPerMinute ?? this.getDefaultRPM();
        this.queue = [];
        this.processing = false;
        this.requestTimes = [];
        this.retryDelays = [1000, 2000, 5000, 10000]; // Exponential backoff delays (ms)
    }

    /**
     * Get default RPM from environment variable or return null
     */
    getDefaultRPM() {
        if (process.env.PAMPAX_RATE_LIMIT) {
            const limit = parseInt(process.env.PAMPAX_RATE_LIMIT, 10);
            if (!isNaN(limit) && limit > 0) {
                return limit;
            }
        }
        return null; // No limit by default
    }

    /**
     * Check if we can make a request right now
     */
    canMakeRequest() {
        if (this.rpm === null) {
            return true; // No rate limiting
        }

        const now = Date.now();
        const oneMinuteAgo = now - 60000;

        // Remove requests older than 1 minute
        this.requestTimes = this.requestTimes.filter(time => time > oneMinuteAgo);

        return this.requestTimes.length < this.rpm;
    }

    /**
     * Record that a request was made
     */
    recordRequest() {
        if (this.rpm !== null) {
            this.requestTimes.push(Date.now());
        }
    }

    /**
     * Calculate delay needed before next request
     */
    getDelayUntilNextSlot() {
        if (this.rpm === null || this.requestTimes.length === 0) {
            return 0;
        }

        const oldestRequest = this.requestTimes[0];
        const timeUntilExpiry = 60000 - (Date.now() - oldestRequest);
        
        return Math.max(0, timeUntilExpiry + 100); // Add 100ms buffer
    }

    /**
     * Execute a function with rate limiting
     * Includes automatic retry with exponential backoff for 429 errors
     */
    async execute(fn, retryCount = 0) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject, retryCount });
            this.processQueue();
        });
    }

    /**
     * Process the request queue
     */
    async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            // Wait until we can make a request
            while (!this.canMakeRequest()) {
                const delay = this.getDelayUntilNextSlot();
                if (delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

            const { fn, resolve, reject, retryCount } = this.queue.shift();

            try {
                this.recordRequest();
                const result = await fn();
                resolve(result);
            } catch (error) {
                // Handle rate limit errors (429)
                if (this.isRateLimitError(error)) {
                    const maxRetries = this.retryDelays.length;
                    
                    if (retryCount < maxRetries) {
                        // Exponential backoff retry
                        const delay = this.retryDelays[retryCount];
                        console.warn(`⚠️  Rate limit hit (429). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                        
                        await new Promise(resolve => setTimeout(resolve, delay));
                        
                        // Re-queue with incremented retry count
                        this.queue.unshift({ fn, resolve, reject, retryCount: retryCount + 1 });
                    } else {
                        // Max retries exceeded
                        reject(new Error(`Rate limit exceeded after ${maxRetries} retries: ${error.message}`));
                    }
                } else {
                    // Other errors - reject immediately
                    reject(error);
                }
            }
        }

        this.processing = false;
    }

    /**
     * Check if error is a rate limit error
     */
    isRateLimitError(error) {
        if (!error) return false;
        
        const message = error.message || '';
        const status = error.status || error.statusCode || 0;
        
        return status === 429 || 
               message.includes('429') || 
               message.includes('rate limit') ||
               message.includes('too many requests');
    }

    /**
     * Get current stats
     */
    getStats() {
        return {
            rpm: this.rpm,
            queueLength: this.queue.length,
            requestsInLastMinute: this.requestTimes.length,
            isLimited: this.rpm !== null
        };
    }

    /**
     * Clear the queue and reset state
     */
    reset() {
        this.queue = [];
        this.requestTimes = [];
        this.processing = false;
    }
}

/**
 * Create a rate limiter instance based on provider type
 */
export function createRateLimiter(providerName) {
    // Default rate limits for common providers (if not set via env var)
    const defaultLimits = {
        'OpenAI': 50,           // 50 RPM for free tier
        'Cohere': 100,          // 100 RPM for trial
        'Ollama': null,         // No limit - local
        'Transformers.js (Local)': null  // No limit - local
    };

    // Check environment variable first
    if (process.env.PAMPAX_RATE_LIMIT) {
        return new RateLimiter(); // Will use env var
    }

    // Use provider default
    const rpm = defaultLimits[providerName] ?? null;
    return new RateLimiter(rpm);
}
