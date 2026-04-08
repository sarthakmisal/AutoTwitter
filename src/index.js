/**
 * Main application entry point for Twitter Autobot
 * Initializes Express server and cron scheduler to run simultaneously
 * Handles application lifecycle management and graceful shutdown
 */

// Load environment variables first
require('dotenv').config();

const { validateConfig } = require('./config');
const { startServer, stopServer } = require('./server');
const { initializeCronScheduler, stopCronScheduler, getCronStatus } = require('./cron');
const { createLogger, logStartup, logShutdown, logUnhandledError } = require('./logger');
const { handleUnhandledError, withRetry, categorizeError, ERROR_CATEGORIES } = require('./error-handler');

const logger = createLogger('MAIN');

// Global references for cleanup
let serverInstance = null;
let cronTask = null;
let isShuttingDown = false;

/**
 * Main application startup sequence
 * Initializes configuration, starts server, and sets up cron scheduler
 */
async function startApplication() {
    const operation = logger.startOperation('Application startup');

    try {
        // Log startup information
        logStartup({ port: process.env.PORT || 3000 });

        // Step 1: Validate configuration
        logger.info('Validating configuration');
        const config = validateConfig();

        // Step 2: Start Express health check server
        logger.info('Starting health check server');
        serverInstance = await startServer(config);

        // Step 3: Initialize cron scheduler
        logger.info('Initializing cron scheduler');
        cronTask = initializeCronScheduler();

        // Step 4: Application ready
        const cronStatus = getCronStatus(cronTask);

        const startupSummary = {
            serverPort: serverInstance.port,
            cronScheduled: true,
            nextExecution: cronStatus.nextExecutionIST,
            timeUntilNext: cronStatus.timeUntilNextFormatted,
            processId: process.pid,
            nodeVersion: process.version,
            environment: process.env.NODE_ENV || 'development'
        };

        logger.info('Twitter Autobot started successfully', startupSummary);

        // Display user-friendly status (keeping some console.log for user visibility)
        console.log('\n=== Twitter Autobot Started Successfully ===');
        console.log(`✓ Health server running on port ${serverInstance.port}`);
        console.log('✓ Cron scheduler initialized and running');
        console.log(`✓ Next tweet scheduled for: ${cronStatus.nextExecutionIST} IST`);
        console.log(`✓ Time until next execution: ${cronStatus.timeUntilNextFormatted}`);
        console.log('\n📊 Service Status:');
        console.log(`   Health endpoint: http://localhost:${serverInstance.port}/health`);
        console.log(`   Service info: http://localhost:${serverInstance.port}/`);
        console.log('   Cron job: Active (14:30 UTC daily)');
        console.log('\n🎯 Application is ready and running!');
        console.log('Press Ctrl+C to gracefully shutdown the application\n');

        operation.end('completed', startupSummary);
        return true;

    } catch (error) {
        logger.error('Failed to start Twitter Autobot', error, {
            startupStep: 'unknown',
            processId: process.pid,
            nodeVersion: process.version
        });

        // Display user-friendly error (keeping console.error for visibility)
        console.error('\n❌ Failed to start Twitter Autobot:');
        console.error(`Error: ${error.message}`);

        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }

        operation.fail(error);

        // Cleanup any partially initialized components
        await gracefulShutdown(1);
        return false;
    }
}

/**
 * Graceful shutdown handler
 * Stops cron scheduler and server in proper order
 * @param {number} exitCode - Process exit code (0 = success, 1 = error)
 */
async function gracefulShutdown(exitCode = 0) {
    if (isShuttingDown) {
        logger.warn('Shutdown already in progress', { exitCode });
        return;
    }

    isShuttingDown = true;
    const operation = logger.startOperation('Application shutdown', { exitCode });

    try {
        logger.info('Initiating graceful shutdown', {
            exitCode,
            reason: exitCode === 0 ? 'normal' : 'error',
            uptime: process.uptime()
        });

        // Step 1: Stop cron scheduler first to prevent new jobs
        if (cronTask) {
            logger.info('Stopping cron scheduler');
            stopCronScheduler(cronTask);
            cronTask = null;
        }

        // Step 2: Stop Express server
        if (serverInstance && serverInstance.server) {
            logger.info('Stopping health check server');
            await stopServer(serverInstance.server);
            serverInstance = null;
        }

        logger.info('Graceful shutdown completed successfully', {
            exitCode,
            finalUptime: process.uptime()
        });

        // Log shutdown information
        logShutdown(exitCode, exitCode === 0 ? 'normal' : 'error');

        operation.end('completed', { exitCode });

        // Display user-friendly message
        console.log('✓ Graceful shutdown completed');
        console.log(`Application stopped at: ${new Date().toISOString()}`);

    } catch (error) {
        logger.error('Error during shutdown', error, {
            exitCode,
            shutdownStep: 'unknown'
        });

        console.error('Error during shutdown:', error.message);
        operation.fail(error, { exitCode });
        exitCode = 1;
    }

    // Exit the process
    process.exit(exitCode);
}

