# FOSSHACK — Full System Design

> Version 2.0 · March 2026 · Implementation complete

---

## Problem

Developers, especially early-career ones, face high friction finding open-source issues to contribute to. Existing platforms use basic labels like "good first issue" and keyword search — neither is personalized nor context-aware. The result: users are overwhelmed, unconfident, and drop off before they ever contribute.

**The fix:** An intelligent matching layer that tags issues semantically, builds a developer profile, and returns ranked, personalized issue recommendations.

---

## What Already Exists (`foss_hack/`)

The data pipeline is built and working. It handles:

- **Collection** — GitHub GraphQL poller (every 15 min), GitHub webhooks (real-time), goodfirstissue.dev + up-for-grabs.net (daily)
- **Enrichment** — 7 modules: difficulty classifier, issue type tagger, tech stack detector, repo health scorer, freshness tracker, mentorship signal detector, embedding generator
- **Storage** — PostgreSQL (source of truth), Meilisearch (full-text search), Redis (cache + queue broker)
- **Queue** — BullMQ with 4 workers: raw_issues, repo_discovery, closed_issues, re_enrich
- **API** — `GET /issues`, `GET /issues/:id`, `GET /search`, `POST /webhooks/github`, `GET /health`

This is the foundation. Everything below extends it.

---

## The Four Flows

### Flow 1 — Issue ingestion (continuous background)
```
GitHub (poller every 15min / webhook real-time)
  → Redis dedup check  →  already seen? drop it
  → BullMQ raw_issues queue
  → Worker: enrichment pipeline (difficulty, type, tech-stack, semantic-tagger,
            repo-health, freshness, mentorship, embeddings)
  → PostgreSQL upsert + Meilisearch sync
```
Runs forever. No user involvement.

### Flow 2 — User onboarding (sign-up, one-time)
```
User fills sign-up form:
  - GitHub username (optional)
  - Languages / frameworks they know
  - Domain interests (pick from base 10)
  - Experience level (beginner / intermediate / advanced)
  - Issue type preferences (bug-fix, feature, docs…)
  - Free-text goal ("I want to learn backend")
  ↓
LLM extracts structured tags:
  { tech_stack, domains, skills, experience_level, preferred_difficulty }
  ↓
Generate user embedding (OpenAI text-embedding-3-small, 1536 dims)
  ↓
Store in users table → return user_id
```
Sign-up form is the primary signal source. GitHub username enriches it further if provided.

### Flow 3 — Recommendations (request-time)
```
GET /users/:id/recommendations
  ↓
Tier 1: hard filter — PostgreSQL (tech_stack overlap + difficulty + state=open)
  ↓
Tier 2: vector similarity — pgvector cosine (user embedding ↔ issue embeddings)
  ↓
Tier 3: score each candidate:
  0.4 × embedding_similarity
  0.3 × domain_overlap
  0.2 × gfi_quality_score
  0.1 × repo_health_score
  ↓
Cache in Redis (10 min) → return ranked issues with match_reasons
```
Fast at request time. All expensive work done in Flows 1 and 2.

### Flow 4 — Daily user profile refresh (future / post-MVP)
```
Daily cron → re-fetch GitHub activity → re-run LLM extraction
  → update tags if changed → bump profile_version → invalidate cache
```
Keeps profiles fresh as users gain new skills. Out of scope for MVP.

---

## What We Are Building

Three new layers on top of the existing pipeline:

1. **Richer issue tagging** — semantic tags extracted by LLM, beyond the current rule-based enrichment
2. **User profile** — developer onboarding that creates a structured profile mirroring issue tags
3. **Matching service** — takes a user profile, returns ranked issues with a match score

---

## Layer 1 — Issue Tag Schema

Every issue will have two categories of tags: **structural** (already exist, rule-based) and **semantic** (new, LLM-generated).

### Structural tags (existing)

| Field | Values | How generated |
|---|---|---|
| `difficulty_label` | `easy` \| `medium` \| `hard` | Labels → LLM fallback |
| `issue_type` | `bug-fix` \| `feature` \| `docs` \| `tests` \| `refactor` \| `performance` \| `design` \| `discussion` | Labels → LLM fallback |
| `tech_stack` | `[TypeScript, React, ...]` | GitHub API → pkg files → body regex |
| `freshness_label` | `fresh` \| `active` \| `stale` | Time math |
| `is_mentored` | boolean | Label + body keyword scan |
| `repo_health_score` | float 0–1 | Composite score |
| `embedding` | VECTOR(1024) | HuggingFace BAAI/bge-large-en-v1.5 |

