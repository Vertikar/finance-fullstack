# Feature scope: About dialog (version & build info)

Status: **v1 — scoped, not yet implemented** · 2026-07-27
Branch: `feature/about-version-info`

## 1. Goal

Show the running app's version and git commit hash so a bug report can be tied to an exact build,
and so it's obvious when the web bundle and the API are from different builds.

Surfaced as a **ⓘ button in the header → modal**, reachable from every tab on both mobile and
desktop. Shows **both** the frontend build info and the API's, fetched from a new
`GET /api/version`.

### Decisions (agreed 2026-07-27)

1. **Placement**: header icon button opening a modal — not a Settings section, not a 7th tab
   (the mobile bottom nav is already 6 items wide). Click/tap on both platforms; **no
   hover-only tooltip**, which would be invisible on touch devices.
2. **Version source**: `git describe --tags --always --dirty`, computed on the host at build
   time and injected as a build arg. Nothing to bump by hand.
3. **Contents**: frontend version/commit/build-time (baked into the bundle) **plus** the API's,
   via `GET /api/version`. Explicitly out of scope: DB/migration version, environment name,
   connectivity diagnostics.

### Prerequisite

The repo has **no git tags yet** — `git describe --tags --always --dirty` currently falls back to
`f280cb6-dirty`. Tag the current release (`git tag -a v1.0.0 -m "v1.0.0" && git push origin v1.0.0`)
before or alongside this work, otherwise the About dialog shows a bare hash where a version
should be.

## 2. Where the values come from

Neither Docker build context (`./backend`, `./frontend`) contains `.git`, so **neither build can
shell out to git**. The Makefile computes the values once on the host and passes them down as
build args. Every arg has a fallback so a bare `docker compose build` or `npm start` still works.

```make
VERSION    ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT     ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
BUILD_TIME ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
```

Exported into `docker compose up -d --build` (the `up` and `build` targets) so compose can
interpolate them into `build.args`.

### Backend — ldflags

`backend/Dockerfile` gains `ARG VERSION/COMMIT/BUILD_TIME` and:

```dockerfile
RUN CGO_ENABLED=0 GOOS=linux go build \
      -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT} -X main.buildTime=${BUILD_TIME}" \
      -o finance-api .
```

`main.go` declares the three vars with `"dev"`/`"unknown"` defaults so `go run` and `go test`
behave. They are passed **explicitly into the handler struct** — same rule as `JWT_SECRET`, no
handler reads package globals.

### Frontend — CRA env vars

CRA inlines `REACT_APP_*` at build time only. `frontend/Dockerfile` gains matching `ARG`s promoted
to `ENV` **before** `npm run build`:

```dockerfile
ARG REACT_APP_VERSION=dev
ARG REACT_APP_COMMIT=unknown
ARG REACT_APP_BUILD_TIME=
ENV REACT_APP_VERSION=$REACT_APP_VERSION ...
```

`docker-compose.yml` wires `${VERSION:-dev}` etc. into both services' `build.args`.

## 3. Backend changes

**`backend/handlers/version.go`** — new, no DB dependency:

```go
type VersionHandler struct {
    Version   string
    Commit    string
    BuildTime string
}

// GET /api/version → {"version":"v1.1.0","commit":"f280cb6","build_time":"2026-07-27T02:14:09Z","go_version":"go1.22.5"}
func (h *VersionHandler) Get(w http.ResponseWriter, r *http.Request)
```

`go_version` comes from `runtime.Version()` — free, and useful in a bug report.

**Route placement**: inside the `mw.NewAuth` protected group. The dialog is only reachable when
signed in, and there's no reason to publish the deployed commit hash to unauthenticated callers.
`/health` stays as-is for container healthchecks.

**`main.go`**: three package-level vars, `versionH := &handlers.VersionHandler{...}`, one route
line.

## 4. Frontend changes

| File | Change |
|---|---|
| `api.js` | `getVersion: () => request("/version")` |
| `About.js` | **New.** Presentational component: takes `{ T, isMobile, onClose }`, fetches API version on mount. |
| `About.test.js` | **New.** |
| `App.js` | ⓘ header button + `showAbout` state + render `<About/>` when true. |

### `About.js` behaviour

- Reads frontend build info from `process.env.REACT_APP_*`, falling back to `"dev"` / `"unknown"`
  so `npm start` renders sensibly rather than printing `undefined`.
- Calls `api.getVersion()` in a `useEffect` on mount. Three states: loading (`…`), loaded, and
  error — on error the API row reads `unavailable` and the **frontend info still renders**. A
  version dialog that shows nothing because one fetch failed is worse than a partial one.
- Renders two labelled groups, **App** and **API**, each with Version / Commit / Built. Monospace
  values, using the existing `S.mono` styling and `T` theme tokens (no new colours).
- **Mismatch hint**: if both commits are known and differ, show a muted "web and API are from
  different builds" line. This is the main reason for showing both.
