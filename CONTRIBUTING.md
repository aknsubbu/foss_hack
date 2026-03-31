# Contributing to FOSSHACK

Thank you for your interest in contributing! This document explains how to get the project running locally and how to submit changes.

## Prerequisites

- Node.js 20+
- Docker Desktop
- Git

## Local Development Setup

```bash
# 1. Fork and clone
git clone https://github.com/<your-username>/foss_hack.git
cd foss_hack

# 2. Install backend dependencies
npm install

# 3. Install frontend dependencies
cd frontend && npm install && cd ..

# 4. Start infrastructure
docker compose up -d

# 5. Set up environment
cp .env.example .env
# Fill in your GITHUB_TOKEN, GROQ_API_KEY, HUGGINGFACE_API_KEY

# 6. Start the backend (auto-runs migrations)
npm run dev

# 7. Start the frontend
cd frontend && npm run dev
```

Backend runs on **http://localhost:3000**, frontend on **http://localhost:4000**.

## Project Structure

```
foss_hack/
├── src/
│   ├── api/            # Fastify server + route handlers
│   ├── collectors/     # GitHub poller + webhook receiver
│   ├── db/             # PostgreSQL client, migrations, seed
│   ├── enrichment/     # Issue enrichment pipeline modules
│   ├── queue/          # BullMQ workers
│   ├── search/         # Meilisearch sync
│   ├── types/          # TypeScript type definitions
│   ├── users/          # User onboarding + recommendation matching
│   └── cache/          # Redis client
├── scripts/            # One-off scripts (seed, enrich, embed)
├── frontend/           # Next.js 14 frontend
└── docker-compose.yml
```

## Making Changes

1. Create a branch: `git checkout -b feat/your-feature`
2. Make your changes
3. Test manually: `npm run dev` and verify via `curl http://localhost:3000/health`
4. TypeScript check: `npm run build` or `npx tsc --noEmit`
5. Commit and open a Pull Request

## Submitting a Pull Request

- Keep PRs focused — one feature or fix per PR
- Describe what the change does and why in the PR description
- If adding a new enrichment module, register it in `src/enrichment/pipeline.ts`
- If adding a new API route, register it in `src/api/server.ts`

## Reporting Issues

Open a GitHub Issue with:
- A clear description of the problem
- Steps to reproduce
- Expected vs actual behaviour
- Relevant logs (from `npm run dev` output)

## Code Style

The project uses TypeScript strict mode. Keep things consistent with existing code — no linter is configured yet, but follow the patterns you see.

## License

By contributing, you agree your contributions will be licensed under the [MIT License](./LICENSE).
