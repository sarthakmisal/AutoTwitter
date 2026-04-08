/**
 * Twitter API integration service
 * Handles tweet posting using Twitter API v2 with OAuth 1.0a authentication
 */

const { TwitterApi } = require('twitter-api-v2');
const { getConfig } = require('./config');
const { createLogger } = require('./logger');
const { withRetry, categorizeError, ERROR_CATEGORIES } = require('./error-handler');

const logger = createLogger('TWITTER');

/**
 * Creates and configures Twitter API client
 * @returns {TwitterApi} Configured Twitter API client
 */
function createTwitterClient() {
    const operation = logger.startOperation('Twitter client creation');

    try {
        const config = getConfig();

        // Validate configuration
        const requiredFields = ['apiKey', 'apiSecret', 'accessToken', 'accessTokenSecret'];
        const missingFields = requiredFields.filter(field => !config.twitter[field]);

        if (missingFields.length > 0) {
            throw new Error(`Missing Twitter configuration fields: ${missingFields.join(', ')}`);
        }

        const client = new TwitterApi({
            appKey: config.twitter.apiKey,
            appSecret: config.twitter.apiSecret,
            accessToken: config.twitter.accessToken,
            accessSecret: config.twitter.accessTokenSecret,
        });

        logger.info('Twitter API client created successfully', {
            hasApiKey: !!config.twitter.apiKey,
            hasApiSecret: !!config.twitter.apiSecret,
            hasAccessToken: !!config.twitter.accessToken,
            hasAccessSecret: !!config.twitter.accessTokenSecret
        });

        operation.end('completed');
        return client;

    } catch (error) {
        logger.error('Failed to create Twitter API client', error);
        operation.fail(error);
        throw error;
    }
}

/**
 * Posts a tweet to Twitter with enhanced error handling and fallback mechanisms
 * @param {string} tweetText - The text content to tweet (must be 200-270 characters)
 * @returns {Promise<boolean>} - Returns true if successful, false if failed
 */
