/**
 * Example usage of the configuration loader
 * This file demonstrates how to use the config module in the application
 */

// Load dotenv to read .env file
require('dotenv').config();

const { validateConfig } = require('./config');

// Example usage
try {
    console.log('Loading configuration...');
    const config = validateConfig();

    console.log('\nConfiguration structure:');
    console.log('- Twitter API credentials: configured');
    console.log('- Gemini AI API key: configured');
    console.log('- NewsData.io API key: configured');
    console.log(`- Server port: ${config.server.port}`);

    console.log('\nConfiguration loaded successfully! ✓');
} catch (error) {
    console.error('\nConfiguration failed to load:');
    console.error(error.message);
    console.error('\nPlease check your .env file and ensure all required variables are set.');
    process.exit(1);
}