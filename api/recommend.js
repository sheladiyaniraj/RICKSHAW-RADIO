// Vercel serverless function: picks the next songs for a driver based on
// their recent listening, using an LLM through the Vercel AI Gateway.
// NOTE: _catalog.json is a manually-synced trim (title/mood/language) of
// the `songs` array in index.html — regenerate it if that array changes.
const { generateText, Output } = require('ai');
const { z } = require('zod');
const CATALOG = require('./_catalog.json');

const MAX_HISTORY = 50;
const CATALOG_TITLES = new Set(CATALOG.map(s => s.title));

const RecommendationSchema = z.object({
  picks: z
    .array(
      z.object({
        title: z.string(),
        reason: z.string().max(80),
      })
    )
    .min(4)
    .max(8),
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { history, mood } = req.body || {};
  if (!Array.isArray(history) || history.length > MAX_HISTORY) {
    res.status(400).json({ error: 'Invalid history' });
    return;
  }
  const safeMood = typeof mood === 'string' ? mood.slice(0, 40) : null;

  try {
    const { output } = await generateText({
      model: 'anthropic/claude-haiku-4.5',
      output: Output.object({ schema: RecommendationSchema }),
      system: `You are the DJ for Rickshaw Radio, a Bollywood jukebox for Indian auto
rickshaw drivers. Pick the next songs ONLY from the provided catalog — the
"title" field must be an exact match to a catalog entry. Bias your picks
toward what the driver's recent history suggests they like: mood, language,
repeated eras or artists, and songs they let finish rather than skipped.
If history is empty, pick a broadly popular, high-energy mix. Each "reason"
is one short line, in Hinglish, playful — like an auto driver's banter,
never marketing copy.`,
      prompt: JSON.stringify({ catalog: CATALOG, recentHistory: history, currentMood: safeMood }),
    });

    const picks = output.picks.filter(p => CATALOG_TITLES.has(p.title));
    res.status(200).json({ picks });
  } catch (err) {
    res.status(500).json({ error: 'Recommendation failed' });
  }
};
