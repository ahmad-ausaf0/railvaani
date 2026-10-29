# RailVaani

Voice-first, accessible Indian train search. Two core ideas:

1. Search trains and seat availability entirely by voice (English, Hindi, Hinglish), with a fully usable typed fallback.
2. Automatically find cheaper "split journey" options when direct trains are unavailable or over budget.

Booking always happens on the official IRCTC site/app; RailVaani deep-links there with details pre-filled. IRCTC is never scraped.

## Status

- [x] Milestone 1: scaffold + data layer
- [ ] Milestone 2: split-journey engine (pure TS + unit tests)
- [ ] Milestone 3: voice pipeline + LLM intent parsing
- [ ] Milestone 4: results / split / preferences UI
- [ ] Milestone 5: accessibility + testing pass (axe-core, Playwright keyboard flows)
- [ ] Milestone 6: final README, provider swap guide, accessibility statement

## Structure (npm workspaces)

| Path | What it is |
| --- | --- |
| apps/web | Angular 20 PWA: standalone components, signals, CDK a11y, Tailwind |
| apps/api | Node backend: LLM intent parsing, provider proxy, caching, rate limiting |
| packages/split-engine | Pure TypeScript split-journey engine (framework-free, unit-tested) |
| e2e | Playwright + axe-core (keyboard-only flows included) |

## Swapping in a real data provider

Every feature codes against `TrainDataProvider` (apps/web/src/app/core/data/train-data-provider.ts). Implement it with a real API and register it in the provider factory. API keys live in env on the backend only, never in the repo (see .env.example). The shipped `MockTrainProvider` seeds the GKP / LKO / CNB / NDLS corridor with 18 trains across SL, 3A, 3E, 2A, CC and 2S.

## Accessibility

WCAG 2.2 AA baseline, AAA where feasible: keyboard-only operation, visible 3:1 focus, screen-reader announcements for every result and status, never colour alone, plain-language copy (WL/RAC always explained), 48px touch targets, Senior Mode, English + Hindi via Angular i18n. The full checklist ships with Milestone 5.
