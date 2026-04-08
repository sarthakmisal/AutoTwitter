// Mock the Google Generative AI module before importing
jest.mock('@google/generative-ai');

const { selectBestTopic, generateTweet } = require('../src/gemini');
const { GoogleGenerativeAI } = require('@google/generative-ai');

describe('Gemini AI Service', () => {
    let mockGenerateContent;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Setup mock
        mockGenerateContent = jest.fn();
        GoogleGenerativeAI.mockImplementation(() => ({
            getGenerativeModel: () => ({
                generateContent: mockGenerateContent
            })
        }));

        // Mock environment variable
        process.env.GEMINI_API_KEY = 'test-api-key';
    });

    describe('selectBestTopic', () => {
        it('should select a topic from provided topics array', async () => {
            const mockTopics = [
                'India vs Pakistan cricket match controversy',
                'New tech startup funding in Bangalore',
                'Bollywood celebrity wedding drama'
            ];

            const mockResponse = {
                response: {
                    text: () => 'India vs Pakistan cricket match controversy'
                }
            };

            mockGenerateContent.mockResolvedValue(mockResponse);

            const result = await selectBestTopic(mockTopics);

            expect(result).toBe('India vs Pakistan cricket match controversy');
            expect(mockGenerateContent).toHaveBeenCalledTimes(1);
            expect(mockGenerateContent).toHaveBeenCalledWith(expect.stringContaining('viral tweet strategist'));
        });

        it('should throw error when no topics provided', async () => {
            await expect(selectBestTopic([])).rejects.toThrow('No topics provided for selection');
            await expect(selectBestTopic(null)).rejects.toThrow('No topics provided for selection');
        });

        it('should throw error when Gemini returns empty response', async () => {
            const mockTopics = ['Test topic'];
            const mockResponse = {
                response: {
                    text: () => ''
                }
            };

            mockGenerateContent.mockResolvedValue(mockResponse);

            await expect(selectBestTopic(mockTopics)).rejects.toThrow('Gemini returned empty response for topic selection');
        });

        it('should retry once after 3 seconds on API failure', async () => {
            const mockTopics = ['Test topic'];

            // First call fails
            mockGenerateContent.mockRejectedValueOnce(new Error('API Error'));

            // Second call succeeds
            const mockResponse = {
                response: {
                    text: () => 'Test topic'
                }
            };
            mockGenerateContent.mockResolvedValueOnce(mockResponse);

            // Mock setTimeout to avoid actual delay in tests
            jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
                callback();
                return 123; // mock timer id
            });

            const result = await selectBestTopic(mockTopics);

            expect(result).toBe('Test topic');
            expect(mockGenerateContent).toHaveBeenCalledTimes(2);
            expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 3000);

            // Restore setTimeout
            setTimeout.mockRestore();
        });

        it('should throw error after retry fails', async () => {
            const mockTopics = ['Test topic'];

            // Both calls fail
            mockGenerateContent.mockRejectedValue(new Error('API Error'));

            // Mock setTimeout to avoid actual delay in tests
            jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
                callback();
                return 123;
            });

            await expect(selectBestTopic(mockTopics)).rejects.toThrow('Topic selection failed after retry');
            expect(mockGenerateContent).toHaveBeenCalledTimes(2);

            setTimeout.mockRestore();
        });

        it('should handle topics with special characters and formatting', async () => {
            const mockTopics = [
                'Topic with "quotes" and symbols!',
                'Topic with\nnewlines',
                'Topic with émojis 🔥'
            ];

            const mockResponse = {
                response: {
                    text: () => 'Topic with "quotes" and symbols!'
                }
            };

            mockGenerateContent.mockResolvedValue(mockResponse);

            const result = await selectBestTopic(mockTopics);

            expect(result).toBe('Topic with "quotes" and symbols!');
            expect(mockGenerateContent).toHaveBeenCalledWith(expect.stringContaining('Topic with "quotes"'));
        });
    });

    describe('generateTweet', () => {
        it('should generate a tweet for given topic', async () => {
            const mockTopic = 'India vs Pakistan cricket match controversy';
            const mockTweetText = 'bruh this india pak match got everyone losing their minds 😤 cricket fans really think this is life or death situation yaar... like touch grass maybe? its just a game or am i missing something here? #CricketFever #IndvsPak #GetALife';

            const mockResponse = {
                response: {
                    text: () => mockTweetText
                }
            };

            mockGenerateContent.mockResolvedValue(mockResponse);

            const result = await generateTweet(mockTopic);

            expect(result).toBe(mockTweetText);
            expect(mockGenerateContent).toHaveBeenCalledTimes(1);
            expect(mockGenerateContent).toHaveBeenCalledWith(expect.stringContaining('savage, unfiltered Gen Z'));
        });

        it('should throw error when no topic provided', async () => {
            await expect(generateTweet('')).rejects.toThrow('No topic provided for tweet generation');
            await expect(generateTweet(null)).rejects.toThrow('No topic provided for tweet generation');
            await expect(generateTweet('   ')).rejects.toThrow('No topic provided for tweet generation');
        });

        it('should warn when tweet length is outside optimal range', async () => {
            const mockTopic = 'Test topic';
            const shortTweet = 'short tweet'; // Less than 200 chars
            const longTweet = 'a'.repeat(300); // More than 270 chars

            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            // Test short tweet
            mockGenerateContent.mockResolvedValueOnce({
                response: { text: () => shortTweet }
            });

            await generateTweet(mockTopic);
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('outside optimal range'));

            // Test long tweet
            mockGenerateContent.mockResolvedValueOnce({
                response: { text: () => longTweet }
            });

            await generateTweet(mockTopic);
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('outside optimal range'));

            consoleSpy.mockRestore();
        });

        it('should handle API errors gracefully', async () => {
            const mockTopic = 'Test topic';
            mockGenerateContent.mockRejectedValue(new Error('API Error'));

            await expect(generateTweet(mockTopic)).rejects.toThrow('Tweet generation failed: API Error');
        });

        it('should accept tweets within optimal character range without warning', async () => {
            const mockTopic = 'Test topic';
            const optimalTweet = 'a'.repeat(235); // Within 200-270 range

            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            mockGenerateContent.mockResolvedValue({
                response: { text: () => optimalTweet }
            });

            const result = await generateTweet(mockTopic);

            expect(result).toBe(optimalTweet);
            expect(consoleSpy).not.toHaveBeenCalled();

            consoleSpy.mockRestore();
        });
    });
});