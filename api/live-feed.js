// Vercel serverless function: returns the recent cross-driver "now playing"
// feed for the admin dashboard. Gated by a single shared secret (ADMIN_TOKEN)
// — this is a personal tool, not a multi-user auth system.
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

const FEED_KEY = 'live:plays';
const DEFAULT_LIMIT = 50;

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function isValidToken(provided){
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = req.headers['x-admin-token'];
  if (!isValidToken(token)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const feed = await redis.lrange(FEED_KEY, 0, DEFAULT_LIMIT - 1);
    res.status(200).json({ feed });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load feed' });
  }
};
