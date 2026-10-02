import { config, dataset } from "@/lib/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { const d = await dataset(), c = config(); return Response.json({ status: "ok", database: "connected", jobs: d.jobs.length, neighborhoods: d.neighborhoods.length, version: d.version, openaiConfigured: !!c.OPENAI_API_KEY, whatsappConfigured: !!(c.TWILIO_AUTH_TOKEN && c.WHATSAPP_WEBHOOK_URL), partnerRoutesConfigured: !!c.GOOGLE_MAPS_API_KEY }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ status: "unavailable" }, { status: 503 }); }
}
