/**
 * Centralized logging utility for Twitter Autobot
 * Provides consistent logging format across all components
 */

/**
 * Log levels for different types of messages
 */
const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

/**
 * Creates a formatted timestamp for log entries
 * @returns {string} ISO timestamp string
 */
function getTimestamp() {
    return new Date().toISOString();
}

/**
 * Formats log messages with consistent structure
 * @param {string} level - Log level (ERROR, WARN, INFO, DEBUG)
 * @param {string} component - Component name (e.g., 'SCRAPER', 'GEMINI', 'TWITTER')
 * @param {string} message - Log message
 * @param {Object} metadata - Additional metadata to include
 * @returns {string} Formatted log message
 */
function formatLogMessage(level, component, message, metadata = {}) {
    const timestamp = getTimestamp();
    const baseMessage = `[${timestamp}] [${level}] [${component}] ${message}`;

    if (Object.keys(metadata).length > 0) {
        return `${baseMessage} | ${JSON.stringify(metadata)}`;
    }

    return baseMessage;
}

/**
 * Logger class with consistent formatting and component tracking
 */
class Logger {
    constructor(component) {
        this.component = component.toUpperCase();
    }

    /**
     * Log error messages
     * @param {string} message - Error message
     * @param {Error|Object} error - Error object or additional metadata
     * @param {Object} metadata - Additional metadata
     */
    error(message, error = null, metadata = {}) {
        const logMetadata = { ...metadata };

        if (error) {
            if (error instanceof Error) {
                logMetadata.error = {
                    message: error.message,
                    stack: error.stack,
                    code: error.code || null
                };
            } else {
                logMetadata.errorDetails = error;
            }
        }

        const formattedMessage = formatLogMessage(LOG_LEVELS.ERROR, this.component, message, logMetadata);
        console.error(formattedMessage);
    }

    /**
     * Log warning messages
     * @param {string} message - Warning message
     * @param {Object} metadata - Additional metadata
     */
    warn(message, metadata = {}) {
        const formattedMessage = formatLogMessage(LOG_LEVELS.WARN, this.component, message, metadata);
        console.warn(formattedMessage);
    }

    /**
     * Log info messages
     * @param {string} message - Info message
     * @param {Object} metadata - Additional metadata
     */
    info(message, metadata = {}) {
        const formattedMessage = formatLogMessage(LOG_LEVELS.INFO, this.component, message, metadata);
        console.log(formattedMessage);
    }

    /**
     * Log debug messages (only in development)
     * @param {string} message - Debug message
     * @param {Object} metadata - Additional metadata
     */
    debug(message, metadata = {}) {
        if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
            const formattedMessage = formatLogMessage(LOG_LEVELS.DEBUG, this.component, message, metadata);
            console.log(formattedMessage);
        }
    }

    /**
     * Log operation start with timing
     * @param {string} operation - Operation name
     * @param {Object} metadata - Additional metadata
     * @returns {Object} Timer object for measuring duration
     */
    startOperation(operation, metadata = {}) {
        const startTime = Date.now();
        const operationId = `${operation}-${startTime}`;

        this.info(`Starting operation: ${operation}`, {
            operationId,
            startTime: getTimestamp(),
            ...metadata
        });

        return {
            operationId,
            startTime,
            end: (result = 'completed', additionalMetadata = {}) => {
                const duration = Date.now() - startTime;
                this.info(`Operation ${result}: ${operation}`, {
                    operationId,
                    duration: `${duration}ms`,
                    ...additionalMetadata
                });
                return duration;
            },
            fail: (error, additionalMetadata = {}) => {
                const duration = Date.now() - startTime;
                this.error(`Operation failed: ${operation}`, error, {
                    operationId,
                    duration: `${duration}ms`,
                    ...additionalMetadata
                });
                return duration;
            }
        };
    }

    /**
     * Log API call details
     * @param {string} apiName - API name (e.g., 'Reddit', 'Twitter', 'Gemini')
     * @param {string} endpoint - API endpoint or operation
     * @param {Object} metadata - Additional metadata
     */
    apiCall(apiName, endpoint, metadata = {}) {
        this.info(`API call: ${apiName}`, {
            endpoint,
            timestamp: getTimestamp(),
            ...metadata
        });
    }

    /**
     * Log API response details
     * @param {string} apiName - API name
     * @param {string} endpoint - API endpoint or operation
     * @param {boolean} success - Whether the call was successful
     * @param {Object} metadata - Additional metadata (response size, status code, etc.)
     */
    apiResponse(apiName, endpoint, success, metadata = {}) {
        const level = success ? 'info' : 'error';
        const status = success ? 'SUCCESS' : 'FAILED';

        this[level](`API response: ${apiName} ${status}`, {
            endpoint,
            success,
            timestamp: getTimestamp(),
            ...metadata
        });
    }

    /**
     * Log data processing results
     * @param {string} operation - Processing operation
     * @param {number} inputCount - Number of input items
     * @param {number} outputCount - Number of output items
     * @param {Object} metadata - Additional metadata
     */
    dataProcessing(operation, inputCount, outputCount, metadata = {}) {
        this.info(`Data processing: ${operation}`, {
            inputCount,
            outputCount,
            processingRate: inputCount > 0 ? `${((outputCount / inputCount) * 100).toFixed(1)}%` : '0%',
            ...metadata
        });
    }
}

/**
 * Creates a logger instance for a specific component
 * @param {string} component - Component name
 * @returns {Logger} Logger instance
 */
function createLogger(component) {
    return new Logger(component);
}

/**
 * Global error handler for unhandled errors
 * @param {Error} error - The unhandled error
 * @param {string} context - Context where the error occurred
 */
function logUnhandledError(error, context = 'UNKNOWN') {
    const logger = createLogger('GLOBAL');
    logger.error(`Unhandled error in ${context}`, error, {
        context,
        pid: process.pid,
        memory: process.memoryUsage(),
        uptime: process.uptime()
    });
}

/**
 * Logs application startup information
 * @param {Object} config - Application configuration
 */
function logStartup(config = {}) {
    const logger = createLogger('STARTUP');
    logger.info('Application starting', {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        environment: process.env.NODE_ENV || 'development',
        port: config.port || 'unknown'
    });
}

/**
 * Logs application shutdown information
 * @param {number} exitCode - Process exit code
 * @param {string} reason - Shutdown reason
 */
function logShutdown(exitCode = 0, reason = 'normal') {
    const logger = createLogger('SHUTDOWN');
    logger.info('Application shutting down', {
        exitCode,
        reason,
        uptime: `${process.uptime()}s`,
        memory: process.memoryUsage()
    });
}

module.exports = {
    Logger,
    createLogger,
    logUnhandledError,
    logStartup,
    logShutdown,
    LOG_LEVELS
};