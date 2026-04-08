const axios = require('axios');
const cheerio = require('cheerio');
const { getConfig } = require('./config');
const { createLogger } = require('./logger');
const { withRetry, withFallback, categorizeError, ERROR_CATEGORIES } = require('./error-handler');

const logger = createLogger('SCRAPER');

/**
 * Scrapes Reddit posts from specified subreddits
 * @param {string[]} subreddits - Array of subreddit names (without r/ prefix)
 * @param {number} limit - Number of posts to fetch per subreddit (default: 5)
 * @returns {Promise<Array>} Array of Reddit post objects
 */
async function scrapeReddit(subreddits = ['india', 'technology'], limit = 5) {
    const operation = logger.startOperation('Reddit scraping', {
        subreddits,
        limit,
        totalSubreddits: subreddits.length
    });

    // Input validation with detailed error logging
    if (!Array.isArray(subreddits) || subreddits.length === 0) {
        const error = new Error('Invalid subreddits parameter: must be non-empty array');
        logger.error('Reddit scraping failed: Invalid input parameters', error, {
            subreddits,
            subredditsType: typeof subreddits,
            isArray: Array.isArray(subreddits),
            inputValidation: 'failed'
        });
        operation.fail(error, { inputValidation: 'failed' });
        return [];
    }

    if (typeof limit !== 'number' || limit <= 0 || limit > 100) {
        const error = new Error('Invalid limit parameter: must be number between 1-100');
        logger.error('Reddit scraping failed: Invalid limit parameter', error, {
            limit,
            limitType: typeof limit,
            inputValidation: 'failed'
        });
        operation.fail(error, { inputValidation: 'failed' });
        return [];
    }

    const results = [];
    const errors = [];
    const fallbackMechanisms = {
        retryAttempts: 0,
        maxRetries: 1,
        partialFailureRecovery: true
    };

    for (const subreddit of subreddits) {
        const subredditOperation = logger.startOperation(`Reddit r/${subreddit}`, { subreddit, limit });

        // Validate individual subreddit name
        if (!subreddit || typeof subreddit !== 'string' || subreddit.trim().length === 0) {
            const error = new Error(`Invalid subreddit name: ${subreddit}`);
            logger.error('Skipping invalid subreddit', error, {
                subreddit,
                subredditType: typeof subreddit,
                position: subreddits.indexOf(subreddit)
            });
            errors.push({ subreddit, error: error.message, type: 'validation' });
            subredditOperation.fail(error, { validationFailed: true });
            continue;
        }

        let retryCount = 0;
        let success = false;

        while (retryCount <= fallbackMechanisms.maxRetries && !success) {
            try {
                const isRetry = retryCount > 0;
                logger.apiCall('Reddit', `r/${subreddit}/hot.json`, {
                    limit,
                    attempt: retryCount + 1,
                    isRetry
                });

                const response = await axios.get(`https://www.reddit.com/r/${subreddit}/hot.json`, {
                    params: { limit },
                    headers: {
                        'User-Agent': 'TweetBot/1.0'
                    },
                    timeout: 10000 // 10 second timeout
                });

                // Enhanced response validation
                if (!response || !response.data) {
                    throw new Error('Empty response from Reddit API');
                }

                if (!response.data.data || !response.data.data.children || !Array.isArray(response.data.data.children)) {
                    logger.warn(`Reddit r/${subreddit} returned unexpected response format`, {
                        subreddit,
                        hasData: !!response.data,
                        hasDataData: !!(response.data && response.data.data),
                        hasChildren: !!(response.data && response.data.data && response.data.data.children),
                        isChildrenArray: Array.isArray(response.data?.data?.children),
                        responseKeys: response.data ? Object.keys(response.data) : [],
                        attempt: retryCount + 1
                    });

                    // Treat malformed response as partial failure, continue with empty results
                    subredditOperation.end('completed with warnings', {
                        postsScraped: 0,
                        malformedResponse: true,
                        attempt: retryCount + 1
                    });
                    success = true;
                    continue;
                }

                const posts = response.data.data.children
                    .filter(child => child && child.data) // Filter out invalid posts
                    .map(child => {
                        const post = child.data;
                        return {
                            source: 'reddit',
                            title: post.title || 'No title',
                            score: post.score || 0,
                            comments: post.num_comments || 0,
                            subreddit: post.subreddit || subreddit,
                            url: post.permalink ? `https://reddit.com${post.permalink}` : ''
                        };
                    })
                    .filter(post => post.title && post.title !== 'No title'); // Filter out posts without valid titles

                results.push(...posts);

                logger.apiResponse('Reddit', `r/${subreddit}/hot.json`, true, {
                    postsCount: posts.length,
                    responseSize: JSON.stringify(response.data).length,
                    statusCode: response.status,
                    attempt: retryCount + 1,
                    isRetry,
                    filteredPosts: response.data.data.children.length - posts.length
                });

                subredditOperation.end('completed', {
                    postsScraped: posts.length,
                    attempt: retryCount + 1,
                    retriesUsed: retryCount
                });
                success = true;

            } catch (error) {
                retryCount++;
                const isLastAttempt = retryCount > fallbackMechanisms.maxRetries;

                // Enhanced error categorization
                const errorDetails = {
                    subreddit,
                    errorType: error.name,
                    errorMessage: error.message,
                    attempt: retryCount,
                    maxAttempts: fallbackMechanisms.maxRetries + 1,
                    isLastAttempt,
                    isNetworkError: !error.response,
                    isTimeout: error.code === 'ECONNABORTED',
                    statusCode: error.response?.status,
                    responseData: error.response?.data
                };

                // Categorize error types for better handling
                if (error.response) {
                    errorDetails.errorCategory = 'api_error';
                    errorDetails.httpStatus = error.response.status;

                    // Handle specific HTTP status codes
                    if (error.response.status === 429) {
                        errorDetails.errorCategory = 'rate_limit';
                        errorDetails.retryAfter = error.response.headers?.['retry-after'];
                    } else if (error.response.status >= 500) {
                        errorDetails.errorCategory = 'server_error';
                    } else if (error.response.status === 404) {
                        errorDetails.errorCategory = 'not_found';
                    } else if (error.response.status === 403) {
                        errorDetails.errorCategory = 'forbidden';
                    }
                } else if (error.code === 'ECONNABORTED') {
                    errorDetails.errorCategory = 'timeout';
                } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                    errorDetails.errorCategory = 'network_error';
                } else {
                    errorDetails.errorCategory = 'unknown';
                }

                logger.apiResponse('Reddit', `r/${subreddit}/hot.json`, false, errorDetails);

                if (isLastAttempt) {
                    errors.push({
                        subreddit,
                        error: error.message,
                        type: errorDetails.errorCategory,
                        attempts: retryCount,
                        finalError: true
                    });

                    logger.error(`Reddit scraping failed for r/${subreddit} after ${retryCount} attempts`, error, errorDetails);
                    subredditOperation.fail(error, errorDetails);
                } else {
                    // Log retry attempt
                    logger.warn(`Reddit scraping attempt ${retryCount} failed for r/${subreddit}, retrying`, errorDetails);

                    // Add delay before retry for rate limiting and server errors
                    if (errorDetails.errorCategory === 'rate_limit' || errorDetails.errorCategory === 'server_error') {
                        const delay = errorDetails.retryAfter ? parseInt(errorDetails.retryAfter) * 1000 : 2000;
                        logger.info(`Waiting ${delay}ms before retry due to ${errorDetails.errorCategory}`, {
                            subreddit,
                            delay,
                            reason: errorDetails.errorCategory
                        });
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }
        }
    }

    // Enhanced final results logging with fallback analysis
    const successfulSubreddits = subreddits.length - errors.length;
    const successRate = subreddits.length > 0 ? ((successfulSubreddits / subreddits.length) * 100).toFixed(1) : '0';

    const finalStats = {
        totalSubreddits: subreddits.length,
        successfulSubreddits,
        failedSubreddits: errors.length,
        totalPosts: results.length,
        successRate: `${successRate}%`,
        errorBreakdown: {},
        fallbacksUsed: fallbackMechanisms.retryAttempts,
        partialFailureRecovery: errors.length > 0 && results.length > 0
    };

    // Categorize errors for better analysis
    errors.forEach(error => {
        const category = error.type || 'unknown';
        finalStats.errorBreakdown[category] = (finalStats.errorBreakdown[category] || 0) + 1;
    });

    logger.dataProcessing('Reddit scraping', subreddits.length, results.length, finalStats);

    // Determine operation result based on success criteria
    if (results.length === 0 && errors.length > 0) {
        logger.error('Reddit scraping completely failed - no posts retrieved', new Error('Complete scraping failure'), {
            ...finalStats,
            criticalFailure: true,
            errors: errors.length > 0 ? errors : undefined
        });
        operation.fail(new Error('Complete Reddit scraping failure'), finalStats);
    } else if (errors.length > 0) {
        logger.warn('Reddit scraping completed with partial failures', {
            ...finalStats,
            partialFailure: true,
            errors: errors
        });
        operation.end('completed with warnings', finalStats);
    } else {
        logger.info('Reddit scraping completed successfully', finalStats);
        operation.end('completed', finalStats);
    }

    return results;
}

/**
 * Scrapes news from NewsData.io API for India
 * @param {string[]} categories - Array of news categories (default: ['technology', 'politics', 'business'])
 * @param {number} limit - Number of articles to fetch (default: 5)
 * @returns {Promise<Array>} Array of news article objects
 */
async function scrapeNewsData(categories = ['technology', 'politics', 'business'], limit = 5) {
    const operation = logger.startOperation('NewsData.io scraping', {
        categories,
        limit,
        country: 'in'
    });

    // Input validation with detailed error logging
    if (!Array.isArray(categories) || categories.length === 0) {
        const error = new Error('Invalid categories parameter: must be non-empty array');
        logger.error('NewsData.io scraping failed: Invalid input parameters', error, {
            categories,
            categoriesType: typeof categories,
            isArray: Array.isArray(categories),
            inputValidation: 'failed'
        });
        operation.fail(error, { inputValidation: 'failed' });
        return [];
    }

    if (typeof limit !== 'number' || limit <= 0 || limit > 50) {
        const error = new Error('Invalid limit parameter: must be number between 1-50');
        logger.error('NewsData.io scraping failed: Invalid limit parameter', error, {
            limit,
            limitType: typeof limit,
            inputValidation: 'failed'
        });
        operation.fail(error, { inputValidation: 'failed' });
        return [];
    }

    const fallbackMechanisms = {
        retryAttempts: 0,
        maxRetries: 2,
        backoffDelay: 1000,
        fallbackToCache: false
    };

    let retryCount = 0;

    while (retryCount <= fallbackMechanisms.maxRetries) {
        try {
            const isRetry = retryCount > 0;
            logger.apiCall('NewsData.io', '/api/1/news', {
                categories: categories.join(','),
                country: 'in',
                limit,
                attempt: retryCount + 1,
                isRetry
            });

            const config = getConfig();
            const apiKey = config.newsdata.apiKey;

            if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
                const error = new Error('NewsData.io API key not configured or invalid');
                logger.error('NewsData.io API key validation failed', error, {
                    hasApiKey: !!apiKey,
                    apiKeyType: typeof apiKey,
                    apiKeyLength: apiKey ? apiKey.length : 0,
                    configurationError: true
                });
                operation.fail(error, { configurationError: true });
                return [];
            }

            const response = await axios.get('https://newsdata.io/api/1/news', {
                params: {
                    apikey: apiKey,
                    country: 'in', // India
                    category: categories.join(','),
                    language: 'en',
                    size: limit
                },
                timeout: 15000 // 15 second timeout for news API
            });

            // Enhanced response validation
            if (!response || !response.data) {
                throw new Error('Empty response from NewsData.io API');
            }

            // Check for API error responses
            if (response.data.status === 'error') {
                const apiError = new Error(`NewsData.io API error: ${response.data.results?.message || 'Unknown API error'}`);
                apiError.apiErrorCode = response.data.results?.code;
                apiError.apiErrorMessage = response.data.results?.message;
                throw apiError;
            }

            if (!response.data.results || !Array.isArray(response.data.results)) {
                logger.warn('NewsData.io returned unexpected response format', {
                    hasData: !!response.data,
                    hasResults: !!(response.data && response.data.results),
                    isResultsArray: Array.isArray(response.data?.results),
                    responseKeys: response.data ? Object.keys(response.data) : [],
                    responseStatus: response.data?.status,
                    attempt: retryCount + 1
                });

                // Treat malformed response as empty results rather than error
                const emptyResult = [];
                logger.apiResponse('NewsData.io', '/api/1/news', true, {
                    articlesCount: 0,
                    totalResults: 0,
                    responseSize: JSON.stringify(response.data).length,
                    malformedResponse: true,
                    attempt: retryCount + 1
                });

                operation.end('completed with warnings', {
                    articlesScraped: 0,
                    malformedResponse: true,
                    attempt: retryCount + 1
                });
                return emptyResult;
            }

            // Process and validate articles
            const rawArticles = response.data.results.slice(0, limit);
            const articles = rawArticles
                .filter(article => article && (article.title || article.description || article.content)) // Filter out completely empty articles
                .map(article => {
                    // Enhanced data extraction with fallbacks
                    const processedArticle = {
                        source: 'newsdata',
                        title: article.title || article.description?.substring(0, 100) || 'No title',
                        description: article.description || article.content || article.title || 'No description',
                        url: article.link || article.source_url || '',
                        category: Array.isArray(article.category) ? article.category[0] : (article.category || 'general'),
                        pubDate: article.pubDate || article.published_at || null,
                        sourceId: article.source_id || 'unknown'
                    };

                    // Ensure description is not too long
                    if (processedArticle.description.length > 500) {
                        processedArticle.description = processedArticle.description.substring(0, 497) + '...';
                    }

                    return processedArticle;
                })
                .filter(article =>
                    article.title !== 'No title' &&
                    article.description !== 'No description' &&
                    article.title.length > 5 // Filter out very short titles
                );

            logger.apiResponse('NewsData.io', '/api/1/news', true, {
                articlesCount: articles.length,
                rawArticlesCount: rawArticles.length,
                filteredArticles: rawArticles.length - articles.length,
                totalResults: response.data.totalResults || 0,
                responseSize: JSON.stringify(response.data).length,
                statusCode: response.status,
                attempt: retryCount + 1,
                isRetry,
                categories: categories.join(',')
            });

            logger.dataProcessing('NewsData.io processing', rawArticles.length, articles.length, {
                categories,
                country: 'in',
                filteringRate: rawArticles.length > 0 ? `${((articles.length / rawArticles.length) * 100).toFixed(1)}%` : '0%',
                attempt: retryCount + 1
            });

            operation.end('completed', {
                articlesScraped: articles.length,
                attempt: retryCount + 1,
                retriesUsed: retryCount
            });
            return articles;

        } catch (error) {
            retryCount++;
            const isLastAttempt = retryCount > fallbackMechanisms.maxRetries;

            // Enhanced error categorization for NewsData.io
            const errorDetails = {
                categories,
                limit,
                errorType: error.name,
                errorMessage: error.message,
                attempt: retryCount,
                maxAttempts: fallbackMechanisms.maxRetries + 1,
                isLastAttempt,
                isNetworkError: !error.response,
                isTimeout: error.code === 'ECONNABORTED',
                statusCode: error.response?.status,
                responseData: error.response?.data
            };

            // Categorize specific NewsData.io errors
            if (error.apiErrorCode) {
                errorDetails.errorCategory = 'api_error';
                errorDetails.apiErrorCode = error.apiErrorCode;
                errorDetails.apiErrorMessage = error.apiErrorMessage;
            } else if (error.response) {
                errorDetails.errorCategory = 'http_error';
                errorDetails.httpStatus = error.response.status;

                // Handle specific HTTP status codes for NewsData.io
                if (error.response.status === 401) {
                    errorDetails.errorCategory = 'authentication_error';
                    errorDetails.suggestion = 'Check API key validity';
                } else if (error.response.status === 429) {
                    errorDetails.errorCategory = 'rate_limit';
                    errorDetails.retryAfter = error.response.headers?.['retry-after'];
                    errorDetails.suggestion = 'API rate limit exceeded';
                } else if (error.response.status >= 500) {
                    errorDetails.errorCategory = 'server_error';
                    errorDetails.suggestion = 'NewsData.io server issue';
                } else if (error.response.status === 400) {
                    errorDetails.errorCategory = 'bad_request';
                    errorDetails.suggestion = 'Check request parameters';
                }
            } else if (error.code === 'ECONNABORTED') {
                errorDetails.errorCategory = 'timeout';
                errorDetails.suggestion = 'Increase timeout or check network';
            } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                errorDetails.errorCategory = 'network_error';
                errorDetails.suggestion = 'Check internet connectivity';
            } else {
                errorDetails.errorCategory = 'unknown';
            }

            logger.apiResponse('NewsData.io', '/api/1/news', false, errorDetails);

            if (isLastAttempt) {
                logger.error(`NewsData.io scraping failed after ${retryCount} attempts`, error, {
                    ...errorDetails,
                    finalFailure: true,
                    fallbackAction: 'Returning empty array to allow other scrapers to continue'
                });
                operation.fail(error, errorDetails);

                // Return empty array to allow other scrapers to continue (fallback mechanism)
                return [];
            } else {
                // Log retry attempt with backoff strategy
                const delay = fallbackMechanisms.backoffDelay * Math.pow(2, retryCount - 1); // Exponential backoff

                logger.warn(`NewsData.io scraping attempt ${retryCount} failed, retrying in ${delay}ms`, {
                    ...errorDetails,
                    retryDelay: delay,
                    backoffStrategy: 'exponential'
                });

                // Wait before retry with exponential backoff
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // This should never be reached due to the loop structure, but included for safety
    const error = new Error('NewsData.io scraping failed after all retry attempts');
    operation.fail(error, { unexpectedFallthrough: true });
    return [];
}

/**
 * Scrapes trending topics from trends24.in/india/
 * @param {number} limit - Number of trends to fetch (default: 10)
 * @returns {Promise<Array>} Array of trending topic strings
 */
async function scrapeTrends24(limit = 10) {
    const operation = logger.startOperation('Trends24 scraping', {
        limit,
        url: 'https://trends24.in/india/'
    });

    // Input validation with detailed error logging
    if (typeof limit !== 'number' || limit <= 0 || limit > 50) {
        const error = new Error('Invalid limit parameter: must be number between 1-50');
        logger.error('Trends24 scraping failed: Invalid limit parameter', error, {
            limit,
            limitType: typeof limit,
            inputValidation: 'failed'
        });
        operation.fail(error, { inputValidation: 'failed' });
        return [];
    }

    const fallbackMechanisms = {
        retryAttempts: 0,
        maxRetries: 2,
        backoffDelay: 2000,
        alternativeSelectors: ['#trend-list li', '.trend-item', '.trending-topic', 'li[data-trend]'],
        userAgentRotation: [
            'TweetBot/1.0',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        ]
    };

    let retryCount = 0;

    while (retryCount <= fallbackMechanisms.maxRetries) {
        try {
            const isRetry = retryCount > 0;
            const userAgent = fallbackMechanisms.userAgentRotation[retryCount % fallbackMechanisms.userAgentRotation.length];

            logger.apiCall('Trends24', 'https://trends24.in/india/', {
                limit,
                attempt: retryCount + 1,
                isRetry,
                userAgent: userAgent.substring(0, 20) + '...'
            });

            const response = await axios.get('https://trends24.in/india/', {
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                },
                timeout: 15000 // 15 second timeout for web scraping
            });

            // Enhanced response validation
            if (!response || response.data === null || response.data === undefined) {
                throw new Error('Empty or null response from Trends24.in');
            }

            if (typeof response.data !== 'string' || response.data.length === 0) {
                logger.warn('Trends24.in returned invalid response data', {
                    statusCode: response.status,
                    hasData: response.data !== null && response.data !== undefined,
                    dataType: typeof response.data,
                    dataLength: response.data ? response.data.length : 0,
                    attempt: retryCount + 1
                });

                // Treat invalid response as empty results
                operation.end('completed with warnings', {
                    trendsScraped: 0,
                    invalidResponse: true,
                    attempt: retryCount + 1
                });
                return [];
            }

            const $ = cheerio.load(response.data);
            const trends = [];
            let selectorUsed = null;

            // Try multiple selectors as fallback mechanism
            for (const selector of fallbackMechanisms.alternativeSelectors) {
                const elements = $(selector);

                if (elements.length > 0) {
                    selectorUsed = selector;
                    logger.debug(`Using selector: ${selector}`, {
                        elementsFound: elements.length,
                        attempt: retryCount + 1
                    });

                    elements.each((index, element) => {
                        if (trends.length >= limit) return false; // Break the loop

                        const trendText = $(element).text().trim();

                        // Enhanced trend validation
                        if (trendText &&
                            trendText.length > 0 &&
                            trendText.length <= 100 && // Reasonable length limit
                            !trendText.match(/^\s*$/) && // Not just whitespace
                            !trendText.toLowerCase().includes('advertisement') && // Filter ads
                            !trendText.toLowerCase().includes('sponsored')) { // Filter sponsored content

                            trends.push({
                                source: 'trends24',
                                topic: trendText,
                                rank: trends.length + 1,
                                selector: selector
                            });
                        }
                    });

                    if (trends.length > 0) {
                        break; // Found trends with this selector, no need to try others
                    }
                }
            }

            // Log scraping results with detailed analysis
            const scrapingAnalysis = {
                trendsCount: trends.length,
                htmlSize: response.data.length,
                statusCode: response.status,
                selectorUsed,
                selectorsAttempted: fallbackMechanisms.alternativeSelectors.indexOf(selectorUsed) + 1,
                attempt: retryCount + 1,
                isRetry,
                userAgent: userAgent.substring(0, 30) + '...',
                contentAnalysis: {
                    hasHtml: response.data.includes('<html'),
                    hasTrendList: response.data.includes('trend-list'),
                    hasJavaScript: response.data.includes('<script'),
                    estimatedTotalElements: (response.data.match(/<li/g) || []).length
                }
            };

            if (trends.length === 0) {
                logger.warn('No trends found with any selector', {
                    ...scrapingAnalysis,
                    selectorsAttempted: fallbackMechanisms.alternativeSelectors.length,
                    htmlPreview: response.data.substring(0, 500) + '...'
                });

                // If this is not the last attempt, continue to retry
                if (retryCount < fallbackMechanisms.maxRetries) {
                    throw new Error('No trends found, retrying with different approach');
                }

                // Last attempt failed, return empty array
                operation.end('completed with warnings', {
                    trendsScraped: 0,
                    noTrendsFound: true,
                    attempt: retryCount + 1
                });
                return [];
            }

            logger.apiResponse('Trends24', 'https://trends24.in/india/', true, scrapingAnalysis);

            logger.dataProcessing('Trends24 processing', scrapingAnalysis.contentAnalysis.estimatedTotalElements, trends.length, {
                limit,
                htmlParsed: true,
                selectorUsed,
                filteringRate: scrapingAnalysis.contentAnalysis.estimatedTotalElements > 0 ?
                    `${((trends.length / scrapingAnalysis.contentAnalysis.estimatedTotalElements) * 100).toFixed(1)}%` : '0%',
                attempt: retryCount + 1
            });

            operation.end('completed', {
                trendsScraped: trends.length,
                selectorUsed,
                attempt: retryCount + 1,
                retriesUsed: retryCount
            });
            return trends;

        } catch (error) {
            retryCount++;
            const isLastAttempt = retryCount > fallbackMechanisms.maxRetries;

            // Enhanced error categorization for web scraping
            const errorDetails = {
                limit,
                errorType: error.name,
                errorMessage: error.message,
                attempt: retryCount,
                maxAttempts: fallbackMechanisms.maxRetries + 1,
                isLastAttempt,
                isNetworkError: !error.response,
                isTimeout: error.code === 'ECONNABORTED',
                statusCode: error.response?.status,
                responseHeaders: error.response?.headers
            };

            // Categorize web scraping specific errors
            if (error.response) {
                errorDetails.errorCategory = 'http_error';
                errorDetails.httpStatus = error.response.status;
                errorDetails.contentType = error.response.headers?.['content-type'];

                // Handle specific HTTP status codes for web scraping
                if (error.response.status === 403) {
                    errorDetails.errorCategory = 'blocked';
                    errorDetails.suggestion = 'Website may be blocking requests, try different User-Agent';
                } else if (error.response.status === 429) {
                    errorDetails.errorCategory = 'rate_limit';
                    errorDetails.suggestion = 'Rate limited by website';
                } else if (error.response.status >= 500) {
                    errorDetails.errorCategory = 'server_error';
                    errorDetails.suggestion = 'Trends24.in server issue';
                } else if (error.response.status === 404) {
                    errorDetails.errorCategory = 'not_found';
                    errorDetails.suggestion = 'URL may have changed';
                }
            } else if (error.code === 'ECONNABORTED') {
                errorDetails.errorCategory = 'timeout';
                errorDetails.suggestion = 'Website loading too slowly';
            } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                errorDetails.errorCategory = 'network_error';
                errorDetails.suggestion = 'Check internet connectivity or DNS';
            } else if (error.message.includes('No trends found')) {
                errorDetails.errorCategory = 'parsing_error';
                errorDetails.suggestion = 'Website structure may have changed';
            } else {
                errorDetails.errorCategory = 'unknown';
            }

            logger.apiResponse('Trends24', 'https://trends24.in/india/', false, errorDetails);

            if (isLastAttempt) {
                logger.error(`Trends24 scraping failed after ${retryCount} attempts`, error, {
                    ...errorDetails,
                    finalFailure: true,
                    fallbackAction: 'Returning empty array to allow other scrapers to continue'
                });
                operation.fail(error, errorDetails);

                // Return empty array to allow other scrapers to continue (fallback mechanism)
                return [];
            } else {
                // Log retry attempt with backoff strategy
                const delay = fallbackMechanisms.backoffDelay * (retryCount); // Linear backoff for web scraping

                logger.warn(`Trends24 scraping attempt ${retryCount} failed, retrying in ${delay}ms`, {
                    ...errorDetails,
                    retryDelay: delay,
                    backoffStrategy: 'linear',
                    nextUserAgent: fallbackMechanisms.userAgentRotation[retryCount % fallbackMechanisms.userAgentRotation.length].substring(0, 30) + '...'
                });

                // Wait before retry with linear backoff
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // This should never be reached due to the loop structure, but included for safety
    const error = new Error('Trends24 scraping failed after all retry attempts');
    operation.fail(error, { unexpectedFallthrough: true });
    return [];
}

/**
 * Merges topics from all sources into a unified array of strings
 * @param {Array} results - Array of Promise.allSettled results
 * @returns {Array<string>} Array of topic strings for AI processing
 */
function mergeTopics(results) {
    const operation = logger.startOperation('Topic merging', {
        totalSources: results.length
    });

    const topics = [];
    const sourceNames = ['Reddit', 'NewsData.io', 'Trends24'];
    const sourceStats = [];

    results.forEach((result, index) => {
        const sourceName = sourceNames[index];
        const sourceData = { source: sourceName, topics: 0, status: result.status };

        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            const sourceTopics = result.value;

            sourceTopics.forEach(item => {
                let topicText = '';

                // Extract topic text based on source format
                if (item.source === 'reddit') {
                    topicText = item.title;
                } else if (item.source === 'newsdata') {
                    topicText = `${item.title}: ${item.description}`;
                } else if (item.source === 'trends24') {
                    topicText = item.topic;
                }

                // Add topic if it's valid and not empty
                if (topicText && topicText.trim().length > 0) {
                    topics.push(topicText.trim());
                    sourceData.topics++;
                }
            });

            logger.dataProcessing(`${sourceName} topic extraction`, sourceTopics.length, sourceData.topics, {
                source: sourceName,
                extractionRate: sourceTopics.length > 0 ? `${((sourceData.topics / sourceTopics.length) * 100).toFixed(1)}%` : '0%'
            });
        } else if (result.status === 'rejected') {
            logger.error(`${sourceName} scraper failed during merging`, result.reason, {
                source: sourceName,
                index
            });
            sourceData.error = result.reason?.message || 'Unknown error';
        } else {
            logger.warn(`${sourceName} returned invalid data format during merging`, {
                source: sourceName,
                resultStatus: result.status,
                hasValue: !!result.value,
                isArray: Array.isArray(result.value)
            });
        }

        sourceStats.push(sourceData);
    });

    // Log final merging results
    const successfulSources = sourceStats.filter(s => s.status === 'fulfilled').length;
    const failedSources = sourceStats.filter(s => s.status === 'rejected').length;

    logger.dataProcessing('Topic merging complete', results.length, topics.length, {
        successfulSources,
        failedSources,
        sourceBreakdown: sourceStats,
        uniqueTopics: new Set(topics).size
    });

    operation.end('completed', {
        totalTopics: topics.length,
        sourcesProcessed: results.length,
        successRate: `${((successfulSources / results.length) * 100).toFixed(1)}%`
    });

    return topics;
}

/**
 * Main scraping pipeline that fetches topics from all sources
 * Uses Promise.allSettled to continue with partial failures
 * Enhanced with comprehensive error handling and fallback mechanisms
 * @returns {Promise<Array<string>>} Array of topic strings for AI processing
 */
async function scrapeAllSources() {
    const operation = logger.startOperation('Unified scraping pipeline', {
        sources: ['Reddit', 'NewsData.io', 'Trends24'],
        fallbackMechanisms: ['partial_results', 'retry_failed_scrapers', 'emergency_topics']
    });

    const scraperOperations = [
        {
            name: 'Reddit',
            operation: () => module.exports.scrapeReddit(['india', 'technology'], 5),
            fallback: () => module.exports.scrapeReddit(['india'], 3), // Fallback to single subreddit
            emergencyFallback: () => []
        },
        {
            name: 'NewsData.io',
            operation: () => module.exports.scrapeNewsData(['technology', 'politics', 'business'], 5),
            fallback: () => module.exports.scrapeNewsData(['technology'], 3), // Fallback to single category
            emergencyFallback: () => []
        },
        {
            name: 'Trends24',
            operation: () => module.exports.scrapeTrends24(10),
            fallback: () => module.exports.scrapeTrends24(5), // Fallback to fewer trends
            emergencyFallback: () => []
        }
    ];

    try {
        // Enhanced scraping with individual error handling and fallbacks
        const results = await Promise.allSettled(
            scraperOperations.map(async (scraper) => {
                return await withFallback(
                    // Primary operation with retry
                    () => withRetry(
                        scraper.operation,
                        {
                            operationName: `${scraper.name} scraping`,
                            context: { scraper: scraper.name, pipeline: 'primary' }
                        }
                    ),
                    // Fallback operation
                    () => withRetry(
                        scraper.fallback,
                        {
                            operationName: `${scraper.name} fallback scraping`,
                            context: { scraper: scraper.name, pipeline: 'fallback' }
                        }
                    ),
                    {
                        operationName: `${scraper.name} scraping`,
                        fallbackName: `${scraper.name} fallback`,
                        context: { scraper: scraper.name }
                    }
                );
            })
        );

        // Analyze results and apply additional fallbacks if needed
        const successfulResults = results.filter(r => r.status === 'fulfilled');
        const failedResults = results.filter(r => r.status === 'rejected');

        // Log detailed failure analysis
        if (failedResults.length > 0) {
            const failureAnalysis = failedResults.map((result, index) => {
                const scraperName = scraperOperations[results.indexOf(result)].name;
                const errorCategory = categorizeError(result.reason);

                return {
                    scraper: scraperName,
                    error: result.reason.message,
                    category: errorCategory,
                    isRetryable: errorCategory !== ERROR_CATEGORIES.AUTHENTICATION &&
                        errorCategory !== ERROR_CATEGORIES.CONFIGURATION
                };
            });

            logger.warn('Some scrapers failed completely', {
                failedScrapers: failureAnalysis,
                successfulCount: successfulResults.length,
                failedCount: failedResults.length
            });
        }

        // Merge topics from all successful scrapers
        const allTopics = mergeTopics(results);

        // Enhanced fallback mechanism: if we have very few topics, try emergency fallbacks
        if (allTopics.length < 5 && failedResults.length > 0) {
            logger.warn('Low topic count detected, attempting emergency fallbacks', {
                currentTopics: allTopics.length,
                threshold: 5,
                failedScrapers: failedResults.length
            });

            // Try emergency fallbacks for failed scrapers
            const emergencyResults = await Promise.allSettled(
                failedResults.map(async (_, index) => {
                    const originalIndex = results.indexOf(failedResults[index]);
                    const scraper = scraperOperations[originalIndex];

                    try {
                        return await scraper.emergencyFallback();
                    } catch (error) {
                        logger.error(`Emergency fallback failed for ${scraper.name}`, error);
                        return [];
                    }
                })
            );

            // Add any successful emergency results
            const emergencyTopics = emergencyResults
                .filter(r => r.status === 'fulfilled')
                .flatMap(r => r.value)
                .filter(topic => typeof topic === 'string' && topic.trim().length > 0);

            if (emergencyTopics.length > 0) {
                allTopics.push(...emergencyTopics);
                logger.info('Emergency fallbacks provided additional topics', {
                    emergencyTopics: emergencyTopics.length,
                    totalTopics: allTopics.length
                });
            }
        }

        // Final fallback: if still no topics, provide some default trending topics
        if (allTopics.length === 0) {
            const defaultTopics = [
                'Technology trends in India',
                'Indian startup ecosystem',
                'Digital transformation',
                'AI and machine learning',
                'Social media trends'
            ];

            logger.warn('All scrapers failed, using default topics as last resort', {
                defaultTopicsCount: defaultTopics.length,
                fallbackLevel: 'emergency_defaults'
            });

            allTopics.push(...defaultTopics);
        }

        // Enhanced logging with comprehensive metrics
        const successfulScrapers = successfulResults.length;
        const failedScrapers = failedResults.length;
        const totalScrapers = scraperOperations.length;

        const pipelineMetrics = {
            totalTopics: allTopics.length,
            successfulScrapers,
            failedScrapers,
            totalScrapers,
            successRate: `${((successfulScrapers / totalScrapers) * 100).toFixed(1)}%`,
            hasTopics: allTopics.length > 0,
            usedFallbacks: failedScrapers > 0,
            usedEmergencyDefaults: allTopics.some(topic =>
                ['Technology trends in India', 'Indian startup ecosystem'].includes(topic)
            ),
            topicSources: {
                reddit: allTopics.filter(topic =>
                    successfulResults.some(r => r.value && r.value.some &&
                        r.value.some(item => item.source === 'reddit' &&
                            (item.title === topic || topic.includes(item.title?.substring(0, 20))))
                    )
                ).length,
                newsdata: allTopics.filter(topic =>
                    successfulResults.some(r => r.value && r.value.some &&
                        r.value.some(item => item.source === 'newsdata' &&
                            (item.title === topic || topic.includes(item.title?.substring(0, 20))))
                    )
                ).length,
                trends24: allTopics.filter(topic =>
                    successfulResults.some(r => r.value && r.value.some &&
                        r.value.some(item => item.source === 'trends24' &&
                            (item.topic === topic || topic.includes(item.topic?.substring(0, 20))))
                    )
                ).length
            }
        };

        // Determine operation result based on success criteria
        if (allTopics.length === 0) {
            const error = new Error('Complete scraping pipeline failure - no topics available');
            logger.error('Scraping pipeline completely failed', error, {
                ...pipelineMetrics,
                criticalFailure: true,
                allScrapersFailed: true
            });
            operation.fail(error, pipelineMetrics);
            return []; // Return empty array to prevent downstream crashes
        } else if (failedScrapers > 0) {
            logger.warn('Scraping pipeline completed with partial failures', {
                ...pipelineMetrics,
                partialFailure: true,
                resilientOperation: true
            });
            operation.end('completed with warnings', pipelineMetrics);
        } else {
            logger.info('Scraping pipeline completed successfully', pipelineMetrics);
            operation.end('completed', pipelineMetrics);
        }

        return allTopics;

    } catch (error) {
        // This should rarely happen since we use Promise.allSettled and comprehensive error handling
        // But it's critical to have as a safety net
        const errorCategory = categorizeError(error);

        logger.error('Critical error in scraping pipeline', error, {
            sources: scraperOperations.map(s => s.name),
            errorType: error.name,
            errorCategory,
            criticalFailure: true,
            fallbackAction: 'Returning empty array to prevent downstream failures'
        });

        operation.fail(error, {
            criticalFailure: true,
            errorCategory,
            fallbackApplied: true
        });

        // Return empty array to prevent downstream failures
        // The calling code should handle empty arrays gracefully
        return [];
    }
}

module.exports = {
    scrapeReddit,
    scrapeNewsData,
    scrapeTrends24,
    scrapeAllSources,
    mergeTopics
};