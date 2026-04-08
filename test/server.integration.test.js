/**
 * Integration tests for Express health check server startup and configuration
 */

const { startServer, stopServer } = require('../src/server');

describe('Server Integration Tests', () => {
    let serverInstance;

    afterEach(async () => {
        if (serverInstance && serverInstance.server) {
            await stopServer(serverInstance.server);
            serverInstance = null;
        }
    });

    describe('Server Startup', () => {
        test('should start server with mock configuration', async () => {
            const mockConfig = {
                server: {
                    port: 0 // Use port 0 to let OS assign available port
                }
            };

            serverInstance = await startServer(mockConfig);

            expect(serverInstance).toHaveProperty('app');
            expect(serverInstance).toHaveProperty('server');
            expect(serverInstance).toHaveProperty('port');
            expect(typeof serverInstance.port).toBe('number');
            expect(serverInstance.port).toBeGreaterThan(0);
        });

        test('should handle server startup errors gracefully', async () => {
            const mockConfig = {
                server: {
                    port: -1 // Invalid port
                }
            };

            await expect(startServer(mockConfig)).rejects.toThrow();
        });
    });

    describe('Server Shutdown', () => {
        test('should stop server gracefully', async () => {
            const mockConfig = {
                server: {
                    port: 0
                }
            };

            serverInstance = await startServer(mockConfig);
            const server = serverInstance.server;

            // Should not throw
            await expect(stopServer(server)).resolves.toBeUndefined();

            // Clear reference since we manually stopped it
            serverInstance = null;
        });

        test('should handle stopping null server gracefully', async () => {
            await expect(stopServer(null)).resolves.toBeUndefined();
        });
    });
});