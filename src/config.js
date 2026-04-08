/**
 * Configuration loader and validator for Twitter Autobot
 * Loads and validates all required environment variables
 */

const { createLogger } = require('./logger');

const logger = createLogger('CONFIG');

const requiredEnvVars = [
    'TWITTER_API_KEY',
    'TWITTER_API_SECRET',
    'TWITTER_ACCESS_TOKEN',
    'TWITTER_ACCESS_TOKEN_SECRET',
    'GEMINI_API_KEY',
    'NEWSDATA_API_KEY'
];

const optionalEnvVars = {
    'PORT': 3000
};

/**
 * Loads and validates environment configuration
 * @returns {Object} Configuration object with all required settings
 * @throws {Error} If required environment variables are missing
 */
function loadConfig() {
    const operation = logger.startOperation('Configuration loading');

    try {
        const config = {};
        const missingVars = [];
        const warnings = [];

        logger.info('Loading environment configuration', {
            requiredVars: requiredEnvVars.length,
            optionalVars: Object.keys(optionalEnvVars).length
        });

        // Check required environment variables
        for (const varName of requiredEnvVars) {
            const value = process.env[varName];
            if (!value || value.trim() === '') {
                missingVars.push(varName);
                logger.error(`Missing required environment variable: ${varName}`);
            } else {
                config[varName] = value.trim();
                logger.debug(`Loaded required variable: ${varName}`, {
                    hasValue: true,
                    valueLength: value.trim().length
                });
            }
        }

        // Handle missing required variables
        if (missingVars.length > 0) {
            const errorMessage = `Missing required environment variables: ${missingVars.join(', ')}\n` +
                'Please check your .env file or environment variable configuration.';

            const error = new Error(errorMessage);
            logger.error('Configuration validation failed', error, {
                missingVariables: missingVars,
                totalMissing: missingVars.length
            });

            operation.fail(error, { missingVariables: missingVars });
            throw error;
        }

        // Set optional variables with defaults
        for (const [varName, defaultValue] of Object.entries(optionalEnvVars)) {
            const value = process.env[varName];
            if (value && value.trim() !== '') {
                // Convert PORT to number if it's the PORT variable
                const processedValue = varName === 'PORT' ? parseInt(value.trim(), 10) : value.trim();
                config[varName] = processedValue;

                logger.debug(`Loaded optional variable: ${varName}`, {
                    value: processedValue,
                    source: 'environment'
                });
            } else {
                config[varName] = defaultValue;
                warnings.push(`Using default value for ${varName}: ${defaultValue}`);

                logger.info(`Using default value for optional variable: ${varName}`, {
                    defaultValue,
                    source: 'default'
                });
            }
        }

        // Validate PORT is a valid number
        if (isNaN(config.PORT) || config.PORT <= 0 || config.PORT > 65535) {
            const error = new Error('PORT must be a valid number between 1 and 65535');
            logger.error('Invalid PORT configuration', error, {
                portValue: config.PORT,
                portType: typeof config.PORT
            });

            operation.fail(error, { invalidPort: config.PORT });
            throw error;
        }

        // Log warnings if any
        if (warnings.length > 0) {
            warnings.forEach(warning => logger.warn(warning));
        }

        logger.info('Configuration loaded successfully', {
            requiredVarsLoaded: requiredEnvVars.length,
            optionalVarsLoaded: Object.keys(optionalEnvVars).length,
            warningsCount: warnings.length,
            portConfigured: config.PORT
        });

        operation.end('completed', {
            variablesLoaded: requiredEnvVars.length + Object.keys(optionalEnvVars).length,
            warnings: warnings.length
        });

        return config;

    } catch (error) {
        // Re-throw if it's already our error, otherwise wrap it
        if (error.message.includes('Missing required environment variables') ||
            error.message.includes('PORT must be a valid number')) {
            throw error;
        }

        const wrappedError = new Error(`Configuration loading failed: ${error.message}`);
        logger.error('Unexpected error during configuration loading', wrappedError, {
            originalError: error.message,
            errorType: error.name
        });

        operation.fail(wrappedError);
        throw wrappedError;
    }
}

