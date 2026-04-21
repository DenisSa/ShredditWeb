import { buildHomeUrl } from "@/lib/server/shreddit-urls";

describe("buildHomeUrl", () => {
  const originalRedirectUri = process.env.REDDIT_REDIRECT_URI;

  afterEach(() => {
    if (originalRedirectUri === undefined) {
      delete process.env.REDDIT_REDIRECT_URI;
      return;
    }

    process.env.REDDIT_REDIRECT_URI = originalRedirectUri;
  });

  it("prefers the configured public origin over the request URL", () => {
    process.env.REDDIT_REDIRECT_URI = "https://raspberry.tail27c9a0.ts.net/api/auth/reddit/callback";

    expect(buildHomeUrl("http://0.0.0.0:3000/api/auth/reddit/callback?code=abc").toString()).toBe(
      "https://raspberry.tail27c9a0.ts.net/",
    );
  });

  it("falls back to the request origin when the redirect URI is missing", () => {
    delete process.env.REDDIT_REDIRECT_URI;

    expect(buildHomeUrl("https://example.com/api/auth/reddit/callback?code=abc").toString()).toBe(
      "https://example.com/",
    );
  });

  it("falls back to the request origin when the redirect URI is invalid", () => {
    process.env.REDDIT_REDIRECT_URI = "not-a-url";

    expect(buildHomeUrl("https://example.com/api/auth/reddit/callback?code=abc").toString()).toBe(
      "https://example.com/",
    );
  });
});
