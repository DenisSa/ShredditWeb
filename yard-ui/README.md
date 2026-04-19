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
```

Your Reddit app must be a `web app`, and its configured redirect URI must exactly match `REDDIT_REDIRECT_URI`.

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

## License

Licensed under the [MIT license](https://github.com/nextui-org/next-app-template/blob/main/LICENSE).
