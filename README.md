# FOSSHACK — Intelligent Open Source Issue Recommender

> Helping developers — especially early-career contributors — find the right open-source issues to work on, matched to their skills and interests.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## The Problem

Developers who want to contribute to open source face a real barrier: the existing tools (GitHub's "good first issue" label, goodfirstissue.dev) use basic keyword search with no personalization. A beginner TypeScript developer gets the same results as a senior Rust systems programmer.

**The result:** developers are overwhelmed, unconfident, and drop off before they ever make their first contribution.

## The Solution

FOSSHACK tags every open-source issue semantically (domain, required skills, quality score) and builds a developer profile from a short sign-up form. It then uses a 3-tier matching algorithm — PostgreSQL tag filtering → pgvector semantic similarity → weighted scoring — to return personalized, ranked issue recommendations.

---

## Stack

All components are open-source:

| Layer | Technology |
|---|---|
| Database | PostgreSQL 16 + pgvector (vector similarity search) |
| Search | Meilisearch (full-text + faceted) |
| Cache + Queue | Redis + BullMQ |
| API | Fastify (Node.js / TypeScript) |
| LLM enrichment | Groq API (llama-3.3-70b-versatile — open model) |
| Embeddings | HuggingFace BAAI/bge-large-en-v1.5 (1024 dims) |
| Frontend | Next.js 14, Tailwind CSS, TypeScript |
| Infrastructure | Docker Compose |

---

## Architecture

```
GitHub API (poller + webhooks)
        ↓
   BullMQ Queue (Redis)
        ↓
   Enrichment Pipeline
   ├── Difficulty Classifier     (rule-based)
   ├── Issue Type Classifier     (rule-based)
   ├── Tech Stack Tagger         (regex + GitHub API)
   ├── Semantic Tagger           (LLM → domain, skills, gfi_quality_score)
   ├── Repo Health Scorer        (GitHub API composite)
   ├── Freshness Tracker         (time math)
   ├── Mentorship Signal         (label + keyword scan)
   └── Embedding Generator       (HuggingFace BAAI/bge-large-en-v1.5)
        ↓
   PostgreSQL + pgvector  ←── source of truth + HNSW vector index
   Meilisearch            ←── full-text + faceted search
        ↓
   Fastify REST API  →  Next.js Frontend
```

### Matching Algorithm (3 tiers)

```
GET /users/:id/recommendations

Tier 1 — Hard filter (PostgreSQL)
  WHERE tech_stack && user.tech_stack
    AND difficulty_label = user.preferred_difficulty
    AND state = 'open'

Tier 2 — Semantic ranking (pgvector)
  ORDER BY embedding <=> user_embedding   (cosine similarity)
  LIMIT 100

Tier 3 — Score each candidate
  score = 0.4 × embedding_similarity
        + 0.3 × domain_overlap
        + 0.2 × gfi_quality_score
        + 0.1 × repo_health_score
```

---

## Quick Start

### Prerequisites
- Docker Desktop
- Node.js 20+
- A GitHub Personal Access Token (read scope)
- A Groq API key (free tier at console.groq.com)
- A HuggingFace API token (free read token at huggingface.co/settings/tokens)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/aknsubbu/foss_hack.git
cd foss_hack

# 2. Start infrastructure (PostgreSQL, Redis, Meilisearch)
docker compose up -d

# 3. Install dependencies
npm install
cd frontend && npm install && cd ..

# 4. Configure environment
cp .env.example .env
# Fill in: GITHUB_TOKEN, GROQ_API_KEY, HUGGINGFACE_API_KEY
```

### `.env` values

```env
GITHUB_TOKEN=ghp_...              # GitHub PAT (read scope)
GROQ_API_KEY=gsk_...              # Groq free tier
HUGGINGFACE_API_KEY=hf_...        # HuggingFace read token
DATABASE_URL=postgres://fosshack:fosshack@localhost:5433/fosshack
REDIS_URL=redis://localhost:6379
MEILISEARCH_URL=http://localhost:7700
MEILISEARCH_KEY=masterKey
PORT=3000
NODE_ENV=development
```

### Run

```bash
# Terminal 1 — API server (runs migrations automatically)
npm run dev

# Terminal 2 — Frontend (http://localhost:4000)
cd frontend && npm run dev

# Terminal 3 — Seed issues from 100+ repos
npx ts-node --transpile-only scripts/run-seed.ts

# Terminal 4 — LLM enrich all seeded issues (domain tags + embeddings)
npx ts-node --transpile-only scripts/full-enrich.ts
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | DB, Redis, Meilisearch health check |
| `GET` | `/issues` | Browse issues with filters (lang, difficulty, type, freshness) |
| `GET` | `/issues/:id` | Single issue by UUID |
| `GET` | `/search?q=...` | Full-text search via Meilisearch |
| `POST` | `/users` | Onboard a developer — extracts profile tags via LLM |
| `GET` | `/users/:id` | Fetch developer profile |
| `PUT` | `/users/:id` | Update profile (regenerates tags + embedding) |
| `GET` | `/users/:id/recommendations` | Personalized ranked issue recommendations |
| `GET` | `/issues/similar/:id` | Semantically similar issues (vector search) |
| `POST` | `/webhooks/github` | GitHub webhook receiver |

### Recommendation filters

```
GET /users/:id/recommendations?limit=20&freshness=fresh&type=bug-fix&mentored=true&min_gfi_quality=0.6
```

---

## Frontend

Three pages at `http://localhost:4000`:

- **`/`** — Landing page
- **`/onboarding`** — 6-step sign-up form (tech stack, domains, experience level, issue preferences)
- **`/dashboard`** — Personalized recommendations with match scores and reasons
- **`/browse`** — Filter and search all issues

---

## Database Schema

Six migrations in `src/db/migrations/`:

1. `001_create_repos.sql` — repos table + pgvector extension
2. `002_create_issues.sql` — issues table with all enrichment fields
3. `003_create_indexes.sql` — GIN + HNSW indexes
4. `004_create_users.sql` — developer profiles with embedding
5. `005_semantic_tags.sql` — LLM-generated semantic fields on issues
6. `006_repo_attributes.sql` — per-repo LLM attribute extraction
7. `007_update_embedding_dims.sql` — embedding dimensions (1024, HuggingFace)

---

## License

MIT — see [LICENSE](./LICENSE)
