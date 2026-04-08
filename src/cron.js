/**
 * Cron scheduler module
 *
 * The project is designed to post one tweet every day at 20:00 IST (14:30 UTC).
 * This file intentionally exposes a small API used by:
 * - src/index.js (app startup/shutdown + health)
 * - test/cron.test.js (unit tests)
 */

const cron = require('node-cron');
const { scrapeAllSources } = require('./scraper');
const { selectBestTopic, generateTweet } = require('./gemini');
const { postTweet } = require('./twitter');
const { saveTweet, filterFreshTopics } = require('./db');
const { createLogger } = require('./logger');

const logger = createLogger('CRON');

// Daily schedule: 20:00 IST = 14:30 UTC
const DAILY_CRON_EXPRESSION_UTC = '30 14 * * *';

/**
 * Core daily tweet pipeline
 * @returns {Promise<boolean>} true on success, false on failure
 */
async function dailyTweetJob() {
  logger.info('Starting daily tweet job');

  try {
    const rawTopics = await scrapeAllSources();

    if (!Array.isArray(rawTopics) || rawTopics.length === 0) {
      logger.error('No topics scraped');
      return false;
    }

    const freshTopics = filterFreshTopics(rawTopics);
    const topicPool = Array.isArray(freshTopics) && freshTopics.length > 0 ? freshTopics : rawTopics;

    const selectedTopic = await selectBestTopic(topicPool);
    if (!selectedTopic) {
      logger.error('No topic selected');
      return false;
    }

    // NOTE: tests expect generateTweet(selectedTopic) (single argument).
    const generated = await generateTweet(selectedTopic);

    // Support both older (string) and newer ({ tweet, tweetType }) return shapes.
    const tweetText = typeof generated === 'string' ? generated : generated?.tweet;
    const tweetType = typeof generated === 'object' && generated ? generated.tweetType : undefined;

    if (!tweetText || typeof tweetText !== 'string' || tweetText.trim().length === 0) {
      logger.error('Empty tweet generated');
      return false;
    }

    const posted = await postTweet(tweetText);
    if (!posted) {
      logger.error('Tweet posting failed');
      return false;
    }

    // Optional persistence/dedupe (DB module is resilient if SQLite is unavailable).
    saveTweet({ topic: selectedTopic, tweet: tweetText, tweetType });

    logger.info('Daily tweet job completed successfully', {
      tweetLength: tweetText.length,
      tweetType: tweetType || 'unknown'
    });
    return true;

  } catch (error) {
    logger.error('Daily tweet job failed', error);
    return false;
  }
}

/**
 * Compute the next execution time (14:30 UTC daily)
 * @returns {Date}
 */
function getNextExecutionTime(now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(14, 30, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(14, 30, 0, 0);
  }
  return next;
}

/**
 * Initialize and start the cron scheduler
 * @returns {import('node-cron').ScheduledTask}
 */
function initializeCronScheduler() {
  logger.info('Initializing cron scheduler', {
    cronExpression: DAILY_CRON_EXPRESSION_UTC,
    timezone: 'UTC'
  });

  const task = cron.schedule(
    DAILY_CRON_EXPRESSION_UTC,
    async () => {
      await dailyTweetJob();
    },
    {
      timezone: 'UTC'
    }
  );

  // node-cron starts tasks immediately by default, but ensure it's running.
  if (typeof task.start === 'function') {
    task.start();
  }

  return task;
}

/**
 * Stop an active cron scheduler task
 */
function stopCronScheduler(task) {
  try {
    if (task && typeof task.stop === 'function') {
      task.stop();
    }
  } catch (error) {
    logger.error('Failed to stop cron scheduler', error);
  }
}

function formatDuration(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

/**
 * Get status information about cron scheduler
 */
function getCronStatus(task) {
  const now = new Date();
  const nextExecution = getNextExecutionTime(now);
  const timeUntilNext = nextExecution.getTime() - now.getTime();

  let isRunning = false;
  try {
    if (task && typeof task.getStatus === 'function') {
      isRunning = task.getStatus() === 'scheduled';
    } else if (task && typeof task.stop === 'function') {
      // Best-effort fallback when getStatus is unavailable.
      isRunning = true;
    }
  } catch {
    isRunning = false;
  }

  let nextExecutionIST = '';
  try {
    nextExecutionIST = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(nextExecution);
  } catch {
    nextExecutionIST = nextExecution.toISOString();
  }

  return {
    isRunning,
    nextExecution: nextExecution.toISOString(),
    nextExecutionIST,
    timeUntilNext,
    timeUntilNextFormatted: formatDuration(timeUntilNext)
  };
}

/**
 * Manual trigger for the job (used by tests / debugging)
 */
async function triggerManualJob() {
  return dailyTweetJob();
}

// Backwards-compatible aliases (if older code uses these names)
const startCronJobs = initializeCronScheduler;
const runNow = triggerManualJob;

module.exports = {
  // Primary API
  dailyTweetJob,
  initializeCronScheduler,
  stopCronScheduler,
  getNextExecutionTime,
  getCronStatus,
  triggerManualJob,

  // Compatibility
  startCronJobs,
  runNow
};