- **Copy button** — copies a plain-text block of all six fields for pasting into a bug report.
  Uses `navigator.clipboard` guarded with a `typeof` check (jsdom and non-HTTPS origins lack it);
  hidden if unavailable.

### Modal & responsive behaviour

Mirrors the existing Add/Edit modal in `App.js` so there's one visual language:

- Fixed overlay `T.modalOverlay`, `zIndex: 200`.
- Mobile (`<768px`): bottom sheet — `alignItems: "flex-end"`, `borderRadius: "16px 16px 0 0"`,
  full width, `maxHeight: "92dvh"`, `overflowY: "auto"`, and `paddingBottom:
  env(safe-area-inset-bottom)` so the copy button clears the iOS home indicator.
- Desktop: centred card, `maxWidth: 460`.
- Closes on backdrop click, on the Close button, and on **Escape** (a `useEffect` keydown listener
  — the existing modals don't do this; scoped to About only here, and noted as a follow-up to
  apply to the others).
- Clicks inside the card `stopPropagation()` so they don't dismiss it.

### Header button

Sits between the theme toggle and Sign Out. `aria-label="About this app"`, visible `ⓘ` glyph,
`minWidth/minHeight: 34px` on mobile so it clears the tap-target floor while matching the height
of the adjacent buttons. On mobile it's icon-only (the header is already tight — email is hidden
there); on desktop it stays icon-only too, for symmetry with the theme toggle.

## 5. Tests

**Backend — `handlers/version_test.go`** (no sqlmock needed, no DB):

- Handler returns 200, `Content-Type: application/json`, and echoes the injected
  version/commit/build time.
- Zero-value handler still returns valid JSON rather than empty strings — asserts the
  `dev`/`unknown` fallback contract.

**Frontend — `About.test.js`** (`fetch` mocked via `jest.fn()`, per existing convention):

- Renders frontend version/commit from `process.env` stubs.
- Renders API version after a resolved fetch.
- **Failed API fetch** still renders the frontend block and shows `unavailable` — the important
  case.
- Escape key and backdrop click both call `onClose`.
- Mismatch hint appears when commits differ, absent when they match.

**`api.test.js`**: `getVersion` hits `/api/version` with the auth header.

**Manual**: `make up` then check the dialog at desktop width and at 375px (Chrome device
toolbar) in both light and dark themes.

## 6. Files touched

```
Makefile                          VERSION/COMMIT/BUILD_TIME vars, exported from up/build
docker-compose.yml                build.args for api + web
backend/Dockerfile                ARGs + -ldflags -X
backend/main.go                   version vars, VersionHandler, route
backend/handlers/version.go       NEW
backend/handlers/version_test.go  NEW
frontend/Dockerfile               ARG/ENV before npm run build
frontend/src/api.js               getVersion
frontend/src/About.js             NEW
frontend/src/About.test.js        NEW
frontend/src/App.js               header button + showAbout state + render
docs/about-version-feature-scope.md  this file
README.md                         short "Versioning" note: tag releases, how build info flows
```

Roughly 250 lines including tests. Single PR, no migration, no dependency changes.

## 7. Out of scope / follow-ups

To be carried into the PR's `## Testing & follow-up` checklist **and** `TODO.md`:

- Apply the Escape-to-close handler to the existing Add/Edit and Import modals for consistency
  `#frontend`
- Add a CI job (or release workflow) that tags and builds with the real `VERSION` so deployed
  images carry a tag rather than `dev` `#chore`
- Surface migration/schema version in About once there's a reason to debug it `#backend`
- Link the commit hash to the GitHub commit URL once the repo's remote is stable `#frontend`

## 8. Risks

- **Docker layer caching**: `BUILD_TIME` changes on every invocation, so putting the `ARG` too
  early in the Dockerfile busts the dependency-install layer each build. Declare the `ARG`s
  **after** `go mod download` / `npm ci`, immediately before the build step.
- **CRA env inlining is build-time only** — rebuilding the image is required to change the
  version; there's no runtime override. This is intended (it's build metadata), but worth a
  comment in the Dockerfile so nobody tries to set it in `docker-compose environment:`.
- **`--dirty` suffix** will appear on any build from an uncommitted working tree. That's a
  feature (it flags non-reproducible builds), but expect to see it during local development.

## 9. Implementation notes

One deviation from §4 as scoped, recorded here because the reason isn't obvious:

**`About.js` reads `process.env.REACT_APP_*` inside an exported `getWebBuildInfo()` called
during render, not into module-level constants.** Constants captured at import time are
unreachable from a test: stubbing the env means re-importing the module, and
`jest.resetModules()` hands the re-imported component a *second* React instance, whose hook
dispatcher is null — every render dies with `Cannot read properties of null (reading
'useState')`.

Reading at render time is equivalent in a production build. CRA's DefinePlugin substitutes
`process.env.REACT_APP_*` **textually wherever the expression appears**, including inside a
function body, so the values are still compile-time literals with no runtime lookup. The
tests simply set the env before `render()`.
