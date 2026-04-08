const axios = require('axios');
const { scrapeReddit, scrapeNewsData, scrapeTrends24, scrapeAllSources, mergeTopics } = require('../src/scraper');

// Mock the config module
jest.mock('../src/config', () => ({
    getConfig: jest.fn(() => ({
        newsdata: {
            apiKey: 'test-api-key'
        }
    }))
}));

// Mock axios
jest.mock('axios');
const mockedAxios = axios;

describe('Reddit Scraper', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Clear console.log and console.error mocks
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        console.log.mockRestore();
        console.error.mockRestore();
    });

    const mockRedditResponse = {
        data: {
            data: {
                children: [
                    {
                        data: {
                            title: 'Test Post 1',
                            score: 150,
                            num_comments: 25,
                            subreddit: 'india',
                            permalink: '/r/india/comments/test1/'
                        }
                    },
                    {
                        data: {
                            title: 'Test Post 2',
                            score: 89,
                            num_comments: 12,
                            subreddit: 'india',
                            permalink: '/r/india/comments/test2/'
                        }
                    }
                ]
            }
        }
    };

    test('should scrape Reddit posts successfully with default subreddits', async () => {
        mockedAxios.get.mockResolvedValue(mockRedditResponse);

        const result = await scrapeReddit();

        expect(mockedAxios.get).toHaveBeenCalledTimes(2);
        expect(mockedAxios.get).toHaveBeenCalledWith(
            'https://www.reddit.com/r/india/hot.json',
            {
                params: { limit: 5 },
                headers: { 'User-Agent': 'TweetBot/1.0' },
                timeout: 10000
            }
        );
        expect(mockedAxios.get).toHaveBeenCalledWith(
            'https://www.reddit.com/r/technology/hot.json',
            {
                params: { limit: 5 },
                headers: { 'User-Agent': 'TweetBot/1.0' },
                timeout: 10000
            }
        );

        expect(result).toHaveLength(4); // 2 posts from each subreddit
        expect(result[0]).toEqual({
            source: 'reddit',
            title: 'Test Post 1',
            score: 150,
            comments: 25,
            subreddit: 'india',
            url: 'https://reddit.com/r/india/comments/test1/'
        });
    });

    test('should use correct User-Agent header', async () => {
        mockedAxios.get.mockResolvedValue(mockRedditResponse);

        await scrapeReddit(['india']);

        expect(mockedAxios.get).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                headers: { 'User-Agent': 'TweetBot/1.0' }
            })
        );
    });

    test('should extract title, score, and comment count correctly', async () => {
        mockedAxios.get.mockResolvedValue(mockRedditResponse);

        const result = await scrapeReddit(['india']);

        expect(result[0]).toMatchObject({
            title: expect.any(String),
            score: expect.any(Number),
            comments: expect.any(Number),
            subreddit: expect.any(String),
            source: 'reddit'
        });
    });

    test('should handle custom subreddits and limit', async () => {
        mockedAxios.get.mockResolvedValue(mockRedditResponse);

        await scrapeReddit(['programming'], 3);

        expect(mockedAxios.get).toHaveBeenCalledWith(
            'https://www.reddit.com/r/programming/hot.json',
            {
                params: { limit: 3 },
                headers: { 'User-Agent': 'TweetBot/1.0' },
                timeout: 10000
            }
        );
    });

    test('should handle API failures gracefully and continue with other subreddits', async () => {
        mockedAxios.get
            .mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce(mockRedditResponse);

        const result = await scrapeReddit(['india', 'technology']);

        expect(result).toHaveLength(2); // Only posts from successful subreddit
        expect(console.error).toHaveBeenCalledWith(
            'Failed to scrape r/india:',
            'Network error'
        );
    });

    test('should handle malformed Reddit API response', async () => {
        mockedAxios.get.mockResolvedValue({ data: null });

        const result = await scrapeReddit(['india']);

        expect(result).toHaveLength(0);
    });

    test('should handle empty Reddit response', async () => {
        mockedAxios.get.mockResolvedValue({
            data: {
                data: {
                    children: []
                }
            }
        });

        const result = await scrapeReddit(['india']);

        expect(result).toHaveLength(0);
        expect(console.log).toHaveBeenCalledWith('Successfully scraped 0 posts from r/india');
    });

    test('should handle timeout errors', async () => {
        mockedAxios.get.mockRejectedValue(new Error('timeout of 10000ms exceeded'));

        const result = await scrapeReddit(['india']);

        expect(result).toHaveLength(0);
        expect(console.error).toHaveBeenCalledWith(
            'Failed to scrape r/india:',
            'timeout of 10000ms exceeded'
        );
    });

    test('should log scraping progress', async () => {
        mockedAxios.get.mockResolvedValue(mockRedditResponse);

        await scrapeReddit(['india']);

        expect(console.log).toHaveBeenCalledWith('Scraping r/india...');
        expect(console.log).toHaveBeenCalledWith('Successfully scraped 2 posts from r/india');
    });
});

