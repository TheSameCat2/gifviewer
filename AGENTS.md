<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

This repo is a single Next.js 16 app ("GIF Viewer") that serves both the UI and its API routes on port `3000`. There are no separate backend/database services — SQLite (`better-sqlite3`) is embedded and thumbnails (`sharp`) are cached on disk. `better-sqlite3` and `sharp` are native modules compiled during `npm install`.

- Run dev server: `npm run dev` (Turbopack, http://localhost:3000). Lint: `npm run lint`. Build: `npm run build`. There is no automated test suite/`test` script.
- In dev (`NODE_ENV` unset), the app uses project-local `./media` (media library, read-write) and `./data` (auto-created SQLite DB + thumbnail cache). `./media` is gitignored and empty by default, so the gallery starts empty.
- Gotcha: scanning is not automatic. After adding files to `./media`, index them with `curl -X POST http://localhost:3000/api/scan` (the root-folder view only shows files directly in `./media`; nested files appear under their folder in the sidebar). `GET /api/health` returns roots, db path, and folder/media/tag counts for a quick sanity check.
