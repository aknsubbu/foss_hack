# FOSSHACK — Data Layer Features

> **Open Source Issues Platform** · Built for Claude Code · Version 1.0 · March 2026

FOSSHACK is a data pipeline that discovers, enriches, and serves open-source GitHub issues matched to contributor skills. This document describes every feature of the data layer.

---

## What It Does

At its core, FOSSHACK answers one question: **"What open-source issues can I actually contribute to right now?"**

It does this by continuously pulling issues from GitHub, GitLab, and curated aggregator sites, running them through an enrichment pipeline that scores difficulty, detects tech stack, measures repo health, and flags mentorship availability — then serving everything via a fast REST API with full-text search.

---

## Data Sources

FOSSHACK pulls from **five distinct sources**, all running on independent schedules:

### 1. GitHub GraphQL Poller
- Runs every **15 minutes**
- Queries GitHub's GraphQL API for all open issues tagged `good-first-issue` or `help-wanted`
- Fetches up to 100 issues per page with full metadata: title, body, labels, comments, repo info
- Stores a **pagination cursor in Redis** so it survives restarts without re-fetching from scratch
- Deduplicates via a Redis SET before emitting to the queue — never processes the same issue twice

### 2. goodfirstissue.dev
- Runs **daily at 02:00**
- Fetches the curated repo list maintained by the goodfirstissue community (thousands of repos)
- Discovers repo slugs → queues each repo for full issue ingestion via GitHub REST API
- No HTML scraping — reads raw JSON directly from the source repository

### 3. up-for-grabs.net
- Runs **daily at 02:00**, in parallel with goodfirstissue
- Fetches the YAML project list from up-for-grabs.net's GitHub Pages data file
- Parses `github.repository` fields to extract repo slugs
- Merges and deduplicates with goodfirstissue results before queuing

### 4. GitHub Webhooks (Real-Time)
- Handles `issues.opened`, `issues.labeled`, `issues.edited`, `issues.closed`
- HMAC-SHA256 signature validation on every incoming payload — no spoofed webhooks
- Responds `200 OK` immediately; all processing is async via the queue
- Only processes repos that are already tracked by the platform

### 5. GitLab (Day 2)
- Polls GitLab's REST API every **30 minutes**
- Fetches issues labelled `good first issue` or `help wanted`
- Uses the same enrichment pipeline as GitHub issues

---

## Enrichment Pipeline

Every issue is run through **7 enrichment modules** in sequence. If any module fails, the issue is still stored with its raw data intact — enrichment failure never causes data loss.

### 1. Difficulty Classifier
Assigns `easy`, `medium`, or `hard` to every issue.

**Rule-based pass (fast, free):**
- Labels containing `good-first-issue`, `beginner`, `starter`, `first-timers-only` → **easy**
- Labels containing `intermediate`, `moderate` → **medium**
- Labels containing `hard`, `complex`, `advanced`, `expert` → **hard**

**LLM pass (when no label matches):**
- Calls **Claude Haiku 3** (`claude-3-haiku-20240307`) with issue title, body, and labels
- Batches **10 issues per API call** to minimise cost (~$0.30/day at 10,000 issues)
- Returns a float score (0–1) alongside the label for nuanced ranking

### 2. Issue Type Classifier
Tags each issue with one or more types: `bug-fix`, `feature`, `documentation`, `tests`, `refactor`, `performance`, `design`, `discussion`.

- Label-based heuristics (e.g. labels containing "bug", "fix", "crash" → `bug-fix`)
- Title keyword matching as a secondary signal
- LLM fallback with the same batch approach as difficulty

### 3. Tech Stack Tagger
Detects the languages and frameworks relevant to each issue using a **three-tier approach**:

| Priority | Signal | Example |
|---|---|---|
| Primary | GitHub Languages API | `TypeScript`, `Python`, `Rust` |
| Secondary | Package file detection in repo root | `package.json` → JavaScript, `Cargo.toml` → Rust |
| Tertiary | Regex scan of issue body | mentions of React, Django, Next.js, etc. |

- Language cache stored in Redis with a **6-hour TTL** to avoid redundant API calls
- Normalises name variants (`JS` → `JavaScript`, `py` → `Python`)
- Detects 20+ frameworks and tools including React, Vue, Angular, Django, Flask, Rails, Spring, Laravel, Next.js, Docker, Kubernetes, GraphQL

