import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { Station } from '@railvaani/train-core';

import { VoiceIntentService } from './voice-intent.service';

function st(code: string, name: string): Station {
  return { code, name, zone: '', isJunction: /jn|junction/i.test(name) };
}

// Small deterministic slice of the directory: the namesakes the rules must
// tell apart (Delhi/DLI vs New Delhi/NDLS vs Delhi Cantt/DEC, Gorakhpur/GKP
// vs Gorakhpur Cant/GKC, Lucknow/LKO vs Lucknow Ne/LJN, Patna Jn/PNBE vs
// Patna Sahib/PPTA, Mumbai Cst/CSTM vs Mumbai Central/BCT).
const FIXTURE: Station[] = [
  st('NDLS', 'New Delhi'), st('DLI', 'Delhi'), st('DEC', 'Delhi Cantt'),
  st('DAZ', 'Delhi Azadpur'), st('GKP', 'Gorakhpur'), st('GKC', 'Gorakhpur Cant'),
  st('LKO', 'Lucknow'), st('LJN', 'Lucknow Ne'), st('LC', 'Lucknow City'),
  st('PNBE', 'Patna Jn'), st('PPTA', 'Patna Sahib'),
  st('CSTM', 'Mumbai Cst'), st('BCT', 'Mumbai Central'),
];

const svc = new VoiceIntentService();

test('New Delhi to Gorakhpur keeps the spoken order (never reversed)', () => {
  const r = svc.parse('New Delhi to Gorakhpur', FIXTURE);
  assert.equal(r.from?.code, 'NDLS');
  assert.equal(r.to?.code, 'GKP');
});

test('Gorakhpur to New Delhi', () => {
  const r = svc.parse('Gorakhpur to New Delhi', FIXTURE);
  assert.equal(r.from?.code, 'GKP');
  assert.equal(r.to?.code, 'NDLS');
});

test('from Gorakhpur to New Delhi', () => {
  const r = svc.parse('from Gorakhpur to New Delhi', FIXTURE);
  assert.equal(r.from?.code, 'GKP');
  assert.equal(r.to?.code, 'NDLS');
});

test('Gorakhpur se Lucknow', () => {
  const r = svc.parse('Gorakhpur se Lucknow', FIXTURE);
  assert.equal(r.from?.code, 'GKP');
  assert.equal(r.to?.code, 'LKO');
});

test('Hinglish sentence with fillers: mujhe Gorakhpur se Delhi jana hai', () => {
  const r = svc.parse('mujhe Gorakhpur se Delhi jana hai', FIXTURE);
  assert.equal(r.from?.code, 'GKP');
  // Bare "Delhi" must land on New Delhi, not Old Delhi (DLI) or Delhi Cantt.
  assert.equal(r.to?.code, 'NDLS');
});

test('Patna to Mumbai', () => {
  const r = svc.parse('Patna to Mumbai', FIXTURE);
  assert.equal(r.from?.code, 'PNBE');
  assert.equal(r.to?.code, 'CSTM');
});

test('Gorakhpur alone resolves From only', () => {
  const r = svc.parse('Gorakhpur', FIXTURE);
  assert.equal(r.from?.code, 'GKP');
  assert.equal(r.to, undefined);
});

test('book a train resolves nothing', () => {
  const r = svc.parse('book a train', FIXTURE);
  assert.equal(r.from, undefined);
  assert.equal(r.to, undefined);
});

test('no markers: scan spots both names in spoken order', () => {
  const r = svc.parse('Gorakhpur Lucknow', FIXTURE);
  assert.equal(r.from?.code, 'GKP');
  assert.equal(r.to?.code, 'LKO');
});

test('scan prefers the longest name so New Delhi beats Delhi', () => {
  const r = svc.parse('New Delhi Gorakhpur', FIXTURE);
  assert.equal(r.from?.code, 'NDLS');
  assert.equal(r.to?.code, 'GKP');
});

test('fillers around an explicit split do not break resolution', () => {
  const r = svc.parse('please book a train from Gorakhpur to Lucknow tomorrow', FIXTURE);
  assert.equal(r.from?.code, 'GKP');
  assert.equal(r.to?.code, 'LKO');
});

test('Devanagari se marker splits the sides', () => {
  const r = svc.parse('Gorakhpur से Lucknow', FIXTURE);
  assert.equal(r.from?.code, 'GKP');
  assert.equal(r.to?.code, 'LKO');
});

test('explicit multi-word name still wins over the bare-city rule', () => {
  const r = svc.parse('Delhi Cantt to Gorakhpur', FIXTURE);
  assert.equal(r.from?.code, 'DEC');
  assert.equal(r.to?.code, 'GKP');
});

test('real 9k directory: Delhi lands on New Delhi, not DLI or Delhi Cantt', () => {
  const rows = JSON.parse(
    readFileSync(new URL('../../../public/stations.json', import.meta.url), 'utf8'),
  ) as [string, string][];
  const all: Station[] = rows.map(([code, name]) => st(code, name));
  const r = svc.parse('mujhe Gorakhpur se Delhi jana hai', all);
  assert.equal(r.from?.code, 'GKP');
  assert.equal(r.to?.code, 'NDLS');
});
