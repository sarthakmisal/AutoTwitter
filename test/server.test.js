/**
 * Tests for Express health check server
 */

const request = require('supertest');
const { createServer } = require('../src/server');

describe('Health Check Server', () => {
    let app;

    beforeAll(() => {
        app = createServer();
    });

    describe('GET /health', () => {
        test('should return healthy status with timestamp', async () => {
            const response = await request(app)
                .get('/health')
                .expect(200);

            expect(response.body).toHaveProperty('status', 'healthy');
            expect(response.body).toHaveProperty('timestamp');
            expect(response.body).toHaveProperty('uptime');
            expect(response.body).toHaveProperty('service', 'twitter-autobot');

            // Verify timestamp is valid ISO string
            expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);

            // Verify uptime is a number
            expect(typeof response.body.uptime).toBe('number');
            expect(response.body.uptime).toBeGreaterThanOrEqual(0);
        });

        test('should return JSON content type', async () => {
            const response = await request(app)
                .get('/health')
                .expect(200);

            expect(response.headers['content-type']).toMatch(/application\/json/);
        });
    });

    describe('GET /', () => {
        test('should return service info', async () => {
            const response = await request(app)
                .get('/')
                .expect(200);

            expect(response.body).toHaveProperty('service', 'Twitter Autobot');
            expect(response.body).toHaveProperty('status', 'running');
            expect(response.body).toHaveProperty('timestamp');

            // Verify timestamp is valid ISO string
            expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);
        });
    });

    describe('Unknown routes', () => {
        test('should return 404 for unknown endpoints', async () => {
            const response = await request(app)
                .get('/unknown-endpoint')
                .expect(404);

            expect(response.body).toHaveProperty('error', 'Not Found');
            expect(response.body).toHaveProperty('message');
            expect(response.body).toHaveProperty('timestamp');
        });

        test('should handle POST requests to unknown endpoints', async () => {
            const response = await request(app)
                .post('/unknown-endpoint')
                .expect(404);

            expect(response.body).toHaveProperty('error', 'Not Found');
        });
    });
});