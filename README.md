# ShredditWeb

ShredditWeb is a server-backed Reddit cleanup tool built as a single Next.js app at the repo root. It uses a single Reddit web app, a server-side OAuth callback, a SQLite-backed persistent session, a preview step, a dry-run mode, and a live progress bar for destructive runs.

## What it does

- Signs the user into Reddit through a server-side OAuth code exchange.
- Scans the authenticated account for comments and submissions.
- Previews which items match the active rules.
- Optionally dry-runs the deletion pass.
- Overwrites comment or self-post text before deleting, then generates a downloadable local report.
- Stores deleted item content and metadata in SQLite after successful live deletions.
- Lets each Reddit account persist its own deleted-history storage preference.

## Current rules

- Deletes content older than `7` days.
- Deletes content with score below `100`.
- Includes both comments and posts.
- Stores persistent auth sessions in SQLite so reconnecting does not require a fresh Reddit login.
- Browser refresh reconnects to an active run, but server restarts still clear active in-memory jobs.

## Setup

1. Create a Reddit **web app** at `https://www.reddit.com/prefs/apps`.
2. Set its redirect URI to the exact callback route your app will use.
3. Add a `.env.local` file at the repo root with:

```bash
REDDIT_CLIENT_ID=your_reddit_web_app_client_id
REDDIT_CLIENT_SECRET=your_reddit_web_app_client_secret
REDDIT_REDIRECT_URI=http://localhost:3000/api/auth/reddit/callback
SESSION_SECRET=replace_with_a_long_random_secret
# Optional overrides:
# NEXT_PUBLIC_MIN_AGE_DAYS=7
# NEXT_PUBLIC_MAX_SCORE=100
# SQLITE_PATH=./data/shreddit.sqlite
# SESSION_MAX_AGE_DAYS=30
```

The UI never sees the Reddit client secret, access token, or refresh token. Those stay server-side.
By default the server stores persistent sessions and deleted-item history in SQLite at `./data/shreddit.sqlite`, and persisted Reddit grant blobs are encrypted with `SESSION_SECRET`. Deleted-history storage is enabled by default, but each Reddit account can turn it off from the UI and that preference is saved in SQLite.

## Local development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

For local Reddit auth, the app registration and env must match exactly:

- Reddit app type: `web app`
- Redirect URI in Reddit: `http://localhost:3000/api/auth/reddit/callback`
- `REDDIT_REDIRECT_URI` in `.env.local`: `http://localhost:3000/api/auth/reddit/callback`

## Docker

If you prefer to run the app in Docker, keep `.env.local` populated and start the service from the repo root:

```bash
docker compose up --build
```

This uses `docker-compose.yml` to build the production image and serve it on `http://localhost:3000`.

For a Raspberry Pi or any host that should pull a prebuilt image from GitHub Container Registry, use the production compose file instead:

```bash
cp .env.production.example .env.production
docker compose --env-file .env.production -f docker-compose.production.yml pull
docker compose --env-file .env.production -f docker-compose.production.yml up -d
```

`docker-compose.production.yml` mounts a named Docker volume at `/data` and pins SQLite to `/data/shreddit.sqlite`, so sessions, schedules, and deleted-history records survive container restarts and image updates.

## Production Build

```bash
pnpm install
pnpm build
pnpm start
```

Important: this repo is now pinned to Node `24.15.0` LTS and pnpm `10.33.0`. As of April 19, 2026, Node `v25.9.0` is the latest overall release, while `v24.15.0` is the latest LTS line and the intended target for this project.

## Deployment

Deploy the app to a Node-capable host, not static-only hosting:

- Railway
- Render
- Fly.io
- Any Node host that can run `pnpm start`

Make sure the deployed callback route exactly matches `REDDIT_REDIRECT_URI`, for example:

- `https://your-domain.example/api/auth/reddit/callback`

## Raspberry Pi Deployment

The repo now includes two files for a GHCR-backed deployment flow:

- `docker-compose.production.yml`: runs the prebuilt container image and persists SQLite data in the `shreddit-data` Docker volume.
- `.env.production.example`: template for the image reference, Reddit OAuth config, and production bind settings.

To prepare the Pi:

1. Copy `.env.production.example` to `.env.production`.
2. Set `SHREDDIT_IMAGE` to the image published by this repo, for example `ghcr.io/your-github-user/shredditweb:latest`.
3. Set `REDDIT_REDIRECT_URI` to the exact public callback URL you will expose.
4. If the package is private, log in once with a GitHub personal access token (classic) that has `read:packages`.

```bash
echo "$GHCR_READ_PACKAGES_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
docker compose --env-file .env.production -f docker-compose.production.yml pull
docker compose --env-file .env.production -f docker-compose.production.yml up -d
```

The publish workflow at `.github/workflows/publish-image.yml` builds and pushes a `linux/arm64` image to GHCR on pushes to `main`. It publishes a rolling `latest` tag plus a `sha-<commit>` tag so you can pin a specific release if you want to roll back.

## Pi Update Options

The simplest low-maintenance updater is a small `systemd` timer on the Pi that runs `docker compose pull` and `docker compose up -d` on a schedule. This keeps the deployment model one-way: GitHub publishes the image, the Pi only refreshes it.

Example service unit:

```ini
[Unit]
Description=Refresh ShredditWeb from GHCR
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/shredditweb
ExecStart=/usr/bin/docker compose --env-file .env.production -f docker-compose.production.yml pull
ExecStart=/usr/bin/docker compose --env-file .env.production -f docker-compose.production.yml up -d
```

Example timer unit:

```ini
[Unit]
Description=Check for new ShredditWeb images

[Timer]
OnBootSec=2m
OnUnitActiveSec=15m
Unit=shredditweb-refresh.service

[Install]
WantedBy=timers.target
```

If you prefer push-based deployment instead, the other common pattern is an SSH step in GitHub Actions that connects to the Pi after a successful image publish and runs the same two commands remotely. That gives you immediate deploys, but it also means storing SSH credentials in GitHub and letting GitHub reach your Pi over the network.

## HTTPS and Reverse Proxy

For production Reddit OAuth, the external callback URL must exactly match both the Reddit app registration and `REDDIT_REDIRECT_URI`. If your public URL is `https://cleanup.example.com`, the callback must be:

```text
https://cleanup.example.com/api/auth/reddit/callback
```

When a reverse proxy runs on the same Pi, keep `SHREDDIT_BIND=127.0.0.1` so the app container only listens locally and let the proxy terminate TLS.

Caddy is the lowest-maintenance option because it handles Let's Encrypt for you automatically:

```caddyfile
cleanup.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

If you prefer Nginx, use a server block that forwards the original host and HTTPS information:

```nginx
server {
  server_name cleanup.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

If you later add automatic deployments, it is safest to avoid deploying during an active cleanup run because active jobs live in memory and a container restart will interrupt them.

## Project layout

- `app`: Next.js App Router entrypoints and API routes
- `lib/server/shreddit-core.ts`: server-side Reddit OAuth, preview, token refresh, and shred logic
- `lib/server/shreddit-db.ts`: SQLite persistence for sessions and deleted-item history
- `lib/server/shreddit-store.ts`: persistent session store plus in-memory preview/job state
- `lib/shreddit.ts`: browser client helpers for the server APIs
- `components/shreddit-app.tsx`: single-page UI flow
- `tests`: Vitest coverage for scheduling, storage, and run coordination