### Semantic tags (new — LLM-generated in one call per issue)

| Field | Values | Purpose |
|---|---|---|
| `domain` | see base vocabulary below | What area of software this touches |
| `skills_required` | `[React, CSS, async/await, ...]` | Specific skills needed (finer than tech_stack) |
| `context_depth` | `none` \| `low` \| `medium` \| `high` | How much codebase familiarity is needed to start |
| `scope` | `isolated` \| `cross-cutting` | One file vs. touches many parts of the system |
| `gfi_quality_score` | float 0–1 | Is this actually a good first issue (independent of label) |
| `has_clear_criteria` | boolean | Is "done" clearly defined in the issue body |
| `has_reproduction_steps` | boolean | For bugs: can you reproduce it from the description |

### Base domain vocabulary (10 fixed + LLM can extend)

```
frontend        UI, CSS, components, rendering, accessibility
backend         APIs, servers, business logic, auth, sessions
devtools        CLIs, editors, build tools, linters, debuggers, bundlers
infrastructure  Docker, K8s, CI/CD, cloud, networking, deployment
ml              models, training, data pipelines, inference, embeddings
mobile          iOS, Android, React Native, Flutter, cross-platform
database        SQL, ORMs, migrations, query optimization, schema
security        auth, crypto, vulnerabilities, permissions, CVEs
testing         unit/integration/e2e tests, test frameworks, coverage
docs            READMEs, guides, API docs, tutorials, examples
```

LLM can add tags beyond these 10 (e.g. `accessibility`, `parser`, `compiler`, `state-management`). The base 10 are guaranteed vocabulary for hard filtering. LLM-extended tags are bonus signal for embedding-based ranking.

### Single LLM call per issue for semantic tags

Rather than separate LLM calls per module (current approach), semantic tagging is **one structured call**:

```
Input:
  title: <issue title>
  body:  <first 600 chars of issue body>
  labels: [<label names>]
  repo_context:
    tech_stack: [<detected languages>]
    description: <repo description>
    topics: [<repo topics>]

Output (JSON):
{
  "domain": ["frontend", "testing"],          // base vocab first, extras allowed
  "skills_required": ["React", "Jest", "CSS"],
  "context_depth": "low",
  "scope": "isolated",
  "gfi_quality_score": 0.82,
  "has_clear_criteria": true,
  "has_reproduction_steps": false
}
```

This runs as a new enrichment module (`semantic-tagger.ts`) added to the existing pipeline after `tech-stack` (needs tech stack context). Cost: ~1 LLM call per issue. Uses the same Groq/LLM client as the existing classifiers. Falls back gracefully — if it fails, all semantic fields are null.

---

## Layer 2 — User Profile

### What a user profile contains

```
id                  UUID
github_username     TEXT (unique, optional)
display_name        TEXT
bio                 TEXT                    (free-text about themselves)
tech_stack          TEXT[]                  (languages/frameworks they know)
domains             TEXT[]                  (areas they want to work in — from base 10)
experience_level    TEXT                    (beginner | intermediate | advanced)
preferred_difficulty TEXT                   (easy | medium | hard)
preferred_types     TEXT[]                  (bug-fix | feature | docs | ...)
skills              TEXT[]                  (specific skills — mirrors issue.skills_required)
embedding           VECTOR(1536)            (profile embedding for semantic matching)
raw_profile         JSONB                   (original input for debugging/re-processing)
tags_generated_at   TIMESTAMPTZ
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
```

### User onboarding — two inputs

Both are optional, but together they produce much better tags:

1. **GitHub username** — we fetch: pinned repos, contributed-to repos (last 6 months), primary languages, bio
2. **Free-text prompt** — "I'm learning React and want to fix bugs in frontend tools" — this dramatically improves intent extraction

Either alone is enough. GitHub-only gives us skill signals. Free-text gives us intent and goals.

### How user tags are generated (onboarding pipeline)

