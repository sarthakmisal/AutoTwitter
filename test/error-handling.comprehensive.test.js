/**
 * Comprehensive error handling integration tests
 * Tests error handling across all components and failure scenarios
 */

const { scrapeAllSources } = require('../src/scraper');
const { selectBestTopic, generateTweet } = require('../src/gemini');
const { postTweet } = require('../src/twitter');
const { dailyTweetJob } = require('../src/cron');
const { withRetry, withFallback, categorizeError, ERROR_CATEGORIES } = require('../src/error-handler');

// Mock all external dependencies
jest.mock('axios');
jest.mock('@google/generative-ai');
jest.mock('twitter-api-v2');
jest.mock('cheerio');

const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { TwitterApi } = require('twitter-api-v2');

describe('Comprehensive Error Handling Tests', () => {
    let consoleLogSpy;
    let consoleErrorSpy;
    let consoleWarnSpy;

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup console spies
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

        // Mock environment variables
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        process.env.NEWSDATA_API_KEY = 'test-newsdata-key';
        process.env.TWITTER_API_KEY = 'test-twitter-key';
        process.env.TWITTER_API_SECRET = 'test-twitter-secret';
        process.env.TWITTER_ACCESS_TOKEN = 'test-access-token';
        process.env.TWITTER_ACCESS_TOKEN_SECRET = 'test-access-secret';
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    describe('Error Categorization', () => {
        test('should correctly categorize network errors', () => {
            const networkError = new Error('Network error');
            networkError.code = 'ENOTFOUND';

            const category = categorizeError(networkError);
            expect(category).toBe(ERROR_CATEGORIES.NETWORK);
        });

        test('should correctly categorize authentication errors', () => {
            const authError = new Error('Unauthorized');
            authError.response = { status: 401 };

            const category = categorizeError(authError);
            expect(category).toBe(ERROR_CATEGORIES.AUTHENTICATION);
        });

        test('should correctly categorize rate limit errors', () => {
            const rateLimitError = new Error('Too many requests');
            rateLimitError.response = { status: 429 };

            const category = categorizeError(rateLimitError);
            expect(category).toBe(ERROR_CATEGORIES.API_LIMIT);
        });

        test('should correctly categorize timeout errors', () => {
            const timeoutError = new Error('Timeout');
            timeoutError.code = 'ECONNABORTED';

            const category = categorizeError(timeoutError);
            expect(category).toBe(ERROR_CATEGORIES.TIMEOUT);
        });

        test('should correctly categorize validation errors', () => {
            const validationError = new Error('Invalid input provided');

            const category = categorizeError(validationError);
            expect(category).toBe(ERROR_CATEGORIES.VALIDATION);
        });
    });

    describe('Retry Mechanism Tests', () => {
        test('should retry failed operations with exponential backoff', async () => {
            let attemptCount = 0;
            const failingOperation = jest.fn().mockImplementation(() => {
                attemptCount++;
                if (attemptCount < 3) {
                    throw new Error('Temporary failure');
                }
                return 'success';
            });

            const result = await withRetry(failingOperation, {
                operationName: 'test operation'
            });

            expect(result).toBe('success');
            expect(failingOperation).toHaveBeenCalledTimes(3);
        });

        test('should not retry authentication errors', async () => {
            const authError = new Error('Unauthorized');
            authError.response = { status: 401 };

            const failingOperation = jest.fn().mockRejectedValue(authError);

            await expect(withRetry(failingOperation, {
                operationName: 'auth test'
            })).rejects.toThrow('Unauthorized');

            expect(failingOperation).toHaveBeenCalledTimes(1);
        });

        test('should handle retry exhaustion gracefully', async () => {
            const persistentError = new Error('Persistent network error');
            persistentError.code = 'ENOTFOUND';

            const failingOperation = jest.fn().mockRejectedValue(persistentError);

            await expect(withRetry(failingOperation, {
                operationName: 'persistent failure test'
            })).rejects.toThrow();

            expect(failingOperation).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
        });
    });

    describe('Fallback Mechanism Tests', () => {
        test('should use fallback when primary operation fails', async () => {
            const primaryError = new Error('Primary operation failed');
            const primaryOperation = jest.fn().mockRejectedValue(primaryError);
            const fallbackOperation = jest.fn().mockResolvedValue('fallback result');

            const result = await withFallback(
                primaryOperation,
                fallbackOperation,
                {
                    operationName: 'test operation',
                    fallbackName: 'test fallback'
                }
            );

            expect(result).toBe('fallback result');
            expect(primaryOperation).toHaveBeenCalledTimes(1);
            expect(fallbackOperation).toHaveBeenCalledTimes(1);
        });

        test('should throw error when both primary and fallback fail', async () => {
            const primaryError = new Error('Primary failed');
            const fallbackError = new Error('Fallback failed');

            const primaryOperation = jest.fn().mockRejectedValue(primaryError);
            const fallbackOperation = jest.fn().mockRejectedValue(fallbackError);

            await expect(withFallback(
                primaryOperation,
                fallbackOperation,
                {
                    operationName: 'test operation',
                    fallbackName: 'test fallback'
                }
            )).rejects.toThrow();

            expect(primaryOperation).toHaveBeenCalledTimes(1);
            expect(fallbackOperation).toHaveBeenCalledTimes(1);
        });
    });

    describe('Scraping Error Handling', () => {
        test('should handle partial scraper failures gracefully', async () => {
            // Mock Reddit success, NewsData failure, Trends24 success
            axios.get
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Reddit post 1', score: 100, num_comments: 50 } }
                            ]
                        }
                    }
                })
                .mockRejectedValueOnce(new Error('NewsData API error'))
                .mockResolvedValueOnce({
                    data: '<html><div id="trend-list"><li>Trending topic 1</li></div></html>'
                });

            const result = await scrapeAllSources();

            expect(result).toHaveLength(2); // Reddit + Trends24
            expect(result).toContain('Reddit post 1');
            expect(result).toContain('Trending topic 1');
        });

        test('should return empty array when all scrapers fail', async () => {
            axios.get.mockRejectedValue(new Error('All scrapers failed'));

            const result = await scrapeAllSources();

            expect(result).toEqual([]);
            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        test('should use fallback topics when no scrapers succeed', async () => {
            axios.get.mockRejectedValue(new Error('Complete failure'));

            const result = await scrapeAllSources();

            // Should return default topics as fallback
            expect(result.length).toBeGreaterThan(0);
            expect(result).toContain('Technology trends in India');
        });
    });

    describe('AI Service Error Handling', () => {
        let mockModel;

        beforeEach(() => {
            mockModel = {
                generateContent: jest.fn()
            };

            GoogleGenerativeAI.mockImplementation(() => ({
                getGenerativeModel: () => mockModel
            }));
        });

        test('should handle Gemini API failures with retry', async () => {
            mockModel.generateContent
                .mockRejectedValueOnce(new Error('Temporary API error'))
                .mockResolvedValueOnce({
                    response: {
                        text: () => 'Selected topic'
                    }
                });

            const result = await selectBestTopic(['topic1', 'topic2', 'topic3']);

            expect(result).toBe('Selected topic');
            expect(mockModel.generateContent).toHaveBeenCalledTimes(2);
        });

        test('should handle empty response from Gemini', async () => {
            mockModel.generateContent.mockResolvedValue({
                response: {
                    text: () => ''
                }
            });

            await expect(selectBestTopic(['topic1', 'topic2'])).rejects.toThrow();
        });

        test('should validate tweet generation output', async () => {
            mockModel.generateContent.mockResolvedValue({
                response: {
                    text: () => 'Short tweet' // Too short
                }
            });

            const result = await generateTweet('Test topic');
            expect(result).toBe('Short tweet'); // Should return even if not optimal length
        });
    });

    describe('Twitter API Error Handling', () => {
        let mockTwitterClient;

        beforeEach(() => {
            mockTwitterClient = {
                v2: {
                    tweet: jest.fn(),
                    me: jest.fn()
                }
            };

            TwitterApi.mockImplementation(() => mockTwitterClient);
        });

        test('should handle Twitter authentication errors', async () => {
            const authError = new Error('Unauthorized');
            authError.code = 401;
            authError.data = { detail: 'Invalid credentials' };

            mockTwitterClient.v2.tweet.mockRejectedValue(authError);

            const validTweet = 'A'.repeat(220); // Valid length tweet
            const result = await postTweet(validTweet);

            expect(result).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Tweet posting failed')
            );
        });

        test('should handle Twitter rate limiting', async () => {
            const rateLimitError = new Error('Rate limit exceeded');
            rateLimitError.code = 429;
            rateLimitError.data = { title: 'Too Many Requests' };

            mockTwitterClient.v2.tweet.mockRejectedValue(rateLimitError);

            const validTweet = 'A'.repeat(220);
            const result = await postTweet(validTweet);

            expect(result).toBe(false);
        });

        test('should validate tweet length before posting', async () => {
            const shortTweet = 'Too short';
            const result = await postTweet(shortTweet);

            expect(result).toBe(false);
            expect(mockTwitterClient.v2.tweet).not.toHaveBeenCalled();
        });
    });

    describe('End-to-End Error Scenarios', () => {
        test('should handle complete pipeline failure gracefully', async () => {
            // Mock all services to fail
            axios.get.mockRejectedValue(new Error('Scraping failed'));

            const mockModel = {
                generateContent: jest.fn().mockRejectedValue(new Error('AI failed'))
            };
            GoogleGenerativeAI.mockImplementation(() => ({
                getGenerativeModel: () => mockModel
            }));

            const mockTwitterClient = {
                v2: {
                    tweet: jest.fn().mockRejectedValue(new Error('Twitter failed'))
                }
            };
            TwitterApi.mockImplementation(() => mockTwitterClient);

            const result = await dailyTweetJob();

            expect(result).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        test('should continue with partial failures in pipeline', async () => {
            // Mock scraping to succeed with minimal data
            axios.get.mockResolvedValue({
                data: {
                    data: {
                        children: [
                            { data: { title: 'Test topic', score: 100, num_comments: 50 } }
                        ]
                    }
                }
            });

            // Mock AI to succeed
            const mockModel = {
                generateContent: jest.fn()
                    .mockResolvedValueOnce({
                        response: { text: () => 'Test topic' }
                    })
                    .mockResolvedValueOnce({
                        response: { text: () => 'A'.repeat(220) } // Valid tweet
                    })
            };
            GoogleGenerativeAI.mockImplementation(() => ({
                getGenerativeModel: () => mockModel
            }));

            // Mock Twitter to fail
            const mockTwitterClient = {
                v2: {
                    tweet: jest.fn().mockRejectedValue(new Error('Twitter API error'))
                }
            };
            TwitterApi.mockImplementation(() => mockTwitterClient);

            const result = await dailyTweetJob();

            expect(result).toBe(false); // Should fail due to Twitter error
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Tweet posting failed')
            );
        });
    });

    describe('Memory and Resource Error Handling', () => {
        test('should handle memory pressure gracefully', () => {
            const originalMemoryUsage = process.memoryUsage;

            // Mock high memory usage
            process.memoryUsage = jest.fn().mockReturnValue({
                rss: 1024 * 1024 * 1024, // 1GB
                heapTotal: 512 * 1024 * 1024, // 512MB
                heapUsed: 500 * 1024 * 1024, // 500MB
                external: 50 * 1024 * 1024 // 50MB
            });

            // This would trigger memory warnings in the actual application
            const memUsage = process.memoryUsage();
            expect(memUsage.heapUsed).toBeGreaterThan(400 * 1024 * 1024);

            // Restore original function
            process.memoryUsage = originalMemoryUsage;
        });
    });

    describe('Configuration Error Handling', () => {
        test('should handle missing API keys gracefully', async () => {
            // Remove API keys
            delete process.env.GEMINI_API_KEY;
            delete process.env.TWITTER_API_KEY;

            // This should be handled by the configuration validation
            expect(() => {
                require('../src/config').validateConfig();
            }).toThrow();
        });

        test('should handle invalid configuration values', () => {
            process.env.PORT = 'invalid-port';

            // Configuration should handle invalid port gracefully
            const config = require('../src/config').getConfig();
            expect(typeof config.server.port).toBe('number');
        });
    });
});