### 4. Repo Health Scorer
Produces a composite **0–1 health score** for the repository maintaining each issue, based on four weighted signals:

| Signal | Weight | Logic |
|---|---|---|
| Stars count | 20% | Logarithmic scale — 1M stars = 1.0 |
| Days since last commit | 30% | < 7 days = 1.0, < 30 days = 0.7, < 90 days = 0.4, ≥ 90 days = 0.1 |
| Avg issue response time | 35% | < 24h = 1.0, < 72h = 0.7, < 168h = 0.4, ≥ 168h = 0.1 |
| Is archived | 15% | Archived repos score 0.0 — overrides everything |

Full breakdown stored as JSONB for debugging and display in the frontend.

### 5. Freshness Tracker
Pure computation — no API calls needed.

- `fresh` — last activity less than 30 days ago
- `active` — last activity 30–180 days ago
- `stale` — no activity for more than 180 days

Also records `issue_age_days` (time since opened) and `days_since_activity` (time since last update).

### 6. Mentorship Signal Detector
Identifies issues where maintainers have offered to guide contributors.

**Label check:** `mentored`, `has-mentor`, `office-hours`, `pair-programming`, `pairing`

**Body keyword check:** phrases like `"happy to help"`, `"feel free to ask"`, `"office hours"`, `"will guide"`, `"pair program"`, `"guidance available"`

### 7. Embedding Generator *(Day 2)*
Generates a **1536-dimension vector** for each issue using OpenAI `text-embedding-3-small`.

- Input: issue title + first 500 characters of body
- Stored as `VECTOR(1536)` in PostgreSQL via pgvector
- Enables **semantic similarity search** — "find issues like this one"
- HNSW index for fast approximate nearest-neighbour queries
- Skipped silently if `OPENAI_API_KEY` is not configured (column is nullable)

---

## Storage Architecture

FOSSHACK uses three storage systems, each chosen for a specific purpose:

### PostgreSQL 16 + pgvector
The **source of truth** for all issue data.

- `repos` table — metadata for every tracked repository
- `issues` table — fully enriched issue documents with all enrichment fields
- All enrichment fields use `COALESCE` on upsert — existing enrichment is never overwritten by a raw re-ingest
- `raw_json JSONB` column stores the original unmodified API response for every issue
- pgvector extension for vector similarity search
- pg_trgm extension for trigram-based text search fallback
- Optimised indexes: GIN on `tech_stack[]` and `issue_type[]` arrays, HNSW on `embedding`, composite index on `(difficulty_label, freshness_label, state)`

### Meilisearch 1.x
**Full-text and faceted search** for the API.

- Searchable fields: `title`, `body_raw`, `repo_slug`, `tech_stack`
- Filterable: `tech_stack`, `difficulty_label`, `issue_type`, `freshness_label`, `source`, `is_mentored`, `state`
- Sortable: `created_at`, `updated_at`, `repo_health_score`
- Returns facet distribution counts (e.g. "32 Python issues, 12 easy")
- Synced after every successful DB upsert

### Redis 7
**Cache, queue broker, and deduplication store.**

| Key | Purpose | TTL |
|---|---|---|
| `seen_issues` (SET) | Global dedup — prevents reprocessing | Permanent |
| `cursor:github-poller` | GraphQL pagination cursor | Permanent |
| `repo:{slug}:languages` | Cached language list per repo | 6 hours |
| `repo:{slug}:meta` | Cached repo metadata | 6 hours |
| `popular:{lang}` | Cached browse page results | 5 minutes |
| `rl:github:{window}` | Rate limit counter | 1 hour |

---

## Async Queue System (BullMQ)

All heavy processing is decoupled from ingestion via BullMQ on Redis.

| Queue | Producer | Consumer | Concurrency |
|---|---|---|---|
| `raw_issues` | GitHub Poller, Webhooks, GitLab | Full enrichment pipeline → DB + Meilisearch | 5 |
| `repo_discovery` | Aggregator Fetcher | Fetch all open issues for a new repo | 2 |
| `closed_issues` | Webhook Receiver | Mark issue `state='closed'` in DB | 10 |
| `re_enrich` | Weekly cron / manual | Re-run enrichment from stored `raw_json` | 3 |

