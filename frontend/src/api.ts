/** Everything the browser asks the backend for.
 *
 *  One file, so the shape of the API is visible in one place and a
 *  change to it breaks compilation rather than a page.
 *
 *  SAME ORIGIN, ALWAYS. nginx serves the bundle and proxies /api on the
 *  same hostname, so these are relative paths — no base URL to
 *  configure per deployment, and nothing to get wrong between staging
 *  and production. */

export interface SiteLink {
  slug: string;
  title: string;
}

export interface Site {
  title: string;
  locale: string;
  tagline: string;
  nav: SiteLink[];
  footer: SiteLink[];
}

export interface FeedMedia {
  url: string;
  thumbnail: string;
  kind: string;
  width: number;
  height: number;
  alt: string;
}

export interface FeedItem {
  id: string;
  published_at: string | null;
  title: string;
  text: string;
  tags: string[];
  platform: string;
  account: { name: string; handle: string };
  media: FeedMedia[];
}

export interface PageContent {
  slug: string;
  title: string;
  body: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Accept: "application/json" },
    // The members area needs the session cookie; the public endpoints do
    // not care. Same-origin means this is the browser's default anyway,
    // and stating it means the members calls do not need their own
    // fetch wrapper later.
    credentials: "same-origin",
  });
  if (!res.ok) {
    // THE STATUS, NOT A GUESS AT THE CAUSE. The backend deliberately
    // answers 503 with a bland string rather than a stack trace, so
    // there is nothing more to extract and inventing a friendlier
    // explanation here would be inventing a diagnosis.
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const api = {
  site: () => get<Site>("/api/site"),
  feed: (limit?: number) =>
    get<{ items: FeedItem[] }>(
      limit ? `/api/feed?limit=${limit}` : "/api/feed",
    ),
  page: (slug: string) => get<PageContent>(`/api/page/${slug}`),
};
