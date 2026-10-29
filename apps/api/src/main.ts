import cors from 'cors';
import express from 'express';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'railvaani-api' });
});

// POST /api/parse-intent
// LLM converts the spoken or typed sentence into a structured search intent
// (from, to, date, classPreference[], budget, departureWindow, via[], quota,
// passengers, sortBy, language). Strict JSON-schema output. Lands in Milestone 3.

// POST /api/search
// Proxied provider search with short-TTL availability caching and rate limiting.
// Runs the split-journey engine for fallback options. Lands in Milestone 3/4.

// Voice privacy: the browser never uploads audio. Only the transcript text of the
// user's sentence reaches this server, and it is never logged with any PII.

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

const port = Number(process.env['PORT'] ?? 3000);
app.listen(port, () => {
  console.log(`railvaani-api listening on port ${port}`);
});