async function postTweet(tweetText) {
    const operation = logger.startOperation('Tweet posting', {
        tweetLength: tweetText?.length || 0,
        hasContent: !!tweetText,
        fallbackMechanisms: ['retry_with_backoff', 'detailed_error_logging']
    });

    // Enhanced input validation
    if (!tweetText || typeof tweetText !== 'string') {
        const error = new Error('Invalid tweet text provided');
        logger.error('Tweet posting failed: Invalid input', error, {
            tweetText: tweetText,
            tweetType: typeof tweetText,
            inputValidation: 'failed',
            errorCategory: ERROR_CATEGORIES.VALIDATION
        });
        operation.fail(error, { inputValidation: 'failed' });
        return false;
    }

    const cleanTweetText = tweetText.trim();
    if (cleanTweetText.length === 0) {
        const error = new Error('Tweet text is empty after trimming');
        logger.error('Tweet posting failed: Empty content', error, {
            originalLength: tweetText.length,
            trimmedLength: cleanTweetText.length,
            inputValidation: 'failed'
        });
        operation.fail(error, { inputValidation: 'failed' });
        return false;
    }

    // Validate tweet length with detailed feedback
    if (cleanTweetText.length < 200 || cleanTweetText.length > 270) {
        const error = new Error(`Tweet length ${cleanTweetText.length} is outside required range (200-270 characters)`);
        logger.error('Tweet posting failed: Invalid length', error, {
            actualLength: cleanTweetText.length,
            requiredRange: '200-270',
            tweetPreview: cleanTweetText.substring(0, 100) + '...',
            lengthValidation: 'failed',
            errorCategory: ERROR_CATEGORIES.VALIDATION
        });
        operation.fail(error, { lengthValidation: 'failed' });
        return false;
    }

    try {
        // Use retry mechanism for Twitter API calls
        const result = await withRetry(
            async () => {
                const client = createTwitterClient();

                logger.apiCall('Twitter', 'v2.tweet', {
                    tweetLength: cleanTweetText.length,
                    tweetPreview: cleanTweetText.substring(0, 50) + '...',
                    attempt: 'primary'
                });

                // Post the tweet using Twitter API v2
                const response = await client.v2.tweet(cleanTweetText);

                // Enhanced response validation
                if (!response || !response.data || !response.data.id) {
                    const responseError = new Error('Invalid response structure from Twitter API');
                    responseError.responseData = response;
                    throw responseError;
                }

                return response;
            },
            {
                operationName: 'Twitter API tweet posting',
                context: {
                    tweetLength: cleanTweetText.length,
                    service: 'twitter',
                    operation: 'post_tweet'
                }
            }
        );

        // Success handling
        logger.apiResponse('Twitter', 'v2.tweet', true, {
            tweetId: result.data.id,
            tweetLength: cleanTweetText.length,
            responseData: {
                id: result.data.id,
                text: result.data.text ? 'present' : 'missing'
            }
        });

        logger.info('Tweet posted successfully', {
            tweetId: result.data.id,
            tweetLength: cleanTweetText.length,
            tweetPreview: cleanTweetText.substring(0, 100) + (cleanTweetText.length > 100 ? '...' : ''),
            successfulPosting: true
        });

        operation.end('completed', {
            tweetId: result.data.id,
            tweetLength: cleanTweetText.length,
            posted: true
        });

        return true;

    } catch (error) {
        // Enhanced error categorization and handling
        const errorCategory = categorizeError(error);
        const errorAnalysis = {
            errorType: error.name,
            errorMessage: error.message,
            errorCategory,
            tweetLength: cleanTweetText.length,
            tweetPreview: cleanTweetText.substring(0, 100) + '...',
            hasErrorCode: !!error.code,
            hasErrorData: !!error.data,
            isNetworkError: !error.response && (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND'),
            isAuthError: error.code === 401 || (error.data && error.data.title === 'Unauthorized'),
            isRateLimitError: error.code === 429 || (error.data && error.data.title === 'Too Many Requests'),
            isDuplicateError: error.code === 403 && error.message && error.message.includes('duplicate'),
            isResponseError: !!error.responseData
        };

        // Add specific error details if available
        if (error.code) {
            errorAnalysis.errorCode = error.code;
        }
        if (error.data) {
            errorAnalysis.errorData = error.data;

            // Extract specific Twitter API error details
            if (error.data.detail) {
                errorAnalysis.twitterErrorDetail = error.data.detail;
            }
            if (error.data.errors && Array.isArray(error.data.errors)) {
                errorAnalysis.twitterErrors = error.data.errors.map(err => ({
                    message: err.message,
                    code: err.code,
                    parameter: err.parameter
                }));
            }
        }
        if (error.response) {
            errorAnalysis.responseStatus = error.response.status;
            errorAnalysis.responseHeaders = error.response.headers;
        }
        if (error.responseData) {
            errorAnalysis.invalidResponseStructure = true;
            errorAnalysis.responseKeys = error.responseData ? Object.keys(error.responseData) : [];
        }

        // Provide specific error guidance based on error type
        switch (errorCategory) {
            case ERROR_CATEGORIES.AUTHENTICATION:
                errorAnalysis.suggestion = 'Check Twitter API credentials (API key, secret, access tokens)';
                errorAnalysis.actionRequired = 'Verify authentication configuration';
                break;
            case ERROR_CATEGORIES.API_LIMIT:
                errorAnalysis.suggestion = 'Twitter API rate limit exceeded, wait before retrying';
                errorAnalysis.actionRequired = 'Implement rate limiting or wait for reset';
                break;
            case ERROR_CATEGORIES.NETWORK:
                errorAnalysis.suggestion = 'Check internet connectivity and Twitter API status';
                errorAnalysis.actionRequired = 'Verify network connection';
                break;
            case ERROR_CATEGORIES.SERVER_ERROR:
                errorAnalysis.suggestion = 'Twitter API server error, retry may succeed';
                errorAnalysis.actionRequired = 'Monitor Twitter API status';
                break;
            default:
                errorAnalysis.suggestion = 'Review error details and Twitter API documentation';
                errorAnalysis.actionRequired = 'Investigate specific error cause';
        }

        logger.apiResponse('Twitter', 'v2.tweet', false, errorAnalysis);

        // Enhanced error logging with fallback information
        logger.error('Tweet posting failed', error, {
            ...errorAnalysis,
            fallbackAction: 'Tweet content preserved for manual posting or retry',
            tweetContent: cleanTweetText, // Log full content for recovery
            recoveryOptions: [
                'Manual posting via Twitter web interface',
                'Retry after resolving underlying issue',
                'Check Twitter API status and limits'
            ]
        });

        // Additional logging for critical errors
        if (errorCategory === ERROR_CATEGORIES.AUTHENTICATION) {
            logger.error('Authentication failure detected - check API credentials', error, {
                credentialCheck: 'required',
                apiKeysPresent: {
                    apiKey: !!process.env.TWITTER_API_KEY,
                    apiSecret: !!process.env.TWITTER_API_SECRET,
                    accessToken: !!process.env.TWITTER_ACCESS_TOKEN,
                    accessSecret: !!process.env.TWITTER_ACCESS_TOKEN_SECRET
                }
            });
        }

        operation.fail(error, {
            ...errorAnalysis,
            tweetContentPreserved: true,
            posted: false
        });

        return false;
    }
}

/**
 * Validates Twitter API credentials by making a test call
 * @returns {Promise<boolean>} - Returns true if credentials are valid
 */
async function validateTwitterCredentials() {
    const operation = logger.startOperation('Twitter credentials validation');

    try {
        const client = createTwitterClient();

        logger.apiCall('Twitter', 'v2.me', { purpose: 'credential_validation' });

        // Test credentials by getting user info
        const user = await client.v2.me();

        if (user && user.data) {
            logger.apiResponse('Twitter', 'v2.me', true, {
                userId: user.data.id,
                username: user.data.username,
                hasUserData: !!user.data
            });

            logger.info('Twitter API credentials validated successfully', {
                authenticatedUser: user.data.username,
                userId: user.data.id
            });

            operation.end('completed', {
                username: user.data.username,
                userId: user.data.id
            });

            return true;
        } else {
            const error = new Error('Invalid response from Twitter API during validation');

            logger.apiResponse('Twitter', 'v2.me', false, {
                hasUser: !!user,
                hasData: !!(user && user.data),
                responseType: typeof user
            });

            logger.error('Twitter API credential validation failed: Invalid response', error, {
                responseStructure: {
                    hasUser: !!user,
                    hasData: !!(user && user.data),
                    userKeys: user ? Object.keys(user) : []
                }
            });

            operation.fail(error, { responseValidation: 'failed' });
            return false;
        }

    } catch (error) {
        const errorAnalysis = {
            errorType: error.name,
            errorMessage: error.message,
            isAuthError: error.code === 401 || (error.data && error.data.title === 'Unauthorized'),
            isNetworkError: !error.response && (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND'),
            hasErrorCode: !!error.code,
            hasErrorData: !!error.data
        };

        if (error.code) {
            errorAnalysis.errorCode = error.code;
        }
        if (error.data) {
            errorAnalysis.errorData = error.data;
        }

        logger.apiResponse('Twitter', 'v2.me', false, errorAnalysis);

        logger.error('Twitter API credential validation failed', error, {
            ...errorAnalysis,
            suggestion: errorAnalysis.isAuthError ? 'Check API keys and tokens' : 'Check network connectivity'
        });

        operation.fail(error, errorAnalysis);
        return false;
    }
}

module.exports = {
    postTweet,
    validateTwitterCredentials,
    createTwitterClient
};