import twilio from "twilio";
import { candidate, config, dataset, whatsappId } from "@/lib/storage";
import { handleAnswer, view, whatsappText } from "@/lib/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const reply = (s: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xml(s)}</Message></Response>`, { headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" } });
export async function POST(req: Request) {
  const c = config(); if (!c.TWILIO_AUTH_TOKEN || !c.WHATSAPP_WEBHOOK_URL) return new Response("WhatsApp not configured", { status: 503 });
  const form = await req.formData(); const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) { if (typeof value !== "string" || key in params) return new Response("Invalid form", { status: 400 }); params[key] = value; }
  const signature = req.headers.get("X-Twilio-Signature") ?? "";
  if (!signature || !twilio.validateRequest(c.TWILIO_AUTH_TOKEN, signature, c.WHATSAPP_WEBHOOK_URL, params)) return new Response("Invalid signature", { status: 403 });
  if (!/^whatsapp:\+[0-9]{8,15}$/.test(params.From ?? "") || !/^SM[a-f0-9]{32}$/i.test(params.MessageSid ?? "")) return new Response("Invalid message", { status: 400 });
  if ((params.Body ?? "").length > 2000) return reply("Please keep your answer under 2,000 characters.");
  try {
    const id = await whatsappId(params.From), [d, p] = await Promise.all([dataset(), candidate(id, "whatsapp")]);
    if (!Object.keys(p.answers).length && /^(hi|hello|selam|merhaba|start)$/i.test((params.Body ?? "").trim())) return reply(whatsappText(view(p, d)));
    const result = await handleAnswer(p, d, params.Body ?? "", params.MessageSid);
    return reply(whatsappText(result));
  } catch { return reply("Your answer couldn't be saved. Please send it again in a few seconds. Your previous answers are retained."); }
}
