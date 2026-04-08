/**
 * Enhanced error handling utilities for Twitter Autobot
 * Provides centralized error handling, fallback mechanisms, and recovery strategies
 */

const { createLogger } = require('./logger');

const logger = createLogger('ERROR_HANDLER');

/**
 * Error categories for better error classification and handling
 */
const ERROR_CATEGORIES = {
    NETWORK: 'network',
    API_LIMIT: 'api_limit',
    AUTHENTICATION: 'authentication',
    VALIDATION: 'validation',
    TIMEOUT: 'timeout',
    SERVER_ERROR: 'server_error',
    CONFIGURATION: 'configuration',
    UNKNOWN: 'unknown'
};

/**
 * Retry strategies for different types of operations
 */
const RETRY_STRATEGIES = {
    EXPONENTIAL_BACKOFF: 'exponential_backoff',
    LINEAR_BACKOFF: 'linear_backoff',
    IMMEDIATE: 'immediate',
    NO_RETRY: 'no_retry'
};

/**
 * Default retry configurations for different error categories
 */
const DEFAULT_RETRY_CONFIG = {
    [ERROR_CATEGORIES.NETWORK]: {
        maxRetries: 3,
        strategy: RETRY_STRATEGIES.EXPONENTIAL_BACKOFF,
        baseDelay: 1000,
        maxDelay: 10000
    },
    [ERROR_CATEGORIES.API_LIMIT]: {
        maxRetries: 2,
        strategy: RETRY_STRATEGIES.LINEAR_BACKOFF,
        baseDelay: 5000,
        maxDelay: 30000
    },
    [ERROR_CATEGORIES.TIMEOUT]: {
        maxRetries: 2,
        strategy: RETRY_STRATEGIES.EXPONENTIAL_BACKOFF,
        baseDelay: 2000,
        maxDelay: 8000
    },
    [ERROR_CATEGORIES.SERVER_ERROR]: {
        maxRetries: 2,
        strategy: RETRY_STRATEGIES.EXPONENTIAL_BACKOFF,
        baseDelay: 3000,
        maxDelay: 15000
    },
    [ERROR_CATEGORIES.AUTHENTICATION]: {
        maxRetries: 0,
        strategy: RETRY_STRATEGIES.NO_RETRY,
        baseDelay: 0,
        maxDelay: 0
    },
    [ERROR_CATEGORIES.VALIDATION]: {
        maxRetries: 0,
        strategy: RETRY_STRATEGIES.NO_RETRY,
        baseDelay: 0,
        maxDelay: 0
    },
    [ERROR_CATEGORIES.CONFIGURATION]: {
        maxRetries: 0,
        strategy: RETRY_STRATEGIES.NO_RETRY,
        baseDelay: 0,
        maxDelay: 0
    },
    [ERROR_CATEGORIES.UNKNOWN]: {
        maxRetries: 1,
        strategy: RETRY_STRATEGIES.LINEAR_BACKOFF,
        baseDelay: 2000,
        maxDelay: 5000
    }
};

/**
 * Categorizes an error based on its properties and message
 * @param {Error} error - The error to categorize
 * @param {Object} context - Additional context about the error
 * @returns {string} Error category
 */
