import { candidate, dataset, previousEvent } from "@/lib/storage";
import { handleAnswer, view } from "@/lib/service";
import { requestOrigin, sameOrigin } from "@/lib/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const COOKIE = "second_start_session";
function sessionId(req: Request): { id: string; fresh: boolean } {
  const value = req.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (value && /^[a-f0-9-]{36}$/.test(value)) return { id: "web_" + value, fresh: false };
  return { id: "web_" + crypto.randomUUID(), fresh: true };
}
function response(data: unknown, req: Request, id: string, fresh: boolean, status = 200) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (fresh) headers["Set-Cookie"] = `${COOKIE}=${id.slice(4)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${requestOrigin(req).startsWith("https:") ? "; Secure" : ""}`;
  return Response.json(data, { status, headers });
}
export async function GET(req: Request) {
  const s = sessionId(req);
  try { const [d, p] = await Promise.all([dataset(), candidate(s.id, "web")]); return response(view(p, d), req, s.id, s.fresh); }
  catch { return Response.json({ error: "Session couldn't be loaded. Please try again." }, { status: 503 }); }
}
export async function POST(req: Request) {
  if (!sameOrigin(req, true)) return Response.json({ error: "Origin rejected" }, { status: 403 });
  const s = sessionId(req);
  try {
    if (Number(req.headers.get("content-length") ?? 0) > 8192) return Response.json({ error: "Answer too long" }, { status: 413 });
    const b = await req.json() as { answer?: unknown; eventId?: unknown; revision?: unknown; action?: unknown };
    if (typeof b.answer !== "string" || b.answer.length > 2000 || typeof b.eventId !== "string" || !/^[a-f0-9-]{36}$/.test(b.eventId)) return Response.json({ error: "Invalid answer" }, { status: 400 });
    const [d, p] = await Promise.all([dataset(), candidate(s.id, "web")]);
    const prior = await previousEvent(s.id + ":" + b.eventId, s.id);
    if (prior) return response(JSON.parse(prior), req, s.id, s.fresh);
    if (b.revision !== p.revision) return response({ error: "Your session changed. Reloading the latest answers.", latest: view(p, d) }, req, s.id, s.fresh, 409);
    const result = await handleAnswer(p, d, b.answer, s.id + ":" + b.eventId, typeof b.action === "string" ? b.action : undefined);
    return response(result, req, s.id, s.fresh);
  } catch (e) { return Response.json({ error: e instanceof Error && e.message === "SESSION_CONFLICT" ? "Your session changed. Please refresh." : "Answer couldn't be saved. Please retry." }, { status: 503 }); }
}
