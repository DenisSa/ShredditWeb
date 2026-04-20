# ShredditWeb UI

This package is the Next.js web app for ShredditWeb. It handles the UI plus the server-side Reddit OAuth callback, session management, preview generation, and long-running shred jobs.

## Technologies Used

- [Next.js 16](https://nextjs.org/docs)
- [NextUI v2](https://nextui.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Tailwind Variants](https://tailwind-variants.org)
- [TypeScript](https://www.typescriptlang.org/)
- [Framer Motion](https://www.framer.com/motion/)
- [next-themes](https://github.com/pacocoursey/next-themes)

## Local Development

```bash
pnpm install
```

Set `yard-ui/.env.local` with your Reddit web app values:

```bash
REDDIT_CLIENT_ID=your_reddit_web_app_client_id
REDDIT_CLIENT_SECRET=your_reddit_web_app_client_secret
REDDIT_REDIRECT_URI=http://localhost:3000/api/auth/reddit/callback
SESSION_SECRET=replace_with_a_long_random_secret
# Optional:
# NEXT_PUBLIC_MIN_AGE_DAYS=7
# NEXT_PUBLIC_MAX_SCORE=100
# SQLITE_PATH=./data/shreddit.sqlite
# SESSION_MAX_AGE_DAYS=30
```

Your Reddit app must be a `web app`, and its configured redirect URI must exactly match `REDDIT_REDIRECT_URI`.
The app persists Reddit sessions and deleted-item history in SQLite. If `SQLITE_PATH` is omitted, it defaults to `./data/shreddit.sqlite`, and the persisted Reddit grant blob is encrypted with `SESSION_SECRET`. Deleted-history storage is enabled by default and can now be turned on or off per Reddit account from the UI.

Then run the app:

```bash
pnpm dev
```

## Production Build

```bash
pnpm build
pnpm lint
```

To run the production server locally after building:

```bash
pnpm start
```

## History API

The server now exposes `GET /api/history/deleted?limit=100` for the current local session so you can inspect stored deleted-item history without opening SQLite manually.
It also exposes `POST /api/settings/history` with `{ "storeDeletionHistory": true | false }` to persist the deleted-history preference for the currently signed-in Reddit account.

## License

Licensed under the [MIT license](https://github.com/nextui-org/next-app-template/blob/main/LICENSE).