describe('NewsData.io Scraper', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Clear console.log and console.error mocks
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
        jest.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        console.log.mockRestore();
        console.error.mockRestore();
        console.warn.mockRestore();
    });

    const mockNewsDataResponse = {
        data: {
            status: 'success',
            totalResults: 10,
            results: [
                {
                    title: 'Tech Innovation in India',
                    description: 'Latest technology developments in Indian startups',
                    content: 'Full article content here...',
                    link: 'https://example.com/tech-news-1',
                    category: ['technology'],
                    pubDate: '2024-01-15 10:30:00'
                },
                {
                    title: 'Political Update from Delhi',
                    description: 'Recent political developments in the capital',
                    content: 'Political news content...',
                    link: 'https://example.com/politics-news-1',
                    category: ['politics'],
                    pubDate: '2024-01-15 09:15:00'
                },
                {
                    title: 'Business Growth in Mumbai',
                    description: 'Economic indicators show positive trends',
                    content: 'Business news content...',
                    link: 'https://example.com/business-news-1',
                    category: ['business'],
                    pubDate: '2024-01-15 08:45:00'
                }
            ]
        }
    };

    test('should scrape NewsData.io articles successfully with default categories', async () => {
        mockedAxios.get.mockResolvedValue(mockNewsDataResponse);

        const result = await scrapeNewsData();

        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
        expect(mockedAxios.get).toHaveBeenCalledWith(
            'https://newsdata.io/api/1/news',
            {
                params: {
                    apikey: 'test-api-key',
                    country: 'in',
                    category: 'technology,politics,business',
                    language: 'en',
                    size: 5
                },
                timeout: 10000
            }
        );

        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({
            source: 'newsdata',
            title: 'Tech Innovation in India',
            description: 'Latest technology developments in Indian startups',
            url: 'https://example.com/tech-news-1',
            category: 'technology',
            pubDate: '2024-01-15 10:30:00'
        });
    });

    test('should extract title and description from top 5 results', async () => {
        mockedAxios.get.mockResolvedValue(mockNewsDataResponse);

        const result = await scrapeNewsData();

        expect(result).toHaveLength(3);
        result.forEach(article => {
            expect(article).toMatchObject({
                title: expect.any(String),
                description: expect.any(String),
                source: 'newsdata',
                url: expect.any(String),
                category: expect.any(String)
            });
        });
    });

    test('should handle custom categories and limit', async () => {
        mockedAxios.get.mockResolvedValue(mockNewsDataResponse);

        await scrapeNewsData(['technology'], 3);

        expect(mockedAxios.get).toHaveBeenCalledWith(
            'https://newsdata.io/api/1/news',
            {
                params: {
                    apikey: 'test-api-key',
                    country: 'in',
                    category: 'technology',
                    language: 'en',
                    size: 3
                },
                timeout: 10000
            }
        );
    });

    test('should handle API failures gracefully', async () => {
        const errorResponse = {
            response: {
                status: 401,
                data: { error: 'Invalid API key' }
            },
            message: 'Request failed with status code 401'
        };
        mockedAxios.get.mockRejectedValue(errorResponse);

        const result = await scrapeNewsData();

        expect(result).toHaveLength(0);
        expect(console.error).toHaveBeenCalledWith(
            'Failed to scrape NewsData.io:',
            'Request failed with status code 401'
        );
        expect(console.error).toHaveBeenCalledWith(
            'NewsData.io API error status:',
            401
        );
        expect(console.error).toHaveBeenCalledWith(
            'NewsData.io API error data:',
            { error: 'Invalid API key' }
        );
    });

    test('should handle network errors gracefully', async () => {
        mockedAxios.get.mockRejectedValue(new Error('Network error'));

        const result = await scrapeNewsData();

        expect(result).toHaveLength(0);
        expect(console.error).toHaveBeenCalledWith(
            'Failed to scrape NewsData.io:',
            'Network error'
        );
    });

    test('should handle malformed API response', async () => {
        mockedAxios.get.mockResolvedValue({ data: null });

        const result = await scrapeNewsData();

        expect(result).toHaveLength(0);
        expect(console.warn).toHaveBeenCalledWith(
            'NewsData.io returned unexpected response format'
        );
    });

    test('should handle empty results array', async () => {
        mockedAxios.get.mockResolvedValue({
            data: {
                status: 'success',
                totalResults: 0,
                results: []
            }
        });

        const result = await scrapeNewsData();

        expect(result).toHaveLength(0);
        expect(console.log).toHaveBeenCalledWith('Successfully scraped 0 articles from NewsData.io');
    });

    test('should handle articles with missing fields gracefully', async () => {
        const incompleteResponse = {
            data: {
                status: 'success',
                results: [
                    {
                        title: null,
                        description: null,
                        content: 'Some content',
                        link: null,
                        category: null,
                        pubDate: null
                    }
                ]
            }
        };
        mockedAxios.get.mockResolvedValue(incompleteResponse);

        const result = await scrapeNewsData();

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            source: 'newsdata',
            title: 'No title',
            description: 'Some content', // Falls back to content
            url: '',
            category: 'general',
            pubDate: null
        });
    });

    test('should use description fallback when content is available', async () => {
        const responseWithContent = {
            data: {
                status: 'success',
                results: [
                    {
                        title: 'Test Article',
                        description: null,
                        content: 'Article content as fallback',
                        link: 'https://example.com/test',
                        category: ['technology'],
                        pubDate: '2024-01-15 10:00:00'
                    }
                ]
            }
        };
        mockedAxios.get.mockResolvedValue(responseWithContent);

        const result = await scrapeNewsData();

        expect(result[0].description).toBe('Article content as fallback');
    });

    test('should limit results to specified size', async () => {
        const largeResponse = {
            data: {
                status: 'success',
                results: Array(10).fill(null).map((_, i) => ({
                    title: `Article ${i + 1}`,
                    description: `Description ${i + 1}`,
                    link: `https://example.com/article-${i + 1}`,
                    category: ['technology'],
                    pubDate: '2024-01-15 10:00:00'
                }))
            }
        };
        mockedAxios.get.mockResolvedValue(largeResponse);

        const result = await scrapeNewsData(['technology'], 3);

        expect(result).toHaveLength(3);
    });

    test('should log scraping progress', async () => {
        mockedAxios.get.mockResolvedValue(mockNewsDataResponse);

        await scrapeNewsData();

        expect(console.log).toHaveBeenCalledWith('Scraping NewsData.io...');
        expect(console.log).toHaveBeenCalledWith('Successfully scraped 3 articles from NewsData.io');
    });

    test('should handle timeout errors', async () => {
        mockedAxios.get.mockRejectedValue(new Error('timeout of 10000ms exceeded'));

        const result = await scrapeNewsData();

        expect(result).toHaveLength(0);
        expect(console.error).toHaveBeenCalledWith(
            'Failed to scrape NewsData.io:',
            'timeout of 10000ms exceeded'
        );
    });
});

