# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Post-Change Checklist

**After making code changes, ALWAYS:**
1. Run `cd backend && npm test` and `cd frontend && npm test` to run all tests
2. Run `cd frontend && npx tsc --noEmit` and `cd backend && npx tsc --noEmit` to catch type errors
3. Commit changes to main
4. Push to origin (`git push origin main`) — this triggers GitHub Actions (tests + Docker build)
5. Run `./deploy.sh` in the background — it validates TypeScript, waits for the GH Actions build to finish, pulls the new image, and redeploys via Portainer API automatically
6. For quick iteration without waiting for GitHub Actions: `./deploy.sh --local` (builds Docker image locally then redeploys)

**IMPORTANT:** Always use `./deploy.sh` to deploy. Do NOT manually push and restart — the script handles the full pipeline (validate → push triggers GH build → wait → pull → Portainer stop/start → health check).

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

## Testing

Tests use **Vitest**. Backend uses **Supertest** with in-memory SQLite databases; Plex-dependent endpoints use mocked `plexService`. Frontend uses **@testing-library/react** with jsdom.

```bash
# Run all tests
cd backend && npm test           # Backend tests (vitest + supertest)
cd frontend && npm test          # Frontend tests (vitest + testing-library)

# Watch mode for development
cd backend && npm run test:watch
cd frontend && npm run test:watch

# Run a single test file (vitest accepts a filename filter)
cd backend && npx vitest run __tests__/routes/media.test.ts
cd backend && npx vitest run __tests__/routes/          # all route tests
cd frontend && npx vitest run src/__tests__/stores/authStore.test.ts
```

**Backend vitest config note:** `root` is set to `./src`, so test paths are relative to `backend/src/`. Uses `pool: 'forks'` (required for native `better-sqlite3` module).

### Test Infrastructure

- **Test helpers** in `backend/src/__tests__/helpers/`:
  - `app-factory.ts` — `createTestApp()` returns `{ app, db }` with fresh in-memory SQLite. Mirrors `index.ts` but skips helmet, CORS, rate-limiting, static files.
  - `auth-helpers.ts` — `createAdminAndToken(db)` and `createPlexUserAndToken(db)` insert users + sessions, return `{ user, password, token }`. Uses bcrypt cost 4 for speed.
  - `plex-fixtures.ts` — Mock data: `MOCK_LIBRARIES`, `MOCK_METADATA_MOVIE`, `MOCK_METADATA_EPISODE`, `MOCK_SEARCH_RESULTS`, etc.
  - `setup.ts` — Auto-loaded; mocks winston logger globally, sets `NODE_ENV=test`.

- **Typical test pattern:**
  ```typescript
  const { app, db } = createTestApp();
  const { token } = await createAdminAndToken(db);
  vi.mocked(plexService.getLibraries).mockResolvedValue(MOCK_LIBRARIES);
  await request(app).get('/api/libraries').set('Authorization', `Bearer ${token}`).expect(200);
  ```

- **Frontend setup** (`frontend/src/__tests__/setup.ts`): Mocks localStorage, window.location, matchMedia. Uses jsdom environment.

### Testing Requirements

For **ANY** code change, write tests for new/modified functionality. Run tests before committing. All tests must pass before deployment — CI enforces this.

## Architecture

**Monorepo** with `/backend`, `/frontend`, and `/worker` directories. In production, the frontend is built to static files and served by the backend Express server.

### Backend (Node.js + Express + TypeScript)
- **Entry point**: `backend/src/index.ts` — Express app setup, middleware, route registration
- **Database**: SQLite via better-sqlite3 in `backend/src/models/database.ts` (single file, handles all CRUD + schema migrations)
- **Auth**: Token-based sessions in `backend/src/middleware/auth.ts` — supports Bearer header and `?token=` query param (for iframe downloads). Two auth paths: local admin (bcrypt) and Plex OAuth (PIN-based via plex.tv). Brute-force protection locks IPs after 5 failed attempts for 15 minutes.
- **Plex integration**: `backend/src/services/plexService.ts` — all Plex API calls (singleton)
- **Transcoding**: `backend/src/services/transcodeManager.ts` — ffmpeg queue, hardware encoder detection (VAAPI → QSV → software fallback), concurrent job limits, 7-day cache TTL, crash recovery, distributed worker support
- **Routes**: `backend/src/routes/` — auth, media, libraries, transcodes, settings, logs, users, worker. Each exported as `createXRouter(db)` factory.
- **Worker auth**: `backend/src/middleware/workerAuth.ts` — token-based auth for distributed workers

