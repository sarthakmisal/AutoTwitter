/**
 * Express health check server for Twitter Autobot
 * Provides health monitoring endpoint for deployment platforms like Render
 */

const express = require('express');
const { getConfig } = require('./config');
const { createLogger } = require('./logger');
const { categorizeError, ERROR_CATEGORIES } = require('./error-handler');

const logger = createLogger('SERVER');

/**
 * Creates and configures Express server with health check endpoint
 * @returns {Object} Express app instance
 */
function createServer() {
    const operation = logger.startOperation('Express server creation');

    try {
        const app = express();

        // Middleware for JSON parsing (if needed for future endpoints)
        app.use(express.json());

        // Request logging middleware
        app.use((req, res, next) => {
            logger.info('HTTP request received', {
                method: req.method,
                url: req.url,
                userAgent: req.get('User-Agent'),
                ip: req.ip || req.connection.remoteAddress
            });
            next();
        });

        // Health check endpoint with enhanced error handling
        app.get('/health', (req, res) => {
            const healthOperation = logger.startOperation('Health check request');

            try {
                const memUsage = process.memoryUsage();
                const healthStatus = {
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    uptime: process.uptime(),
                    service: 'twitter-autobot',
                    version: process.env.npm_package_version || '1.0.0',
                    memory: {
                        used: Math.round(memUsage.heapUsed / 1024 / 1024),
                        total: Math.round(memUsage.heapTotal / 1024 / 1024),
                        rss: Math.round(memUsage.rss / 1024 / 1024),
                        external: Math.round(memUsage.external / 1024 / 1024)
                    },
                    system: {
                        nodeVersion: process.version,
                        platform: process.platform,
                        arch: process.arch,
                        pid: process.pid
                    },
                    environment: process.env.NODE_ENV || 'development'
                };

                // Add health warnings if needed
                const warnings = [];
                if (healthStatus.memory.used > 500) {
                    warnings.push('High memory usage detected');
                }
                if (healthStatus.uptime < 60) {
                    warnings.push('Service recently restarted');
                }

                if (warnings.length > 0) {
                    healthStatus.warnings = warnings;
                    healthStatus.status = 'healthy-with-warnings';
                }

                logger.info('Health check requested', {
                    status: healthStatus.status,
                    uptime: healthStatus.uptime,
                    memoryUsed: healthStatus.memory.used,
                    warnings: warnings.length,
                    requestIp: req.ip || req.connection.remoteAddress
                });

                healthOperation.end('completed', {
                    status: healthStatus.status,
                    warnings: warnings.length
                });

                res.status(200).json(healthStatus);

            } catch (error) {
                const errorCategory = categorizeError(error);

                logger.error('Error in health check endpoint', error, {
                    errorCategory,
                    requestIp: req.ip || req.connection.remoteAddress,
                    userAgent: req.get('User-Agent')
                });

                healthOperation.fail(error, { errorCategory });

                res.status(500).json({
                    status: 'error',
                    timestamp: new Date().toISOString(),
                    error: 'Health check failed',
                    message: 'Unable to determine service health',
                    suggestion: 'Check service logs for details'
                });
            }
        });

        // Root endpoint for basic service info
        app.get('/', (req, res) => {
            try {
                const serviceInfo = {
                    service: 'Twitter Autobot',
                    status: 'running',
                    timestamp: new Date().toISOString(),
                    description: 'Automated Twitter bot that posts viral tweets based on trending topics',
                    endpoints: {
                        health: '/health',
                        info: '/'
                    }
                };

                logger.info('Service info requested');
                res.status(200).json(serviceInfo);
            } catch (error) {
                logger.error('Error in service info endpoint', error);
                res.status(500).json({
                    error: 'Internal server error',
                    timestamp: new Date().toISOString()
                });
            }
        });

        // 404 handler for unknown routes
        app.use('*', (req, res) => {
            logger.warn('404 - Route not found', {
                method: req.method,
                url: req.url,
                userAgent: req.get('User-Agent')
            });

            res.status(404).json({
                error: 'Not Found',
                message: 'The requested endpoint does not exist',
                timestamp: new Date().toISOString(),
                availableEndpoints: ['/health', '/']
            });
        });

        // Global error handler with enhanced error analysis
        app.use((error, req, res, next) => {
            const errorCategory = categorizeError(error);
            const errorId = `err-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            logger.error('Unhandled Express error', error, {
                errorId,
                errorCategory,
                method: req.method,
                url: req.url,
                userAgent: req.get('User-Agent'),
                ip: req.ip || req.connection.remoteAddress,
                headers: req.headers,
                body: req.body,
                params: req.params,
                query: req.query
            });

            // Determine appropriate status code based on error type
            let statusCode = 500;
            let errorMessage = 'An unexpected error occurred';

            switch (errorCategory) {
                case ERROR_CATEGORIES.VALIDATION:
                    statusCode = 400;
                    errorMessage = 'Invalid request data';
                    break;
                case ERROR_CATEGORIES.AUTHENTICATION:
                    statusCode = 401;
                    errorMessage = 'Authentication required';
                    break;
                case ERROR_CATEGORIES.NETWORK:
                    statusCode = 503;
                    errorMessage = 'Service temporarily unavailable';
                    break;
                default:
                    statusCode = 500;
                    errorMessage = 'Internal server error';
            }

            res.status(statusCode).json({
                error: errorMessage,
                errorId,
                message: 'An error occurred while processing your request',
                timestamp: new Date().toISOString(),
                suggestion: 'Please try again later or contact support if the problem persists'
            });
        });

        logger.info('Express server created successfully', {
            middlewareCount: app._router ? app._router.stack.length : 0,
            endpoints: ['/health', '/', '*']
        });

        operation.end('completed');
        return app;

    } catch (error) {
        logger.error('Failed to create Express server', error);
        operation.fail(error);
        throw error;
    }
}

/**
 * Starts the Express server on the configured port
 * @param {Object} config - Configuration object with server settings
 * @returns {Promise<Object>} Promise that resolves to server instance
 */
function startServer(config = null) {
    return new Promise((resolve, reject) => {
        const operation = logger.startOperation('Express server startup');

        try {
            // Load config if not provided
            if (!config) {
                config = getConfig();
            }

            const app = createServer();
            const port = config.server.port;

            logger.info('Starting Express server', {
                port,
                environment: process.env.NODE_ENV || 'development'
            });

            const server = app.listen(port, (err) => {
                if (err) {
                    logger.error('Failed to start Express server', err, { port });
                    operation.fail(err, { port });
                    reject(err);
                    return;
                }

                const actualPort = server.address().port;

                logger.info('Express server started successfully', {
                    port: actualPort,
                    address: server.address(),
                    maxConnections: server.maxConnections
                });

                operation.end('completed', { port: actualPort });
                resolve({ app, server, port: actualPort });
            });

            // Handle server errors
            server.on('error', (error) => {
                const errorMetadata = {
                    port,
                    errorCode: error.code,
                    errorType: error.name
                };

                if (error.code === 'EADDRINUSE') {
                    logger.error(`Port ${port} is already in use`, error, errorMetadata);
                } else if (error.code === 'EACCES') {
                    logger.error(`Permission denied to bind to port ${port}`, error, errorMetadata);
                } else {
                    logger.error('Server error occurred', error, errorMetadata);
                }

                operation.fail(error, errorMetadata);
                reject(error);
            });

            // Handle server connection events
            server.on('connection', (socket) => {
                logger.debug('New connection established', {
                    remoteAddress: socket.remoteAddress,
                    remotePort: socket.remotePort
                });
            });

        } catch (error) {
            logger.error('Failed to create server', error);
            operation.fail(error);
            reject(error);
        }
    });
}

/**
 * Gracefully stops the server
 * @param {Object} server - Server instance to stop
 * @returns {Promise<void>}
 */
function stopServer(server) {
    return new Promise((resolve) => {
        const operation = logger.startOperation('Express server shutdown');

        if (server) {
            logger.info('Stopping Express server');

            // Set a timeout for forceful shutdown if graceful shutdown takes too long
            const forceShutdownTimeout = setTimeout(() => {
                logger.warn('Forcing server shutdown due to timeout');
                server.destroy();
                operation.end('completed with force', { forcedShutdown: true });
                resolve();
            }, 10000); // 10 second timeout

            server.close((error) => {
                clearTimeout(forceShutdownTimeout);

                if (error) {
                    logger.error('Error during server shutdown', error);
                    operation.fail(error);
                } else {
                    logger.info('Express server stopped gracefully');
                    operation.end('completed');
                }

                resolve();
            });
        } else {
            logger.warn('No server instance provided to stop');
            operation.end('completed', { noServerToStop: true });
            resolve();
        }
    });
}

module.exports = {
    createServer,
    startServer,
    stopServer
};