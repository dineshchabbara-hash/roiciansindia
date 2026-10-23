/**
 * The site's public origin for absolute redirects from the auth routes.
 *
 * Behind a reverse proxy (self-hosting, e.g. Hostinger), `request.url` in a
 * route handler carries the server's own address (https://localhost:<port>),
 * not the public one, so a redirect built from it sends the person nowhere.
 * NEXT_PUBLIC_APP_URL is the deployment's public base URL (already used for
 * the password-reset link), so it wins when it is a valid http(s) URL. Only
 * its origin is used; the request origin remains the fallback.
 */
export function publicOrigin(requestUrl: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // Not a URL: fall back to the request.
    }
  }
  return new URL(requestUrl).origin;
}
