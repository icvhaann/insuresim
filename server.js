import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import rateLimit from 'express-rate-limit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '20kb' }));
app.use(express.static(join(__dirname, 'public')));

// ── Rate limiting ─────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down a little.' }
});
app.use('/api/', limiter);

// ── Validate API key at startup ───────────────────────────────────────────
if (!process.env.DEEPSEEK_API_KEY) {
  console.error('ERROR: DEEPSEEK_API_KEY environment variable is not set.');
  process.exit(1);
}

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

// ── Warmup endpoint ───────────────────────────────────────────────────────
app.get('/api/warmup', (req, res) => res.json({ status: 'ok' }));

// ── Main chat endpoint ────────────────────────────────────────────────────
// Stateless by design — conversation history is sent from the client each time.
// This means every browser tab is automatically isolated with no shared server state.
// Unlimited simultaneous sessions work out of the box.
app.post('/api/chat', async (req, res) => {
  const { system, messages } = req.body;

  if (!system || typeof system !== 'string') {
    return res.status(400).json({ error: 'Missing system prompt.' });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Missing or empty messages array.' });
  }

  // Sanitise and apply sliding window
  const trimmed = messages
    .slice(-8)
    .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.slice(0, 2000)
    }));

  if (trimmed.length === 0) {
    return res.status(400).json({ error: 'No valid messages after sanitisation.' });
  }

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',          // DeepSeek-V3
        messages: [
          { role: 'system', content: system.slice(0, 8000) },
          ...trimmed
        ],
        max_tokens: 300,
        temperature: 0.8,
        stream: false
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('DeepSeek API error:', response.status, err);

      if (response.status === 429) return res.status(429).json({ error: 'Rate limit reached — please wait.' });
      if (response.status === 401) return res.status(500).json({ error: 'Server configuration error.' });
      return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content ?? '';
    res.json({ content: text });

  } catch (err) {
    console.error('Network error calling DeepSeek:', err.message);
    res.status(500).json({ error: 'Could not reach AI service. Please try again.' });
  }
});

// ── Catch-all ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Minigame running on port ${PORT}`));
