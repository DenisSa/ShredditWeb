'use client' 
 
import { useEffect } from 'react'
 
export default function Error({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error)
  }, [error])
 
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center">
      <div className="w-full rounded-[28px] border border-[color:var(--page-border)] bg-[color:var(--page-panel-strong)] p-8 shadow-[0_20px_60px_rgba(40,24,13,0.12)]">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[color:var(--page-danger)]">
          ShredditWeb error
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--page-ink)]">
          Something went wrong while rendering the app.
        </h2>
        <p className="mt-3 text-sm leading-7 text-[color:var(--page-muted)]">
          The current page state can be retried safely. If this keeps happening, reload the page and sign in again.
        </p>
        <button
          className="mt-6 inline-flex items-center justify-center rounded-full bg-[color:var(--page-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--page-accent-strong)]"
          onClick={() => reset()}
        >
          Try again
        </button>
      </div>
    </div>
  )
}
