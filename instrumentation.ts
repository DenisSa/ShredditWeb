export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { startBackgroundLoops } = await import("@/lib/server/shreddit-background");
  startBackgroundLoops();
}
