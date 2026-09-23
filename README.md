# Tacticus Guild Wars Dashboard

A Guild Wars analytics and team composition dashboard for the game *Praetorians of Terra*. Tracks live and historical guild-vs-guild war snapshots, player performance, battle logs, and team compositions.

## Pages

| Page | Description |
|------|-------------|
| `index.html` | Home overview with dataset selection |
| `guild-wars.html` | Guild Wars overview — token usage, battle performance, score projections |
| `guild-raid.html` | Guild Raid season — boss encounters by tier, attacks, and per-player damage |
| `battle-log.html` | Battle history with filters for result, player, team, and units |
| `guild-teams.html` | Team composition library and builder *(dev only)* |
| `player-page.html` | Per-player average attack/defense scores with scatter plots *(dev only)* |

## Skill Ratings

Skill rating is calculated per used, non-abandoned battle token and then summed
for each player. The calculation is:

```text
rating = core score
rating *= each applicable unique skill buff multiplier
rating *= 0.75 if the battle is a cleanup
rating *= 0.10 if the battle is an NPC game (easy round)
rating *= 2 if the attack wins
skill rating = rating / 10
```

The core score is the battle score with any tile-clear bonus removed. Tokens
without a score, abandoned tokens, and scores of zero contribute `0`. A win is
an attack where the defender did not defend successfully; a defended attack
does not receive the win multiplier. Easy games are battles containing the
`templNpc1Initiate` NPC on either side.

The currently recognized skill buffs and their multipliers are:

| Buff | Multiplier |
|------|------------|
| `EnvDefenderHealthBuff2` | 1.25 |
| `EnvFlakFire` | 1.20 |
| `EnvArtillerySupport` | 1.15 |
| `EnvArmourSupplies` | 1.10 |
| `EnvAngelsOfDeath` | 1.10 |
| `EnvFortified` | 1.025 |

Duplicate instances of the same buff are applied only once. Player totals are
the sum of their token ratings; multi-war summaries use the average player
rating across the selected war datasets.

## Data Structure

```
data/
├── dataset-manifest.json     # Index of all war datasets (labels, sources, cache hash)
├── war/
│   ├── current.json           # Active war snapshot
│   └── <id>.json              # Historical war snapshots (UUID-named)
├── raid/
│   ├── current.json           # Active guild raid season
│   └── <season>.json          # Historical guild raid seasons
└── static/
    ├── guild-teams.json      # Team composition library
    ├── players.json          # Player directory (id, name, avatar) built from war data
    ├── portrait-map.json     # Unit ID → portrait image mapping
    └── image-manifest.json   # Available portrait images
```

Switch between datasets via the `?dataset=<key>` URL parameter.

## Scripts

```bash
# Generate dataset-manifest.json from data/war/
node scripts/generate-dataset-manifest.js

# Auto-map unit portraits from all snapshots
node src/auto-map-portraits.js

# Copy portrait images (Windows)
npm run copy:portraits
```

Or via npm:

```bash
npm run generate:datasets
npm run map:portraits
npm run copy:portraits

# Store the Tacticus API key (Guild Raid scope) in .env.local
npm run raid:key

# Fetch the current guild raid season into data/raid/
# Also backfills seasons 100+ that are not cached yet; add -- --force to refetch all
npm run fetch:raid

# Fetch a selected inclusive season range; add --force to refetch cached seasons
npm run fetch:raid:range -- --start 90 --end 99
```

The range fetcher accepts `--start <season>` and `--end <season>`. It writes the
season JSON files and merges the fetched summaries into `data/raid/manifest.json`.
Requests are paced with a random 1-3 second delay, with no more than 10 season
requests running at once.

## Supabase

Player and guild raid data lives in Supabase (Postgres) — the database is the
source of truth, and the JSON files under `data/` are kept as exports/backups.
The schema (players, raid_seasons, raid_entries) lives in
`supabase/migrations/` and is public read-only via the anon key + row level
security; writes go through the service-role key.

- `players` — player directory (id, name, avatar)
- `raid_seasons` — one row per season, including summary columns (entries,
  players, damage, start, end) that mirror `data/raid/manifest.json`
- `raid_entries` — one row per boss attack, with the full lineup flattened
  onto the row: `unit_id_1`..`unit_id_5` / `unit_1_power`..`unit_5_power`
  plus `mow_unit_id` / `mow_power`. `guild_id` (the guild tag) scopes each
  row so other guilds can be added later.

`guild-raid.html` and `player-page.html` read from Supabase in the browser via
`src/lib/supabase-config.js` (public anon key) and `src/lib/supabase-data.js`,
which returns the same shapes the JSON files provided. The JSON files under
`data/` remain as fallback and exports.

```bash
# Store Supabase credentials in .env.local (from Project Settings -> API)
npm run supabase:keys

# Apply the schema: paste supabase/migrations/20260908000000_init.sql
# into the Supabase SQL editor (or use the Supabase CLI)

# Backfill: import players + all raid seasons from data/
npm run db:import

# Useful flags
npm run db:import -- --dry-run        # count rows, write nothing
npm run db:import -- --season 108     # a single season
npm run db:import -- --players-only   # refresh the players directory
```

Once credentials are in place, `npm run fetch:raid` also upserts each fetched
season into Supabase (use `-- --no-db` to skip; a failed DB write warns but
never blocks the JSON export). After regenerating the player directory with
`npm run generate:players`, sync it with `npm run db:import -- --players-only`.

## Tests

Tests use the built-in `node:test` runner — no extra dependencies required.

```bash
node --test tests/
```

## Tech Stack

- Vanilla JavaScript (no frameworks)
- Tailwind CSS (CDN)
- Node.js for build scripts and tests

## Updating live war data

Instructions to update the data war the currently active war. Snowprint does not offer an API for war data Data has to be scraped from a live instance of tacticus.

### Inital setup

**1. Install Tacticus:** Download and install [Tacticus desktop add](https://hub.tacticusgame.com/download?source=web).
**2. Install mitmproxy:** Download and install [mitmproxy](https://www.mitmproxy.org/). This also include **mitmweb**.

### Turn on a proxy server

Whenever you want to scrap data you have to turn on a proxy server:

1. Open **Settings → Network & Internet → Proxy**.
2. Under *Manual proxy setup*, toggle **Use a proxy server** on.
3. Set Address to `127.0.0.1` and Port to `8080`, then click **Save**.

### Turn on mitmweb & filter tacticus data

Once mitmweb is running and the proxy is active:

1. Open command propmt with `Window key + R`.
2. Run the `mitmweb` command. If this command works, mitmweb will open a browser tab automatically.
```bash
mitmweb
```
### Find live war data

You should now be set up to extract the war data.

**1. log into tacticus desktop all**.
**2. navigate to Guilds -> Guild War -> War Status -> Activity**.

![Guild War screen](./img/instructions-open.png)

![War Status – Activity tab](./img/instructions-activity.png)

**3. In mitmweb you are looking for a path called `https://api-live.loki.snowprintstudios.com/game-event/game3/...` you are looking from a request type called "GET_GUILD_WAR_ACTIVITY_LOGS"**

![mitmweb – finding the request](./img/instructions-api.png)

**4. Open the response tab and copy the API response data**

![mitmweb – copy the response](./img/instructions-copy.png)

### Save live war data

Save the JSON output from the scraped API responce to [current.json](tacticus-guild\data\war\current.json).

Commit and push back to master. A GitHub action will deploy the data to the live site.
