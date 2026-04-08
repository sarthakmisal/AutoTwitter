/**
 * Integration tests for comprehensive error handling across all components
 */

const { scrapeAllSources } = require('../src/scraper');
const { selectBestTopic, generateTweet } = require('../src/gemini');
const { postTweet } = require('../src/twitter');
const { dailyTweetJob } = require('../src/cron');
const { withRetry, withFallback, CircuitBreaker } = require('../src/error-handler');

// Mock external dependencies
jest.mock('axios');
jest.mock('@google/generative-ai');
jest.mock('twitter-api-v2');
jest.mock('../src/config');

const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { TwitterApi } = require('twitter-api-v2');
const { getConfig } = require('../src/config');

describe('Error Handling Integration Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        // Mock console methods to reduce test noise
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();

        // Mock config
        getConfig.mockReturnValue({
            twitter: {
                apiKey: 'test_api_key',
                apiSecret: 'test_api_secret',
                accessToken: 'test_access_token',
                accessTokenSecret: 'test_access_token_secret'
            },
            gemini: {
                apiKey: 'test_gemini_key'
            },
            newsdata: {
                apiKey: 'test_newsdata_key'
            }
        });

        // Mock setTimeout to avoid delays in tests
        jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
            callback();
            return 123;
        });
    });

    afterEach(() => {
        console.log.mockRestore();
        console.warn.mockRestore();
        console.error.mockRestore();
        setTimeout.mockRestore();
    });

    describe('Scraping Error Handling', () => {
        test('should handle partial scraper failures gracefully', async () => {
            // Mock Reddit success, NewsData failure, Trends24 success
            axios.get
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Reddit Post 1', score: 100, num_comments: 20, subreddit: 'india' } }
                            ]
                        }
                    }
                })
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Reddit Post 2', score: 80, num_comments: 15, subreddit: 'technology' } }
                            ]
                        }
                    }
                })
                .mockRejectedValueOnce(new Error('NewsData API failed'))
                .mockResolvedValueOnce({
                    data: '<html><body><div id="trend-list"><li>Trending Topic 1</li><li>Trending Topic 2</li></div></body></html>'
                });

            const result = await scrapeAllSources();

            expect(result).toHaveLength(4); // 2 Reddit + 0 NewsData + 2 Trends24
            expect(result).toEqual([
                'Reddit Post 1',
                'Reddit Post 2',
                'Trending Topic 1',
                'Trending Topic 2'
            ]);
        });

        test('should handle complete scraping failure', async () => {
            // Mock all scrapers failing
            axios.get.mockRejectedValue(new Error('Network error'));

            const result = await scrapeAllSources();

            expect(result).toHaveLength(0);
        });

        test('should handle malformed responses gracefully', async () => {
            // Mock malformed responses
            axios.get
                .mockResolvedValueOnce({ data: null }) // Reddit malformed
                .mockResolvedValueOnce({ data: null }) // Reddit malformed
                .mockResolvedValueOnce({ data: { status: 'error' } }) // NewsData error
                .mockResolvedValueOnce({ data: '<html><body></body></html>' }); // Trends24 empty

            const result = await scrapeAllSources();

            expect(result).toHaveLength(0);
        });
    });

    describe('AI Service Error Handling', () => {
        test('should handle Gemini API failures with retry', async () => {
            const mockGenerateContent = jest.fn()
                .mockRejectedValueOnce(new Error('API temporarily unavailable'))
                .mockResolvedValueOnce({
                    response: { text: () => 'Selected topic after retry' }
                });

            GoogleGenerativeAI.mockImplementation(() => ({
                getGenerativeModel: () => ({ generateContent: mockGenerateContent })
            }));

            const topics = ['Topic 1', 'Topic 2', 'Topic 3'];
            const result = await selectBestTopic(topics);

            expect(result).toBe('Selected topic after retry');
            expect(mockGenerateContent).toHaveBeenCalledTimes(2);
        });

        test('should handle tweet generation failures', async () => {
            const mockGenerateContent = jest.fn()
                .mockRejectedValueOnce(new Error('Content filtered'))
                .mockResolvedValueOnce({
                    response: { text: () => 'Generated tweet content that meets all requirements and has proper length for optimal engagement on social media platforms with relevant hashtags #test #automation' }
                });

            GoogleGenerativeAI.mockImplementation(() => ({
                getGenerativeModel: () => ({ generateContent: mockGenerateContent })
            }));

            const result = await generateTweet('Test topic');

            expect(result).toContain('Generated tweet content');
            expect(mockGenerateContent).toHaveBeenCalledTimes(2);
        });

        test('should fail after exhausting retries', async () => {
            const mockGenerateContent = jest.fn()
                .mockRejectedValue(new Error('Persistent API error'));

            GoogleGenerativeAI.mockImplementation(() => ({
                getGenerativeModel: () => ({ generateContent: mockGenerateContent })
            }));

            await expect(selectBestTopic(['Topic 1'])).rejects.toThrow('Topic selection failed after');
            expect(mockGenerateContent).toHaveBeenCalledTimes(4); // Initial + 3 retries
        });
    });

    describe('Twitter API Error Handling', () => {
        test('should handle Twitter API authentication errors', async () => {
            const mockTweet = jest.fn().mockRejectedValue({
                code: 401,
                message: 'Unauthorized'
            });

            TwitterApi.mockImplementation(() => ({
                v2: { tweet: mockTweet }
            }));

            const validTweet = 'A'.repeat(250);
            const result = await postTweet(validTweet);

            expect(result).toBe(false);
            expect(mockTweet).toHaveBeenCalledTimes(1);
        });

        test('should handle Twitter API rate limiting', async () => {
            const mockTweet = jest.fn()
                .mockRejectedValueOnce({
                    code: 429,
                    message: 'Rate limit exceeded'
                })
                .mockResolvedValueOnce({
                    data: { id: '123456789', text: 'Tweet posted' }
                });

            TwitterApi.mockImplementation(() => ({
                v2: { tweet: mockTweet }
            }));

            const validTweet = 'A'.repeat(250);

            // Use retry mechanism
            const result = await withRetry(
                () => postTweet(validTweet),
                { operationName: 'tweet posting' }
            );

            expect(result).toBe(true);
            expect(mockTweet).toHaveBeenCalledTimes(2);
        });
    });

    describe('Complete Pipeline Error Handling', () => {
        test('should handle end-to-end pipeline with partial failures', async () => {
            // Setup mocks for successful pipeline with some retries

            // Scraping: partial success
            axios.get
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Test Topic', score: 100, num_comments: 20, subreddit: 'india' } }
                            ]
                        }
                    }
                })
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Tech News', score: 80, num_comments: 15, subreddit: 'technology' } }
                            ]
                        }
                    }
                })
                .mockRejectedValueOnce(new Error('NewsData failed'))
                .mockResolvedValueOnce({
                    data: '<html><body><div id="trend-list"><li>Trending Now</li></div></body></html>'
                });

            // AI: success after retry
            const mockGenerateContent = jest.fn()
                .mockRejectedValueOnce(new Error('Temporary AI error'))
                .mockResolvedValueOnce({
                    response: { text: () => 'Test Topic' }
                })
                .mockResolvedValueOnce({
                    response: { text: () => 'This is a comprehensive test tweet that demonstrates the error handling capabilities of our Twitter automation system with proper length and engaging content for maximum viral potential #test #automation' }
                });

            GoogleGenerativeAI.mockImplementation(() => ({
                getGenerativeModel: () => ({ generateContent: mockGenerateContent })
            }));

            // Twitter: success
            const mockTweet = jest.fn().mockResolvedValue({
                data: { id: '123456789', text: 'Tweet posted' }
            });

            TwitterApi.mockImplementation(() => ({
                v2: { tweet: mockTweet }
            }));

            const result = await dailyTweetJob();

            expect(result).toBe(true);
            expect(mockGenerateContent).toHaveBeenCalledTimes(3); // 1 retry + 2 successful calls
            expect(mockTweet).toHaveBeenCalledTimes(1);
        });

        test('should fail gracefully when no topics are available', async () => {
            // Mock all scrapers failing
            axios.get.mockRejectedValue(new Error('All scrapers failed'));

            const result = await dailyTweetJob();

            expect(result).toBe(false);
        });

        test('should handle AI service complete failure', async () => {
            // Scraping success
            axios.get
                .mockResolvedValue({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Test Topic', score: 100, num_comments: 20, subreddit: 'india' } }
                            ]
                        }
                    }
                });

            // AI complete failure
            const mockGenerateContent = jest.fn()
                .mockRejectedValue(new Error('AI service unavailable'));

            GoogleGenerativeAI.mockImplementation(() => ({
                getGenerativeModel: () => ({ generateContent: mockGenerateContent })
            }));

            const result = await dailyTweetJob();

            expect(result).toBe(false);
        });
    });

    describe('Circuit Breaker Integration', () => {
        test('should protect external APIs with circuit breaker', async () => {
            const circuitBreaker = new CircuitBreaker('test-api', {
                failureThreshold: 2,
                resetTimeout: 1000
            });

            const mockApiCall = jest.fn()
                .mockRejectedValue(new Error('API error'));

            // First two failures should open circuit
            await expect(circuitBreaker.execute(mockApiCall)).rejects.toThrow('API error');
            await expect(circuitBreaker.execute(mockApiCall)).rejects.toThrow('API error');

            expect(circuitBreaker.getStatus().state).toBe('OPEN');

            // Third call should be blocked by circuit breaker
            await expect(circuitBreaker.execute(mockApiCall)).rejects.toThrow('Circuit breaker test-api is OPEN');
            expect(mockApiCall).toHaveBeenCalledTimes(2); // Should not call API when circuit is open
        });
    });

    describe('Fallback Mechanisms', () => {
        test('should use fallback when primary operation fails', async () => {
            const primaryOperation = jest.fn().mockRejectedValue(new Error('Primary failed'));
            const fallbackOperation = jest.fn().mockResolvedValue('Fallback success');

            const result = await withFallback(primaryOperation, fallbackOperation, {
                operationName: 'test operation',
                fallbackName: 'test fallback'
            });

            expect(result).toBe('Fallback success');
            expect(primaryOperation).toHaveBeenCalledTimes(1);
            expect(fallbackOperation).toHaveBeenCalledTimes(1);
        });

        test('should handle cascading failures with multiple fallbacks', async () => {
            const operation1 = jest.fn().mockRejectedValue(new Error('Operation 1 failed'));
            const operation2 = jest.fn().mockRejectedValue(new Error('Operation 2 failed'));
            const operation3 = jest.fn().mockResolvedValue('Operation 3 success');

            // Chain fallbacks
            const result = await withFallback(
                operation1,
                () => withFallback(operation2, operation3, {
                    operationName: 'operation 2',
                    fallbackName: 'operation 3'
                }),
                {
                    operationName: 'operation 1',
                    fallbackName: 'operation 2 with fallback'
                }
            );

            expect(result).toBe('Operation 3 success');
            expect(operation1).toHaveBeenCalledTimes(1);
            expect(operation2).toHaveBeenCalledTimes(1);
            expect(operation3).toHaveBeenCalledTimes(1);
        });
    });
});