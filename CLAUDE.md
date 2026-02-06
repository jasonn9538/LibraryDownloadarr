# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Post-Change Checklist

**After making code changes, ALWAYS:**
1. Run `cd frontend && npx tsc --noEmit` and `cd backend && npx tsc --noEmit` to catch errors
2. Commit and push to main (triggers GitHub Actions Docker build)
3. Run `./deploy.sh` to wait for the build and redeploy via Portainer
4. If you need a quick local deploy without waiting for GitHub Actions: `./deploy.sh --local`

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

There are **no tests** in this project. Type-checking (`tsc --noEmit`) is the primary validation.

## Architecture

**Monorepo** with separate `/backend` and `/frontend` directories. In production, the frontend is built to static files and served by the backend Express server.

### Backend (Node.js + Express + TypeScript)
- **Entry point**: `backend/src/index.ts` - Express app setup, middleware, route registration
- **Database**: SQLite via better-sqlite3 in `backend/src/models/database.ts` (single file, ~1000 lines, handles all CRUD + schema migrations)
- **Auth**: Token-based sessions in `backend/src/middleware/auth.ts` - supports Bearer header and `?token=` query param (for iframe downloads)
- **Plex integration**: `backend/src/services/plexService.ts` - all Plex API calls
- **Transcoding**: `backend/src/services/transcodeManager.ts` - ffmpeg queue with max 2 concurrent, hardware encoding support
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
- GitHub Actions (`.github/workflows/docker-publish.yml`) builds multi-arch Docker image on push to main
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

## Known Gotchas

- **No `backend/src/db/` directory** - the database is at `backend/src/models/database.ts`
- **No `backend/src/middleware/error.ts`** - error handler is inline in `index.ts`
- Sessions are in-memory (lost on restart) - users must re-login after deploy
- Plex API fields are often nullable - always use optional chaining
- The frontend dev server runs on port **3000** (configured in `vite.config.ts`), not 5173
- The backend runs on port **5069**, not 3001