All jobs retry up to 3 times with exponential backoff (base 1s, max 60s). Failed jobs are retained for 500 entries for debugging.

---

## REST API

Base URL: `http://localhost:3000`

### `GET /health`
Returns the health of all three services.
```json
{ "status": "ok", "db": "ok", "redis": "ok", "search": "ok" }
```

### `GET /issues`
Paginated browse with filters.

| Parameter | Example | Description |
|---|---|---|
| `lang` | `?lang=TypeScript&lang=React` | Filter by tech stack (repeatable) |
| `difficulty` | `?difficulty=easy` | `easy` · `medium` · `hard` |
| `type` | `?type=bug-fix` | Issue type filter |
| `freshness` | `?freshness=fresh` | `fresh` · `active` · `stale` |
| `mentored` | `?mentored=true` | Only issues with mentorship signal |
| `source` | `?source=github` | Source platform |
| `page` / `limit` | `?page=2&limit=20` | Pagination (max 100 per page) |
| `sort` | `?sort=repo_health_score` | Sort by field |

### `GET /issues/:id`
Returns a single enriched issue by UUID.

### `GET /search?q=...`
Full-text search via Meilisearch with facet distribution in the response.

```json
{
  "hits": [...],
  "estimatedTotalHits": 142,
  "facetDistribution": {
    "tech_stack": { "TypeScript": 45, "Python": 32 },
    "difficulty_label": { "easy": 88, "medium": 54 }
  }
}
```

### `POST /webhooks/github`
Real-time GitHub webhook receiver with HMAC-SHA256 validation.

---

## Scheduled Maintenance Jobs

| Job | Schedule | Purpose |
|---|---|---|
| GitHub Poller | Every 15 min | Paginated GraphQL fetch |
| GitLab Poller | Every 30 min | REST pagination |
| Aggregator Fetcher | Daily 02:00 | goodfirstissue + up-for-grabs |
| Stale Issue Scanner | Daily 03:00 | Mark inactive issues as stale |
| Closed Issue Sweeper | Every 6 hours | Verify and sync closed state |
| Repo Health Refresher | Daily 04:00 | Re-score repo health for all tracked repos |
| Re-enrichment Runner | Weekly Sunday 01:00 | Re-run LLM enrichment on stale issues |

---

## Rate Limiting & Reliability

- **GitHub REST:** 5,000 req/hr tracked via Redis counter
- **GitHub GraphQL:** 5,000 points/hr — 1-second delay between pages
- **Auto-pause** when `X-RateLimit-Remaining < 100`
- **Exponential backoff** on HTTP 429/403/5xx: base 1s, max 60s, ±20% jitter
- **Claude Haiku retries:** 3 attempts on 429/529, then stores issue without LLM fields
- **Enrichment failure isolation:** one failed module never blocks the rest; issue always stored

---

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| API Framework | Fastify 4 |
| Collector Workers | Python 3.12 (httpx + asyncio) |
| Message Queue | BullMQ 5 on Redis 7 |
| Enrichment LLM | Claude Haiku 3 (Anthropic) |
| Primary Database | PostgreSQL 16 + pgvector |
| Full-text Search | Meilisearch 1.7 |
| Cache / Queue Broker | Redis 7 |
| Scheduler | node-cron |
| Containers | Docker Compose |
| Embeddings | OpenAI text-embedding-3-small |
| Logging | Pino (structured JSON) |

---

## Acceptance Criteria

The data layer is production-ready when:

- `docker compose up` starts all services with no errors
- `npm run seed` populates the database with at least 200 issues
- `GET /issues` returns a valid paginated response
- `GET /issues?lang=Python&difficulty=easy` returns only Python easy issues
- `GET /search?q=authentication` returns results within 200ms
- A new GitHub issue on a tracked repo appears in the DB within 30 seconds via webhook
- All issues have at minimum: `title`, `url`, `repo_slug`, `source`, `tech_stack`, `difficulty_label`, `freshness_label`
- No duplicate issues exist in the database
- `GET /health` returns `200` with all services showing `ok`
- Re-running the seed script produces no duplicate rows

---

*FOSSHACK Data Layer · Version 1.0 · March 2026*
