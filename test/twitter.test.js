/**
 * Unit tests for Twitter API integration
 */

const { postTweet, validateTwitterCredentials, createTwitterClient } = require('../src/twitter');

// Mock the twitter-api-v2 module
jest.mock('twitter-api-v2');
const { TwitterApi } = require('twitter-api-v2');

// Mock the config module
jest.mock('../src/config');
const { getConfig } = require('../src/config');

describe('Twitter API Integration', () => {
    let mockTwitterClient;
    let mockV2;
    let consoleLogSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Setup console spies
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        // Mock config
        getConfig.mockReturnValue({
            twitter: {
                apiKey: 'test_api_key',
                apiSecret: 'test_api_secret',
                accessToken: 'test_access_token',
                accessTokenSecret: 'test_access_token_secret'
            }
        });

        // Setup Twitter API mocks
        mockV2 = {
            tweet: jest.fn(),
            me: jest.fn()
        };

        mockTwitterClient = {
            v2: mockV2
        };

        TwitterApi.mockImplementation(() => mockTwitterClient);
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    describe('createTwitterClient', () => {
        it('should create Twitter client with correct configuration', () => {
            const client = createTwitterClient();

            expect(TwitterApi).toHaveBeenCalledWith({
                appKey: 'test_api_key',
                appSecret: 'test_api_secret',
                accessToken: 'test_access_token',
                accessSecret: 'test_access_token_secret'
            });

            expect(client).toBe(mockTwitterClient);
        });
    });

    describe('postTweet', () => {
        const validTweet = 'A'.repeat(250); // 250 characters, within valid range

        it('should successfully post a valid tweet', async () => {
            const mockResponse = {
                data: {
                    id: '1234567890',
                    text: validTweet
                }
            };

            mockV2.tweet.mockResolvedValue(mockResponse);

            const result = await postTweet(validTweet);

            expect(result).toBe(true);
            expect(mockV2.tweet).toHaveBeenCalledWith(validTweet);
            expect(consoleLogSpy).toHaveBeenCalledWith('✓ Tweet posted successfully');
            expect(consoleLogSpy).toHaveBeenCalledWith('Tweet ID: 1234567890');
            expect(consoleLogSpy).toHaveBeenCalledWith(`Tweet content: ${validTweet}`);
        });

        it('should reject tweet that is too short', async () => {
            const shortTweet = 'A'.repeat(150); // 150 characters, too short

            const result = await postTweet(shortTweet);

            expect(result).toBe(false);
            expect(mockV2.tweet).not.toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                `Tweet posting failed: Tweet length ${shortTweet.length} is outside required range (200-270 characters)`
            );
            expect(consoleErrorSpy).toHaveBeenCalledWith(`Tweet content: ${shortTweet}`);
        });

        it('should reject tweet that is too long', async () => {
            const longTweet = 'A'.repeat(300); // 300 characters, too long

            const result = await postTweet(longTweet);

            expect(result).toBe(false);
            expect(mockV2.tweet).not.toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                `Tweet posting failed: Tweet length ${longTweet.length} is outside required range (200-270 characters)`
            );
            expect(consoleErrorSpy).toHaveBeenCalledWith(`Tweet content: ${longTweet}`);
        });

        it('should reject invalid tweet text (null)', async () => {
            const result = await postTweet(null);

            expect(result).toBe(false);
            expect(mockV2.tweet).not.toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalledWith('Tweet posting failed: Invalid tweet text provided');
        });

        it('should reject invalid tweet text (non-string)', async () => {
            const result = await postTweet(123);

            expect(result).toBe(false);
            expect(mockV2.tweet).not.toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalledWith('Tweet posting failed: Invalid tweet text provided');
        });

        it('should handle Twitter API errors gracefully', async () => {
            const error = new Error('Twitter API Error');
            error.code = 401;
            error.data = { detail: 'Unauthorized' };

            mockV2.tweet.mockRejectedValue(error);

            const result = await postTweet(validTweet);

            expect(result).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalledWith('Tweet posting failed:', 'Twitter API Error');
            expect(consoleErrorSpy).toHaveBeenCalledWith(`Tweet content: ${validTweet}`);
            expect(consoleErrorSpy).toHaveBeenCalledWith('Error code: 401');
            expect(consoleErrorSpy).toHaveBeenCalledWith('Error details:', { detail: 'Unauthorized' });
        });

        it('should handle unexpected response format', async () => {
            const mockResponse = {
                // Missing data.id
                data: {
                    text: validTweet
                }
            };

            mockV2.tweet.mockResolvedValue(mockResponse);

            const result = await postTweet(validTweet);

            expect(result).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalledWith('Tweet posting failed: Unexpected response format');
            expect(consoleErrorSpy).toHaveBeenCalledWith(`Tweet content: ${validTweet}`);
        });

        it('should handle completely invalid response', async () => {
            mockV2.tweet.mockResolvedValue(null);

            const result = await postTweet(validTweet);

            expect(result).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalledWith('Tweet posting failed: Unexpected response format');
            expect(consoleErrorSpy).toHaveBeenCalledWith(`Tweet content: ${validTweet}`);
        });
    });

    describe('validateTwitterCredentials', () => {
        it('should successfully validate credentials', async () => {
            const mockUserResponse = {
                data: {
                    id: '123456789',
                    username: 'testuser'
                }
            };

            mockV2.me.mockResolvedValue(mockUserResponse);

            const result = await validateTwitterCredentials();

            expect(result).toBe(true);
            expect(mockV2.me).toHaveBeenCalled();
            expect(consoleLogSpy).toHaveBeenCalledWith('✓ Twitter API credentials validated successfully');
            expect(consoleLogSpy).toHaveBeenCalledWith('Authenticated as: @testuser');
        });

        it('should handle invalid credentials', async () => {
            const error = new Error('Invalid credentials');
            mockV2.me.mockRejectedValue(error);

            const result = await validateTwitterCredentials();

            expect(result).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalledWith('✗ Twitter API credential validation failed:', 'Invalid credentials');
        });

        it('should handle unexpected user response format', async () => {
            mockV2.me.mockResolvedValue(null);

            const result = await validateTwitterCredentials();

            expect(result).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalledWith('✗ Twitter API credential validation failed: Invalid response');
        });

        it('should handle missing user data', async () => {
            const mockUserResponse = {
                // Missing data property
            };

            mockV2.me.mockResolvedValue(mockUserResponse);

            const result = await validateTwitterCredentials();

            expect(result).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalledWith('✗ Twitter API credential validation failed: Invalid response');
        });
    });
});