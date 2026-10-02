// Next may construct req.url with an internal hostname behind a proxy.
// Host is the browser's addressed domain; do not trust x-forwarded-host here.
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const scheme = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.slice(0, -1);
  if (scheme !== "http" && scheme !== "https") throw new Error("Invalid request scheme");
  return new URL(`${scheme}://${req.headers.get("host") || url.host}`).origin;
}
export function sameOrigin(req: Request, allowMissing = false): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return allowMissing;
  try { return origin === requestOrigin(req); } catch { return false; }
}
