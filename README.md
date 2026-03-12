# Dwarf Land

AI-powered civilization simulator. Autonomous dwarves make decisions using tiered AI models (Gemini, Claude, GPT). Built on Cloudflare Workers.

**Live:** [dwarf.land](https://dwarf.land)

## Features

### World
- 500x250 emoji tile world map with 28 real-world cities across all continents
- 7 continents with biome-specific terrain (tundra, desert, jungle, mountains, ocean)
- Terrain speed system with Dijkstra pathfinding (mountains = slow, roads = fast)
- Auto-generated roads between cities using A* (land-only, no ocean crossing)
- Railroads: dwarves upgrade roads for ultra-fast travel (3 iron + 2 wood per tile)
- Per-city resources and culturally-named populations
- Cities auto-expand when population and resources allow (beds, stockpiles, tables)

### Dwarves
- 80-140 autonomous dwarves with D&D stats (STR/DEX/CON/INT/WIS/CHA)
- Cultural names from 28 real civilizations
- AI-generated backstories and personality traits
- Soul attributes: faith, morality, ambition
- Age system with stat modifiers (young +DEX, elder +WIS, ancient death chance)
- Carry system: dwarves haul resources back to stockpiles based on STR
- Food sharing: generous dwarves share with hungry neighbors (based on morality + CHA)

### Crafting (Infinite Craft)
- Combine any two items to create new ones (Water + Fire = Steam)
- 296 base items seeded from InfiniteCraftWiki (depth 1-6)
- Unknown combos resolved via AI (Gemini Flash Lite) and cached forever
- Per-dwarf inventory (max 6 craft items)
- Dwarves auto-craft at workshops when idle with 2+ items
- Terrain yields craft ingredients (mining = Earth/Stone, fishing = Water, etc.)

### Trading
- Dwarves from different cities trade when they meet on the same tile
- INT advantage: smarter dwarves get 2:1 deals, equal INT = 1:1 swap
- Enemy dwarves refuse to trade (relationship system)
- Detailed trade logs show exactly what was exchanged
- 30% trigger chance per meeting to prevent spam

### Ships & Sea Travel
- Ships built at coastal cities (10 wood + 3 cloth + 2 iron)
- 1 captain per ship — sails across ocean to other coastal cities
- Captain sleeps and eats aboard; ship auto-fishes from fish spots
- Cargo system: resources transfer to destination city on arrival
- Ambitious dwarves spontaneously embark on voyages
- Click ships on map to inspect cargo, captain, destination

### UI
- Click inspector for dwarves (stats, inventory, carry, events), cities (ideology), terrain, ships
- Follow/lock camera on a specific dwarf with pulsing ring indicator
- City switcher dropdown in top HUD — click city name to jump to any of 28 cities
- City ideology labels computed from aggregate personality (Militant, Spiritual, Mercantile, etc.)
- Contextual Mine/Build/Farm/Road actions in dwarf inspector
- Splash screen for new visitors + in-game mechanics guide

### AI
- 4-tier model routing (simple/medium/complex/premium) via OpenRouter
- Fire-and-forget AI calls: game never blocks on responses
- Intent cache: AI decides, cache stores intent, dwarf executes when idle
- Budget hard caps prevent runaway spending ($8.50/hr total)
- In-memory rate limiting per tier

## Sponsorship

Pay to upgrade a dwarf's AI reasoning tier via Polar.sh. Sponsored dwarves get a star badge and make smarter decisions.

| Tier | Price | AI Upgrade | Calls |
|------|-------|------------|-------|
| Bronze | $1 | medium | 100 |
| Silver | $3 | complex | 75 |
| Gold | $10 | premium | 100 |

## Tech Stack

- **Runtime:** Cloudflare Workers (Hono)
- **Database:** Cloudflare D1 (SQLite)
- **AI:** OpenRouter via Vercel AI SDK v6 + Zod v4 schemas
- **Payments:** Polar.sh (@polar-sh/sdk)
- **Frontend:** Vanilla JS canvas + DAUB UI (grunge theme)
- **Tests:** Vitest (143 tests across 11 files)

## Development

```bash
npm install
npm run dev              # local dev server
npm test                 # run 143 tests
npm run test:watch       # vitest watch mode
npm run db:migrate:local # apply D1 migrations locally
npm run db:migrate:remote # apply D1 migrations to production
npm run deploy           # deploy to Cloudflare Workers
```

### Seeding craft data

```bash
npx tsx scripts/import-craft-data.ts     # downloads + generates SQL
npm run db:migrate:local                  # apply locally
npm run db:migrate:remote                 # apply to production
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Budget status per tier |
| POST | `/api/decide/:tier` | AI decision (simple/medium/complex/premium) |
| POST | `/api/backstory` | Generate dwarf backstory |
| POST | `/api/craft` | Combine two items (cache-first, AI fallback) |
| POST | `/api/state/save` | Save game state |
| GET | `/api/state/load` | Load game state |
| POST | `/api/sponsor/checkout` | Create Polar checkout session |
| POST | `/api/sponsor/webhook` | Polar webhook handler |
| GET | `/api/sponsor/total` | Total sponsorship revenue |
| GET | `/api/sponsor/status/:dwarfId` | Check sponsorship status |

## Database Migrations

| Migration | Description |
|-----------|-------------|
| `0001_init.sql` | Game state, budget log, AI log tables |
| `0002_sponsorships.sql` | Dwarf sponsorship tracking |
| `0003_crafting.sql` | Craft items + recipes tables |

## Architecture

```
public/index.html      # Game client (canvas, all game logic)
src/worker.ts          # Hono API server
src/ai/router.ts       # Model routing + fallback chains
src/ai/schemas.ts      # Zod v4 schemas for AI output
src/ai/prompts.ts      # Prompt templates per tier
src/ai/fallback.ts     # Local fallback logic (no AI)
src/shared/types.ts    # TypeScript interfaces
src/shared/actions.ts  # Action enums per tier
src/guardrails/        # Budget + rate limiting
src/db/state.ts        # D1 state persistence
migrations/            # D1 SQL migrations
scripts/               # Import/seed scripts
tests/                 # 11 test files, 143 tests
```