describe('Trends24 Scraper', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Clear console.log and console.error mocks
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
        jest.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        console.log.mockRestore();
        console.error.mockRestore();
        console.warn.mockRestore();
    });

    const mockTrends24HTML = `
        <html>
            <body>
                <div id="trend-list">
                    <li>Modi Government</li>
                    <li>Cricket World Cup</li>
                    <li>Bollywood News</li>
                    <li>Tech Innovation</li>
                    <li>Stock Market</li>
                    <li>Weather Update</li>
                    <li>Election Results</li>
                    <li>Sports News</li>
                    <li>Entertainment</li>
                    <li>Business Growth</li>
                    <li>Extra Trend</li>
                </div>
            </body>
        </html>
    `;

    const mockTrends24Response = {
        data: mockTrends24HTML
    };

    test('should scrape Trends24 topics successfully with default limit', async () => {
        mockedAxios.get.mockResolvedValue(mockTrends24Response);

        const result = await scrapeTrends24();

        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
        expect(mockedAxios.get).toHaveBeenCalledWith(
            'https://trends24.in/india/',
            {
                headers: {
                    'User-Agent': 'TweetBot/1.0',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                },
                timeout: 10000
            }
        );

        expect(result).toHaveLength(10);
        expect(result[0]).toEqual({
            source: 'trends24',
            topic: 'Modi Government',
            rank: 1
        });
        expect(result[9]).toEqual({
            source: 'trends24',
            topic: 'Business Growth',
            rank: 10
        });
    });

    test('should extract top 10 trend strings from #trend-list li tags', async () => {
        mockedAxios.get.mockResolvedValue(mockTrends24Response);

        const result = await scrapeTrends24();

        expect(result).toHaveLength(10);
        result.forEach((trend, index) => {
            expect(trend).toMatchObject({
                source: 'trends24',
                topic: expect.any(String),
                rank: index + 1
            });
            expect(trend.topic.length).toBeGreaterThan(0);
        });
    });

    test('should handle custom limit parameter', async () => {
        mockedAxios.get.mockResolvedValue(mockTrends24Response);

        const result = await scrapeTrends24(5);

        expect(result).toHaveLength(5);
        expect(result[4]).toEqual({
            source: 'trends24',
            topic: 'Stock Market',
            rank: 5
        });
    });

    test('should use correct User-Agent header', async () => {
        mockedAxios.get.mockResolvedValue(mockTrends24Response);

        await scrapeTrends24();

        expect(mockedAxios.get).toHaveBeenCalledWith(
            'https://trends24.in/india/',
            expect.objectContaining({
                headers: expect.objectContaining({
                    'User-Agent': 'TweetBot/1.0'
                })
            })
        );
    });

    test('should handle web scraping failures gracefully', async () => {
        const errorResponse = {
            response: {
                status: 503,
                headers: { 'content-type': 'text/html' }
            },
            message: 'Request failed with status code 503'
        };
        mockedAxios.get.mockRejectedValue(errorResponse);

        const result = await scrapeTrends24();

        expect(result).toHaveLength(0);
        expect(console.error).toHaveBeenCalledWith(
            'Failed to scrape Trends24.in:',
            'Request failed with status code 503'
        );
        expect(console.error).toHaveBeenCalledWith(
            'Trends24.in error status:',
            503
        );
    });

    test('should handle network errors gracefully', async () => {
        mockedAxios.get.mockRejectedValue(new Error('Network error'));

        const result = await scrapeTrends24();

        expect(result).toHaveLength(0);
        expect(console.error).toHaveBeenCalledWith(
            'Failed to scrape Trends24.in:',
            'Network error'
        );
    });

    test('should handle empty HTML response', async () => {
        mockedAxios.get.mockResolvedValue({ data: '' });

        const result = await scrapeTrends24();

        expect(result).toHaveLength(0);
        expect(console.log).toHaveBeenCalledWith('Successfully scraped 0 trends from Trends24.in');
    });

    test('should handle HTML without trend-list element', async () => {
        const emptyHTML = '<html><body><div>No trends here</div></body></html>';
        mockedAxios.get.mockResolvedValue({ data: emptyHTML });

        const result = await scrapeTrends24();

        expect(result).toHaveLength(0);
        expect(console.log).toHaveBeenCalledWith('Successfully scraped 0 trends from Trends24.in');
    });

    test('should handle HTML with empty trend list', async () => {
        const emptyTrendHTML = '<html><body><div id="trend-list"></div></body></html>';
        mockedAxios.get.mockResolvedValue({ data: emptyTrendHTML });

        const result = await scrapeTrends24();

        expect(result).toHaveLength(0);
        expect(console.log).toHaveBeenCalledWith('Successfully scraped 0 trends from Trends24.in');
    });

    test('should handle HTML with whitespace-only trends', async () => {
        const whitespaceHTML = `
            <html>
                <body>
                    <div id="trend-list">
                        <li>   </li>
                        <li></li>
                        <li>Valid Trend</li>
                        <li>  Another Valid Trend  </li>
                    </div>
                </body>
            </html>
        `;
        mockedAxios.get.mockResolvedValue({ data: whitespaceHTML });

        const result = await scrapeTrends24();

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            source: 'trends24',
            topic: 'Valid Trend',
            rank: 1
        });
        expect(result[1]).toEqual({
            source: 'trends24',
            topic: 'Another Valid Trend',
            rank: 2
        });
    });

    test('should handle timeout errors', async () => {
        mockedAxios.get.mockRejectedValue(new Error('timeout of 10000ms exceeded'));

        const result = await scrapeTrends24();

        expect(result).toHaveLength(0);
        expect(console.error).toHaveBeenCalledWith(
            'Failed to scrape Trends24.in:',
            'timeout of 10000ms exceeded'
        );
    });

    test('should log scraping progress', async () => {
        mockedAxios.get.mockResolvedValue(mockTrends24Response);

        await scrapeTrends24();

        expect(console.log).toHaveBeenCalledWith('Scraping Trends24.in...');
        expect(console.log).toHaveBeenCalledWith('Successfully scraped 10 trends from Trends24.in');
    });

    test('should handle null response data', async () => {
        mockedAxios.get.mockResolvedValue({ data: null });

        const result = await scrapeTrends24();

        expect(result).toHaveLength(0);
        expect(console.warn).toHaveBeenCalledWith('Trends24.in returned empty response');
    });
});

