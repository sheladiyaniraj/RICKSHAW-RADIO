// Vercel serverless function: records a "now playing" event into a shared
// Redis feed for the admin dashboard. Fire-and-forget from the client —
// no user identifier, no IP, nothing personally identifying is stored.
const { Redis } = require('@upstash/redis');
const CATALOG = require('./_catalog.json');

const CATALOG_BY_TITLE = new Map(CATALOG.map(s => [s.title, s]));
const FEED_KEY = 'live:plays';
const MAX_FEED = 200;

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { title } = req.body || {};
  // Trust only the title from the client; look mood/language up ourselves
  // so the feed can't be spoofed with arbitrary text.
  const song = typeof title === 'string' ? CATALOG_BY_TITLE.get(title) : null;
  if (!song) {
    res.status(400).json({ error: 'Unknown song' });
    return;
  }

  try {
    await redis.lpush(FEED_KEY, { title: song.title, mood: song.mood, language: song.language, ts: Date.now() });
    await redis.ltrim(FEED_KEY, 0, MAX_FEED - 1);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'Tracking failed' });
  }
};
