/**
 * Tests for configuration loader
 */

const { loadConfig, getConfig, validateConfig } = require('../src/config');

// Store original environment
const originalEnv = process.env;

describe('Configuration Loader', () => {
    beforeEach(() => {
        // Reset environment before each test
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        // Restore original environment
        process.env = originalEnv;
    });

    test('should load valid configuration successfully', () => {
        // Set all required environment variables
        process.env.TWITTER_API_KEY = 'test_twitter_key';
        process.env.TWITTER_API_SECRET = 'test_twitter_secret';
        process.env.TWITTER_ACCESS_TOKEN = 'test_access_token';
        process.env.TWITTER_ACCESS_TOKEN_SECRET = 'test_access_secret';
        process.env.GEMINI_API_KEY = 'test_gemini_key';
        process.env.NEWSDATA_API_KEY = 'test_newsdata_key';
        process.env.PORT = '3000';

        const config = getConfig();

        expect(config.twitter.apiKey).toBe('test_twitter_key');
        expect(config.twitter.apiSecret).toBe('test_twitter_secret');
        expect(config.twitter.accessToken).toBe('test_access_token');
        expect(config.twitter.accessTokenSecret).toBe('test_access_secret');
        expect(config.gemini.apiKey).toBe('test_gemini_key');
        expect(config.newsdata.apiKey).toBe('test_newsdata_key');
        expect(config.server.port).toBe(3000);
    });

    test('should use default PORT when not specified', () => {
        // Set required vars but not PORT
        process.env.TWITTER_API_KEY = 'test_key';
        process.env.TWITTER_API_SECRET = 'test_secret';
        process.env.TWITTER_ACCESS_TOKEN = 'test_token';
        process.env.TWITTER_ACCESS_TOKEN_SECRET = 'test_token_secret';
        process.env.GEMINI_API_KEY = 'test_gemini';
        process.env.NEWSDATA_API_KEY = 'test_newsdata';
        delete process.env.PORT;

        const config = getConfig();
        expect(config.server.port).toBe(3000);
    });

    test('should throw error for missing required variables', () => {
        // Only set some required variables
        process.env.TWITTER_API_KEY = 'test_key';
        delete process.env.TWITTER_API_SECRET;
        delete process.env.GEMINI_API_KEY;

        expect(() => {
            loadConfig();
        }).toThrow('Missing required environment variables');
    });

    test('should throw error for invalid PORT', () => {
        // Set all required vars but invalid PORT
        process.env.TWITTER_API_KEY = 'test_key';
        process.env.TWITTER_API_SECRET = 'test_secret';
        process.env.TWITTER_ACCESS_TOKEN = 'test_token';
        process.env.TWITTER_ACCESS_TOKEN_SECRET = 'test_token_secret';
        process.env.GEMINI_API_KEY = 'test_gemini';
        process.env.NEWSDATA_API_KEY = 'test_newsdata';
        process.env.PORT = 'invalid_port';

        expect(() => {
            getConfig();
        }).toThrow('PORT must be a valid number');
    });

    test('should trim whitespace from environment variables', () => {
        process.env.TWITTER_API_KEY = '  test_key  ';
        process.env.TWITTER_API_SECRET = 'test_secret';
        process.env.TWITTER_ACCESS_TOKEN = 'test_token';
        process.env.TWITTER_ACCESS_TOKEN_SECRET = 'test_token_secret';
        process.env.GEMINI_API_KEY = 'test_gemini';
        process.env.NEWSDATA_API_KEY = 'test_newsdata';

        const config = getConfig();
        expect(config.twitter.apiKey).toBe('test_key');
    });

    test('should treat empty strings as missing variables', () => {
        process.env.TWITTER_API_KEY = '';
        process.env.TWITTER_API_SECRET = 'test_secret';
        process.env.TWITTER_ACCESS_TOKEN = 'test_token';
        process.env.TWITTER_ACCESS_TOKEN_SECRET = 'test_token_secret';
        process.env.GEMINI_API_KEY = 'test_gemini';
        process.env.NEWSDATA_API_KEY = 'test_newsdata';

        expect(() => {
            loadConfig();
        }).toThrow('Missing required environment variables: TWITTER_API_KEY');
    });
});