import "server-only";

function getConfiguredAppOrigin() {
  const redirectUri = process.env.REDDIT_REDIRECT_URI?.trim();

  if (!redirectUri) {
    return null;
  }

  try {
    const url = new URL(redirectUri);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function buildHomeUrl(requestUrl: string) {
  const configuredOrigin = getConfiguredAppOrigin();
  const url = configuredOrigin ? new URL("/", configuredOrigin) : new URL("/", requestUrl);

  url.search = "";
  url.hash = "";

  return url;
}