/**
 * Setup process signal handlers for graceful shutdown with enhanced error handling
 */
function setupSignalHandlers() {
    logger.info('Setting up signal handlers for graceful shutdown');

    // Handle Ctrl+C (SIGINT)
    process.on('SIGINT', () => {
        logger.info('Received SIGINT (Ctrl+C)', { signal: 'SIGINT' });
        console.log('\nReceived SIGINT (Ctrl+C)');
        gracefulShutdown(0);
    });

    // Handle termination signal (SIGTERM) - used by process managers
    process.on('SIGTERM', () => {
        logger.info('Received SIGTERM', { signal: 'SIGTERM' });
        console.log('\nReceived SIGTERM');
        gracefulShutdown(0);
    });

    // Handle uncaught exceptions with enhanced error analysis
    process.on('uncaughtException', (error) => {
        const errorCategory = categorizeError(error);

        handleUnhandledError(error, 'UNCAUGHT_EXCEPTION', {
            processId: process.pid,
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime(),
            errorCategory,
            nodeVersion: process.version,
            platform: process.platform,
            serverRunning: !!serverInstance,
            cronRunning: !!cronTask
        });

        console.error('\n💥 UNCAUGHT EXCEPTION DETECTED 💥');
        console.error(`Error: ${error.message}`);
        console.error(`Category: ${errorCategory}`);
        console.error(`Stack: ${error.stack}`);
        console.error(`Time: ${new Date().toISOString()}`);
        console.error('Application will shutdown to prevent corruption...\n');

        gracefulShutdown(1);
    });

    // Handle unhandled promise rejections with enhanced error analysis
    process.on('unhandledRejection', (reason, promise) => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        const errorCategory = categorizeError(error);

        handleUnhandledError(error, 'UNHANDLED_REJECTION', {
            promise: promise.toString(),
            reason: String(reason),
            processId: process.pid,
            errorCategory,
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime(),
            serverRunning: !!serverInstance,
            cronRunning: !!cronTask
        });

        console.error('\n💥 UNHANDLED PROMISE REJECTION DETECTED 💥');
        console.error(`Promise: ${promise}`);
        console.error(`Reason: ${reason}`);
        console.error(`Category: ${errorCategory}`);
        console.error(`Time: ${new Date().toISOString()}`);
        console.error('Application will shutdown to prevent corruption...\n');

        gracefulShutdown(1);
    });

    // Handle warning events (Node.js warnings)
    process.on('warning', (warning) => {
        logger.warn('Node.js warning detected', {
            warningName: warning.name,
            warningMessage: warning.message,
            warningStack: warning.stack,
            processId: process.pid
        });

        // Log deprecation warnings separately for visibility
        if (warning.name === 'DeprecationWarning') {
            logger.warn('Deprecation warning - code update may be needed', {
                deprecatedFeature: warning.message,
                stack: warning.stack
            });
        }
    });

    // Handle memory warnings (if available)
    if (process.memoryUsage) {
        setInterval(() => {
            const memUsage = process.memoryUsage();
            const memUsageMB = {
                rss: Math.round(memUsage.rss / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                external: Math.round(memUsage.external / 1024 / 1024)
            };

            // Log warning if memory usage is high
            if (memUsageMB.heapUsed > 500) { // 500MB threshold
                logger.warn('High memory usage detected', {
                    memoryUsage: memUsageMB,
                    uptime: process.uptime(),
                    threshold: '500MB'
                });
            }

            // Log memory stats periodically for monitoring
            logger.debug('Memory usage stats', {
                memoryUsage: memUsageMB,
                uptime: process.uptime()
            });
        }, 300000); // Check every 5 minutes
    }

    logger.info('Signal handlers configured successfully', {
        handlers: ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection', 'warning'],
        memoryMonitoring: !!process.memoryUsage
    });
}

/**
 * Application health check function
 * Returns current status of all components
 * @returns {Object} Health status object
 */
function getApplicationHealth() {
    const cronStatus = cronTask ? getCronStatus(cronTask) : { isRunning: false };

    return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        components: {
            server: {
                status: serverInstance ? 'running' : 'stopped',
                port: serverInstance ? serverInstance.port : null
            },
            cronScheduler: {
                status: cronStatus.isRunning ? 'running' : 'stopped',
                nextExecution: cronStatus.nextExecution || null,
                timeUntilNext: cronStatus.timeUntilNextFormatted || null
            }
        },
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        }
    };
}

// Main execution
if (require.main === module) {
    // Setup signal handlers first
    setupSignalHandlers();

    // Start the application
    startApplication().catch((error) => {
        console.error('Fatal error during startup:', error);
        process.exit(1);
    });
}

// Export functions for testing
module.exports = {
    startApplication,
    gracefulShutdown,
    getApplicationHealth,
    setupSignalHandlers
};