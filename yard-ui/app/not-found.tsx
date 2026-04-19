import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center">
      <div className="w-full rounded-[28px] border border-[color:var(--page-border)] bg-[color:var(--page-panel-strong)] p-8 shadow-[0_20px_60px_rgba(40,24,13,0.12)]">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[color:var(--page-warning)]">
          Page not found
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--page-ink)]">
          There isn&apos;t anything to shred here.
        </h1>
        <p className="mt-3 text-sm leading-7 text-[color:var(--page-muted)]">
          The page you requested does not exist in this static build. Head back to the main ShredditWeb tool
          to sign in and manage your Reddit cleanup run.
        </p>
        <Link
          className="mt-6 inline-flex items-center justify-center rounded-full bg-[color:var(--page-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--page-accent-strong)]"
          href="/"
        >
          Return home
        </Link>
      </div>
    </div>
  );
}