function categorizeError(error, context = {}) {
    const operation = logger.startOperation('Error categorization', {
        errorType: error.name,
        hasErrorCode: !!error.code,
        hasResponse: !!error.response,
        contextKeys: Object.keys(context)
    });

    try {
        let category = ERROR_CATEGORIES.UNKNOWN;
        const errorMessage = error.message.toLowerCase();
        const errorCode = error.code;
        const httpStatus = error.response?.status;

        // Network-related errors
        if (errorCode === 'ENOTFOUND' || errorCode === 'ECONNREFUSED' ||
            errorCode === 'ECONNRESET' || errorMessage.includes('network')) {
            category = ERROR_CATEGORIES.NETWORK;
        }
        // Timeout errors
        else if (errorCode === 'ECONNABORTED' || errorMessage.includes('timeout')) {
            category = ERROR_CATEGORIES.TIMEOUT;
        }
        // Authentication errors
        else if (httpStatus === 401 || httpStatus === 403 ||
            errorMessage.includes('unauthorized') || errorMessage.includes('forbidden') ||
            errorMessage.includes('api key') || errorMessage.includes('authentication')) {
            category = ERROR_CATEGORIES.AUTHENTICATION;
        }
        // Rate limiting errors
        else if (httpStatus === 429 || errorMessage.includes('rate limit') ||
            errorMessage.includes('too many requests') || errorMessage.includes('quota')) {
            category = ERROR_CATEGORIES.API_LIMIT;
        }
        // Server errors
        else if (httpStatus >= 500 || errorMessage.includes('server error') ||
            errorMessage.includes('internal error')) {
            category = ERROR_CATEGORIES.SERVER_ERROR;
        }
        // Validation errors
        else if (errorMessage.includes('validation') || errorMessage.includes('invalid') ||
            errorMessage.includes('required') || errorMessage.includes('missing')) {
            category = ERROR_CATEGORIES.VALIDATION;
        }
        // Configuration errors
        else if (errorMessage.includes('configuration') || errorMessage.includes('config') ||
            errorMessage.includes('environment variable')) {
            category = ERROR_CATEGORIES.CONFIGURATION;
        }

        const categorization = {
            category,
            errorType: error.name,
            errorMessage: error.message,
            errorCode,
            httpStatus,
            isRetryable: category !== ERROR_CATEGORIES.AUTHENTICATION &&
                category !== ERROR_CATEGORIES.VALIDATION &&
                category !== ERROR_CATEGORIES.CONFIGURATION
        };

        logger.debug('Error categorized', categorization);
        operation.end('completed', { category, isRetryable: categorization.isRetryable });

        return category;

    } catch (categorizationError) {
        logger.error('Failed to categorize error', categorizationError, {
            originalError: error.message,
            originalErrorType: error.name
        });
        operation.fail(categorizationError);
        return ERROR_CATEGORIES.UNKNOWN;
    }
}

/**
 * Calculates delay for retry based on strategy and attempt number
 * @param {string} strategy - Retry strategy
 * @param {number} attempt - Current attempt number (1-based)
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {number} maxDelay - Maximum delay in milliseconds
 * @returns {number} Delay in milliseconds
 */
function calculateRetryDelay(strategy, attempt, baseDelay, maxDelay) {
    let delay = 0;

    switch (strategy) {
        case RETRY_STRATEGIES.EXPONENTIAL_BACKOFF:
            delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
            break;
        case RETRY_STRATEGIES.LINEAR_BACKOFF:
            delay = Math.min(baseDelay * attempt, maxDelay);
            break;
        case RETRY_STRATEGIES.IMMEDIATE:
            delay = 0;
            break;
        case RETRY_STRATEGIES.NO_RETRY:
        default:
            delay = 0;
            break;
    }

    // Add small random jitter to prevent thundering herd
    if (delay > 0) {
        const jitter = Math.random() * 0.1 * delay; // 10% jitter
        delay = Math.floor(delay + jitter);
    }

    return delay;
}

/**
 * Enhanced retry wrapper with intelligent error handling
 * @param {Function} operation - Async function to retry
 * @param {Object} options - Retry options
 * @param {string} options.operationName - Name of the operation for logging
 * @param {Object} options.retryConfig - Custom retry configuration
 * @param {Object} options.context - Additional context for error handling
 * @returns {Promise<any>} Result of the operation
 */