```
POST /users  { github_username?, prompt? }
  ↓
1. If github_username: fetch GitHub profile via REST API
   - user bio, location, blog
   - pinned repos (language, topics, description)
   - recently pushed repos (languages)
   → build a structured context object

2. LLM call — extract tags from context + free-text prompt:
   Input:  github_profile (if available) + user's free-text
   Output: {
     tech_stack: [...],
     domains: [...],           // must be subset of base 10 + LLM extras
     experience_level: "...",
     preferred_difficulty: "...",
     skills: [...]
   }

3. Generate embedding
   Input: "<experience_level> developer interested in <domains>. Skills: <skills>. <prompt>"
   Model: HuggingFace BAAI/bge-large-en-v1.5 via router.huggingface.co (1024 dims — same model as issues)

4. Store in users table
5. Return user_id — client stores this for subsequent recommendation requests
```

**No auth required.** User submits once, gets back a `user_id` UUID, uses it in future calls. Profile can be updated via `PUT /users/:id`. This keeps the MVP stateless and simple.

### Profile update and versioning

When the user updates their profile, the embedding is regenerated. Redis recommendation cache for that user is invalidated by including a `profile_version` integer in the cache key (incremented on every update).

---

## Layer 3 — Matching Service

### Algorithm — three tiers

```
GET /users/:id/recommendations?limit=20&freshness=fresh&type=bug-fix

Tier 1 — Hard filter (PostgreSQL)
  WHERE state = 'open'
    AND tech_stack && user.tech_stack         -- array overlap
    AND (user.preferred_difficulty IS NULL OR difficulty_label = user.preferred_difficulty)
    AND (freshness param if provided)
    AND (type param if provided)
  → candidate set (could be thousands)

Tier 2 — Semantic ranking (pgvector)
  ORDER BY embedding <=> user.embedding       -- cosine similarity
  LIMIT 100                                   -- top 100 semantic matches from candidates

Tier 3 — Score and return
  For each of the 100 candidates, compute match_score:
    0.4 × embedding_similarity
    0.3 × domain_overlap_score     (|user.domains ∩ issue.domain| / |user.domains|)
    0.2 × gfi_quality_score        (how good is the issue itself)
    0.1 × repo_health_score
  Sort by match_score DESC, return top N
```

No LLM re-ranking in the MVP. The three-tier algorithm above is fast, cheap, and good enough.

### Cache

```
Redis key:  recommend:{user_id}:v{profile_version}:{filter_hash}
TTL:        10 minutes
```

`filter_hash` is a short hash of the query parameters (freshness, type, limit). This means:
- Same user, same filters → cached for 10 min
- User updates profile → `profile_version` bumps → cache miss → fresh results
- Different filters → different key → independent cache entry

### Response format

```json
{
  "user_id": "uuid",
  "recommendations": [
    {
      "issue": { ...full IssueDoc... },
      "match_score": 0.87,
      "match_reasons": {
        "domain_overlap": ["frontend", "testing"],
        "skill_overlap": ["React", "Jest"],
        "difficulty_match": true,
        "gfi_quality": 0.82,
        "is_mentored": false
      }
    }
  ],
  "total_candidates": 342,
  "cached": false
}
```

`match_reasons` is computed cheaply from the structured tags — no extra LLM call needed.

---

## Repo Attribute Extraction (HLD section 1)

Per the HLD: repos are split into sections, each section gets an LLM call, hashes track changes.

### Sections

| Section | Content | Purpose |
|---|---|---|
| 1 | Repo metadata: name, description, topics, stars, primary language | Base attributes |
| 2 | README.md content (first 1500 chars) | Project context, onboarding friendliness |
| 3 | CONTRIBUTING.md content (first 1500 chars, if exists) | Contribution process, beginner signals |
| 4 | Last 10 open issue titles (sampled signal) | Current active work areas |

### What gets extracted

```json
{
  "base_attributes": {
    "project_type": "library | framework | app | tool | docs | infrastructure",
    "primary_domain": "frontend | backend | devtools | ...",
    "beginner_friendliness": 0.0–1.0,
    "has_contributing_guide": true,
    "has_code_of_conduct": false,
    "setup_complexity": "low | medium | high"
  },
  "dynamic_attributes": {
    "active_areas": ["auth refactor", "performance improvements"],
    "maintainer_responsiveness": "high | medium | low",
    "current_focus": "free text summary of what the repo is currently working on"
  }
}
```

