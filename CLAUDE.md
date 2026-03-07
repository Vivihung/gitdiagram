# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GitDiagram converts GitHub repositories into interactive Mermaid diagrams using a 3-stage LLM pipeline. It's a full-stack app with a Next.js frontend (Vercel) and FastAPI backend (Railway).

## Commands

### Frontend (pnpm, Node 22)
```bash
pnpm install          # Install dependencies
pnpm dev              # Start Next.js dev server (Turbo)
pnpm build            # Production build
pnpm lint             # ESLint
pnpm check            # Type-check + lint
pnpm typecheck        # TypeScript only (no lint)
pnpm test             # Vitest (frontend unit tests)
pnpm test:watch       # Vitest in watch mode
pnpm format:write     # Prettier formatting
pnpm format:check     # Prettier check (no write)
```

### Backend (Python 3.12, uv)
```bash
cd backend
uv sync --no-install-project   # Install pinned deps into .venv
uv run pytest -q               # Run all backend tests
uv run pytest tests/path/test_file.py::test_name  # Run single test
uv run python -m compileall app  # Compile check
```

`pnpm test:backend` runs backend tests from the repo root without `cd backend`.

### Database
```bash
pnpm db:push       # Push schema changes to Postgres
pnpm db:generate   # Generate Drizzle migration files
pnpm db:studio     # Open Drizzle Studio
```

### Local Development
```bash
# Start local Postgres
./start-database.sh

# Start FastAPI backend (Docker, recommended for production parity)
docker-compose up --build -d
docker-compose logs -f api

# OR start FastAPI backend directly
pnpm dev:backend   # runs uvicorn via uv
```

To route the Next.js frontend to a local FastAPI backend, set in `.env`:
```
NEXT_PUBLIC_USE_LEGACY_BACKEND=true
NEXT_PUBLIC_API_DEV_URL=http://localhost:8000
```

## Architecture

### Dual-Backend Design
The app supports two generation backends controlled by `NEXT_PUBLIC_USE_LEGACY_BACKEND`:
- **FastAPI** (`backend/`) on Railway — primary production path
- **Next.js Route Handlers** (`src/app/api/generate/`) — legacy fallback

Despite the name, `NEXT_PUBLIC_USE_LEGACY_BACKEND=true` points to the **primary** FastAPI backend in production (the name is historical).

Both expose the same SSE streaming API. The frontend (`src/features/diagram/api.ts`) routes to one or the other transparently.

### 3-Stage LLM Pipeline
Diagram generation uses three sequential OpenAI streaming calls:
1. **Explanation** — understands the repo structure
2. **Component Mapping** — maps components to file paths (XML tags extracted)
3. **Mermaid Diagram** — generates Mermaid syntax with click events

After stage 3, Mermaid syntax is validated (via `backend/scripts/validate_mermaid.mjs` or `src/server/generate/mermaid.ts`) and auto-fixed for up to 3 attempts if invalid. Prompts live in `backend/app/prompts.py` and `src/server/generate/prompts.ts`.

### Streaming State Machine
SSE events flow through states: `idle → started → explanation_* → mapping_* → diagram_* → diagram_fix_* → complete`

Frontend: `src/hooks/diagram/useDiagramStream.ts` manages state.
Backend: `backend/app/routers/generate.py` emits events.

### GitHub Authentication Priority
1. User-supplied PAT (from localStorage)
2. `GITHUB_PAT` env var
3. GitHub App (CLIENT_ID + PRIVATE_KEY + INSTALLATION_ID)

### Caching
Generated diagrams are cached in PostgreSQL (`gitdiagram_diagram_cache` table, schema at `src/server/db/schema.ts`) keyed by `(username, repo)`. Server action: `src/app/_actions/cache.ts`.

### Path Aliases
TypeScript uses `~/*` → `./src/*`.

## Key File Locations

| Concern | Frontend | Backend |
|---|---|---|
| Prompts | `src/server/generate/prompts.ts` | `backend/app/prompts.py` |
| GitHub client | `src/server/generate/github.ts` | `backend/app/services/github_service.py` |
| OpenAI streaming | `src/server/generate/openai.ts` | `backend/app/services/openai_service.py` |
| Mermaid validation | `src/server/generate/mermaid.ts` | `backend/app/services/mermaid_service.py` |
| Stream endpoint | `src/app/api/generate/stream/` | `backend/app/routers/generate.py` |
| DB schema | `src/server/db/schema.ts` | — |
| Frontend API client | `src/features/diagram/api.ts` | — |
| Main diagram hook | `src/hooks/useDiagram.ts` | — |

## Environment Variables

Minimum required (see `.env.example` for full list):
- `POSTGRES_URL` — Neon serverless Postgres
- `OPENAI_API_KEY` — used for all generation stages
- `GITHUB_PAT` — optional but avoids GitHub rate limits
- `OPENAI_MODEL` — single model for all three pipeline stages