/**
 * Gets structured configuration object with grouped settings
 * @returns {Object} Structured configuration object
 */
function getConfig() {
    try {
        const rawConfig = loadConfig();

        const structuredConfig = {
            twitter: {
                apiKey: rawConfig.TWITTER_API_KEY,
                apiSecret: rawConfig.TWITTER_API_SECRET,
                accessToken: rawConfig.TWITTER_ACCESS_TOKEN,
                accessTokenSecret: rawConfig.TWITTER_ACCESS_TOKEN_SECRET
            },
            gemini: {
                apiKey: rawConfig.GEMINI_API_KEY
            },
            newsdata: {
                apiKey: rawConfig.NEWSDATA_API_KEY
            },
            server: {
                port: rawConfig.PORT
            }
        };

        logger.debug('Configuration structured successfully', {
            hasTwitterConfig: !!(structuredConfig.twitter.apiKey && structuredConfig.twitter.apiSecret),
            hasGeminiConfig: !!structuredConfig.gemini.apiKey,
            hasNewsdataConfig: !!structuredConfig.newsdata.apiKey,
            serverPort: structuredConfig.server.port
        });

        return structuredConfig;

    } catch (error) {
        logger.error('Failed to get structured configuration', error);
        throw error;
    }
}

/**
 * Validates that all configuration is properly loaded
 * Logs configuration status without exposing sensitive values
 */
function validateConfig() {
    const operation = logger.startOperation('Configuration validation');

    try {
        const config = getConfig();

        // Validate each configuration section
        const validationResults = {
            twitter: {
                valid: !!(config.twitter.apiKey && config.twitter.apiSecret &&
                    config.twitter.accessToken && config.twitter.accessTokenSecret),
                fields: ['apiKey', 'apiSecret', 'accessToken', 'accessTokenSecret']
            },
            gemini: {
                valid: !!config.gemini.apiKey,
                fields: ['apiKey']
            },
            newsdata: {
                valid: !!config.newsdata.apiKey,
                fields: ['apiKey']
            },
            server: {
                valid: !!(config.server.port && config.server.port > 0),
                fields: ['port']
            }
        };

        // Check for any validation failures
        const failedSections = Object.entries(validationResults)
            .filter(([, result]) => !result.valid)
            .map(([section]) => section);

        if (failedSections.length > 0) {
            const error = new Error(`Configuration validation failed for sections: ${failedSections.join(', ')}`);
            logger.error('Configuration validation failed', error, {
                failedSections,
                validationResults
            });

            operation.fail(error, { failedSections });
            throw error;
        }

        // Log successful validation (without exposing sensitive values)
        logger.info('Configuration validation successful', {
            serverPort: config.server.port,
            twitterConfigured: validationResults.twitter.valid,
            geminiConfigured: validationResults.gemini.valid,
            newsdataConfigured: validationResults.newsdata.valid,
            allSectionsValid: true
        });

        // Keep some console.log for user visibility during startup
        console.log('✓ Configuration loaded successfully');
        console.log(`✓ Server port: ${config.server.port}`);
        console.log('✓ Twitter API credentials configured');
        console.log('✓ Gemini AI API key configured');
        console.log('✓ NewsData.io API key configured');

        operation.end('completed', {
            sectionsValidated: Object.keys(validationResults).length,
            allValid: true
        });

        return config;

    } catch (error) {
        // Keep console.error for user visibility during startup
        console.error('✗ Configuration validation failed:', error.message);

        if (!error.message.includes('Configuration validation failed')) {
            logger.error('Unexpected error during configuration validation', error);
            operation.fail(error);
        }

        throw error;
    }
}

module.exports = {
    loadConfig,
    getConfig,
    validateConfig
};