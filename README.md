# GIF Viewer

A self-hosted media gallery for browsing mounted image and GIF collections via a web UI backed by SQLite.

## Features

- **Library scanning** — walks the media root and caches folder/file metadata in SQLite, tracking additions, removals, and renames.
- **Folder/subfolder browsing** — sidebar tree navigation and breadcrumb trail to explore any depth.
- **Thumbnail previews** — generated on demand and cached on disk; grid view shows them instantly.
- **Fullscreen viewer** — click any thumbnail to open it; navigate with on-screen controls.
- **Star ratings and tags** — rate media 1–5 stars, add/remove text tags; changes persist in the DB.
- **Move & reorder** — from the viewer, move media between folders and change order using the viewer controls.
- **Docker/Unraid ready** — single image, health-checked, configurable via env vars.

## Environment Variables

| Variable    | Default                       | Description                                      |
|-------------|-------------------------------|--------------------------------------------------|
| `APP_NAME`  | `GIF Viewer`                  | Application display name in the header            |
| `MEDIA_ROOT`| `/media` (Docker) / `./media` (local) | Root folder containing all media files |
| `DATA_ROOT` | `/data` (Docker) / `./data` (local) | Root for DB and thumbnails          |
| `DB_PATH`   | `{DATA_ROOT}/gifviewer.db`     | Path to the SQLite database                       |
| `THUMB_ROOT`| `{DATA_ROOT}/thumbnails`      | Path to the thumbnail cache                      |

## Local Development

```bash
npm install
npm run dev
```

Place media in `media/` (or point `MEDIA_ROOT` elsewhere). Database and thumbnails land in `data/`.

## Docker / Unraid

```bash
docker compose up -d
```

### Volumes

| Mount           | Purpose                                         |
|-----------------|-------------------------------------------------|
| `/media`        | Media library — **must be read-write** to enable move support |
| `gifviewer-data` | Named volume for DB + thumbnails (persists)   |

### Example Unraid docker run

```yaml
volumes:
  - /mnt/user/media:/media:rw
  - gifviewer-data:/data
```

> **Note:** If the media root is mounted read-only, move and reorder operations will fail. Always use `rw` if you plan to move media through the UI.

## Tech Stack

Next.js 16 · React 19 · TypeScript · better-sqlite3 · sharp
