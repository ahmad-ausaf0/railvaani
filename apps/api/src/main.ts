import cors from 'cors';
import express from 'express';

import { ErailProvider, MAJOR_STATIONS, TrainClass } from '@railvaani/train-core';
import { findOptions, SplitQuery } from '@railvaani/split-engine';

const app = express();
app.use(cors());
app.use(express.json());

const provider = new ErailProvider({
  stationDirectory: MAJOR_STATIONS.map(([code, name]) => ({
    code,
    name,
    zone: '',
    isJunction: false,
  })),
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'railvaani-api', provider: 'erail' });
});

// Live all-India search: trains + split options straight from erail's public data.
app.get('/api/search', async (req, res) => {
  const { from, to, date, cls, quota, budget } = req.query as Record<string, string>;
  if (!from || !to || !date || !cls) {
    res.status(400).json({ error: 'bad_request', message: 'from, to, date and cls are required.' });
    return;
  }
  try {
    const query: SplitQuery = {
      from: String(from).toUpperCase(),
      to: String(to).toUpperCase(),
      date: String(date),
      cls: String(cls).toUpperCase() as TrainClass,
      ...(quota ? { quota: String(quota).toUpperCase() as never } : {}),
      ...(budget && Number(budget) > 0 ? { budgetPerHead: Number(budget) } : {}),
      availabilityMode: 'deferred',
      maxResults: 12,
    };
    const options = await findOptions(provider, query);
    res.json({ options });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'search failed';
    res.status(502).json({ error: 'upstream', message });
  }
});

app.get('/api/stations', async (req, res) => {
  const q = String(req.query['q'] ?? '').trim();
  const stations = q ? await provider.searchStations(q) : (await provider.listStations()).slice(0, 50);
  res.json({ stations });
});

// Voice privacy: the browser never uploads audio. Only the transcript text of the
// user's sentence reaches this server, and it is never logged with any PII.

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

const port = Number(process.env['PORT'] ?? 3000);
app.listen(port, () => {
  console.log(`railvaani-api listening on port ${port}`);
});
