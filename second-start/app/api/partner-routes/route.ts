import { candidate, config, dataset, previousEvent, saveCachedEvent } from "@/lib/storage";
import { computePartnerRoutes } from "@/lib/partner-routes";
import { sameOrigin } from "@/lib/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(req: Request) {
  const c = config(); if (!c.GOOGLE_MAPS_API_KEY) return Response.json({ error: "Google Maps key not configured" }, { status: 503 });
  if (!sameOrigin(req)) return Response.json({ error: "Origin rejected" }, { status: 403 });
  const cookie = req.headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith("second_start_session="))?.split("=")[1];
  if (!cookie || !/^[a-f0-9-]{36}$/.test(cookie)) return Response.json({ error: "Open a profile first" }, { status: 401 });
  try {
  const [p, d] = await Promise.all([candidate("web_" + cookie, "web"), dataset()]);
  if (!p.partner_work_location) return Response.json({ error: "Add a partner workplace to your profile first" }, { status: 400 });
  const cacheId = p.id + ":partner:" + p.partner_work_location;
  const cache = await previousEvent(cacheId, p.id);
  if (cache) return new Response(cache, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    const result = await computePartnerRoutes(d.neighborhoods, p.partner_work_location, c.GOOGLE_MAPS_API_KEY);
    await saveCachedEvent(cacheId, p.id, result, new Date(Date.now() + 3600000).toISOString());
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Partner routes unavailable. Please retry." }, { status: 502 }); }
}
