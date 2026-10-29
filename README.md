# RailVaani

Voice-first, accessible Indian train search. Two core ideas:

1. Search trains and seat availability entirely by voice (English, Hindi, Hinglish), with a fully usable typed fallback.
2. Automatically find cheaper "split journey" options when direct trains are unavailable or over budget.

Booking always happens on the official IRCTC site/app; RailVaani deep-links there with details pre-filled. IRCTC is never scraped.

**Live preview (web app, mock data):** https://ahmad-ausaf0.github.io/railvaani/

## Status

- [x] Milestone 1: scaffold + data layer
- [x] Milestone 2: split-journey engine (pure TS + unit tests)
- [x] Milestone 3 (in progress): working search UI preview (voice button, results, availability chips)
- [ ] Milestone 3 (remaining): Node API endpoints + LLM intent parsing, full i18n
- [ ] Milestone 4: results / split / preferences UI
- [ ] Milestone 5: accessibility + testing pass (axe-core, Playwright keyboard flows)
- [ ] Milestone 6: final README, provider swap guide, accessibility statement

The web app deploys to GitHub Pages on every push to `main` via `.github/workflows/deploy-pages.yml`.

## Structure (npm workspaces)

| Path | What it is |
| --- | --- |
| apps/web | Angular 20 PWA: standalone components, signals, CDK a11y, Tailwind |
| apps/api | Node backend: LLM intent parsing, provider proxy, caching, rate limiting |
| packages/train-core | Train models, `TrainDataProvider` interface, `MockTrainProvider` seed data, third-party API provider skeleton |
| packages/split-engine | Pure TypeScript split-journey engine (framework-free, unit-tested) |
| e2e | Playwright + axe-core (keyboard-only flows included) |

`train-core` and `split-engine` compile to ES module `dist/` output (`npm run build` at the repo root builds packages, then the web app). `npm run test:engine` runs the split-engine unit tests.

## Swapping in a real data provider

Every feature codes against `TrainDataProvider` (packages/train-core/src/train-data-provider.ts). Implement it with a real API and register it in the provider factory. API keys live in env on the backend only, never in the repo (see .env.example). The shipped `MockTrainProvider` seeds the GKP / LKO / CNB / NDLS corridor with 18 trains across SL, 3A, 3E, 2A, CC and 2S.

## Accessibility

WCAG 2.2 AA baseline, AAA where feasible: keyboard-only operation, visible 3:1 focus, screen-reader announcements for every result and status, never colour alone, plain-language copy (WL/RAC always explained), 48px touch targets, Senior Mode, English + Hindi via Angular i18n. The full checklist ships with Milestone 5.
