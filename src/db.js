const path = require('path');
const { createLogger } = require('./logger');

const logger = createLogger('DB');
const DB_PATH = path.join(__dirname, '..', 'kaliyug_facts.db');

let db = null;

/**
 * Lazy-load better-sqlite3 (install: npm install better-sqlite3)
 */
function getDb() {
  if (db) return db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
    initSchema();
    return db;
  } catch (err) {
    logger.error('SQLite init failed — running without dedup', err);
    return null;
  }
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tweets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      tweet TEXT NOT NULL,
      tweet_type TEXT,
      posted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS used_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_hash TEXT UNIQUE NOT NULL,
      topic TEXT NOT NULL,
      used_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  logger.info('DB schema ready');
}

/**
 * Check if topic was used in last N days
 */
function isTopicUsed(topic, days = 7) {
  const database = getDb();
  if (!database) return false;

  try {
    const hash = simpleHash(topic);
    const row = database.prepare(`
      SELECT id FROM used_topics 
      WHERE topic_hash = ? 
      AND used_at >= datetime('now', '-${days} days')
    `).get(hash);
    return !!row;
  } catch (err) {
    logger.error('isTopicUsed failed', err);
    return false;
  }
}

/**
 * Filter out recently used topics from list
 */
function filterFreshTopics(topics, days = 7) {
  const database = getDb();
  if (!database) return topics; // no DB = no filter, proceed anyway

  return topics.filter(topic => !isTopicUsed(topic, days));
}

/**
 * Save posted tweet to DB
 */
function saveTweet({ topic, tweet, tweetType }) {
  const database = getDb();
  if (!database) return;

  try {
    const hash = simpleHash(topic);

    database.prepare(`
      INSERT INTO tweets (topic, tweet, tweet_type) VALUES (?, ?, ?)
    `).run(topic, tweet, tweetType || 'unknown');

    database.prepare(`
      INSERT OR IGNORE INTO used_topics (topic_hash, topic) VALUES (?, ?)
    `).run(hash, topic);

    logger.info('Tweet saved to DB', { topic: topic.substring(0, 50) });
  } catch (err) {
    logger.error('saveTweet failed', err);
  }
}

/**
 * Get last N tweets (for logs/debug)
 */
function getRecentTweets(limit = 10) {
  const database = getDb();
  if (!database) return [];

  try {
    return database.prepare(`
      SELECT tweet, topic, tweet_type, posted_at 
      FROM tweets ORDER BY posted_at DESC LIMIT ?
    `).all(limit);
  } catch (err) {
    logger.error('getRecentTweets failed', err);
    return [];
  }
}

/**
 * Simple string hash for topic dedup
 */
function simpleHash(str) {
  const normalized = str.toLowerCase().trim().substring(0, 100);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString();
}

module.exports = {
  saveTweet,
  filterFreshTopics,
  isTopicUsed,
  getRecentTweets
};
