# ShredditWeb

ShredditWeb is a server-backed Reddit cleanup tool. The active app lives in `yard-ui` and uses a single Reddit web app, a server-side OAuth callback, an in-memory browser-session cookie, a preview step, a dry-run mode, and a live progress bar for destructive runs.

## What it does

- Signs the user into Reddit through a server-side OAuth code exchange.
- Scans the authenticated account for comments and submissions.
- Previews which items match the active rules.
- Optionally dry-runs the deletion pass.
- Overwrites comment or self-post text before deleting, then generates a downloadable local report.

## Current rules

- Deletes content older than `7` days.
- Deletes content with score below `100`.
- Includes both comments and posts.
- Uses a single browser session with server-side in-memory state.
- Browser refresh reconnects to an active run, but server restarts clear active sessions and jobs.

## Setup

1. Create a Reddit **web app** at `https://www.reddit.com/prefs/apps`.
2. Set its redirect URI to the exact callback route your app will use.
3. Add a `yard-ui/.env.local` file with:

```bash
REDDIT_CLIENT_ID=your_reddit_web_app_client_id
REDDIT_CLIENT_SECRET=your_reddit_web_app_client_secret
REDDIT_REDIRECT_URI=http://localhost:3000/api/auth/reddit/callback
SESSION_SECRET=replace_with_a_long_random_secret
# Optional overrides:
# NEXT_PUBLIC_MIN_AGE_DAYS=7
# NEXT_PUBLIC_MAX_SCORE=100
```

The UI never sees the Reddit client secret, access token, or refresh token. Those stay server-side.

## Local development

```bash
pnpm install
pnpm dev:ui
```

Open `http://localhost:3000`.

For local Reddit auth, the app registration and env must match exactly:

- Reddit app type: `web app`
- Redirect URI in Reddit: `http://localhost:3000/api/auth/reddit/callback`
- `REDDIT_REDIRECT_URI` in `yard-ui/.env.local`: `http://localhost:3000/api/auth/reddit/callback`

## Docker

If you prefer to run the app in Docker, keep `yard-ui/.env.local` populated and start the service from the repo root:

```bash
docker compose up --build
```

This uses `docker-compose.yml` to build the `yard-ui` production image and serve it on `http://localhost:3000`.

## Production Build

```bash
pnpm install
pnpm build
```

The production server lives in `yard-ui`:

- `pnpm build` builds the Next.js app
- `pnpm --filter shredditweb-ui start` starts the production server

If you need to work on the legacy Node package directly, use `pnpm build:lib` or `pnpm dev:lib`.

Important: this repo is now pinned to Node `24.15.0` LTS and pnpm `10.33.0`. As of April 19, 2026, Node `v25.9.0` is the latest overall release, while `v24.15.0` is the latest LTS line and the intended target for this project.

## Deployment

Deploy `yard-ui` to a Node-capable host, not static-only hosting:

- Railway
- Render
- Fly.io
- Any Node host that can run `pnpm --filter shredditweb-ui start`

Make sure the deployed callback route exactly matches `REDDIT_REDIRECT_URI`, for example:

- `https://your-domain.example/api/auth/reddit/callback`

## Project layout

- `yard-ui`: active Next.js application
- `yard-ui/lib/server/shreddit-core.ts`: server-side Reddit OAuth, preview, token refresh, and shred logic
- `yard-ui/lib/server/shreddit-store.ts`: in-memory session and job store
- `yard-ui/lib/shreddit.ts`: browser client helpers for the server APIs
- `yard-ui/components/shreddit-app.tsx`: single-page UI flow
- `yard-lib`: legacy Node script reference, no longer the intended deployment target
- `pnpm-workspace.yaml`: workspace definition for the UI and legacy library packages
