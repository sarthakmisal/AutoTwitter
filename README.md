# Twitter Autobot

Twitter Autobot is a Node.js service that:
- Scrapes trending topics from multiple sources
- Uses Gemini to pick the best topic and write a tweet in a Hinglish “Kaliyug Facts” voice
- Posts the tweet to Twitter/X via Twitter API v2
- Runs on a daily schedule via an in-process cron job

It exposes a small Express server for health monitoring (no UI).

## What Happens Every Day (Schedule)

The scheduler is implemented in [src/cron.js](src/cron.js) using `node-cron`.

**Current schedule (exactly as coded):**
- Cron expression: `30 14 * * *`
- Time zone used by the scheduler: `UTC`
- Meaning: every day at **14:30 UTC** which is **20:00 IST**

### What happens at 14:30 UTC

When the process is running and the clock hits 14:30 UTC, the cron callback runs `dailyTweetJob()`.

`dailyTweetJob()` performs these steps:
1. **Scrape topics** from:
   - Reddit (`/r/india` and `/r/technology`)
   - NewsData.io (categories: `technology,politics,business`)
   - Trends24 (India page)
2. **Merge** all results into a single array of topic strings.
   - Reddit items become: post `title`
   - NewsData.io items become: `title: description`
   - Trends24 items become: the trend `topic`
3. **De-duplicate “recently used” topics** using SQLite (last 7 days) when SQLite is available.
4. **Select the best topic** using Gemini (`gemini-1.5-flash`).
5. **Generate a tweet** using Gemini (`gemini-1.5-flash`).
6. **Post to Twitter/X** using Twitter API v2.
7. **Persist** the posted tweet + used-topic hash to SQLite for future de-duplication.

## Will It “Surely” Post at the Exact Time?

It will post **only if all of these are true at the scheduled time**:
- The Node.js process is running (cron is in-process; if the service is stopped/sleeping, nothing runs)
- Your environment variables are present and valid
- The scrapers can return *some* topics (or the system falls back to default topics if all scrapers fail)
- Gemini API requests succeed
- The generated tweet passes the posting validation (Twitter module enforces **200–270 characters**)
- Twitter/X API credentials are valid and Twitter accepts the post (no auth failures, no rate limits, etc.)

Important timing behavior (this is how `node-cron` works):
- If your service is **down** at 14:30 UTC, the tweet is **not queued** and will **not “catch up”** later.
- If your host sleeps your process (common on free tiers), the cron job will not run while sleeping.

If you need “always posts at 20:00 IST” guarantees, you typically add an **external scheduler** (Render Cron, GitHub Actions, a cloud scheduler) that hits an endpoint or runs a job, rather than relying only on an in-process cron.

## Quick Start

### Prerequisites
- Node.js `>=18`
- Twitter/X Developer credentials (API key/secret + access token/secret)
- Google AI Studio Gemini API key
- NewsData.io API key

### Install
```bash
npm install
```

### Configure env
Create a `.env` file in the project root:
```bash
TWITTER_API_KEY=...
TWITTER_API_SECRET=...
TWITTER_ACCESS_TOKEN=...
TWITTER_ACCESS_TOKEN_SECRET=...

GEMINI_API_KEY=...
NEWSDATA_API_KEY=...

PORT=3000
```

### Run
```bash
npm start
```

## Service Endpoints

Implemented in [src/server.js](src/server.js):

- `GET /` returns basic service info
- `GET /health` returns a structured health payload

Example health response shape (fields may vary slightly by runtime):
```json
{
  "status": "healthy",
  "timestamp": "2026-04-08T00:00:00.000Z",
  "uptime": 123.45,
  "service": "twitter-autobot",
  "version": "1.0.0",
  "memory": { "used": 16, "total": 32, "rss": 70, "external": 3 },
  "system": { "nodeVersion": "v22.x", "platform": "win32", "arch": "x64", "pid": 1234 },
  "environment": "development"
}
```

## Data Sources (Exact)

### Reddit
- Endpoint: `https://www.reddit.com/r/{subreddit}/hot.json`
- Default subreddits: `india`, `technology`
- Uses header `User-Agent: TweetBot/1.0`
- Timeout: 10s
- Retries: 1 retry (2 total attempts per subreddit)

### NewsData.io
- Endpoint: `https://newsdata.io/api/1/news`
- Default categories: `technology,politics,business`
- Country: `in`
- Language: `en`
- Size: `5`
- Timeout: 15s
- Retries: up to 2 retries (3 total attempts)

### Trends24
- URL: `https://trends24.in/india/`
- Parses HTML with Cheerio using selector `#trend-list li`
- Default limit: 10
- Timeout: 15s

### Last-resort fallback topics
If all scrapers fail, [src/scraper.js](src/scraper.js) falls back to a small built-in list:
- Technology trends in India
- Indian startup ecosystem
- Digital transformation
- AI and machine learning
- Social media trends

## Gemini Behavior (Exact)

Implemented in [src/gemini.js](src/gemini.js):
- Model used: `gemini-1.5-flash`
- Topic selection: picks 1 topic from the first 20 candidates
- Tweet generation: returns `{ tweet, tweetType }`
- Prompt enforces: Hinglish voice, 2–3 hashtags at end, max 2 emojis, and a **strict 200–240 character target**

Note: Posting still enforces **200–270 characters** in [src/twitter.js](src/twitter.js).

## Twitter/X Posting Rules (Exact)

Implemented in [src/twitter.js](src/twitter.js):
- Uses `twitter-api-v2` client
- Validates tweet length: **must be 200–270 characters** or posting is rejected
- Uses retry helper (`withRetry`) around the Twitter API call

## SQLite “No Repeat Topics” (Exact)

Implemented in [src/db.js](src/db.js):
- Database file: `kaliyug_facts.db` (project root)
- Keeps a `used_topics` table keyed by a simple topic hash
- Filters out topics used in the last **7 days**

If SQLite fails to initialize, the app logs an error and continues **without de-duplication**.

## Manual Run / Debug

Trigger the job immediately (no schedule):
```bash
node -e "require('./src/cron').triggerManualJob().then(r => console.log('manual job result:', r)).catch(console.error)"
```

Scrape topics only:
```bash
node -e "require('./src/scraper').scrapeAllSources().then(console.log).catch(console.error)"
```

## Deployment Notes (Render or similar)

This app schedules work with an in-process cron. That means:
- Your service must stay running continuously for the scheduled tweet to fire.
- Health checks help monitoring, but they do not *guarantee* the process won’t be stopped/restarted.

If you need hard guarantees, use an external scheduler to run/trigger the job at 14:30 UTC.

## Project Structure

```
.
├── src/
│   ├── index.js      # App entry: config validation, server, cron scheduler
│   ├── cron.js       # Daily schedule + tweet pipeline orchestration
│   ├── scraper.js    # Reddit + NewsData + Trends24 scrapers and merge logic
│   ├── gemini.js     # Topic selection + tweet generation (Gemini)
│   ├── twitter.js    # Twitter/X posting
│   ├── db.js         # SQLite persistence + topic de-duplication
│   ├── server.js     # Express health server
│   ├── logger.js     # Structured logging helpers
│   └── error-handler.js
└── test/
```