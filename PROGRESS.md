# Dwarf Land - Progress

## Phase 1: Cloudflare Workers + Simple AI ✅ COMPLETE

### What was built:
- **Project setup**: npm, wrangler.jsonc, tsconfig.json, .dev.vars, .gitignore
- **D1 schema**: `migrations/0001_init.sql` — game_state, budget_log, ai_log tables
- **Hono worker** (`src/worker.ts`): API routes for /api/decide/:tier, /api/state/save, /api/state/load, /api/health
- **AI router** (`src/ai/router.ts`): Google-first 4-tier routing with 3-model fallback chains per tier
- **Zod schemas** (`src/ai/schemas.ts`): Structured output schemas for all tiers + backstory + religion
- **Prompt templates** (`src/ai/prompts.ts`): Per-tier prompts (simple ~400 tokens, premium ~3000)
- **Fallback** (`src/ai/fallback.ts`): Local deterministic logic when all AI models fail
- **Guardrails**: Budget tracking via D1, in-memory rate limiting, population caps
- **State persistence** (`src/db/state.ts`): Save/load JSON to D1
- **Client AI** (`public/index.html`): Intent cache, executor, auto-save (60s + sendBeacon), auto-load
- **35+ actions** catalogued in `src/shared/actions.ts`
- **Types** defined in `src/shared/types.ts`

### Verified:
- `GET /api/health` returns budget per tier
- `POST /api/decide/simple` — Gemini Flash Lite correctly decided hungry dwarf should eat (1 cent)
- State save/load round-trip works
- TypeScript compiles clean
- Budget logging tracks calls and costs

## Phase 2: Dwarf Identity + D&D Stats 🔄 IN PROGRESS (TDD first)

### Current: Writing extensive tests (TDD)
- Rate limiter balance tests
- Budget tracker with mock D1
- Population equilibrium
- Zod schema validation
- Action system + stat modifiers
- Fallback logic
- D&D stat generation
- Prompt template bounds

## Phases 3-6: Not started
- Phase 3: Social System + MEDIUM Tier
- Phase 4: Religion System + PREMIUM Tier
- Phase 5: Combat + Governance + COMPLEX Tier
- Phase 6: Animals, Polish, Budget Dashboard

## File Structure
```
dwarf-fortress/
├── .dev.vars                     # API key (gitignored)
├── package.json
├── wrangler.jsonc
├── tsconfig.json
├── PROGRESS.md                   # This file
├── public/
│   └── index.html                # Game client (~1300 lines)
├── src/
│   ├── worker.ts                 # Hono app entry
│   ├── ai/
│   │   ├── router.ts             # Tier routing + fallback chains
│   │   ├── schemas.ts            # Zod schemas for AI output
│   │   ├── prompts.ts            # Prompt templates per tier
│   │   └── fallback.ts           # Local logic fallback
│   ├── guardrails/
│   │   ├── budget.ts             # Cost tracking (D1-backed)
│   │   ├── rate-limiter.ts       # Per-tier rate limiting
│   │   └── population.ts         # Pop cap + equilibrium
│   ├── db/
│   │   └── state.ts              # Save/load game state
│   └── shared/
│       ├── actions.ts            # 35+ action definitions
│       └── types.ts              # Shared TypeScript types
├── migrations/
│   └── 0001_init.sql             # D1 migration
└── tests/                        # TDD test suite (in progress)
```