### Hash-based change detection

For each repo, we store a JSONB column `sections_hash`:
```json
{
  "section1": "sha256(metadata_string)",
  "section2": "sha256(readme_content)",
  "section3": "sha256(contributing_content)",
  "section4": "sha256(issue_titles_joined)"
}
```

Daily cron:
1. Fetch current content for each section
2. Compute new hash
3. Compare with stored hash
4. Only fire LLM call for sections where hash changed
5. Merge updated attributes into stored `repo_attributes`
6. Update stored hashes

This means most repo runs are hash comparisons only — no LLM cost unless something actually changed.

---

## Database Migrations

### Migration 004 — users table

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_username       TEXT UNIQUE,
  display_name          TEXT,
  bio                   TEXT,
  tech_stack            TEXT[],
  domains               TEXT[],
  experience_level      TEXT,           -- 'beginner' | 'intermediate' | 'advanced'
  preferred_difficulty  TEXT,           -- 'easy' | 'medium' | 'hard'
  preferred_types       TEXT[],
  skills                TEXT[],
  profile_version       INTEGER DEFAULT 1,
  embedding             VECTOR(1536),
  raw_profile           JSONB,
  tags_generated_at     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_github_username_idx ON users(github_username);
CREATE INDEX IF NOT EXISTS users_domains_idx ON users USING GIN(domains);
CREATE INDEX IF NOT EXISTS users_tech_stack_idx ON users USING GIN(tech_stack);
CREATE INDEX IF NOT EXISTS users_embedding_idx ON users
  USING hnsw (embedding vector_cosine_ops);
```

### Migration 005 — semantic tags on issues

```sql
ALTER TABLE issues ADD COLUMN IF NOT EXISTS domain              TEXT[];
ALTER TABLE issues ADD COLUMN IF NOT EXISTS skills_required     TEXT[];
ALTER TABLE issues ADD COLUMN IF NOT EXISTS context_depth       TEXT;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS scope               TEXT;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS gfi_quality_score   FLOAT;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS has_clear_criteria  BOOLEAN;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS has_reproduction_steps BOOLEAN;

CREATE INDEX IF NOT EXISTS issues_domain_idx ON issues USING GIN(domain);
CREATE INDEX IF NOT EXISTS issues_skills_idx ON issues USING GIN(skills_required);
CREATE INDEX IF NOT EXISTS issues_context_depth_idx ON issues(context_depth);
CREATE INDEX IF NOT EXISTS issues_gfi_quality_idx ON issues(gfi_quality_score DESC);
```

### Migration 006 — repo attribute columns

```sql
ALTER TABLE repos ADD COLUMN IF NOT EXISTS sections_hash          JSONB;
ALTER TABLE repos ADD COLUMN IF NOT EXISTS repo_attributes        JSONB;
ALTER TABLE repos ADD COLUMN IF NOT EXISTS attributes_extracted_at TIMESTAMPTZ;
```

---

## New API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/users` | Onboard new user (github_username and/or prompt) |
| `GET` | `/users/:id` | Fetch user profile |
| `PUT` | `/users/:id` | Update user profile (regenerates tags + embedding) |
| `GET` | `/users/:id/recommendations` | Personalized ranked issues |
| `GET` | `/issues/similar/:id` | Issues similar to a given issue (pure vector search) |

### `POST /users` request body

```json
{
  "github_username": "octocat",          // optional
  "prompt": "I'm learning React and want to fix bugs in frontend tools",  // optional
  "preferred_difficulty": "easy",        // optional hint
  "preferred_types": ["bug-fix", "docs"] // optional hint
}
```

At least one of `github_username` or `prompt` must be present.

### `GET /users/:id/recommendations` query params

| Param | Example | Description |
|---|---|---|
| `limit` | `?limit=20` | Number of results (default 20, max 50) |
| `freshness` | `?freshness=fresh` | Pre-filter by freshness |
| `type` | `?type=bug-fix` | Pre-filter by issue type |
| `mentored` | `?mentored=true` | Only mentored issues |
| `min_gfi_quality` | `?min_gfi_quality=0.6` | Minimum GFI quality score |

---

## New Files to Create

