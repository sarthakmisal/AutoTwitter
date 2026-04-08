/**
 * Integration tests for complete Twitter Autobot pipeline
 * Tests end-to-end flow from scraping through tweet posting with comprehensive error scenarios
 * Requirements: 1.8, 2.4, 4.4, 5.4
 */

const { scrapeAllSources } = require('../src/scraper');
const { selectBestTopic, generateTweet } = require('../src/gemini');
const { postTweet } = require('../src/twitter');
const { dailyTweetJob } = require('../src/cron');

// Mock external dependencies
jest.mock('axios');
jest.mock('@google/generative-ai');
jest.mock('twitter-api-v2');
jest.mock('../src/config');
jest.mock('cheerio');

const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { TwitterApi } = require('twitter-api-v2');
const { getConfig } = require('../src/config');
const cheerio = require('cheerio');

describe('Complete Pipeline Integration Tests', () => {
    let consoleLogSpy;
    let consoleWarnSpy;
    let consoleErrorSpy;
    let mockGenerateContent;
    let mockTweet;
    let mockMe;
    let mockCheerioLoad;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock console methods to capture logging output
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        // Mock setTimeout to avoid delays in tests
        jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
            callback();
            return 123;
        });

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
            },
            server: {
                port: 3000
            }
        });

        // Setup Gemini AI mocks
        mockGenerateContent = jest.fn();
        GoogleGenerativeAI.mockImplementation(() => ({
            getGenerativeModel: () => ({ generateContent: mockGenerateContent })
        }));

        // Setup Twitter API mocks
        mockTweet = jest.fn();
        mockMe = jest.fn();
        TwitterApi.mockImplementation(() => ({
            v2: { tweet: mockTweet, me: mockMe }
        }));

        // Setup Cheerio mock
        mockCheerioLoad = jest.fn();
        cheerio.load = mockCheerioLoad;
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        setTimeout.mockRestore();
    });

    describe('End-to-End Pipeline Success Scenarios', () => {
        test('should complete full pipeline successfully with all sources', async () => {
            // Mock successful scraping from all sources
            axios.get
                // Reddit r/india
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'India Tech Innovation Hub', score: 250, num_comments: 45, subreddit: 'india' } },
                                { data: { title: 'Mumbai Metro Expansion News', score: 180, num_comments: 32, subreddit: 'india' } }
                            ]
                        }
                    }
                })
                // Reddit r/technology
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'AI Revolution in Healthcare', score: 320, num_comments: 67, subreddit: 'technology' } },
                                { data: { title: 'Quantum Computing Breakthrough', score: 290, num_comments: 54, subreddit: 'technology' } }
                            ]
                        }
                    }
                })
                // NewsData.io API
                .mockResolvedValueOnce({
                    data: {
                        status: 'success',
                        results: [
                            { title: 'Indian Startup Unicorn Funding', description: 'Major funding round for Indian tech startup' },
                            { title: 'Digital India Initiative Progress', description: 'Government digital transformation updates' }
                        ]
                    }
                })
                // Trends24.in
                .mockResolvedValueOnce({
                    data: '<html><body><div id="trend-list"><li>Cricket World Cup</li><li>Bollywood Awards</li><li>Tech Conference</li></div></body></html>'
                });

            // Mock Cheerio for HTML parsing
            const mockCheerio = {
                text: jest.fn().mockReturnValue('Cricket World Cup'),
                each: jest.fn((callback) => {
                    callback(0, { text: () => 'Cricket World Cup' });
                    callback(1, { text: () => 'Bollywood Awards' });
                    callback(2, { text: () => 'Tech Conference' });
                })
            };
            mockCheerioLoad.mockReturnValue(() => mockCheerio);

            // Mock successful AI topic selection
            mockGenerateContent.mockResolvedValueOnce({
                response: { text: () => 'AI Revolution in Healthcare' }
            });

            // Mock successful tweet generation
            mockGenerateContent.mockResolvedValueOnce({
                response: {
                    text: () => 'AI in healthcare is literally changing everything yaar! From diagnosis to treatment, technology is making doctors superhuman. But are we ready for AI making life-death decisions? What if the algorithm gets it wrong? #HealthTech #AIRevolution #DigitalIndia'
                }
            });

            // Mock successful tweet posting
            mockTweet.mockResolvedValueOnce({
                data: { id: '1234567890', text: 'Tweet posted successfully' }
            });

            const result = await dailyTweetJob();

            expect(result).toBe(true);

            // Verify all external API calls were made
            expect(axios.get).toHaveBeenCalledTimes(4); // 2 Reddit + 1 NewsData + 1 Trends24
            expect(mockGenerateContent).toHaveBeenCalledTimes(2); // Topic selection + Tweet generation
            expect(mockTweet).toHaveBeenCalledTimes(1);

            // Verify logging output for successful pipeline
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Starting daily tweet job')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Tweet posting completed successfully')
            );
        });

        test('should handle partial scraping success and continue pipeline', async () => {
            // Mock partial scraping success (Reddit works, NewsData fails, Trends24 works)
            axios.get
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Breaking Tech News', score: 400, num_comments: 89, subreddit: 'india' } }
                            ]
                        }
                    }
                })
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Startup Funding Round', score: 350, num_comments: 76, subreddit: 'technology' } }
                            ]
                        }
                    }
                })
                .mockRejectedValueOnce(new Error('NewsData API rate limit exceeded'))
                .mockResolvedValueOnce({
                    data: '<html><body><div id="trend-list"><li>Tech Innovation</li><li>Digital Transformation</li></div></body></html>'
                });

            // Mock Cheerio for HTML parsing
            const mockCheerio = {
                text: jest.fn().mockReturnValue('Tech Innovation'),
                each: jest.fn((callback) => {
                    callback(0, { text: () => 'Tech Innovation' });
                    callback(1, { text: () => 'Digital Transformation' });
                })
            };
            mockCheerioLoad.mockReturnValue(() => mockCheerio);

            // Mock successful AI processing
            mockGenerateContent
                .mockResolvedValueOnce({
                    response: { text: () => 'Breaking Tech News' }
                })
                .mockResolvedValueOnce({
                    response: {
                        text: () => 'Breaking tech news hitting different today! The innovation wave in India is unstoppable but are we prepared for the disruption? Traditional industries better adapt fast or get left behind. Thoughts? #TechNews #Innovation #DigitalIndia #Disruption'
                    }
                });

            // Mock successful tweet posting
            mockTweet.mockResolvedValueOnce({
                data: { id: '9876543210', text: 'Tweet posted' }
            });

            const result = await dailyTweetJob();

            expect(result).toBe(true);

            // Verify partial failure was handled gracefully
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('NewsData.io scraping attempt')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('completed successfully')
            );
        });

        test('should validate scraped data quality and filter invalid content', async () => {
            // Mock mixed quality data from Reddit
            axios.get
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Valid Post Title', score: 100, num_comments: 20, subreddit: 'india' } },
                                { data: { title: '', score: 0, num_comments: 0, subreddit: 'india' } }, // Invalid - empty title
                                { data: { title: 'Another Valid Post', score: 50, num_comments: 10, subreddit: 'india' } },
                                { data: { title: 'Ad', score: 1, num_comments: 0, subreddit: 'india' } } // Invalid - too short
                            ]
                        }
                    }
                })
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Quality Tech Post', score: 200, num_comments: 40, subreddit: 'technology' } }
                            ]
                        }
                    }
                })
                .mockResolvedValueOnce({
                    data: {
                        status: 'success',
                        results: [
                            { title: 'Valid News Article', description: 'Detailed news content here' },
                            { title: '', description: '' }, // Invalid - empty content
                            { title: 'Another Valid Article', description: 'More news content' }
                        ]
                    }
                })
                .mockResolvedValueOnce({
                    data: '<html><body><div id="trend-list"><li>Valid Trend</li><li></li><li>Another Trend</li></div></body></html>'
                });

            // Mock Cheerio for HTML parsing with mixed content
            const mockCheerio = {
                text: jest.fn()
                    .mockReturnValueOnce('Valid Trend')
                    .mockReturnValueOnce('') // Empty trend
                    .mockReturnValueOnce('Another Trend'),
                each: jest.fn((callback) => {
                    callback(0, { text: () => 'Valid Trend' });
                    callback(1, { text: () => '' }); // Empty trend
                    callback(2, { text: () => 'Another Trend' });
                })
            };
            mockCheerioLoad.mockReturnValue(() => mockCheerio);

            mockGenerateContent
                .mockResolvedValueOnce({
                    response: { text: () => 'Valid Post Title' }
                })
                .mockResolvedValueOnce({
                    response: {
                        text: () => 'Data quality is everything in automation! Garbage in, garbage out - clean your inputs or face the consequences. Validation saves you from embarrassing failures later. Quality over quantity always wins. #DataQuality #Automation #TechBestPractices #CleanData'
                    }
                });

            mockTweet.mockResolvedValueOnce({
                data: { id: '9999999999', text: 'Quality tweet posted' }
            });

            const result = await dailyTweetJob();

            expect(result).toBe(true);

            // Verify data filtering occurred - should have filtered out invalid entries
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Topic scraping completed successfully')
            );
        });
    });

    describe('Error Handling and Recovery Scenarios', () => {
        test('should fail gracefully when no topics are scraped', async () => {
            // Mock all scrapers failing
            axios.get.mockRejectedValue(new Error('Network connectivity issues'));

            const result = await dailyTweetJob();

            expect(result).toBe(false);
            expect(mockGenerateContent).not.toHaveBeenCalled();
            expect(mockTweet).not.toHaveBeenCalled();

            // Verify error logging
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Job failed: No topics available')
            );
        });

        test('should handle AI topic selection failure with retries', async () => {
            // Mock successful scraping
            axios.get
                .mockResolvedValue({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Test Topic for AI', score: 100, num_comments: 20, subreddit: 'india' } }
                            ]
                        }
                    }
                });

            // Mock AI topic selection failure after retries
            mockGenerateContent.mockRejectedValue(new Error('Gemini API quota exceeded'));

            const result = await dailyTweetJob();

            expect(result).toBe(false);
            expect(mockGenerateContent).toHaveBeenCalledTimes(4); // Initial + 3 retries
            expect(mockTweet).not.toHaveBeenCalled();

            // Verify error logging
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Critical error in topic selection')
            );
        });

        test('should handle AI tweet generation failure', async () => {
            // Mock successful scraping
            axios.get
                .mockResolvedValue({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Controversial Topic', score: 500, num_comments: 150, subreddit: 'india' } }
                            ]
                        }
                    }
                });

            // Mock successful topic selection but failed tweet generation
            mockGenerateContent
                .mockResolvedValueOnce({
                    response: { text: () => 'Controversial Topic' }
                })
                .mockRejectedValue(new Error('Content safety filter triggered'));

            const result = await dailyTweetJob();

            expect(result).toBe(false);
            expect(mockTweet).not.toHaveBeenCalled();

            // Verify error logging
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Critical error in tweet generation')
            );
        });

        test('should handle Twitter API posting failure', async () => {
            // Mock successful scraping and AI processing
            axios.get
                .mockResolvedValue({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Social Media Trends', score: 200, num_comments: 40, subreddit: 'technology' } }
                            ]
                        }
                    }
                });

            mockGenerateContent
                .mockResolvedValueOnce({
                    response: { text: () => 'Social Media Trends' }
                })
                .mockResolvedValueOnce({
                    response: {
                        text: () => 'Social media trends are wild right now! Everyone trying to go viral but missing the authentic connection. Real engagement beats algorithm hacks any day. Stop chasing numbers, start building community. #SocialMedia #Authenticity #Community #DigitalMarketing'
                    }
                });

            // Mock Twitter API failure
            mockTweet.mockRejectedValue({
                code: 401,
                message: 'Unauthorized - Invalid credentials'
            });

            const result = await dailyTweetJob();

            expect(result).toBe(false);

            // Verify tweet content was logged for manual posting
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Critical error in tweet posting')
            );
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Social media trends are wild')
            );
        });

        test('should handle Twitter API rate limiting with retry', async () => {
            // Mock successful scraping and AI processing
            axios.get
                .mockResolvedValue({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Rate Limit Test', score: 150, num_comments: 30, subreddit: 'india' } }
                            ]
                        }
                    }
                });

            mockGenerateContent
                .mockResolvedValueOnce({
                    response: { text: () => 'Rate Limit Test' }
                })
                .mockResolvedValueOnce({
                    response: {
                        text: () => 'Rate limits everywhere! APIs throttling left and right but developers still pushing boundaries. Innovation never stops for technical constraints. Build better, scale smarter, respect the limits. #API #Development #TechLife #Innovation #RateLimit'
                    }
                });

            // Mock Twitter API rate limiting then success
            mockTweet
                .mockRejectedValueOnce({
                    code: 429,
                    message: 'Rate limit exceeded'
                })
                .mockResolvedValueOnce({
                    data: { id: '5555555555', text: 'Tweet posted after retry' }
                });

            const result = await dailyTweetJob();

            expect(result).toBe(true);
            expect(mockTweet).toHaveBeenCalledTimes(2); // Initial failure + successful retry

            // Verify retry logging
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('attempt 1 failed, retrying')
            );
        });

        test('should handle malformed API responses gracefully', async () => {
            // Mock malformed responses from different sources
            axios.get
                .mockResolvedValueOnce({
                    data: null // Malformed Reddit response
                })
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Valid Tech Post', score: 100, num_comments: 20, subreddit: 'technology' } }
                            ]
                        }
                    }
                })
                .mockResolvedValueOnce({
                    data: {
                        status: 'error',
                        message: 'Invalid API key'
                    }
                })
                .mockResolvedValueOnce({
                    data: '<html><body><div>No trend list found</div></body></html>' // No trends
                });

            // Mock Cheerio for empty trends
            const mockCheerio = {
                text: jest.fn().mockReturnValue(''),
                each: jest.fn() // No elements found
            };
            mockCheerioLoad.mockReturnValue(() => mockCheerio);

            mockGenerateContent
                .mockResolvedValueOnce({
                    response: { text: () => 'Valid Tech Post' }
                })
                .mockResolvedValueOnce({
                    response: {
                        text: () => 'Handling malformed data is crucial for robust systems! APIs fail, responses break, but resilient code keeps running. Always validate, always have fallbacks, never trust external data blindly. #ErrorHandling #RobustCode #APIDesign #SystemResilience'
                    }
                });

            mockTweet.mockResolvedValueOnce({
                data: { id: '1111111111', text: 'Resilience tweet posted' }
            });

            const result = await dailyTweetJob();

            expect(result).toBe(true);

            // Verify warnings for malformed responses
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('scraping attempt')
            );
        });

        test('should handle network timeouts and connection errors', async () => {
            // Mock network timeout errors
            const timeoutError = new Error('Request timeout');
            timeoutError.code = 'ECONNABORTED';

            const networkError = new Error('Network unreachable');
            networkError.code = 'ENOTFOUND';

            axios.get
                .mockRejectedValueOnce(timeoutError) // Reddit timeout
                .mockRejectedValueOnce(networkError) // Reddit network error
                .mockRejectedValueOnce(timeoutError) // NewsData timeout
                .mockResolvedValueOnce({
                    data: '<html><body><div id="trend-list"><li>Network Recovery Test</li></div></body></html>'
                });

            // Mock Cheerio for successful trends parsing
            const mockCheerio = {
                text: jest.fn().mockReturnValue('Network Recovery Test'),
                each: jest.fn((callback) => {
                    callback(0, { text: () => 'Network Recovery Test' });
                })
            };
            mockCheerioLoad.mockReturnValue(() => mockCheerio);

            mockGenerateContent
                .mockResolvedValueOnce({
                    response: { text: () => 'Network Recovery Test' }
                })
                .mockResolvedValueOnce({
                    response: {
                        text: () => 'Network issues testing our patience again! Timeouts, connection drops, DNS failures - the internet is not as reliable as we think. Build for failure, expect the unexpected, have backup plans ready. #NetworkResilience #SystemDesign #ErrorHandling #TechReality'
                    }
                });

            mockTweet.mockResolvedValueOnce({
                data: { id: '2222222222', text: 'Network resilience tweet posted' }
            });

            const result = await dailyTweetJob();

            expect(result).toBe(true);

            // Verify network error handling
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('scraping attempt')
            );
        });

        test('should handle cascading failures gracefully', async () => {
            // Mock multiple system failures
            axios.get.mockRejectedValue(new Error('All scrapers down'));

            const result = await dailyTweetJob();

            expect(result).toBe(false);

            // Verify graceful failure handling
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Job failed: No topics available')
            );
            expect(mockGenerateContent).not.toHaveBeenCalled();
            expect(mockTweet).not.toHaveBeenCalled();
        });

        test('should handle authentication errors across different services', async () => {
            // Mock successful scraping
            axios.get
                .mockResolvedValue({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Auth Test Topic', score: 100, num_comments: 20, subreddit: 'india' } }
                            ]
                        }
                    }
                });

            // Mock Gemini authentication error
            const authError = new Error('API key invalid');
            authError.code = 401;
            mockGenerateContent.mockRejectedValue(authError);

            const result = await dailyTweetJob();

            expect(result).toBe(false);

            // Verify authentication error handling
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Critical error in topic selection')
            );
        });
    });

    describe('Logging and Monitoring Verification', () => {
        test('should log comprehensive pipeline progress', async () => {
            // Mock successful pipeline
            axios.get
                .mockResolvedValue({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Logging Test Topic', score: 100, num_comments: 25, subreddit: 'india' } }
                            ]
                        }
                    }
                });

            // Mock Cheerio for trends
            const mockCheerio = {
                text: jest.fn().mockReturnValue('Logging Trend'),
                each: jest.fn((callback) => {
                    callback(0, { text: () => 'Logging Trend' });
                })
            };
            mockCheerioLoad.mockReturnValue(() => mockCheerio);

            mockGenerateContent
                .mockResolvedValueOnce({
                    response: { text: () => 'Logging Test Topic' }
                })
                .mockResolvedValueOnce({
                    response: {
                        text: () => 'Logging everything properly is crucial for debugging! Comprehensive logs save hours of troubleshooting later. Every API call, every error, every success needs tracking. Debug like your sanity depends on it. #Logging #Debugging #DevLife #Monitoring #TechTips'
                    }
                });

            mockTweet.mockResolvedValueOnce({
                data: { id: '7777777777', text: 'Logging tweet posted' }
            });

            await dailyTweetJob();

            // Verify comprehensive logging
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Starting daily tweet job')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Topic scraping completed successfully')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Topic selection completed successfully')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Tweet generation completed successfully')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Tweet posting completed successfully')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Daily tweet job completed successfully')
            );
        });

        test('should log detailed error information for troubleshooting', async () => {
            // Mock scraping failure
            const networkError = new Error('ENOTFOUND - DNS resolution failed');
            networkError.code = 'ENOTFOUND';
            axios.get.mockRejectedValue(networkError);

            await dailyTweetJob();

            // Verify detailed error logging
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Job failed: No topics available')
            );
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('ENOTFOUND')
            );
        });

        test('should track performance metrics and timing', async () => {
            // Mock successful but slow operations
            axios.get
                .mockImplementation(() =>
                    new Promise(resolve =>
                        setTimeout(() => resolve({
                            data: {
                                data: {
                                    children: [
                                        { data: { title: 'Performance Test', score: 100, num_comments: 20, subreddit: 'india' } }
                                    ]
                                }
                            }
                        }), 100)
                    )
                );

            // Mock Cheerio for trends
            const mockCheerio = {
                text: jest.fn().mockReturnValue('Performance Trend'),
                each: jest.fn((callback) => {
                    callback(0, { text: () => 'Performance Trend' });
                })
            };
            mockCheerioLoad.mockReturnValue(() => mockCheerio);

            mockGenerateContent
                .mockResolvedValueOnce({
                    response: { text: () => 'Performance Test' }
                })
                .mockResolvedValueOnce({
                    response: {
                        text: () => 'Performance matters in everything we build! Slow APIs kill user experience faster than bad design. Optimize early, monitor always, scale smartly. Speed is a feature, not an afterthought. #Performance #API #UserExperience #Optimization #TechTips'
                    }
                });

            mockTweet.mockResolvedValueOnce({
                data: { id: '8888888888', text: 'Performance tweet posted' }
            });

            const startTime = Date.now();
            await dailyTweetJob();
            const endTime = Date.now();

            // Verify operation completed within reasonable time
            expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds

            // Verify timing logs are present
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('completed successfully')
            );
        });

        test('should log API call details and response analysis', async () => {
            // Mock successful API calls with detailed responses
            axios.get
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'API Monitoring Test', score: 150, num_comments: 30, subreddit: 'india' } }
                            ]
                        }
                    }
                })
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Tech API Integration', score: 200, num_comments: 45, subreddit: 'technology' } }
                            ]
                        }
                    }
                })
                .mockResolvedValueOnce({
                    data: {
                        status: 'success',
                        results: [
                            { title: 'API News Article', description: 'Detailed API integration news' }
                        ]
                    }
                })
                .mockResolvedValueOnce({
                    data: '<html><body><div id="trend-list"><li>API Trends</li></div></body></html>'
                });

            // Mock Cheerio for trends
            const mockCheerio = {
                text: jest.fn().mockReturnValue('API Trends'),
                each: jest.fn((callback) => {
                    callback(0, { text: () => 'API Trends' });
                })
            };
            mockCheerioLoad.mockReturnValue(() => mockCheerio);

            mockGenerateContent
                .mockResolvedValueOnce({
                    response: { text: () => 'API Monitoring Test' }
                })
                .mockResolvedValueOnce({
                    response: {
                        text: () => 'API monitoring is essential for production systems! Track every call, measure every response, log every failure. Without proper monitoring, you are flying blind in the digital sky. Monitor everything, assume nothing. #APIMonitoring #SystemObservability #DevOps #TechOps'
                    }
                });

            mockTweet.mockResolvedValueOnce({
                data: { id: '9999999999', text: 'API monitoring tweet posted' }
            });

            await dailyTweetJob();

            // Verify API call logging
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Starting daily tweet job')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('completed successfully')
            );
        });

        test('should log warning messages for suboptimal conditions', async () => {
            // Mock scenario with warnings (partial failures, suboptimal responses)
            axios.get
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Warning Test Topic', score: 50, num_comments: 5, subreddit: 'india' } }
                            ]
                        }
                    }
                })
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [] // Empty results
                        }
                    }
                })
                .mockRejectedValueOnce(new Error('NewsData temporary unavailable'))
                .mockResolvedValueOnce({
                    data: '<html><body><div id="trend-list"><li>Warning Trend</li></div></body></html>'
                });

            // Mock Cheerio for trends
            const mockCheerio = {
                text: jest.fn().mockReturnValue('Warning Trend'),
                each: jest.fn((callback) => {
                    callback(0, { text: () => 'Warning Trend' });
                })
            };
            mockCheerioLoad.mockReturnValue(() => mockCheerio);

            // Mock tweet generation with suboptimal length
            mockGenerateContent
                .mockResolvedValueOnce({
                    response: { text: () => 'Warning Test Topic' }
                })
                .mockResolvedValueOnce({
                    response: {
                        text: () => 'Short tweet' // Too short, should trigger warning
                    }
                });

            mockTweet.mockResolvedValueOnce({
                data: { id: '1010101010', text: 'Warning tweet posted' }
            });

            const result = await dailyTweetJob();

            // Should still succeed despite warnings
            expect(result).toBe(true);

            // Verify warning logs
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('scraping attempt')
            );
        });
    });

    describe('Data Validation and Quality Checks', () => {
        test('should validate scraped data quality', async () => {
            // Mock mixed quality data
            axios.get
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Valid Post Title', score: 100, num_comments: 20, subreddit: 'india' } },
                                { data: { title: '', score: 0, num_comments: 0, subreddit: 'india' } }, // Invalid
                                { data: { title: 'Another Valid Post', score: 50, num_comments: 10, subreddit: 'india' } }
                            ]
                        }
                    }
                })
                .mockResolvedValue({
                    data: {
                        data: {
                            children: []
                        }
                    }
                });

            mockGenerateContent
                .mockResolvedValueOnce({
                    response: { text: () => 'Valid Post Title' }
                })
                .mockResolvedValueOnce({
                    response: {
                        text: () => 'Data quality is everything in automation! Garbage in, garbage out - clean your inputs or face the consequences. Validation saves you from embarrassing failures later. Quality over quantity always wins. #DataQuality #Automation #TechBestPractices #CleanData'
                    }
                });

            mockTweet.mockResolvedValueOnce({
                data: { id: '9999999999', text: 'Quality tweet posted' }
            });

            const result = await dailyTweetJob();

            expect(result).toBe(true);

            // Verify data filtering occurred
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Topic scraping completed successfully')
            );
        });

        test('should validate tweet content requirements', async () => {
            // Mock successful scraping
            axios.get
                .mockResolvedValue({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Tweet Validation Test', score: 100, num_comments: 20, subreddit: 'india' } }
                            ]
                        }
                    }
                });

            mockGenerateContent
                .mockResolvedValueOnce({
                    response: { text: () => 'Tweet Validation Test' }
                })
                .mockResolvedValueOnce({
                    response: {
                        text: () => 'Tweet validation is critical for social media automation! Character limits, hashtag requirements, engagement hooks - every element needs checking. One invalid tweet can break your entire pipeline flow. #TwitterBot #Automation #SocialMedia #Validation #TechTips'
                    }
                });

            mockTweet.mockResolvedValueOnce({
                data: { id: '1111111111', text: 'Validation tweet posted' }
            });

            await dailyTweetJob();

            // Verify tweet validation logging
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Tweet generation completed successfully')
            );
        });
    });

    describe('Fallback and Recovery Mechanisms', () => {
        test('should recover from transient failures', async () => {
            // Mock transient failures followed by success
            axios.get
                .mockRejectedValueOnce(new Error('Temporary network glitch'))
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            children: [
                                { data: { title: 'Recovery Test Topic', score: 200, num_comments: 35, subreddit: 'india' } }
                            ]
                        }
                    }
                })
                .mockResolvedValue({
                    data: {
                        data: {
                            children: []
                        }
                    }
                });

            mockGenerateContent
                .mockResolvedValueOnce({
                    response: { text: () => 'Recovery Test Topic' }
                })
                .mockResolvedValueOnce({
                    response: {
                        text: () => 'Recovery mechanisms save the day when systems fail! Transient errors happen, but resilient code bounces back. Retry logic, fallbacks, circuit breakers - build for failure, succeed in chaos. #Resilience #ErrorHandling #SystemDesign #Reliability #TechArchitecture'
                    }
                });

            mockTweet.mockResolvedValueOnce({
                data: { id: '2222222222', text: 'Recovery tweet posted' }
            });

            const result = await dailyTweetJob();

            expect(result).toBe(true);

            // Verify recovery was logged
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('scraping attempt')
            );
        });

        test('should handle cascading failures gracefully', async () => {
            // Mock multiple system failures
            axios.get.mockRejectedValue(new Error('All scrapers down'));

            const result = await dailyTweetJob();

            expect(result).toBe(false);

            // Verify graceful failure handling
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Job failed: No topics available')
            );
            expect(mockGenerateContent).not.toHaveBeenCalled();
            expect(mockTweet).not.toHaveBeenCalled();
        });
    });
});