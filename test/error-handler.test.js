/**
 * Tests for enhanced error handling utilities
 */

const {
    ERROR_CATEGORIES,
    RETRY_STRATEGIES,
    categorizeError,
    calculateRetryDelay,
    withRetry,
    CircuitBreaker,
    handleUnhandledError,
    withFallback
} = require('../src/error-handler');

// Mock the logger
jest.mock('../src/logger', () => ({
    createLogger: jest.fn(() => ({
        startOperation: jest.fn(() => ({
            end: jest.fn(),
            fail: jest.fn()
        })),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

describe('Error Handler Utilities', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Mock console methods to avoid noise in tests
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        console.log.mockRestore();
        console.warn.mockRestore();
        console.error.mockRestore();
    });

    describe('categorizeError', () => {
        test('should categorize network errors correctly', () => {
            const networkError = new Error('Network error');
            networkError.code = 'ENOTFOUND';

            const category = categorizeError(networkError);
            expect(category).toBe(ERROR_CATEGORIES.NETWORK);
        });

        test('should categorize timeout errors correctly', () => {
            const timeoutError = new Error('timeout of 5000ms exceeded');
            timeoutError.code = 'ECONNABORTED';

            const category = categorizeError(timeoutError);
            expect(category).toBe(ERROR_CATEGORIES.TIMEOUT);
        });

        test('should categorize authentication errors correctly', () => {
            const authError = new Error('Unauthorized');
            authError.response = { status: 401 };

            const category = categorizeError(authError);
            expect(category).toBe(ERROR_CATEGORIES.AUTHENTICATION);
        });

        test('should categorize rate limit errors correctly', () => {
            const rateLimitError = new Error('Too many requests');
            rateLimitError.response = { status: 429 };

            const category = categorizeError(rateLimitError);
            expect(category).toBe(ERROR_CATEGORIES.API_LIMIT);
        });

        test('should categorize server errors correctly', () => {
            const serverError = new Error('Internal server error');
            serverError.response = { status: 500 };

            const category = categorizeError(serverError);
            expect(category).toBe(ERROR_CATEGORIES.SERVER_ERROR);
        });

        test('should categorize validation errors correctly', () => {
            const validationError = new Error('Invalid input provided');

            const category = categorizeError(validationError);
            expect(category).toBe(ERROR_CATEGORIES.VALIDATION);
        });

        test('should categorize unknown errors as unknown', () => {
            const unknownError = new Error('Some random error');

            const category = categorizeError(unknownError);
            expect(category).toBe(ERROR_CATEGORIES.UNKNOWN);
        });
    });

    describe('calculateRetryDelay', () => {
        test('should calculate exponential backoff correctly', () => {
            const delay1 = calculateRetryDelay(RETRY_STRATEGIES.EXPONENTIAL_BACKOFF, 1, 1000, 10000);
            const delay2 = calculateRetryDelay(RETRY_STRATEGIES.EXPONENTIAL_BACKOFF, 2, 1000, 10000);
            const delay3 = calculateRetryDelay(RETRY_STRATEGIES.EXPONENTIAL_BACKOFF, 3, 1000, 10000);

            expect(delay1).toBeGreaterThanOrEqual(1000);
            expect(delay1).toBeLessThan(1200); // With jitter
            expect(delay2).toBeGreaterThanOrEqual(2000);
            expect(delay2).toBeLessThan(2400);
            expect(delay3).toBeGreaterThanOrEqual(4000);
            expect(delay3).toBeLessThan(4800);
        });

        test('should calculate linear backoff correctly', () => {
            const delay1 = calculateRetryDelay(RETRY_STRATEGIES.LINEAR_BACKOFF, 1, 1000, 10000);
            const delay2 = calculateRetryDelay(RETRY_STRATEGIES.LINEAR_BACKOFF, 2, 1000, 10000);
            const delay3 = calculateRetryDelay(RETRY_STRATEGIES.LINEAR_BACKOFF, 3, 1000, 10000);

            expect(delay1).toBeGreaterThanOrEqual(1000);
            expect(delay1).toBeLessThan(1200);
            expect(delay2).toBeGreaterThanOrEqual(2000);
            expect(delay2).toBeLessThan(2400);
            expect(delay3).toBeGreaterThanOrEqual(3000);
            expect(delay3).toBeLessThan(3600);
        });

        test('should respect maximum delay', () => {
            const delay = calculateRetryDelay(RETRY_STRATEGIES.EXPONENTIAL_BACKOFF, 10, 1000, 5000);
            expect(delay).toBeLessThanOrEqual(5500); // Max + jitter
        });

        test('should return 0 for immediate strategy', () => {
            const delay = calculateRetryDelay(RETRY_STRATEGIES.IMMEDIATE, 1, 1000, 10000);
            expect(delay).toBe(0);
        });

        test('should return 0 for no retry strategy', () => {
            const delay = calculateRetryDelay(RETRY_STRATEGIES.NO_RETRY, 1, 1000, 10000);
            expect(delay).toBe(0);
        });
    });

    describe('withRetry', () => {
        test('should succeed on first attempt', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');

            const result = await withRetry(mockOperation, {
                operationName: 'test operation'
            });

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        test('should retry on failure and eventually succeed', async () => {
            const mockOperation = jest.fn()
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce('success');

            // Mock setTimeout to avoid delays in tests
            jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
                callback();
                return 123;
            });

            const result = await withRetry(mockOperation, {
                operationName: 'test operation',
                retryConfig: {
                    maxRetries: 2,
                    strategy: RETRY_STRATEGIES.IMMEDIATE,
                    baseDelay: 0,
                    maxDelay: 0
                }
            });

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledTimes(2);

            setTimeout.mockRestore();
        });

        test('should fail after exhausting retries', async () => {
            const mockOperation = jest.fn().mockRejectedValue(new Error('Persistent error'));

            await expect(withRetry(mockOperation, {
                operationName: 'test operation',
                retryConfig: {
                    maxRetries: 2,
                    strategy: RETRY_STRATEGIES.IMMEDIATE,
                    baseDelay: 0,
                    maxDelay: 0
                }
            })).rejects.toThrow('test operation failed after 3 attempts');

            expect(mockOperation).toHaveBeenCalledTimes(3);
        });

        test('should not retry for authentication errors', async () => {
            const authError = new Error('Unauthorized');
            authError.response = { status: 401 };
            const mockOperation = jest.fn().mockRejectedValue(authError);

            await expect(withRetry(mockOperation, {
                operationName: 'test operation'
            })).rejects.toThrow('Unauthorized');

            expect(mockOperation).toHaveBeenCalledTimes(1);
        });
    });

    describe('CircuitBreaker', () => {
        test('should allow operations when circuit is closed', async () => {
            const circuitBreaker = new CircuitBreaker('test', {
                failureThreshold: 3,
                resetTimeout: 1000
            });

            const mockOperation = jest.fn().mockResolvedValue('success');

            const result = await circuitBreaker.execute(mockOperation);

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledTimes(1);
            expect(circuitBreaker.getStatus().state).toBe('CLOSED');
        });

        test('should open circuit after failure threshold', async () => {
            const circuitBreaker = new CircuitBreaker('test', {
                failureThreshold: 2,
                resetTimeout: 1000
            });

            const mockOperation = jest.fn().mockRejectedValue(new Error('Operation failed'));

            // First failure
            await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow('Operation failed');
            expect(circuitBreaker.getStatus().state).toBe('CLOSED');

            // Second failure - should open circuit
            await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow('Operation failed');
            expect(circuitBreaker.getStatus().state).toBe('OPEN');

            // Third attempt should be blocked
            await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow('Circuit breaker test is OPEN');
            expect(mockOperation).toHaveBeenCalledTimes(2); // Should not call operation when circuit is open
        });

        test('should transition to half-open after reset timeout', async () => {
            const circuitBreaker = new CircuitBreaker('test', {
                failureThreshold: 1,
                resetTimeout: 100 // Short timeout for testing
            });

            const mockOperation = jest.fn()
                .mockRejectedValueOnce(new Error('Operation failed'))
                .mockResolvedValueOnce('success');

            // Cause circuit to open
            await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow('Operation failed');
            expect(circuitBreaker.getStatus().state).toBe('OPEN');

            // Wait for reset timeout
            await new Promise(resolve => setTimeout(resolve, 150));

            // Next operation should succeed and close circuit
            const result = await circuitBreaker.execute(mockOperation);
            expect(result).toBe('success');
            expect(circuitBreaker.getStatus().state).toBe('CLOSED');
        });

        test('should provide accurate status information', () => {
            const circuitBreaker = new CircuitBreaker('test', {
                failureThreshold: 3,
                resetTimeout: 5000
            });

            const status = circuitBreaker.getStatus();

            expect(status).toHaveProperty('name', 'test');
            expect(status).toHaveProperty('state', 'CLOSED');
            expect(status).toHaveProperty('recentFailures', 0);
            expect(status).toHaveProperty('failureThreshold', 3);
            expect(status).toHaveProperty('lastFailureTime', null);
            expect(status).toHaveProperty('nextAttemptTime', null);
            expect(status).toHaveProperty('timeUntilReset', 0);
        });

        test('should reset circuit manually', async () => {
            const circuitBreaker = new CircuitBreaker('test', {
                failureThreshold: 1,
                resetTimeout: 10000
            });

            const mockOperation = jest.fn().mockRejectedValue(new Error('Operation failed'));

            // Open circuit
            await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow('Operation failed');
            expect(circuitBreaker.getStatus().state).toBe('OPEN');

            // Manual reset
            circuitBreaker.reset();
            expect(circuitBreaker.getStatus().state).toBe('CLOSED');
            expect(circuitBreaker.getStatus().recentFailures).toBe(0);
        });
    });

    describe('withFallback', () => {
        test('should use primary operation when it succeeds', async () => {
            const primaryOperation = jest.fn().mockResolvedValue('primary success');
            const fallbackOperation = jest.fn().mockResolvedValue('fallback success');

            const result = await withFallback(primaryOperation, fallbackOperation, {
                operationName: 'test operation',
                fallbackName: 'test fallback'
            });

            expect(result).toBe('primary success');
            expect(primaryOperation).toHaveBeenCalledTimes(1);
            expect(fallbackOperation).not.toHaveBeenCalled();
        });

        test('should use fallback when primary fails', async () => {
            const primaryOperation = jest.fn().mockRejectedValue(new Error('Primary failed'));
            const fallbackOperation = jest.fn().mockResolvedValue('fallback success');

            const result = await withFallback(primaryOperation, fallbackOperation, {
                operationName: 'test operation',
                fallbackName: 'test fallback'
            });

            expect(result).toBe('fallback success');
            expect(primaryOperation).toHaveBeenCalledTimes(1);
            expect(fallbackOperation).toHaveBeenCalledTimes(1);
        });

        test('should throw error when both primary and fallback fail', async () => {
            const primaryOperation = jest.fn().mockRejectedValue(new Error('Primary failed'));
            const fallbackOperation = jest.fn().mockRejectedValue(new Error('Fallback failed'));

            await expect(withFallback(primaryOperation, fallbackOperation, {
                operationName: 'test operation',
                fallbackName: 'test fallback'
            })).rejects.toThrow('Both test operation and test fallback failed');

            expect(primaryOperation).toHaveBeenCalledTimes(1);
            expect(fallbackOperation).toHaveBeenCalledTimes(1);
        });
    });

    describe('handleUnhandledError', () => {
        test('should log unhandled error with proper categorization', () => {
            const error = new Error('Test unhandled error');
            const mockLogger = require('../src/logger').createLogger();

            handleUnhandledError(error, 'TEST_CONTEXT', { testMetadata: 'value' });

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Unhandled error detected',
                error,
                expect.objectContaining({
                    context: 'TEST_CONTEXT',
                    errorCategory: ERROR_CATEGORIES.UNKNOWN,
                    testMetadata: 'value'
                })
            );
        });

        test('should log to console for visibility', () => {
            const error = new Error('Test unhandled error');

            handleUnhandledError(error, 'TEST_CONTEXT');

            expect(console.error).toHaveBeenCalledWith('\n💥 UNHANDLED ERROR DETECTED 💥');
            expect(console.error).toHaveBeenCalledWith('Context: TEST_CONTEXT');
            expect(console.error).toHaveBeenCalledWith('Error: Test unhandled error');
        });
    });
});