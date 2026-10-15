<p align="center">
  <img src="frontend/public/yogurt.svg" alt="yogurt" width="220">
</p>

# yogurt

A single-user productivity web app with a Mac OS X Aqua-style desktop interface. Each section runs as a movable, resizable window on a desktop with a Dock and a menu bar.

- **Backend:** FastAPI, SQLAlchemy 2, PostgreSQL, with optional Redis caching and Celery jobs.
- **Frontend:** React 18, Vite and Tailwind CSS.

![Desktop](docs/screenshots/desktop.png)

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [API](#api)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Sample data](#sample-data)
- [Demo and screenshot tooling](#demo-and-screenshot-tooling)
- [Project structure](#project-structure)

## Features

### Desktop shell

- Apps open as windows with traffic-light controls, title-bar dragging, a resize grip and a genie-style minimise.
- **Dock:** launches apps, magnifies icons on hover, bounces on launch and lights up under running apps.
- **Menu bar:** File, View, Go, Window and Help menus. `Alt+1` to `Alt+6` jump straight to an app.
- **URL routing:** the URL follows the front window (`/notes`, `/tasks`, `/guitar`, and so on). `/desktop` shows the empty desktop.
- **Dark mode:** follows the OS by default. It can also be toggled from the View menu or the menu-bar switch; the choice is stored in `localStorage` as `yogurt.theme`.
- **Theming:** colours are CSS variables consumed by Tailwind (`rgb(var(--c-…) / <alpha-value>)`), and dark mode swaps them under `html.dark`.

![Dark mode](docs/screenshots/dark.png)

### Notes

The note editor is live-preview: markup renders in place, and clicking a block edits its raw markdown. A Source toggle switches the whole note to plain text.

![Notes](docs/screenshots/notes.png)

| Syntax | Result |
| --- | --- |
| `# `, `## `, `### ` | Headings |
| `- `, `1. ` | Bullet and numbered lists (continue on Enter) |
| `- [ ] ` / `- [x] ` | Checkboxes, clickable in preview |
| `[[Note title]]`, `[[Note title\|alias]]` | Links to other notes, with autocomplete after `[[` |
| `**bold**`, `*italic*`, `~~strike~~`, `==highlight==`, `` `code` `` | Inline formatting |
| `#tag` | Tags |
| `> ` | Quote |
| ```` ``` ```` | Code block |
| `---` | Horizontal rule |

- **Backlinks:** each note lists its outgoing links and the notes that mention it.
- **Renaming:** renaming a note rewrites `[[Old title]]` links in every other note on the server.
- **Floating notes:** any note can be popped out into a floating window and pinned so it follows you between apps.
- **System notes:** these are created on demand by `/notes/system/{key}` and can't be deleted. The LeetCode problem list is one of them.

### Graph notes

A graph note is a canvas of nodes, edges and groups, stored as JSON on the note.

![Graph note](docs/screenshots/graph.png)

- **Nodes** carry a priority (none, low, medium or high), a progress percentage, an optional accent border and an optional linked note.
- **Edges** are solid or dashed. Hovering a node animates the flow along its connected edges and dims the rest.
- **Groups** are labelled frames. Dragging a group carries the nodes and groups inside it.

| Input | Action |
| --- | --- |
| Double-click canvas / `N` | New node |
| Drag from a node's handle | Connect nodes |
| Shift-click | Add to selection |
| `Ctrl+G` | Group selection |
| `Ctrl+A` | Select all |
| `Enter` | Rename selected node |
| `Delete` / `Backspace` | Delete selection |
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Undo / redo |
| `F` | Fit view |
| `Esc` | Clear selection |

### Calendar

A calendar with day, week, month and schedule views.

![Calendar](docs/screenshots/calendar.png)

- **Events** have a start and end time, all-day support, colours and notes.
- **Recurrence:** daily, weekdays, weekly or monthly. Each occurrence is stored as its own row and shares a `series_id` with the rest of its series.
- **Editing a series:** edits and deletes take `?scope=this|following|all`.

| Key | Action |
| --- | --- |
| `D` / `W` / `M` / `A` | Day / week / month / schedule view |
| `T` | Jump to today |
| `J`/`N`, `K`/`P` | Next / previous period |
| `C` | Create event |
| `Esc` | Close the event panel |

### LeetCode tracker

Problems are tracked as a checklist inside a system note grouped by topic, with difficulty tags. A stats panel shows totals and a difficulty breakdown.

![LeetCode](docs/screenshots/leetcode.png)

### Reading

The library is a Minecraft enchanting-room scene built in CSS 3D (perspective and `preserve-3d` faces).

- **Sprites:** books, shelves and textures are 16×16 sprites drawn procedurally onto `<canvas>` (`components/Reading/pixelArt.js`).
- **Opening a book:** the table opens the selected book and shows any notes from past sessions.
- **Reading sessions:** sessions record the start and end page. A book is marked completed when its last page is reached.

![Reading](docs/screenshots/reading.png)

### Guitar practice

- **Scale generator:** draws keys from a chosen pool (all keys, major, minor, major and minor, or major with harmonic and melodic minor) once each per round. Custom key selections can be saved.
- **Metronome:** BPM, beats per measure, subdivisions and an accented first beat.
- **Session timer:** logs practice sessions with notes.

![Guitar](docs/screenshots/guitar.png)

### Dashboard

The dashboard shows streaks for each activity, today's tasks, a weekly minutes chart (Recharts), an activity heatmap and a quick note.

![Dashboard](docs/screenshots/dashboard.png)

## Architecture

```
frontend (Vite, :3000)  --axios-->  FastAPI (:8000)  -->  PostgreSQL
                                        |
                                        +--> Redis (optional): response cache, Celery broker
                                        +--> Celery worker + beat: daily aggregation, email digests
```

- **Single user:** the app runs as one user, seeded on startup (`id = 1`).
- **Schema:**
  - On startup the app runs `Base.metadata.create_all` and then `ensure_columns` (`app/utils/migrations.py`).
  - `ensure_columns` adds columns that were introduced after a table was first created, since `create_all` doesn't alter existing tables.
- **Caching:** analytics responses are cached in Redis when it's reachable. Without Redis the app runs uncached, and a reconnect cooldown keeps requests from waiting on it.
- **Request timing:** `PerformanceMiddleware` times each request, counts its DB queries, and logs requests slower than 500 ms.
- **Scheduled jobs** (`app/tasks.py`):
  - daily analytics aggregation at 00:05 UTC
  - daily email digest at 07:00
  - weekly digest on Sundays at 20:00

  A streak-alert task is also defined but isn't scheduled.

  Email goes through SendGrid and is disabled when no API key is set.
- **Frontend state:**
  - React contexts handle notes, theme and toasts.
  - A window-manager context owns window position, size, z-order and minimised state, and keeps the URL in sync with the front window.

### Data model

`User`, `Note`, `Task`, `GuitarSession`, `Book`, `ReadingSession`, `LeetcodeProblem`, `DailyAnalytics`, `Streak`, `Notification`, `EmailPreferences`, `Integration` (see `backend/app/models.py`).

## API

Interactive docs are served at `http://localhost:8000/docs` when the backend is running.

| Prefix | Endpoints |
| --- | --- |
| `/notes` | `GET /`, `POST /`, `GET /dashboard`, `GET /system/{key}`, `GET/PATCH/DELETE /{note_id}` |
| `/tasks` | `GET /` (date range), `POST /`, `PATCH /{task_id}?scope=`, `DELETE /{task_id}?scope=` |
| `/guitar` | `POST/GET /sessions`, `DELETE /sessions/{session_id}`, `GET /stats` |
| `/books`, `/reading` | `POST/GET /books`, `PATCH /books/{book_id}`, `POST/GET /reading/sessions`, `GET /reading/stats` |
| `/leetcode` | `POST/GET /problems`, `PATCH /problems/{problem_id}`, `GET /stats` |
| `/analytics` | `today`, `weekly`, `monthly`, `summary`, `streaks`, `trends`, `predictions`, `comparison`, `anomalies`, `peak-hours`, `heatmap`, `export` |
| `/notifications` | `GET /`, `POST /{id}/read`, `PUT /preferences`, `POST /test`, `GET /digest` |
| `/integrations` | GitHub and Goodreads `connect` / `sync` / `stats` |
| `/health` | Status and cache connectivity |

## Getting started

### Requirements

- Python 3.12
- Node.js 18 or newer
- PostgreSQL 16
- Redis 7 (optional)

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows; use `source .venv/bin/activate` elsewhere
pip install -r requirements.txt
cp .env.example .env            # then set DATABASE_URL
uvicorn app.main:app --reload --port 8000
```

The database named in `DATABASE_URL` must exist. Tables are created on first start.

### Frontend

```bash
cd frontend
npm install
npm run dev                     # http://localhost:3000
```

### Docker

`docker-compose.yml` runs PostgreSQL, Redis, the backend, a Celery worker and Celery beat. The frontend is run separately with `npm run dev`.

```bash
docker compose up -d
```

## Configuration

Backend settings are read from `backend/.env` (see `backend/.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/productivity_analytics` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379/0` | Response cache |
| `CACHE_DEFAULT_TTL_SECONDS` | `3600` | Cache TTL |
| `CELERY_BROKER_URL` | `redis://localhost:6379/1` | Celery broker |
| `CELERY_RESULT_BACKEND` | `redis://localhost:6379/1` | Celery results |
| `SENDGRID_API_KEY` | unset | Enables email digests |
| `SENDGRID_FROM_EMAIL` | `noreply@productivity-analytics.app` | Sender address |
| `LOG_LEVEL` | `INFO` | Logging level |

The frontend reads `VITE_API_URL` from `frontend/.env`. It defaults to `http://localhost:8000`.

## Sample data

`backend/scripts/showcase_data.py` loads sample data:

- LeetCode problems
- a populated calendar with recurring events
- a DSA roadmap graph note
- linked notes

The IDs it creates are recorded in `backend/scripts/.showcase_ids.json`, so `--remove` deletes only those rows.

```bash
cd backend
.venv/Scripts/python.exe scripts/showcase_data.py            # load
.venv/Scripts/python.exe scripts/showcase_data.py --remove   # remove
```

## Demo and screenshot tooling

`demo/` contains Node scripts that drive the running app with Playwright (`playwright-core` with the installed Microsoft Edge; the path is set in each script). Install them with `cd demo && npm install`.

| Script | Output |
| --- | --- |
| `screenshots.mjs` | The README screenshots in `docs/screenshots/` |
| `capture.mjs` | A scripted walkthrough recorded from a 2× CDP screencast. It logs frame timestamps, scene marks and element rects to `output/capture/manifest.json`, and restores any notes it edits. |
| `compose.mjs` | Renders the edited video. It uses an eased camera over the logged rects, captions and title cards, rendered frame by frame in a headless page and piped to ffmpeg (`ffmpeg-static`, libx264/AAC). Output goes to `output/yogurt-showcase.mp4`. |
| `music.mjs` | Synthesises the soundtrack: a 120 BPM WAV whose structure is aligned to the edit |
| `shot.mjs` | One-off screenshots: `node shot.mjs <name> [route] [--dark] [--size=WxH] [--js=...]` |

`npm run video` runs the capture and the compose steps in sequence. Both servers must be running.

## Project structure

```
backend/
  app/
    main.py            FastAPI app, startup (create_all, ensure_columns, default user)
    models.py          SQLAlchemy models
    schemas.py         Pydantic schemas
    routes/            notes, tasks, guitar, reading, leetcode, analytics, notifications, integrations
    utils/             migrations, analytics engine, query helpers
    services/          email and notification services
    middleware/        request timing
    cache.py           Redis cache with graceful fallback
    tasks.py           Celery app and scheduled jobs
  scripts/showcase_data.py
frontend/
  src/
    desktop/           window manager, windows, Dock, menu bar, app registry, icons, logo
    pages/             one page per app
    components/        Notes (editor, markup, graph editor, floating notes), Calendar,
                       Reading (3D library, pixel art), GuitarPractice, Leetcode, Tasks, common
    context/           notes, theme and toast providers
    services/api.js    API client
  public/              logo, wallpapers, icons
demo/                  capture, compose, music and screenshot scripts
docs/screenshots/      README images
docker-compose.yml
```
