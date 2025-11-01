# Video Grabber

Modernised monorepo for the Video Grabber project with dedicated frontend and backend services deployable via a single `docker compose up -d --build` command.

## Repository Layout

- `apps/frontend` – React + Vite SPA packaged into an Nginx container
- `apps/backend` – Node.js API with yt-dlp, Puppeteer, and cookie tooling
- `infra/caddy` – TLS-enabled reverse proxy for domain routing
- `docker-compose.yml` – Orchestrates frontend, backend, and proxy services

## Local Development

```bash
# Install workspace dependencies
npm install

# Start both services (frontend: 5173, backend: 3001)
npm run dev

# Run individual services
npm run dev:frontend
npm run dev:backend

# Production-style commands
npm run build
npm run start
```

- Frontend dev server: `http://localhost:5173`
- Backend API: `http://localhost:3001`

## Environment Configuration

Each workspace provides ready-to-edit env files:

- `apps/frontend/.env.local` → `VITE_API_URL=http://localhost:3001`
- `apps/frontend/.env.production` → `VITE_API_URL=https://video-grabber-api.mxdhavgautam.com`
- `apps/backend/.env.local` → Development ports, CORS, and local storage paths
- `apps/backend/.env.production` → Production domains and persistent storage paths

Backend defaults:

- Cookies stored at `COOKIES_FILE` (local: `./runtime/yt-dlp/cookies.txt`, container: `/var/lib/video-grabber/yt-dlp/cookies.txt`)
- Chromium profiles stored at `CHROME_PROFILE_DIR`

## Production Deployment

Requirements: Ubuntu 24.04 LTS VPS with Docker + Docker Compose and DNS A records pointing to the server:

- `video-grabber.mxdhavgautam.com`
- `video-grabber-api.mxdhavgautam.com`

```bash
# Build images and start all services
docker compose up -d --build

# Stream logs
docker compose logs -f

# Stop the stack
docker compose down
```

Caddy automatically provisions TLS certificates. Set `ACME_EMAIL` in your shell or override it in `docker-compose.yml` to receive certificate notifications.

### Services

- **frontend** – Nginx serving the compiled SPA
- **backend** – Node.js API (internal port 3001)
- **caddy** – TLS reverse proxy publishing the two domains

### Persistent Volumes

- `backend_data` → `/var/lib/video-grabber` (yt-dlp cookies, Chromium profiles)
- `caddy_data`, `caddy_config` → TLS assets and Caddy state

### Health Checks

- Frontend: `https://video-grabber.mxdhavgautam.com/health`
- Backend: `https://video-grabber-api.mxdhavgautam.com/health`

## Maintenance Notes

- Rebuild the backend when yt-dlp or Chromium tooling needs updates: `docker compose build backend`.
- Authenticated sessions can upload cookies via `POST /upload-authenticated-cookies`; the files persist in the backend data volume.
- The previous simplified server is archived at `apps/backend/legacy/server-simple.mjs` for reference only.
