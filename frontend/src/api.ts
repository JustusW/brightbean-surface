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
  /** "page" renders Markdown, "gallery" renders every published picture.
   *  It travels with the link so the frontend needs no route table of
   *  its own to keep in step with the configuration. */
  kind?: string;
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
  /** NOTE: Brightbean records 0 for both on these assets, so nothing in
   *  the layout may depend on knowing a picture's size in advance. They
   *  are carried because the API sends them, not because anything here
   *  can trust them. */
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

/** A signed-in club member.
 *
 *  DELIBERATELY THIN. It carries what the members area has to branch on
 *  and nothing else — no name, no last-login, no "where am I signed in"
 *  list. The standing rule is that nothing is stored which is not
 *  technically required, and a field the browser is sent is a field that
 *  was stored. */
export interface MemberAccount {
  email: string;
  /** Signing up creates an account; the club decides whether it is a
   *  membership. Until then the welcome page says so instead of
   *  pretending the person is in. */
  approved: boolean;
}

/** What went wrong, as the BACKEND put it.
 *
 *  FastAPI answers a refusal with {"detail": "..."} and that string is
 *  the backend's own words — reading it is not inventing a diagnosis,
 *  which is what a friendlier message composed here would be. When there
 *  is no detail the status is all there is, and that is what gets
 *  thrown. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function fail(res: Response): Promise<never> {
  let detail = "";
  try {
    const body = await res.json();
    if (body && typeof body.detail === "string") detail = body.detail;
  } catch {
    /* Not JSON, or empty. The status still says something true. */
  }
  throw new ApiError(res.status, detail || `${res.status} ${res.statusText}`);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Accept: "application/json" },
    // The members area needs the session cookie; the public endpoints do
    // not care. Same-origin means this is the browser's default anyway,
    // and stating it means the members calls do not need their own
    // fetch wrapper.
    credentials: "same-origin",
  });
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  if (!res.ok) return fail(res);
  // 204 on sign-out: there is nothing to parse and asking for JSON would
  // throw on an empty body.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  site: () => get<Site>("/api/site"),
  gallery: () => get<{ images: FeedMedia[] }>("/api/gallery"),
  feed: (limit?: number) =>
    get<{ items: FeedItem[] }>(
      limit ? `/api/feed?limit=${limit}` : "/api/feed",
    ),
  page: (slug: string) => get<PageContent>(`/api/page/${slug}`),

  // ---- members -------------------------------------------------------
  //
  // NO TOKEN IS HELD HERE, deliberately. The session is a row in our own
  // database and the cookie carries only its id, so signing out is a
  // DELETE that takes effect at once — a self-contained token could not
  // be revoked before it expired, which is exactly the property you want
  // on the day an account turns out to be compromised.
  me: () => get<MemberAccount | null>("/api/auth/me"),
  signup: (email: string, password: string) =>
    post<MemberAccount>("/api/auth/signup", { email, password }),
  login: (email: string, password: string) =>
    post<MemberAccount>("/api/auth/login", { email, password }),
  logout: () => post<void>("/api/auth/logout", {}),

  /** WHERE THE GOOGLE LEG STARTS. A full page navigation rather than a
   *  fetch: the browser has to leave for Google and come back, and an
   *  XHR cannot do that. It is a URL, so it is stated here with every
   *  other endpoint rather than typed into a component. */
  googleStart: "/api/auth/google/start",
};
