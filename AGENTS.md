# DESIGN (frontend-design principles)
- Pick one clear design direction before coding: Indian railway signage and ticket stubs, warm and trustworthy.
- Do not use Inter, Roboto, Arial or system fonts. Pick one characterful display font and one readable body font with Devanagari support.
- No purple gradients on white. No glassmorphism. No identical rounded cards everywhere.
- Choose one dominant colour, one accent, and neutral paper tones.
- Use real layout hierarchy: timelines, ticket-style cards, strong grid.
- Motion only where it helps. Respect prefers-reduced-motion.
- Design every state, not just the happy path: loading, empty, error, success. Design at 375px, 768px and 1440px widths.
- Check every text/background pair for contrast with a tool, including placeholder text, captions and text on coloured chips. Placeholder text is never the only label.

# WRITING (stop-slop rules, apply to all app text and the README)
- Cut filler openers and all adverbs.
- Say the point directly. No "not X, it's Y" contrasts.
- Active voice with a person or the app as the subject.
- Vary sentence length. No em dashes.
- No slogans or quotable lines. Plain words, Grade 6 reading level.

# ANGULAR
- Angular 20: standalone components, signals, new control flow (@if, @for), inject() for dependencies, reactive forms, lazy-loaded routes.
- Strict TypeScript. No "any". Small components. Services behind interfaces.

# ACCESSIBILITY
- WCAG 2.2 AA. Semantic HTML, visible focus, 48px touch targets, 4.5:1 contrast.
- Never use colour alone. Live regions for results. Keyboard use everywhere.
- Run axe-core with Playwright on every page. Add keyboard-only tests.
- Never remove a focus outline without a designed replacement.

# DATA CORRECTNESS
- Use India Standard Time for "today". Hide trains that already departed.
- If seats could not be checked, show "Check seats on IRCTC". Never show "Available" unless confirmed.
- Availability is per segment (boarding station to alighting station). A status fetched for one segment must never be shown for a different segment.
- Search cities as station clusters (Delhi = NDLS, DLI, ANVT, NZM, SSB; Lucknow = LKO, LJN). Label every result with its actual boarding and alighting stations.
- Never display an estimated or guessed fare as a fare. If the real fare is unknown, show "Fare on IRCTC".
- Every availability figure carries the time it was fetched. Stale figures say how old they are.
- A failed data call must never kill the whole search. Direct trains render even if split search fails. Split options render even if one hub fails. Show partial results with a plain note about what could not be checked.
- Never print a raw error message (like "Failed to fetch") to the user. Errors to users are one plain sentence plus a retry action.

# PERFORMANCE
- Parallel requests with a cap of 4, 8-second timeouts, one retry.
- Show direct trains first, then split journeys as they load.
- Initial bundle under 250 KB. Lighthouse score 90 or higher.

# SECURITY
- Secrets only in backend environment variables. No API keys in the web bundle.
- Validate all input on the backend, including voice transcripts.
- Rate limit the API. CORS for our own origin only. Security headers.
- Run npm audit before each release. No personal data in logs. No voice audio stored.

# QUALITY AND SHIPPING
- Write a test with each feature. Run all tests before saying a task is done.
- GitHub Actions: lint, unit tests, e2e tests, build, deploy.
- Keep the README current with setup, environment variables and deploy steps.
- After each task, tell me what changed and what is next.
- One task at a time. Push, report, and stop. Wait for the next task.
