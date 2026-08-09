// Vercel serverless function: picks the next songs for a driver based on
// their recent listening, using an LLM through the Vercel AI Gateway.
// NOTE: _catalog.json is a manually-synced trim (title/mood/language) of
// the `songs` array in index.html — regenerate it if that array changes.
const { generateText, Output } = require('ai');
const { z } = require('zod');
const CATALOG = require('./_catalog.json');

const MAX_HISTORY = 50;
const MAX_RECENTLY_SHOWN = 20;
const MIN_ELIGIBLE_POOL = 6; // don't let exclusions shrink the pool below this
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

// Explicit feedback is a much stronger, unambiguous signal than an inferred
// "skip" (which can also mean a broken embed) — keep it a separate channel
// from `history` and enforce it in code, not just by asking the model nicely.
function sanitizeFeedback(feedback) {
  const out = {};
  if (!feedback || typeof feedback !== 'object') return out;
  for (const [title, value] of Object.entries(feedback)) {
    if (CATALOG_TITLES.has(title) && (value === 'liked' || value === 'disliked')) {
      out[title] = value;
    }
  }
  return out;
}

function sanitizeRecentlyShown(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(t => typeof t === 'string' && CATALOG_TITLES.has(t)).slice(-MAX_RECENTLY_SHOWN);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { history, mood, feedback, recentlyShown } = req.body || {};
  if (!Array.isArray(history) || history.length > MAX_HISTORY) {
    res.status(400).json({ error: 'Invalid history' });
    return;
  }
  const safeMood = typeof mood === 'string' ? mood.slice(0, 40) : null;
  const safeFeedback = sanitizeFeedback(feedback);
  const safeRecentlyShown = sanitizeRecentlyShown(recentlyShown);

  // Hard-exclude disliked titles always. Hard-exclude recently-shown titles
  // too, but only if the catalog is big enough to still give the model a
  // real choice — with ~57 songs, stacking both filters can otherwise starve
  // the pool, so recently-shown is dropped first if things get too small.
  const dislikedTitles = new Set(Object.keys(safeFeedback).filter(t => safeFeedback[t] === 'disliked'));
  let eligible = CATALOG.filter(s => !dislikedTitles.has(s.title));
  const withoutRepeats = eligible.filter(s => !safeRecentlyShown.includes(s.title));
  if (withoutRepeats.length >= MIN_ELIGIBLE_POOL) eligible = withoutRepeats;

  const eligibleTitles = new Set(eligible.map(s => s.title));

  try {
    const { output } = await generateText({
      model: 'anthropic/claude-haiku-4.5',
      output: Output.object({ schema: RecommendationSchema }),
      system: `You are the DJ for Rickshaw Radio, a Bollywood jukebox for Indian auto
rickshaw drivers. Pick the next songs ONLY from the provided catalog — the
"title" field must be an exact match to a catalog entry. The catalog has
already been filtered to exclude songs the driver disliked and (where
possible) songs shown to them very recently, so just focus on picking well
from what's left.
Explicit feedback is the strongest signal: strongly favor moods/languages/eras
similar to "liked" titles in recentFeedback. Implicit history (recentHistory)
is a weaker, secondary signal — weight songs the driver let finish over ones
they skipped. If both are empty, pick a broadly popular, high-energy mix.
Each "reason" is one short line, in Hinglish, playful — like an auto driver's
banter, never marketing copy.`,
      prompt: JSON.stringify({
        catalog: eligible,
        recentHistory: history,
        recentFeedback: safeFeedback,
        currentMood: safeMood,
      }),
    });

    const picks = output.picks.filter(p => eligibleTitles.has(p.title));
    res.status(200).json({ picks });
  } catch (err) {
    res.status(500).json({ error: 'Recommendation failed' });
  }
};
