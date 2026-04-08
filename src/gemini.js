const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getConfig } = require('./config');
const { createLogger } = require('./logger');

const logger = createLogger('GEMINI');

function getClient() {
  const config = getConfig();
  return new GoogleGenerativeAI(config.gemini.apiKey);
}

// Rotate tweet types for variety
const TWEET_TYPES = [
  'unpopular_take',
  'trending_mythology',
  'sarcastic_observation',
  'mind_blowing_fact',
  'relatable_mythological',
  'on_this_day_angle'
];

function getTweetType(index) {
  return TWEET_TYPES[index % TWEET_TYPES.length];
}

const TWEET_TYPE_INSTRUCTIONS = {
  unpopular_take: `Write an unpopular or contrarian opinion about this topic. Start with something like "Controversial but..." or "Hot take:" or jump straight into the take. Make it debate-inducing.`,
  trending_mythology: `Connect this trending topic to Hindu mythology in a clever, unexpected way. Show how Mahabharata or Ramayana already had a version of this situation.`,
  sarcastic_observation: `Make a sarcastic, dry-humor observation about this topic. Think: someone who's seen it all and is mildly disappointed in humanity but still funny about it.`,
  mind_blowing_fact: `Share the most shocking or lesser-known angle of this topic. Start with something that makes people stop scrolling.`,
  relatable_mythological: `Make a relatable GenZ/millennial observation by comparing a modern feeling or situation to something from mythology. Should feel like "wait, that's literally me".`,
  on_this_day_angle: `This is a historical event. Connect it to modern times in a way that feels fresh and surprising. What would people today think about this? Any mythology parallels?`
};

/**
 * Select the best topic from all scraped sources
 */
async function selectBestTopic(topics) {
  if (!topics || topics.length === 0) return topics[0] || 'Indian mythology facts';

  try {
    const genAI = getClient();
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `You are the social media brain behind "Kaliyug Facts" — a viral Hinglish Twitter account for Indian GenZ and millennials that connects mythology with modern life.

From the following trending topics, pick the ONE that:
1. Has the most potential for a mythology connection OR sarcastic modern take
2. Would make an Indian GenZ stop scrolling
3. Is emotionally charged, controversial, or deeply relatable

Topics:
${topics.slice(0, 20).map((t, i) => `${i + 1}. ${t}`).join('\n')}

Return ONLY the chosen topic text, nothing else.`;

    const result = await model.generateContent(prompt);
    const selected = result.response.text().trim();
    logger.info('Topic selected', { selected });
    return selected;
  } catch (error) {
    logger.error('Topic selection failed', error);
    return topics[0];
  }
}

/**
 * Generate a tweet with rotating type for variety
 */
async function generateTweet(topic, tweetIndex = 0, isOnThisDay = false) {
  try {
    const genAI = getClient();
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const tweetType = isOnThisDay ? 'on_this_day_angle' : getTweetType(tweetIndex);
    const typeInstruction = TWEET_TYPE_INSTRUCTIONS[tweetType];

    const prompt = `You are Kaliyug Facts — a sarcastic, witty, deeply knowledgeable Indian Twitter personality. You mix Hindu mythology with modern life in Hinglish. You sound like a real opinionated human, never a bot.

TOPIC: ${topic}
TWEET TYPE: ${tweetType}
INSTRUCTION: ${typeInstruction}

Write 1 tweet following these rules:
- 200-240 characters max (STRICT)
- Hook in the first 5 words — make people stop scrolling
- Hinglish (natural Hindi-English mix, not forced)
- Sarcastic, curious, debate-inducing — NEVER hateful or disrespectful to any deity
- Question the narrative, never disrespect the divine
- Sounds like a real person with opinions, not a content bot
- End with something that invites replies or retweets
- Add 2-3 relevant hashtags at the very end
- Max 2 emojis total
- NEVER start with "Did you know" or "Fun fact"

Output ONLY the tweet text. No explanation, no preamble.`;

    const result = await model.generateContent(prompt);
    const tweet = result.response.text().trim();
    logger.info('Tweet generated', { topic, tweetType, length: tweet.length });
    return { tweet, tweetType };
  } catch (error) {
    logger.error('Tweet generation failed', error);
    throw error;
  }
}

/**
 * Generate "On This Day" tweet from historical fact
 */
async function generateOnThisDayTweet(historicalFact) {
  return generateTweet(historicalFact, 0, true);
}

module.exports = {
  selectBestTopic,
  generateTweet,
  generateOnThisDayTweet
};