async function withRetry(operation, options = {}) {
    const {
        operationName = 'unknown operation',
        retryConfig = null,
        context = {}
    } = options;

    const retryOperation = logger.startOperation(`Retry wrapper: ${operationName}`, {
        operationName,
        hasCustomConfig: !!retryConfig,
        contextKeys: Object.keys(context)
    });

    let lastError = null;
    let attempt = 0;

    try {
        // First attempt (not a retry)
        attempt = 1;
        logger.debug(`Attempting ${operationName}`, { attempt, isRetry: false });

        const result = await operation();

        logger.info(`${operationName} succeeded on first attempt`);
        retryOperation.end('completed', { attempt, retriesUsed: 0 });

        return result;

    } catch (error) {
        lastError = error;
        const errorCategory = categorizeError(error, context);
        const config = retryConfig || DEFAULT_RETRY_CONFIG[errorCategory];

        logger.warn(`${operationName} failed on attempt ${attempt}`, {
            errorCategory,
            errorMessage: error.message,
            willRetry: config.maxRetries > 0
        });

        // If no retries configured, fail immediately
        if (config.maxRetries === 0) {
            logger.error(`${operationName} failed with no retry configured`, error, {
                errorCategory,
                attempt,
                finalFailure: true
            });
            retryOperation.fail(error, { errorCategory, attempt });
            throw error;
        }

        // Retry loop
        while (attempt < config.maxRetries + 1) {
            attempt++;
            const isLastAttempt = attempt > config.maxRetries;

            try {
                // Calculate and apply delay
                const delay = calculateRetryDelay(
                    config.strategy,
                    attempt - 1, // Subtract 1 because first attempt was already made
                    config.baseDelay,
                    config.maxDelay
                );

                if (delay > 0) {
                    logger.info(`Waiting ${delay}ms before retry ${attempt - 1}`, {
                        operationName,
                        delay,
                        strategy: config.strategy,
                        attempt
                    });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                logger.debug(`Retrying ${operationName}`, {
                    attempt,
                    isRetry: true,
                    isLastAttempt
                });

                const result = await operation();

                logger.info(`${operationName} succeeded on retry ${attempt - 1}`, {
                    totalAttempts: attempt,
                    retriesUsed: attempt - 1
                });

                retryOperation.end('completed', {
                    attempt,
                    retriesUsed: attempt - 1,
                    succeededOnRetry: true
                });

                return result;

            } catch (retryError) {
                lastError = retryError;
                const retryErrorCategory = categorizeError(retryError, context);

                if (isLastAttempt) {
                    logger.error(`${operationName} failed after ${attempt} attempts`, retryError, {
                        errorCategory: retryErrorCategory,
                        totalAttempts: attempt,
                        retriesUsed: attempt - 1,
                        finalFailure: true,
                        allAttemptsFailed: true
                    });
                    break;
                } else {
                    logger.warn(`${operationName} retry ${attempt - 1} failed`, {
                        errorCategory: retryErrorCategory,
                        errorMessage: retryError.message,
                        attempt,
                        remainingAttempts: config.maxRetries - (attempt - 1)
                    });
                }
            }
        }

        // All retries exhausted
        const finalError = new Error(`${operationName} failed after ${attempt} attempts: ${lastError.message}`);
        finalError.originalError = lastError;
        finalError.totalAttempts = attempt;
        finalError.retriesUsed = attempt - 1;

        retryOperation.fail(finalError, {
            errorCategory: categorizeError(lastError, context),
            totalAttempts: attempt,
            retriesUsed: attempt - 1
        });

        throw finalError;
    }
}

/**
 * Circuit breaker pattern implementation for external API calls
 */
class CircuitBreaker {
    constructor(name, options = {}) {
        this.name = name;
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 60000; // 1 minute
        this.monitoringWindow = options.monitoringWindow || 300000; // 5 minutes

        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failures = [];
        this.lastFailureTime = null;
        this.nextAttemptTime = null;

        this.logger = createLogger(`CIRCUIT_BREAKER_${name.toUpperCase()}`);

        this.logger.info('Circuit breaker initialized', {
            name: this.name,
            failureThreshold: this.failureThreshold,
            resetTimeout: this.resetTimeout,
            monitoringWindow: this.monitoringWindow
        });
    }

    /**
     * Executes an operation through the circuit breaker
     * @param {Function} operation - Async function to execute
     * @returns {Promise<any>} Result of the operation
     */
    async execute(operation) {
        const now = Date.now();

        // Clean old failures outside monitoring window
        this.failures = this.failures.filter(
            failureTime => now - failureTime < this.monitoringWindow
        );

        // Check circuit state
        if (this.state === 'OPEN') {
            if (now < this.nextAttemptTime) {
                const error = new Error(`Circuit breaker ${this.name} is OPEN. Next attempt in ${this.nextAttemptTime - now}ms`);
                this.logger.warn('Circuit breaker blocked operation', {
                    state: this.state,
                    nextAttemptIn: this.nextAttemptTime - now,
                    recentFailures: this.failures.length
                });
                throw error;
            } else {
                // Transition to HALF_OPEN
                this.state = 'HALF_OPEN';
                this.logger.info('Circuit breaker transitioning to HALF_OPEN', {
                    previousState: 'OPEN',
                    resetTimeoutExpired: true
                });
            }
        }

        try {
            const result = await operation();

            // Success - reset if we were in HALF_OPEN
            if (this.state === 'HALF_OPEN') {
                this.state = 'CLOSED';
                this.failures = [];
                this.logger.info('Circuit breaker reset to CLOSED after successful operation', {
                    previousState: 'HALF_OPEN'
                });
            }

            return result;

        } catch (error) {
            // Record failure
            this.failures.push(now);
            this.lastFailureTime = now;

            this.logger.warn('Operation failed through circuit breaker', {
                errorMessage: error.message,
                recentFailures: this.failures.length,
                failureThreshold: this.failureThreshold,
                currentState: this.state
            });

            // Check if we should open the circuit
            if (this.failures.length >= this.failureThreshold) {
                this.state = 'OPEN';
                this.nextAttemptTime = now + this.resetTimeout;

                this.logger.error('Circuit breaker opened due to failure threshold', {
                    failureCount: this.failures.length,
                    failureThreshold: this.failureThreshold,
                    nextAttemptTime: new Date(this.nextAttemptTime).toISOString(),
                    resetTimeoutMs: this.resetTimeout
                });
            }

            throw error;
        }
    }

    /**
     * Gets current circuit breaker status
     * @returns {Object} Status information
     */
    getStatus() {
        const now = Date.now();
        return {
            name: this.name,
            state: this.state,
            recentFailures: this.failures.length,
            failureThreshold: this.failureThreshold,
            lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
            nextAttemptTime: this.nextAttemptTime ? new Date(this.nextAttemptTime).toISOString() : null,
            timeUntilReset: this.nextAttemptTime ? Math.max(0, this.nextAttemptTime - now) : 0
        };
    }

    /**
     * Manually resets the circuit breaker
     */
    reset() {
        this.state = 'CLOSED';
        this.failures = [];
        this.lastFailureTime = null;
        this.nextAttemptTime = null;

        this.logger.info('Circuit breaker manually reset', {
            resetBy: 'manual',
            newState: 'CLOSED'
        });
    }
}

/**
 * Global error handler for unhandled errors with enhanced logging
 * @param {Error} error - The unhandled error
 * @param {string} context - Context where the error occurred
 * @param {Object} metadata - Additional metadata
 */
function handleUnhandledError(error, context = 'UNKNOWN', metadata = {}) {
    const errorCategory = categorizeError(error);

    logger.error('Unhandled error detected', error, {
        context,
        errorCategory,
        processId: process.pid,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform,
        ...metadata
    });

    // Log to console for visibility
    console.error('\n💥 UNHANDLED ERROR DETECTED 💥');
    console.error(`Context: ${context}`);
    console.error(`Category: ${errorCategory}`);
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    console.error(`Time: ${new Date().toISOString()}`);
    console.error('=====================================\n');
}

/**
 * Creates a fallback mechanism for critical operations
 * @param {Function} primaryOperation - Primary operation to attempt
 * @param {Function} fallbackOperation - Fallback operation if primary fails
 * @param {Object} options - Fallback options
 * @returns {Promise<any>} Result from primary or fallback operation
 */
async function withFallback(primaryOperation, fallbackOperation, options = {}) {
    const {
        operationName = 'unknown operation',
        fallbackName = 'fallback operation',
        context = {}
    } = options;

    const fallbackWrapper = logger.startOperation(`Fallback wrapper: ${operationName}`, {
        operationName,
        fallbackName,
        contextKeys: Object.keys(context)
    });

    try {
        logger.debug(`Attempting primary operation: ${operationName}`);
        const result = await primaryOperation();

        logger.info(`Primary operation succeeded: ${operationName}`);
        fallbackWrapper.end('completed', { usedFallback: false });

        return result;

    } catch (primaryError) {
        const errorCategory = categorizeError(primaryError, context);

        logger.warn(`Primary operation failed, attempting fallback: ${operationName}`, {
            primaryError: primaryError.message,
            errorCategory,
            fallbackName
        });

        try {
            logger.debug(`Attempting fallback operation: ${fallbackName}`);
            const fallbackResult = await fallbackOperation();

            logger.info(`Fallback operation succeeded: ${fallbackName}`, {
                primaryOperationFailed: true,
                fallbackUsed: true
            });

            fallbackWrapper.end('completed', {
                usedFallback: true,
                primaryError: primaryError.message
            });

            return fallbackResult;

        } catch (fallbackError) {
            const fallbackErrorCategory = categorizeError(fallbackError, context);

            logger.error(`Both primary and fallback operations failed`, fallbackError, {
                operationName,
                fallbackName,
                primaryError: primaryError.message,
                fallbackError: fallbackError.message,
                primaryErrorCategory: errorCategory,
                fallbackErrorCategory,
                totalFailure: true
            });

            const combinedError = new Error(
                `Both ${operationName} and ${fallbackName} failed. ` +
                `Primary: ${primaryError.message}. Fallback: ${fallbackError.message}`
            );
            combinedError.primaryError = primaryError;
            combinedError.fallbackError = fallbackError;

            fallbackWrapper.fail(combinedError, {
                primaryError: primaryError.message,
                fallbackError: fallbackError.message,
                bothFailed: true
            });

            throw combinedError;
        }
    }
}

module.exports = {
    ERROR_CATEGORIES,
    RETRY_STRATEGIES,
    DEFAULT_RETRY_CONFIG,
    categorizeError,
    calculateRetryDelay,
    withRetry,
    CircuitBreaker,
    handleUnhandledError,
    withFallback
};