### Frontend (React 18 + Vite + Tailwind)
- **State**: Zustand for auth (`stores/authStore.ts`), React Context for downloads (`contexts/DownloadContext.tsx`)
- **API client**: `frontend/src/services/api.ts` — Axios-based, auto-attaches auth token
- **Routing**: React Router v6 in `App.tsx` with `ProtectedRoute` wrapper
- **Pages**: Dashboard, LibraryView, MediaDetail, Transcodes, Settings, Users, Help

### Worker (Distributed Transcoding)
Standalone Node.js service in `/worker/` with its own `package.json`, `Dockerfile`, `tsconfig.json`. Offloads ffmpeg work from the main server via pull-based architecture:
1. Starts, detects GPU (NVENC/VAAPI/software) via `gpu-detector.ts`
2. Registers with backend via `POST /api/worker/register` using `WORKER_KEY`
3. Polls `POST /api/worker/claim` every 5s for pending transcode jobs
4. Downloads source from Plex, runs ffmpeg, uploads result to backend
5. Sends heartbeats every 30s; handles SIGTERM gracefully

Key env vars: `SERVER_URL`, `WORKER_KEY`, `WORKER_NAME`, `MAX_CONCURRENT` (default 1).

### Download Flow
- **Original quality**: Hidden iframe → `/api/media/:ratingKey/download?partKey=...&token=...` → browser download manager
- **Transcoded**: POST to `/api/transcodes` → ffmpeg queue → download from `/api/transcodes/:jobId/download`
- **Bulk (ZIP)**: Season/album downloads stream through archiver as ZIP

### Transcode Pipeline
Uses **software decode + hardware encode**: FFmpeg decodes on CPU, uploads frames to GPU for scaling and encoding. CPU usage is expected even with GPU encoding. Hardware encoder is auto-detected at first transcode and cached. Detection order: VAAPI → QSV → software. `/dev/dri/renderD128` must be passed through for GPU access.

### Database Schema & Migrations
Single `DatabaseService` class in `backend/src/models/database.ts`. Constructor calls `initializeTables()` with `CREATE TABLE IF NOT EXISTS` for all tables, then inline column migrations using `pragma_table_info`:
```typescript
const hasColumn = this.db.prepare(
  `SELECT COUNT(*) as count FROM pragma_table_info('table_name') WHERE name='column_name'`
).get() as { count: number };
if (hasColumn.count === 0) {
  this.db.exec('ALTER TABLE table_name ADD COLUMN column_name TYPE');
}
```
Tables: `admin_users`, `plex_users`, `sessions`, `settings`, `download_logs`, `transcode_jobs`, `failed_login_attempts`, `audit_log`, `workers`. Journal mode is `DELETE` (not WAL) for Docker bind-mount compatibility.

### Deployment
- **CI** (`.github/workflows/test.yml`): TypeScript checks + tests on every push/PR to main
- **Docker Build** (`.github/workflows/docker-publish.yml`): Multi-arch image (amd64/arm64), depends on test job passing. Tags: `latest`, semver, branch-sha.
- **Worker Docker** (`.github/workflows/docker-publish-worker.yml`): Separate pipeline for worker image
- **Dockerfile**: Multi-stage (backend-builder → frontend-builder → production on node:20-alpine with ffmpeg + VAAPI drivers). Frontend built to `/app/public/`, served as static files.
- Portainer manages the stack (ID 16, endpoint 2) on the local server
- `deploy.sh` orchestrates: validate TypeScript → wait for GH build → pull image → Portainer stop/start → health check
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
Defined in `frontend/tailwind.config.js`:
- `bg-dark` (#0F0F0F), `bg-dark-100` (#252525), `bg-dark-200` (#1F1F1F)
- `text-primary-500` (#6366f1 indigo), `text-secondary-500` (#a855f7 purple)

## Known Gotchas

- **No `backend/src/db/` directory** — the database is at `backend/src/models/database.ts`
- **No `backend/src/middleware/error.ts`** — error handler is inline in `index.ts`
- Sessions are in-memory SQLite (lost on restart) — users must re-login after deploy
- Plex API fields are often nullable — always use optional chaining
- The frontend dev server runs on port **3000** (configured in `vite.config.ts`), not 5173
- The backend runs on port **5069**, not 3001
- Audit logging is available via `db.logAuditEvent()` — use it for security-relevant actions
