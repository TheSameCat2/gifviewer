# GIF Viewer

A Next.js application for viewing local GIF and image collections.

## Current Status

Foundation complete:
- Next.js 16 with React 19 and TypeScript
- better-sqlite3 database for metadata caching
- sharp for image processing
- Local file serving via mapped volumes (no cloud dependencies)
- Docker/Unraid deployment ready

Gallery and scanning features are not yet implemented.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_NAME` | `GIF Viewer` | Application display name |
| `MEDIA_ROOT` | `/media` (Docker) or `./media` (local) | Root folder for media files |
| `DATA_ROOT` | `/data` (Docker) or `./data` (local) | Root folder for data (DB, thumbnails) |
| `DB_PATH` | `{DATA_ROOT}/gifviewer.db` | Path to SQLite database |
| `THUMB_ROOT` | `{DATA_ROOT}/thumbnails` | Path to thumbnail cache |

## Local Development

```bash
npm install
npm run dev
```

Place media files in the project-local `media/` folder. Data (database, thumbnails) is stored in `data/`.

## Docker / Unraid

```bash
docker compose up -d
```

### Volumes

- `/media` — Your media files (read-write). Map to your media library folder.
- `gifviewer-data` — Named volume for database and thumbnails. Persists across restarts.

### Example Unraid Mount

```yaml
volumes:
  - /mnt/user/media:/media:rw
  - gifviewer-data:/data
```

### Health Check

The container health check uses a Node.js-based probe (no curl required).
