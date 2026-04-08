/**
 * Tests for cron job scheduler functionality
 */

const {
    dailyTweetJob,
    initializeCronScheduler,
    getNextExecutionTime,
    getCronStatus,
    triggerManualJob
} = require('../src/cron');

// Mock all external dependencies
jest.mock('../src/scraper');
jest.mock('../src/gemini');
jest.mock('../src/twitter');

const { scrapeAllSources } = require('../src/scraper');
const { selectBestTopic, generateTweet } = require('../src/gemini');
const { postTweet } = require('../src/twitter');

describe('Cron Job Scheduler', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        // Setup default mocks
        scrapeAllSources.mockResolvedValue([
            'Test topic 1',
            'Test topic 2',
            'Test topic 3'
        ]);

        selectBestTopic.mockResolvedValue('Selected test topic');
        generateTweet.mockResolvedValue('This is a test tweet that meets the character requirements for posting to Twitter and includes proper hashtags #test #automation. It needs to be longer to meet the 200-270 character requirement for optimal engagement and viral potential on the platform.');
        postTweet.mockResolvedValue(true);
    });

    describe('dailyTweetJob', () => {
        test('should complete successfully with valid data', async () => {
            const result = await dailyTweetJob();

            expect(result).toBe(true);
            expect(scrapeAllSources).toHaveBeenCalledTimes(1);
            expect(selectBestTopic).toHaveBeenCalledWith([
                'Test topic 1',
                'Test topic 2',
                'Test topic 3'
            ]);
            expect(generateTweet).toHaveBeenCalledWith('Selected test topic');
            expect(postTweet).toHaveBeenCalledWith('This is a test tweet that meets the character requirements for posting to Twitter and includes proper hashtags #test #automation. It needs to be longer to meet the 200-270 character requirement for optimal engagement and viral potential on the platform.');
        });

        test('should fail gracefully when no topics are scraped', async () => {
            scrapeAllSources.mockResolvedValue([]);

            const result = await dailyTweetJob();

            expect(result).toBe(false);
            expect(scrapeAllSources).toHaveBeenCalledTimes(1);
            expect(selectBestTopic).not.toHaveBeenCalled();
            expect(generateTweet).not.toHaveBeenCalled();
            expect(postTweet).not.toHaveBeenCalled();
        });

        test('should handle scraping errors gracefully', async () => {
            scrapeAllSources.mockRejectedValue(new Error('Scraping failed'));

            const result = await dailyTweetJob();

            expect(result).toBe(false);
            expect(scrapeAllSources).toHaveBeenCalledTimes(1);
        });

        test('should handle topic selection errors gracefully', async () => {
            selectBestTopic.mockRejectedValue(new Error('Topic selection failed'));

            const result = await dailyTweetJob();

            expect(result).toBe(false);
            expect(scrapeAllSources).toHaveBeenCalledTimes(1);
            expect(selectBestTopic).toHaveBeenCalledTimes(1);
        });

        test('should handle tweet generation errors gracefully', async () => {
            generateTweet.mockRejectedValue(new Error('Tweet generation failed'));

            const result = await dailyTweetJob();

            expect(result).toBe(false);
            expect(scrapeAllSources).toHaveBeenCalledTimes(1);
            expect(selectBestTopic).toHaveBeenCalledTimes(1);
            expect(generateTweet).toHaveBeenCalledTimes(1);
        });

        test('should continue when tweet posting fails', async () => {
            postTweet.mockResolvedValue(false);

            const result = await dailyTweetJob();

            expect(result).toBe(false);
            expect(scrapeAllSources).toHaveBeenCalledTimes(1);
            expect(selectBestTopic).toHaveBeenCalledTimes(1);
            expect(generateTweet).toHaveBeenCalledTimes(1);
            expect(postTweet).toHaveBeenCalledTimes(1);
        });
    });

    describe('getNextExecutionTime', () => {
        test('should return next execution time at 14:30 UTC', () => {
            const nextExecution = getNextExecutionTime();

            expect(nextExecution).toBeInstanceOf(Date);
            expect(nextExecution.getUTCHours()).toBe(14);
            expect(nextExecution.getUTCMinutes()).toBe(30);
            expect(nextExecution.getUTCSeconds()).toBe(0);
        });

        test('should return tomorrow if today execution time has passed', () => {
            // Mock current time to be after 14:30 UTC
            const mockDate = new Date();
            mockDate.setUTCHours(15, 0, 0, 0); // 15:00 UTC

            jest.spyOn(global, 'Date').mockImplementation(() => mockDate);

            const nextExecution = getNextExecutionTime();
            const tomorrow = new Date(mockDate);
            tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
            tomorrow.setUTCHours(14, 30, 0, 0);

            expect(nextExecution.getTime()).toBe(tomorrow.getTime());

            global.Date.mockRestore();
        });
    });

    describe('initializeCronScheduler', () => {
        test('should initialize cron scheduler without errors', () => {
            const task = initializeCronScheduler();

            expect(task).toBeDefined();
            expect(typeof task.start).toBe('function');
            expect(typeof task.stop).toBe('function');

            // Clean up
            task.stop();
        });
    });

    describe('getCronStatus', () => {
        test('should return status information', () => {
            const task = initializeCronScheduler();
            const status = getCronStatus(task);

            expect(status).toHaveProperty('isRunning');
            expect(status).toHaveProperty('nextExecution');
            expect(status).toHaveProperty('nextExecutionIST');
            expect(status).toHaveProperty('timeUntilNext');
            expect(status).toHaveProperty('timeUntilNextFormatted');

            expect(typeof status.isRunning).toBe('boolean');
            expect(typeof status.nextExecution).toBe('string');
            expect(typeof status.nextExecutionIST).toBe('string');
            expect(typeof status.timeUntilNext).toBe('number');
            expect(typeof status.timeUntilNextFormatted).toBe('string');

            // The task should be running after initialization
            expect(status.isRunning).toBe(true);

            // Clean up
            task.stop();
        });
    });

    describe('triggerManualJob', () => {
        test('should execute manual job successfully', async () => {
            const result = await triggerManualJob();

            expect(result).toBe(true);
            expect(scrapeAllSources).toHaveBeenCalledTimes(1);
            expect(selectBestTopic).toHaveBeenCalledTimes(1);
            expect(generateTweet).toHaveBeenCalledTimes(1);
            expect(postTweet).toHaveBeenCalledTimes(1);
        });
    });
});