describe('Topic Merging', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
        jest.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        console.log.mockRestore();
        console.error.mockRestore();
        console.warn.mockRestore();
    });

    test('should merge topics from all successful sources', () => {
        const mockResults = [
            {
                status: 'fulfilled',
                value: [
                    { source: 'reddit', title: 'Reddit Post 1', score: 100, comments: 20 },
                    { source: 'reddit', title: 'Reddit Post 2', score: 50, comments: 10 }
                ]
            },
            {
                status: 'fulfilled',
                value: [
                    { source: 'newsdata', title: 'News Article 1', description: 'News description 1' },
                    { source: 'newsdata', title: 'News Article 2', description: 'News description 2' }
                ]
            },
            {
                status: 'fulfilled',
                value: [
                    { source: 'trends24', topic: 'Trending Topic 1', rank: 1 },
                    { source: 'trends24', topic: 'Trending Topic 2', rank: 2 }
                ]
            }
        ];

        const result = mergeTopics(mockResults);

        expect(result).toHaveLength(6);
        expect(result).toEqual([
            'Reddit Post 1',
            'Reddit Post 2',
            'News Article 1: News description 1',
            'News Article 2: News description 2',
            'Trending Topic 1',
            'Trending Topic 2'
        ]);

        expect(console.log).toHaveBeenCalledWith('Merged 2 topics from Reddit');
        expect(console.log).toHaveBeenCalledWith('Merged 2 topics from NewsData.io');
        expect(console.log).toHaveBeenCalledWith('Merged 2 topics from Trends24');
    });

    test('should handle partial failures gracefully', () => {
        const mockResults = [
            {
                status: 'fulfilled',
                value: [
                    { source: 'reddit', title: 'Reddit Post 1', score: 100, comments: 20 }
                ]
            },
            {
                status: 'rejected',
                reason: new Error('NewsData API failed')
            },
            {
                status: 'fulfilled',
                value: [
                    { source: 'trends24', topic: 'Trending Topic 1', rank: 1 }
                ]
            }
        ];

        const result = mergeTopics(mockResults);

        expect(result).toHaveLength(2);
        expect(result).toEqual([
            'Reddit Post 1',
            'Trending Topic 1'
        ]);

        expect(console.log).toHaveBeenCalledWith('Merged 1 topics from Reddit');
        expect(console.error).toHaveBeenCalledWith('NewsData.io scraper failed:', 'NewsData API failed');
        expect(console.log).toHaveBeenCalledWith('Merged 1 topics from Trends24');
    });

    test('should handle all scrapers failing', () => {
        const mockResults = [
            {
                status: 'rejected',
                reason: new Error('Reddit failed')
            },
            {
                status: 'rejected',
                reason: new Error('NewsData failed')
            },
            {
                status: 'rejected',
                reason: new Error('Trends24 failed')
            }
        ];

        const result = mergeTopics(mockResults);

        expect(result).toHaveLength(0);
        expect(console.error).toHaveBeenCalledWith('Reddit scraper failed:', 'Reddit failed');
        expect(console.error).toHaveBeenCalledWith('NewsData.io scraper failed:', 'NewsData failed');
        expect(console.error).toHaveBeenCalledWith('Trends24 scraper failed:', 'Trends24 failed');
    });

    test('should handle empty results from successful scrapers', () => {
        const mockResults = [
            {
                status: 'fulfilled',
                value: []
            },
            {
                status: 'fulfilled',
                value: [
                    { source: 'newsdata', title: 'News Article 1', description: 'News description 1' }
                ]
            },
            {
                status: 'fulfilled',
                value: []
            }
        ];

        const result = mergeTopics(mockResults);

        expect(result).toHaveLength(1);
        expect(result).toEqual(['News Article 1: News description 1']);

        expect(console.log).toHaveBeenCalledWith('Merged 0 topics from Reddit');
        expect(console.log).toHaveBeenCalledWith('Merged 1 topics from NewsData.io');
        expect(console.log).toHaveBeenCalledWith('Merged 0 topics from Trends24');
    });

    test('should filter out empty or whitespace-only topics', () => {
        const mockResults = [
            {
                status: 'fulfilled',
                value: [
                    { source: 'reddit', title: '', score: 100, comments: 20 },
                    { source: 'reddit', title: '   ', score: 50, comments: 10 },
                    { source: 'reddit', title: 'Valid Reddit Post', score: 75, comments: 15 }
                ]
            },
            {
                status: 'fulfilled',
                value: [
                    { source: 'newsdata', title: 'Valid News', description: '' },
                    { source: 'newsdata', title: '', description: 'Valid Description' }
                ]
            },
            {
                status: 'fulfilled',
                value: [
                    { source: 'trends24', topic: '   ', rank: 1 },
                    { source: 'trends24', topic: 'Valid Trend', rank: 2 }
                ]
            }
        ];

        const result = mergeTopics(mockResults);

        expect(result).toHaveLength(4);
        expect(result).toEqual([
            'Valid Reddit Post',
            'Valid News:',
            ': Valid Description',
            'Valid Trend'
        ]);
    });

    test('should handle invalid data structures gracefully', () => {
        const mockResults = [
            {
                status: 'fulfilled',
                value: null
            },
            {
                status: 'fulfilled',
                value: 'not an array'
            },
            {
                status: 'fulfilled',
                value: [
                    { source: 'reddit', title: 'Valid Post', score: 100, comments: 20 }
                ]
            }
        ];

        const result = mergeTopics(mockResults);

        expect(result).toHaveLength(1);
        expect(result).toEqual(['Valid Post']);

        expect(console.warn).toHaveBeenCalledWith('Reddit returned no data or invalid format');
        expect(console.warn).toHaveBeenCalledWith('NewsData.io returned no data or invalid format');
        expect(console.log).toHaveBeenCalledWith('Merged 1 topics from Trends24');
    });
});

