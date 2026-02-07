# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Post-Change Checklist

**After making code changes, ALWAYS:**
1. Run `cd backend && npm test` to run integration tests
2. Run `cd frontend && npx tsc --noEmit` and `cd backend && npx tsc --noEmit` to catch type errors
3. Commit changes to main
4. Push to origin (`git push origin main`) — this triggers GitHub Actions (tests + Docker build)
5. Run `./deploy.sh` in the background — it validates TypeScript, waits for the GH Actions build to finish, pulls the new image, and redeploys via Portainer API automatically
6. For quick iteration without waiting for GitHub Actions: `./deploy.sh --local` (builds Docker image locally then redeploys)

**IMPORTANT:** Always use `./deploy.sh` to deploy. Do NOT manually push and restart — the script handles the full pipeline (validate → push triggers GH build → wait → pull → Portainer stop/start → health check).

**Think about ways to make testing and deployment easier. If you find improvements, add them to this file.**

## Build & Development Commands

```bash
# Backend (runs on port 5069)
cd backend && npm run dev        # Dev server with nodemon
cd backend && npm run build      # Compile TypeScript to dist/
cd backend && npm run lint       # ESLint

# Frontend (runs on port 3000, proxies API to localhost:5069)
cd frontend && npm run dev       # Vite dev server
cd frontend && npm run build     # tsc + vite build (to frontend/dist)
cd frontend && npm run lint      # ESLint

# Docker
docker-compose up --build        # Build and run locally
./deploy.sh                      # Full deploy: validate -> wait for GH Actions -> Portainer redeploy
./deploy.sh --local              # Local build + Portainer redeploy (skip GitHub Actions)
```

```bash
# Testing
cd backend && npm test           # Run all backend integration tests (vitest)
cd backend && npm run test:watch # Watch mode for development
```

Backend tests use **Vitest + Supertest** with in-memory SQLite databases. Plex-dependent endpoints use mocked `plexService`. Tests are in `backend/src/__tests__/`.

## Architecture

**Monorepo** with separate `/backend` and `/frontend` directories. In production, the frontend is built to static files and served by the backend Express server.

### Backend (Node.js + Express + TypeScript)
- **Entry point**: `backend/src/index.ts` - Express app setup, middleware, route registration
- **Database**: SQLite via better-sqlite3 in `backend/src/models/database.ts` (single file, ~1000 lines, handles all CRUD + schema migrations)
- **Auth**: Token-based sessions in `backend/src/middleware/auth.ts` - supports Bearer header and `?token=` query param (for iframe downloads)
- **Plex integration**: `backend/src/services/plexService.ts` - all Plex API calls
- **Transcoding**: `backend/src/services/transcodeManager.ts` - ffmpeg queue with configurable max concurrent (default 2, adjustable 1-10 in Settings), hardware encoding support
- **Routes**: `backend/src/routes/` - auth, media, libraries, transcodes, settings, logs, users

### Frontend (React 18 + Vite + Tailwind)
- **State**: Zustand for auth (`stores/authStore.ts`), React Context for downloads (`contexts/DownloadContext.tsx`)
- **API client**: `frontend/src/services/api.ts` - Axios-based, auto-attaches auth token
- **Routing**: React Router v6 in `App.tsx` with `ProtectedRoute` wrapper
- **Pages**: Dashboard, LibraryView, MediaDetail, Transcodes, Settings, Users, Help, etc.

### Download Flow
- **Original quality**: Frontend creates hidden iframe pointing to `/api/media/:ratingKey/download?partKey=...&token=...` - browser download manager handles it
- **Transcoded**: Frontend POSTs to `/api/transcodes` to queue, ffmpeg runs in background, user downloads from `/api/transcodes/:jobId/download` when done
- **Bulk (ZIP)**: Season/album downloads stream through archiver as ZIP

### Deployment
- **CI Pipeline** (`.github/workflows/test.yml`): Runs TypeScript checks + backend tests on every push and PR to main
- **Docker Build** (`.github/workflows/docker-publish.yml`): Builds multi-arch Docker image on push to main — **depends on test job passing first**
- Portainer manages the stack (ID 16, endpoint 2) on the local server
- `deploy.sh` orchestrates: validate TypeScript -> wait for GH build -> pull image -> restart via Portainer API
- Secrets in `.secrets` (gitignored): `PORTAINER_API_KEY`

## Key Patterns

### Page layout pattern
Every page uses: `useMobileMenu()` hook + `<Sidebar>` + `<Header>` + safe-area insets for PWA.

### Non-ASCII filename handling
HTTP headers can't contain non-ASCII chars. Always use RFC 5987 encoding for Content-Disposition:
```typescript
const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');
const utf8Encoded = encodeURIComponent(filename).replace(/'/g, '%27');
res.setHeader('Content-Disposition', `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`);
```

### Mobile Plex OAuth
`window.open()` must be called **synchronously** in the click handler (before any await). Open `about:blank` first, then navigate after async PIN generation.

### Tailwind custom colors
`bg-dark` (#0a0a0f), `bg-dark-100` (#0f0f23), `bg-dark-200` (#1a1a2e), `text-primary-500` (#e87c03 orange), `text-secondary-500` (#b794f4 purple).

## Testing Standards

- **Test-Driven Mindset:** For ANY new feature or existing code modification, ask yourself: "Can this be tested?" If yes, write a test case.
- **Unit Tests:** Write unit tests for all pure functions, utilities, helpers, and isolated business logic.
- **Integration Tests:** Write integration tests for API routes, user flows, and component interactions.
- **Test Coverage:** Prioritize testing critical paths (auth, downloads, transcodes, settings, user management).
- **CI/CD Gate:** All tests must pass before deployment. The GitHub Actions pipeline enforces this — the Docker build job depends on the test job.
- **Test Location:** Backend tests go in `backend/src/__tests__/routes/` (route integration tests) and `backend/src/__tests__/helpers/` (test utilities).
- **Test Isolation:** Each test file gets a fresh in-memory SQLite database. Plex-dependent endpoints use mocked `plexService`.
- **Running Tests:** `cd backend && npm test` (or `npm run test:watch` during development).

## Code Reusability Standards

- **DRY Principle:** Don't Repeat Yourself — identify repeated code patterns and extract them into reusable components, functions, or utilities.
- **Component Architecture:** Shared UI elements (headers, footers, navigation, modals, buttons) should be single, reusable components. Page-specific variations should use props/configuration rather than duplicating code.
- **Before Writing:** Always check if similar functionality already exists that can be reused or extended.
- **Refactor Opportunities:** When touching existing code, identify and consolidate duplicated patterns.

## Known Gotchas

- **No `backend/src/db/` directory** - the database is at `backend/src/models/database.ts`
- **No `backend/src/middleware/error.ts`** - error handler is inline in `index.ts`
- Sessions are in-memory (lost on restart) - users must re-login after deploy
- Plex API fields are often nullable - always use optional chaining
- The frontend dev server runs on port **3000** (configured in `vite.config.ts`), not 5173
- The backend runs on port **5069**, not 3001
