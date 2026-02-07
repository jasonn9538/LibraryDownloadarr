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
cd backend && npm test           # Run all backend tests (187 tests, vitest + supertest)
cd backend && npm run test:watch # Watch mode for development
cd frontend && npm test          # Run all frontend tests (32 tests, vitest + testing-library)
cd frontend && npm run test:watch # Watch mode for development
```

Tests use **Vitest**. Backend uses **Supertest** with in-memory SQLite databases; Plex-dependent endpoints use mocked `plexService`. Frontend uses **@testing-library/react** with jsdom. Tests are in `backend/src/__tests__/` and `frontend/src/__tests__/`.

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

### Core Philosophy
- **Tests are NOT optional** — they are part of the feature definition
- **Tests catch regressions** — they prevent breaking existing functionality during rapid development
- **Tests document behavior** — they show how code should work
- **CI/CD blocks bad code** — all tests must pass before deployment

### Test-Driven Mindset (MANDATORY)
For **ANY** code change (new feature, bug fix, refactor), you MUST:
1. Ask: "What could break if this code changes?"
2. Ask: "Can this be tested?" If yes, write a test case
3. Write tests that verify the expected behavior
4. Run tests before committing (`cd backend && npm test` and `cd frontend && npm test`)
5. Never skip tests because you're moving fast — tests ARE what let you move fast safely

### Backend Testing
- **Integration Tests** (`backend/src/__tests__/routes/`): Test API routes end-to-end with Supertest. Each test file gets a fresh in-memory SQLite database via `createTestApp()`. Plex-dependent endpoints use mocked `plexService`.
- **Unit Tests** (`backend/src/__tests__/models/`, `backend/src/__tests__/services/`): Test pure functions, database operations, and business logic in isolation.
- **Test Helpers** (`backend/src/__tests__/helpers/`): Shared utilities — `app-factory.ts` (fresh Express app), `auth-helpers.ts` (user/token creation), `plex-fixtures.ts` (mock data).
- **Running:** `cd backend && npm test` (or `npm run test:watch` during development)

### Frontend Testing
- **Store Tests** (`frontend/src/__tests__/stores/`): Test Zustand stores via `getState()` and `setState()`.
- **Component Tests** (`frontend/src/__tests__/components/`): Test React components with `@testing-library/react`. Mock axios to avoid jsdom URL parsing issues.
- **Hook Tests** (`frontend/src/__tests__/hooks/`): Test custom hooks with `renderHook()`.
- **Service Tests** (`frontend/src/__tests__/services/`): Test API client methods and URL builders.
- **Running:** `cd frontend && npm test`

### Test Best Practices
- **AAA Pattern:** Every test should follow Arrange-Act-Assert
- **Descriptive Names:** Use names that explain what is being tested (e.g., "returns 404 when user does not exist")
- **Test Independence:** Each test should be independent and isolated — no shared mutable state between tests
- **Mock External Dependencies:** Always mock external services (Plex API, file system) in tests
- **Test Edge Cases:** Don't just test the happy path — test error conditions, boundary values, null/undefined inputs
- **Keep Tests Fast:** Use in-memory databases, mock slow services, use low bcrypt cost (4) in tests
- **Test Behavior, Not Implementation:** Test visible behavior and outputs, not internal state

### Test Coverage Priorities
- **Critical paths (auth, downloads, transcodes):** Must have integration tests
- **Business logic / utilities:** Should have unit tests (90%+ coverage goal)
- **API endpoints:** Should have integration tests (80%+ coverage goal)
- **UI components:** Should have component tests for non-trivial logic (70%+ coverage goal)

### CI/CD Gate
All tests must pass before deployment. The GitHub Actions pipeline enforces this:
- `.github/workflows/test.yml` — Runs TypeScript checks + backend + frontend tests on every push/PR
- `.github/workflows/docker-publish.yml` — Docker build depends on test job passing first

## Code Reusability Standards

- **DRY Principle:** Don't Repeat Yourself — identify repeated code patterns and extract them into reusable components, functions, or utilities.
- **Component Architecture:** Shared UI elements (headers, footers, navigation, modals, buttons) should be single, reusable components. Page-specific variations should use props/configuration rather than duplicating code.
- **Shared Business Logic:** Extract common logic into utility functions or services (e.g., `formatFileSize()`, date formatting).
- **Composition Over Duplication:** Build complex features by composing smaller, reusable pieces.
- **Before Writing:** Always check if similar functionality already exists that can be reused or extended.
- **Refactor Opportunities:** When touching existing code, identify and consolidate duplicated patterns.

## Security Best Practices

- **Input Validation:** Validate and sanitize ALL user inputs on both client and server
- **Authentication:** Use secure token storage; implement session management properly; use established auth libraries (don't roll your own crypto)
- **Authorization:** Verify permissions on EVERY protected endpoint/action
- **SQL Injection Prevention:** Use parameterized queries (better-sqlite3 handles this), never string concatenation
- **XSS Prevention:** Sanitize user-generated content, escape outputs
- **Secrets Management:** Never commit API keys, passwords, or secrets to git. Use `.secrets` (gitignored) for local secrets, environment variables for production
- **Rate Limiting:** Implement rate limiting on APIs to prevent abuse (already in place on auth routes)
- **Audit Logging:** Log security-relevant actions for audit trails (already implemented via `db.logAuditEvent()`)
- **Non-ASCII Filenames:** Always use RFC 5987 encoding for Content-Disposition headers (see Key Patterns)

## Code Quality & Standards

- **Type Safety:** Use TypeScript throughout. Avoid `any` — use proper types
- **Naming Conventions:** Components/Classes: PascalCase; Functions/variables: camelCase; Constants: UPPER_SNAKE_CASE; Files: kebab-case or camelCase
- **Function Size:** Keep functions small (<50 lines ideally), each doing one thing
- **Magic Numbers/Strings:** No magic values — use named constants
- **Error Messages:** Clear, actionable error messages for users and developers
- **No Dead Code:** Remove unused imports, variables, and functions. Don't leave commented-out code

## Git Standards

- **Commit Messages:** Use conventional style — summarize the nature of changes concisely (e.g., "Add user authentication with JWT", "Fix download crash for non-ASCII filenames")
- **Keep commits focused:** Each commit should represent one logical change
- **Never Commit:** Dependencies (`node_modules`), build artifacts (`dist/`), API keys/secrets (`.env`, `.secrets`), large binary files
- **Branch Strategy:** Main branch for production-ready code. Feature branches for larger work

## Debugging & Error Handling

- **Try-Catch Blocks:** Wrap all risky operations (async, parsing, external API calls) in try-catch
- **Error Logging:** Log errors with context (user ID, action attempted, timestamp, stack trace) using the `logger` utility
- **User Feedback:** Always inform users when something goes wrong with actionable guidance
- **Graceful Degradation:** System should remain functional even if non-critical features fail (e.g., Plex API down shouldn't crash the app)
- **Validation Errors:** Return clear, specific validation errors from API endpoints

## Pre-Change Checklist

Before committing code, verify:
- [ ] Tests written and passing for new/modified functionality
- [ ] `cd backend && npm test` passes
- [ ] `cd frontend && npm test` passes
- [ ] `cd backend && npx tsc --noEmit` passes
- [ ] `cd frontend && npx tsc --noEmit` passes
- [ ] No hardcoded values that should be environment variables
- [ ] Error handling implemented properly
- [ ] No sensitive data in code or logs
- [ ] Reusable code extracted where appropriate

## Quick Decision Framework

When adding a new feature or making changes, ask:
1. **Is this secure?** (input validation, auth, secrets management)
2. **Is this tested?** (unit tests, integration tests, edge cases)
3. **Is this reusable?** (DRY principle, extract common patterns)
4. **Does this follow our patterns?** (consistent with existing code)
5. **Can this break existing functionality?** (run tests to verify)

## Known Gotchas

- **No `backend/src/db/` directory** - the database is at `backend/src/models/database.ts`
- **No `backend/src/middleware/error.ts`** - error handler is inline in `index.ts`
- Sessions are in-memory (lost on restart) - users must re-login after deploy
- Plex API fields are often nullable - always use optional chaining
- The frontend dev server runs on port **3000** (configured in `vite.config.ts`), not 5173
- The backend runs on port **5069**, not 3001