describe('Unified Scraping Pipeline', () => {
    let mockScrapeReddit, mockScrapeNewsData, mockScrapeTrends24;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
        jest.spyOn(console, 'warn').mockImplementation(() => { });

        // Mock the individual scraper functions
        const scraperModule = require('../src/scraper');
        mockScrapeReddit = jest.spyOn(scraperModule, 'scrapeReddit');
        mockScrapeNewsData = jest.spyOn(scraperModule, 'scrapeNewsData');
        mockScrapeTrends24 = jest.spyOn(scraperModule, 'scrapeTrends24');
    });

    afterEach(() => {
        console.log.mockRestore();
        console.error.mockRestore();
        console.warn.mockRestore();
        jest.restoreAllMocks();
    });

    test('should successfully scrape from all sources and merge topics', async () => {
        mockScrapeReddit.mockResolvedValue([
            { source: 'reddit', title: 'Reddit Post 1', score: 150, comments: 25, subreddit: 'india' },
            { source: 'reddit', title: 'Reddit Post 2', score: 100, comments: 15, subreddit: 'technology' }
        ]);

        mockScrapeNewsData.mockResolvedValue([
            { source: 'newsdata', title: 'Tech Innovation in India', description: 'Latest technology developments' }
        ]);

        mockScrapeTrends24.mockResolvedValue([
            { source: 'trends24', topic: 'Modi Government', rank: 1 }
        ]);

        const result = await scrapeAllSources();

        expect(result).toHaveLength(4);
        expect(result).toEqual([
            'Reddit Post 1',
            'Reddit Post 2',
            'Tech Innovation in India: Latest technology developments',
            'Modi Government'
        ]);

        expect(console.log).toHaveBeenCalledWith('Starting unified scraping pipeline...');
        expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Scraping pipeline completed in \d+ms/));
        expect(console.log).toHaveBeenCalledWith('Total topics collected: 4');
        expect(console.log).toHaveBeenCalledWith('Scrapers: 3 successful, 0 failed');
    });

    test('should handle partial failures and continue with successful scrapers', async () => {
        mockScrapeReddit.mockRejectedValue(new Error('Reddit failed'));
        mockScrapeNewsData.mockResolvedValue([
            { source: 'newsdata', title: 'Tech Innovation in India', description: 'Latest technology developments' }
        ]);
        mockScrapeTrends24.mockRejectedValue(new Error('Trends24 failed'));

        const result = await scrapeAllSources();

        expect(result).toHaveLength(1);
        expect(result).toEqual([
            'Tech Innovation in India: Latest technology developments'
        ]);

        expect(console.log).toHaveBeenCalledWith('Starting unified scraping pipeline...');
        expect(console.log).toHaveBeenCalledWith('Total topics collected: 1');
        expect(console.log).toHaveBeenCalledWith('Scrapers: 1 successful, 2 failed');
    });

    test('should handle all scrapers failing gracefully', async () => {
        mockScrapeReddit.mockRejectedValue(new Error('Reddit failed'));
        mockScrapeNewsData.mockRejectedValue(new Error('NewsData failed'));
        mockScrapeTrends24.mockRejectedValue(new Error('Trends24 failed'));

        const result = await scrapeAllSources();

        expect(result).toHaveLength(0);
        expect(console.log).toHaveBeenCalledWith('Starting unified scraping pipeline...');
        expect(console.log).toHaveBeenCalledWith('Total topics collected: 0');
        expect(console.log).toHaveBeenCalledWith('Scrapers: 0 successful, 3 failed');
        expect(console.warn).toHaveBeenCalledWith('No topics were successfully scraped from any source');
    });

    test('should handle empty results from all scrapers', async () => {
        mockScrapeReddit.mockResolvedValue([]);
        mockScrapeNewsData.mockResolvedValue([]);
        mockScrapeTrends24.mockResolvedValue([]);

        const result = await scrapeAllSources();

        expect(result).toHaveLength(0);
        expect(console.log).toHaveBeenCalledWith('Total topics collected: 0');
        expect(console.log).toHaveBeenCalledWith('Scrapers: 3 successful, 0 failed');
        expect(console.warn).toHaveBeenCalledWith('No topics were successfully scraped from any source');
    });

    test('should handle mixed success and empty results', async () => {
        mockScrapeReddit.mockResolvedValue([]);
        mockScrapeNewsData.mockResolvedValue([
            { source: 'newsdata', title: 'Tech Innovation in India', description: 'Latest technology developments' }
        ]);
        mockScrapeTrends24.mockRejectedValue(new Error('Trends24 failed'));

        const result = await scrapeAllSources();

        expect(result).toHaveLength(1);
        expect(result).toEqual([
            'Tech Innovation in India: Latest technology developments'
        ]);

        expect(console.log).toHaveBeenCalledWith('Total topics collected: 1');
        expect(console.log).toHaveBeenCalledWith('Scrapers: 2 successful, 1 failed');
    });
});