```
src/
  users/
    onboarding.ts         GitHub profile fetcher + LLM tag extraction + embedding
    matching.ts           3-tier matching: filter → vector rank → score
  enrichment/
    semantic-tagger.ts    New enrichment module: single LLM call → all semantic fields
  enrichment/
    repo-attributes.ts    Section-based LLM extraction + hash change detection
  db/
    users.ts              User CRUD queries (upsertUser, getUserById, etc.)
  api/
    routes/
      users.ts            POST /users, GET /users/:id, PUT /users/:id
      recommendations.ts  GET /users/:id/recommendations, GET /issues/similar/:id
  db/
    migrations/
      004_create_users.sql
      005_semantic_tags.sql
      006_repo_attributes.sql
```

---

## Changes to Existing Files

### `src/types/issue.ts`
Add new fields to `IssueDoc`:
```typescript
domain?: string[];
skillsRequired?: string[];
contextDepth?: 'none' | 'low' | 'medium' | 'high';
scope?: 'isolated' | 'cross-cutting';
gfiQualityScore?: number;
hasClearCriteria?: boolean;
hasReproductionSteps?: boolean;
```

Add new `User` type.

### `src/enrichment/pipeline.ts`
Add `runSemanticTagger` as module 8 (after `runTechStackTagger`, before `runEmbeddingGenerator`).

### `src/db/client.ts`
- Add semantic fields to `upsertIssue` INSERT + ON CONFLICT DO UPDATE
- Add semantic fields to `rowToIssueDoc`

### `src/api/server.ts`
- Register `registerUsersRoutes` and `registerRecommendationsRoutes`
- Add daily cron for repo attribute extraction

---

## Frontend (Next.js 14)

Located at `frontend/`. Runs on port **4000**.

### Pages

| Route | Purpose |
|---|---|
| `/` | Landing page — hero, feature cards, how-it-works |
| `/onboarding` | 6-step sign-up form → calls `POST /users` → saves `userId` to localStorage |
| `/dashboard?userId=<id>` | Profile sidebar + recommendation cards with filter bar |
| `/browse` | Search bar + filter sidebar (difficulty, domain, type, freshness) + paginated issue grid |

### Key components

- `IssueCard` — shared card for browse and recommendations. Shows match score bar, match reason bullets, skill overlap chips
- `DifficultyBadge` — green/yellow/red pills
- `DomainBadge` — 10 domain badges with emoji
- `Navbar` — sticky nav with active link highlighting

### API transform layer

`frontend/lib/api.ts` contains `transformIssue()` and `transformRecommendation()` that bridge backend field names (camelCase `IssueDoc`) to frontend `Issue` type. Key mappings:

| Backend (`IssueDoc`) | Frontend (`Issue`) |
|---|---|
| `difficultyLabel` | `difficulty` |
| `techStack` | `language` |
| `isMentored` | `hasMentor` |
| `freshnessLabel` | `freshness` |
| `commentsCount` | `commentCount` |
| `issueType[]` | `type` (first element) |
| `externalId` (string) | `number` (parseInt) |
| `matchReasons` (MatchReason object) | `matchReasons` (string[]) |
| `meta.total` | `total` |

---

## Bugs Fixed in Existing Code

| # | File | Bug | Fix |
|---|---|---|---|
| 1 | `src/queue/workers.ts:133` | `reEnrichWorker` passes raw DB row (snake_case) to `reEnrichFromRaw` which expects `IssueDoc` (camelCase) | Run `rowToIssueDoc()` before passing |
| 2 | `src/collectors/github-poller.ts:11` | GraphQL query uses AND for both labels — misses issues with only one label | Change to OR: `label:"good-first-issue" OR label:"help-wanted"` |
| 3 | `src/collectors/webhook-receiver.ts` | Edited issue body doesn't reset `enriched_at` — stale semantic tags survive for up to 7 days | Set `enriched_at = NULL` on edit webhook so weekly re-enrichment picks it up |
| 4 | `src/api/routes/issues.ts` + `recommendations.ts` | Fastify `response` JSON schema was stripping all but 3 fields from API responses | Removed strict `response` schemas from both routes |
| 5 | `src/db/users.ts` | `rowToUser()` never read `embedding` from the DB row — user always loaded with `embedding: undefined` | Added embedding parsing from pgvector string format `[0.1,0.2,...]` |
| 6 | `src/db/migrations/007_update_embedding_dims.sql` | Migration dropped embedding columns on every server restart (migrations run every boot, no tracking table) | Added `DO $$ ... $$` guard: only drops if `atttypmod = 1536` (old OpenAI dims) |

