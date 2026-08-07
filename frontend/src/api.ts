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
  /** The members' forum, as an origin — empty when no forum is wired up.
   *
   *  IT IS NOT IN THE NAV, deliberately: the forum is shut to anybody
   *  who is not a member, so a link to it on the public site would be a
   *  door that answers "no" to almost everyone who tries it. It belongs
   *  in the members area, which is where somebody signed in will look
   *  for it. */
  forum: string;
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
  /** Whether to OFFER the registrations list — and nothing more than
   *  that. It authorises nothing: every admin endpoint checks the
   *  column again server-side, because a flag the browser holds is a
   *  flag the browser can edit. */
  admin: boolean;
  /** Whether to offer the enquiries console. Same caveat, same reason.
   *  A DIFFERENT question from `admin`: this one is for the Vorstand
   *  and their Erfüllungsgehilfen, who are neither admins nor, in the
   *  second case, holders of any office at all. */
  can_answer: boolean;
}

/** One person who has signed up, as the board sees them. */
export interface Registration {
  email: string;
  approved: boolean;
  active: boolean;
  admin: boolean;
  /** Whether the address was ever proven by clicking a link sent to it.
   *  Not a reason to refuse somebody — the club knows its own members —
   *  but a reason to look twice before approving. */
  verified: boolean;
  /** ISO date. */
  created: string;
  /** How they get in: "password", "google", or both. */
  how: string[];
  /** Whether they may read and answer enquiries from the contact
   *  bubble. NOT the same as `admin`: administering accounts and
   *  answering the public are different jobs, and the second is for the
   *  Vorstand and their Erfüllungsgehilfen. */
  can_answer: boolean;
}

/** One thing a visitor typed into the contact bubble. */
export interface EnquiryMessage {
  body: string;
  /** ISO timestamp. */
  at: string;
}

/** One conversation from the bubble, as the club sees it. */
export interface Enquiry {
  id: string;
  /** ISO timestamp. */
  created: string;
  /** ISO timestamp, or null while nobody has dealt with it. */
  handled: string | null;
  /** The address of whoever dealt with it; empty while nobody has. */
  handled_by: string;
  messages: EnquiryMessage[];
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
  /** ANSWERS 204 AND NOTHING ELSE, whether or not the address already
   *  has an account — and it does NOT sign you in. Both of those are
   *  the point rather than an omission: any difference between the two
   *  cases, including holding a session afterwards, would tell an
   *  anonymous caller whether a given person is a member here. The
   *  difference goes to the mailbox instead. */
  signup: (email: string, password: string) =>
    post<void>("/api/auth/signup", { email, password }),
  login: (email: string, password: string) =>
    post<MemberAccount>("/api/auth/login", { email, password }),
  logout: () => post<void>("/api/auth/logout", {}),

  // ---- one-time links -------------------------------------------------
  //
  // BOTH ARE POSTS, even though each arrives as a link in a message. Mail
  // clients and corporate scanners FETCH links to preview them, so a GET
  // that changes state gets spent by a robot before the member has read
  // the message. The link opens this page; the page posts the token.
  verify: (token: string) =>
    post<{ email: string; verified: boolean }>("/api/auth/verify", { token }),
  /** Answers 204 whatever is true — see the route. Never report from the
   *  result whether an account exists; there is nothing there to read. */
  resetRequest: (email: string) =>
    post<void>("/api/auth/reset/request", { email }),
  resetConfirm: (token: string, password: string) =>
    post<MemberAccount>("/api/auth/reset/confirm", { token, password }),

  // ---- the board ------------------------------------------------------
  //
  // ADMIN ONLY, and enforced there rather than here. Both answer 404 to
  // a signed-in member who is not on the board — an ordinary member has
  // no business learning that this exists.
  registrations: () =>
    get<{ members: Registration[] }>("/api/auth/registrations"),
  decide: (
    email: string,
    what: "approve" | "revoke" | "delete" | "answer" | "unanswer",
  ) =>
    post<{
      email: string;
      approved?: boolean;
      deleted?: boolean;
      can_answer?: boolean;
    }>("/api/auth/registrations/decide", { email, what }),

  // ---- the contact bubble ---------------------------------------------
  //
  // THE ONLY ANONYMOUS WRITE ON THIS SITE. Anybody at all may post an
  // enquiry — there is no account, no session and no cookie set by it.
  // The token comes back from the server and the page keeps it only for
  // as long as the tab is open, which is all the flow needs: message,
  // then contact details, then somebody gets in touch out of band.
  /** Leave a message, or add to the one this tab already started.
   *  Answers the thread's token and how many messages it now holds —
   *  the count decides which canned reply is shown, so a reload cannot
   *  desynchronise the script from what was actually stored. */
  enquire: (message: string, token?: string) =>
    post<{ token: string; count: number }>("/api/enquiry", {
      message,
      token: token ?? "",
    }),

  // ---- and the club's side of it ---------------------------------------
  //
  // can_answer ONLY, enforced server-side, which answers 404 rather than
  // 403 to a signed-in member without it: an ordinary member has no
  // business learning that this console exists.
  enquiries: () => get<{ enquiries: Enquiry[]; open: number }>(
    "/api/enquiry/list",
  ),
  enquiryHandle: (id: string, done: boolean) =>
    post<{ id: string; handled: boolean }>("/api/enquiry/handle", {
      id,
      done,
    }),
  enquiryDelete: (id: string) =>
    post<{ id: string; deleted: boolean }>("/api/enquiry/delete", { id }),

  /** WHERE THE GOOGLE LEG STARTS. A full page navigation rather than a
   *  fetch: the browser has to leave for Google and come back, and an
   *  XHR cannot do that. It is a URL, so it is stated here with every
   *  other endpoint rather than typed into a component. */
  googleStart: "/api/auth/google/start",
};
