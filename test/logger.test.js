/**
 * Unit tests for the centralized logging utility
 */

const { Logger, createLogger, logUnhandledError, logStartup, logShutdown, LOG_LEVELS } = require('../src/logger');

describe('Logger Utility', () => {
    let consoleLogSpy;
    let consoleErrorSpy;
    let consoleWarnSpy;

    beforeEach(() => {
        // Mock console methods
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
        // Restore console methods
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    describe('Logger Class', () => {
        let logger;

        beforeEach(() => {
            logger = new Logger('TEST');
        });

        test('should create logger with component name', () => {
            expect(logger.component).toBe('TEST');
        });

        test('should log error messages with proper format', () => {
            const error = new Error('Test error');
            logger.error('Test error message', error);

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            const loggedMessage = consoleErrorSpy.mock.calls[0][0];

            expect(loggedMessage).toContain('[ERROR]');
            expect(loggedMessage).toContain('[TEST]');
            expect(loggedMessage).toContain('Test error message');
            expect(loggedMessage).toContain('Test error');
        });

        test('should log warning messages with proper format', () => {
            logger.warn('Test warning message', { key: 'value' });

            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            const loggedMessage = consoleWarnSpy.mock.calls[0][0];

            expect(loggedMessage).toContain('[WARN]');
            expect(loggedMessage).toContain('[TEST]');
            expect(loggedMessage).toContain('Test warning message');
            expect(loggedMessage).toContain('{"key":"value"}');
        });

        test('should log info messages with proper format', () => {
            logger.info('Test info message');

            expect(consoleLogSpy).toHaveBeenCalledTimes(1);
            const loggedMessage = consoleLogSpy.mock.calls[0][0];

            expect(loggedMessage).toContain('[INFO]');
            expect(loggedMessage).toContain('[TEST]');
            expect(loggedMessage).toContain('Test info message');
        });

        test('should handle debug messages based on environment', () => {
            const originalEnv = process.env.NODE_ENV;

            // Test production environment (should not log debug)
            process.env.NODE_ENV = 'production';
            logger.debug('Debug message');
            expect(consoleLogSpy).not.toHaveBeenCalled();

            // Test development environment (should log debug)
            process.env.NODE_ENV = 'development';
            logger.debug('Debug message');
            expect(consoleLogSpy).toHaveBeenCalledTimes(1);

            // Restore environment
            process.env.NODE_ENV = originalEnv;
        });

        test('should handle operation timing', () => {
            const timer = logger.startOperation('Test operation', { key: 'value' });

            expect(consoleLogSpy).toHaveBeenCalledTimes(1);
            expect(consoleLogSpy.mock.calls[0][0]).toContain('Starting operation: Test operation');

            // End operation
            const duration = timer.end('completed', { result: 'success' });

            expect(consoleLogSpy).toHaveBeenCalledTimes(2);
            expect(consoleLogSpy.mock.calls[1][0]).toContain('Operation completed: Test operation');
            expect(typeof duration).toBe('number');
            expect(duration).toBeGreaterThanOrEqual(0);
        });

        test('should handle operation failures', () => {
            const timer = logger.startOperation('Test operation');
            const error = new Error('Operation failed');

            const duration = timer.fail(error, { context: 'test' });

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy.mock.calls[0][0]).toContain('Operation failed: Test operation');
            expect(typeof duration).toBe('number');
        });

        test('should log API calls', () => {
            logger.apiCall('TestAPI', '/test/endpoint', { param: 'value' });

            expect(consoleLogSpy).toHaveBeenCalledTimes(1);
            const loggedMessage = consoleLogSpy.mock.calls[0][0];

            expect(loggedMessage).toContain('API call: TestAPI');
            expect(loggedMessage).toContain('/test/endpoint');
        });

        test('should log API responses', () => {
            logger.apiResponse('TestAPI', '/test/endpoint', true, { statusCode: 200 });

            expect(consoleLogSpy).toHaveBeenCalledTimes(1);
            const loggedMessage = consoleLogSpy.mock.calls[0][0];

            expect(loggedMessage).toContain('API response: TestAPI SUCCESS');

            // Test failed response
            logger.apiResponse('TestAPI', '/test/endpoint', false, { statusCode: 500 });

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            const errorMessage = consoleErrorSpy.mock.calls[0][0];

            expect(errorMessage).toContain('API response: TestAPI FAILED');
        });

        test('should log data processing results', () => {
            logger.dataProcessing('Test processing', 10, 8, { source: 'test' });

            expect(consoleLogSpy).toHaveBeenCalledTimes(1);
            const loggedMessage = consoleLogSpy.mock.calls[0][0];

            expect(loggedMessage).toContain('Data processing: Test processing');
            expect(loggedMessage).toContain('"inputCount":10');
            expect(loggedMessage).toContain('"outputCount":8');
            expect(loggedMessage).toContain('"processingRate":"80.0%"');
        });

        test('should handle errors without error objects', () => {
            logger.error('Simple error message');

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            const loggedMessage = consoleErrorSpy.mock.calls[0][0];

            expect(loggedMessage).toContain('[ERROR]');
            expect(loggedMessage).toContain('Simple error message');
        });

        test('should handle non-Error objects as error details', () => {
            const errorDetails = { code: 500, message: 'Server error' };
            logger.error('API error', errorDetails);

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            const loggedMessage = consoleErrorSpy.mock.calls[0][0];

            expect(loggedMessage).toContain('API error');
            expect(loggedMessage).toContain('"errorDetails"');
        });
    });

    describe('createLogger function', () => {
        test('should create logger instance with component name', () => {
            const logger = createLogger('CUSTOM');

            expect(logger).toBeInstanceOf(Logger);
            expect(logger.component).toBe('CUSTOM');
        });

        test('should convert component name to uppercase', () => {
            const logger = createLogger('lowercase');

            expect(logger.component).toBe('LOWERCASE');
        });
    });

    describe('Global logging functions', () => {
        test('should log unhandled errors', () => {
            const error = new Error('Unhandled error');
            logUnhandledError(error, 'TEST_CONTEXT');

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            const loggedMessage = consoleErrorSpy.mock.calls[0][0];

            expect(loggedMessage).toContain('[GLOBAL]');
            expect(loggedMessage).toContain('Unhandled error in TEST_CONTEXT');
            expect(loggedMessage).toContain('Unhandled error');
        });

        test('should log startup information', () => {
            logStartup({ port: 3000 });

            expect(consoleLogSpy).toHaveBeenCalledTimes(1);
            const loggedMessage = consoleLogSpy.mock.calls[0][0];

            expect(loggedMessage).toContain('[STARTUP]');
            expect(loggedMessage).toContain('Application starting');
            expect(loggedMessage).toContain('"port":3000');
        });

        test('should log shutdown information', () => {
            logShutdown(0, 'normal');

            expect(consoleLogSpy).toHaveBeenCalledTimes(1);
            const loggedMessage = consoleLogSpy.mock.calls[0][0];

            expect(loggedMessage).toContain('[SHUTDOWN]');
            expect(loggedMessage).toContain('Application shutting down');
            expect(loggedMessage).toContain('"exitCode":0');
            expect(loggedMessage).toContain('"reason":"normal"');
        });
    });

    describe('LOG_LEVELS constant', () => {
        test('should export correct log levels', () => {
            expect(LOG_LEVELS.ERROR).toBe('ERROR');
            expect(LOG_LEVELS.WARN).toBe('WARN');
            expect(LOG_LEVELS.INFO).toBe('INFO');
            expect(LOG_LEVELS.DEBUG).toBe('DEBUG');
        });
    });

    describe('Message formatting', () => {
        test('should include timestamp in log messages', () => {
            const logger = createLogger('TEST');
            logger.info('Test message');

            const loggedMessage = consoleLogSpy.mock.calls[0][0];

            // Check for ISO timestamp format
            expect(loggedMessage).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
        });

        test('should format messages consistently', () => {
            const logger = createLogger('TEST');
            logger.info('Test message', { key: 'value' });

            const loggedMessage = consoleLogSpy.mock.calls[0][0];

            // Check format: [timestamp] [level] [component] message | metadata
            expect(loggedMessage).toMatch(/\[.*\] \[INFO\] \[TEST\] Test message \| \{"key":"value"\}/);
        });

        test('should handle messages without metadata', () => {
            const logger = createLogger('TEST');
            logger.info('Simple message');

            const loggedMessage = consoleLogSpy.mock.calls[0][0];

            // Should not include metadata separator when no metadata
            expect(loggedMessage).not.toContain(' | ');
            expect(loggedMessage).toMatch(/\[.*\] \[INFO\] \[TEST\] Simple message$/);
        });
    });
});