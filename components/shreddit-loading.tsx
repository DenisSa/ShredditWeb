import { Logo } from "@/components/icons";

function surfaceClassName(extra = "") {
  return `rounded-[24px] border border-[color:var(--page-border)] bg-[color:var(--page-surface)] shadow-[0_20px_48px_var(--page-shadow)] ${extra}`.trim();
}

function sectionLabelClassName() {
  return "text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--page-muted)]";
}

export function DashboardLoadingShell() {
  return (
    <div className="pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[color:var(--page-border)] bg-[color:var(--page-surface)] shadow-[0_10px_30px_var(--page-shadow-soft)]">
            <Logo className="text-[color:var(--page-accent)]" size={22} />
          </div>
          <div>
            <p className={sectionLabelClassName()}>ShredditWeb</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[color:var(--page-ink)] sm:text-3xl">
              Cleanup workflow
            </h1>
          </div>
        </div>
        <div className="h-10 w-44 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
      </header>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section className={surfaceClassName("p-5 sm:p-6")}>
            <div className="grid gap-3 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div className="rounded-2xl border border-[color:var(--page-border)] bg-[color:var(--page-surface-strong)] px-4 py-4" key={index}>
                  <div className="h-5 w-16 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
                  <div className="mt-3 h-5 w-24 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
                  <div className="mt-3 h-4 w-full animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
                </div>
              ))}
            </div>
          </section>

          <section className={surfaceClassName("p-5 sm:p-6")}>
            <div className="h-5 w-28 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
            <div className="mt-4 h-10 w-56 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
            <div className="mt-4 h-4 w-full animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
            <div className="mt-3 h-4 w-4/5 animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
            <div className="mt-6 flex gap-3">
              <div className="h-11 w-36 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
              <div className="h-11 w-28 animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
            </div>
          </section>

          <section className={surfaceClassName("p-5 sm:p-6")}>
            <div className="h-5 w-36 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="h-16 animate-pulse rounded-2xl bg-[rgba(91,103,118,0.08)]" key={index} />
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <section className={surfaceClassName("p-5")} key={index}>
              <div className="h-4 w-24 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
              <div className="mt-4 space-y-3">
                <div className="h-5 w-full animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
                <div className="h-5 w-4/5 animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
              </div>
            </section>
          ))}
        </aside>
      </div>
    </div>
  );
}

export function SettingsLoadingShell() {
  return (
    <div className="pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[color:var(--page-border)] bg-[color:var(--page-surface)] shadow-[0_10px_30px_var(--page-shadow-soft)]">
            <Logo className="text-[color:var(--page-accent)]" size={22} />
          </div>
          <div>
            <p className={sectionLabelClassName()}>ShredditWeb</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[color:var(--page-ink)] sm:text-3xl">
              Settings
            </h1>
          </div>
        </div>
        <div className="h-10 w-40 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
      </header>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section className={surfaceClassName("p-5 sm:p-6")}>
            <div className="h-5 w-28 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
            <div className="mt-3 h-10 w-64 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
            <div className="mt-3 h-4 w-full animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="h-24 animate-pulse rounded-2xl bg-[rgba(91,103,118,0.08)]" />
                <div className="h-24 animate-pulse rounded-2xl bg-[rgba(91,103,118,0.08)]" />
              </div>
              <div className="h-72 animate-pulse rounded-2xl bg-[rgba(91,103,118,0.08)]" />
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <section className={surfaceClassName("p-5")} key={index}>
              <div className="h-4 w-28 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
              <div className="mt-4 space-y-3">
                <div className="h-5 w-full animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
                <div className="h-5 w-4/5 animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
              </div>
            </section>
          ))}
        </aside>
      </div>
    </div>
  );
}