---

## Cron Jobs (additions)

| Job | Schedule | Purpose |
|---|---|---|
| Repo Attribute Extractor | Daily 04:00 | Hash-check all repos, fire LLM for changed sections only |

---

## Known Constraints and Decisions

**LLM for semantic tagging:** Uses Groq API (llama-3.3-70b) with same client as existing classifiers. One call per issue. Falls back silently — issue stored without semantic tags if LLM fails.

**Embedding model consistency:** User profiles and issues must use the same embedding model (`text-embedding-3-small`, 1536 dims) for cosine similarity to be meaningful.

**No auth:** Users are identified by UUID. They submit once and get a `user_id` back. This is sufficient for a hackathon MVP.

**Matching fallback:** If a user has no embedding yet (e.g., `OPENAI_API_KEY` not set), Tier 1 (tag filter) + Tier 3 (score without embedding component) still runs. Results are returned with `embedding_similarity: null` in match_reasons.

**`seen_issues` SET:** No TTL currently — grows unboundedly. Acceptable for MVP. Flag for post-hackathon cleanup.

**Meilisearch sync:** New semantic fields (`domain`, `skills_required`) will be added as filterable and searchable fields in `configureMeilisearch()`.

---

## Implementation Order

Phase 1 — DB and types (no runtime changes, safe to do first)
1. Migrations 004, 005, 006
2. New fields in `IssueDoc` and new `User` type in `types/issue.ts`
3. `src/db/users.ts` — user CRUD

Phase 2 — Issue semantic tagging (extends existing pipeline)
4. `src/enrichment/semantic-tagger.ts` — new enrichment module
5. Wire it into `pipeline.ts`
6. Update `upsertIssue` and `rowToIssueDoc` in `db/client.ts`
7. Update Meilisearch config with new fields

Phase 3 — User onboarding
8. `src/users/onboarding.ts` — GitHub profile fetch + LLM extraction + embedding
9. `src/api/routes/users.ts` — POST/GET/PUT endpoints
10. Register routes in `server.ts`

Phase 4 — Matching service
11. `src/users/matching.ts` — 3-tier matching with Redis cache
12. `src/api/routes/recommendations.ts` — recommendation + similar-issues endpoints
13. Register routes in `server.ts`

Phase 5 — Repo attribute extraction
14. `src/enrichment/repo-attributes.ts` — section fetch + hash diff + LLM extraction
15. Wire into daily cron in `server.ts`

Phase 6 — Bug fixes
16. Fix `reEnrichWorker` row mapping
17. Fix GitHub poller label query (AND → OR)
18. Fix webhook edit handler to reset `enriched_at`

---

## Open Questions (Resolved)

| Question | Decision |
|---|---|
| Auth? | No auth. UUID-based identity. User gets `user_id` on first call. |
| Onboarding input? | GitHub username + free-text prompt. Both optional, at least one required. |
| LLM re-ranking in matching? | No. Tag overlap + embedding similarity is enough for MVP. |
| Domain vocabulary? | 10 fixed base tags + LLM can add extras. Base tags used for hard filter. |
| Embedding model? | HuggingFace BAAI/bge-large-en-v1.5 via `router.huggingface.co`, 1024 dims, same for issues and users. |
| Sections for repo extraction? | Metadata, README, CONTRIBUTING.md, recent issue titles. |

---

## Scripts

| Script | Purpose |
|---|---|
| `scripts/run-seed.ts` | Seed 50 repos (242+ issues) into DB via GitHub REST API |
| `scripts/run-poller.ts` | Start GitHub GraphQL poller (continuous) |
| `scripts/embed-issues.ts` | Generate HuggingFace embeddings for issues missing them |
| `scripts/full-enrich.ts` | Run full LLM enrichment (semantic tags + embedding) on all issues |

Run order for a fresh setup:
```bash
docker compose up -d
npm run dev              # starts API + migrations
ts-node scripts/run-seed.ts
ts-node scripts/full-enrich.ts   # ~10 min, processes ~25 issues/min
```

---

*FOSSHACK System Design · v2.0 · March 2026 · Implementation complete*
