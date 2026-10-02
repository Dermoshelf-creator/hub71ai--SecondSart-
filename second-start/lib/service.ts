import type { Candidate, Dataset, View } from "./types.ts";
import { applyAnswer, currentQuestion, newCandidate, questions, sarahCandidate } from "./flow.ts";
import { areaMatches, jobMatches } from "./matching.ts";
import { interpret } from "./ai.ts";
import { config, previousEvent, saveCandidate } from "./storage.ts";
import { computePartnerRoutes } from "./partner-routes.ts";
export function view(p: Candidate, d: Dataset, message = "", ai: View["ai"] = config().OPENAI_API_KEY ? "available" : "off"): View {
  const q = currentQuestion(p, d), areas = areaMatches(p, d), n = d.neighborhoods.find(n => n.id === p.home_neighborhood);
  const remaining = questions(p, d).filter(q => !(q.key in p.answers)).length;
  const ready = q === null || q.key === "choose_neighborhood";
  return { candidate: p, question: q, progress: q === null ? 100 : Math.min(95, Math.round((1 - remaining / questions(p, d).length) * 100)), areas, jobs: n ? jobMatches(p, d, n) : [], ready, message, ai, partnerRoutesEnabled: !!config().GOOGLE_MAPS_API_KEY, totalJobs: d.jobs.length, totalNeighborhoods: d.neighborhoods.length, datasetVersion: d.version };
}
export async function handleAnswer(p: Candidate, d: Dataset, input: string, eventId: string, action?: string): Promise<View> {
  const cached = await previousEvent(eventId, p.id); if (cached) return JSON.parse(cached);
  let next: Candidate, message = "", ai: View["ai"] = config().OPENAI_API_KEY ? "available" : "off";
  if (/^partner$/i.test(input.trim()) && p.partner_work_location && (p.conversation_step === "complete" || p.conversation_step === "choose_neighborhood")) {
    next = structuredClone(p);
    if (!config().GOOGLE_MAPS_API_KEY) message = "Partner route calculation requires a Google Maps API key. Your partner's workplace is saved; no journey time has been assumed.";
    else {
      try { const routes = await computePartnerRoutes(d.neighborhoods, p.partner_work_location, config().GOOGLE_MAPS_API_KEY!); message = `Partner drive · ${routes.date} · 08:00 out / 18:00 back\n` + routes.routes.map(r => `${d.neighborhoods.find(n => n.id === r.neighborhoodId)?.name}: ${r.morning === null ? "?" : Math.ceil(r.morning)} / ${r.evening === null ? "?" : Math.ceil(r.evening)} min`).join("\n") + `\n${routes.attribution}`; } catch { message = "Partner routes couldn't be calculated. No route duration has been assumed."; }
    }
  }
  else if (action === "reset" || /^(reset|restart|bastan)$/i.test(input.trim())) next = newCandidate(p.id, p.channel);
  else if (action === "sarah" && p.channel === "web") { next = sarahCandidate(p.id, d); message = "Sarah's sample answers are loaded. All recommendations below are calculated from the supplied dataset."; }
  else if (action === "select_area" && d.neighborhoods.some(n => n.id === input) && (p.conversation_step === "complete" || p.conversation_step === "choose_neighborhood")) { next = structuredClone(p); next.home_neighborhood = input; next.answers.choose_neighborhood = input; next.conversation_step = "complete"; }
  else {
    const q = currentQuestion(p, d);
    if (!q) {
      const n = d.neighborhoods.find(n => n.id === input || n.name.toLowerCase() === input.toLowerCase());
      next = structuredClone(p);
      if (n) next.home_neighborhood = n.id;
      else message = "Your shortlist is ready. Type an area name to change it, or RESET to begin again.";
    } else {
      const interpreted = await interpret(q, input, p); ai = interpreted.ai;
      if (interpreted.answer === null) { next = structuredClone(p); message = "I couldn't interpret that confidently. Please choose an option or use the example format."; }
      else { next = applyAnswer(p, d, interpreted.answer); next.history.push({ role: "assistant", text: currentQuestion(next, d)?.text ?? "Your job shortlist is ready. Check the employer details before applying." }); }
    }
  }
  next.revision = p.revision + 1; next.updated_at = new Date().toISOString();
  const result = view(next, d, message, ai), response = JSON.stringify(result);
  if (!await saveCandidate(next, p.revision, eventId, response)) {
    const prior = await previousEvent(eventId, p.id); if (prior) return JSON.parse(prior);
    throw new Error("SESSION_CONFLICT");
  }
  return result;
}
const money = (x: number) => Math.round(x / 1000) + "k";
export function whatsappText(v: View): string {
  let text = "*Second Start · Abu Dhabi*\n";
  if (v.message) text += v.message + "\n\n";
  if (v.ready && !v.candidate.home_neighborhood) {
    text += `*${v.candidate.housing.bedrooms ?? 2} BHK area comparison*\n`;
    for (const a of v.areas.slice(0, 3)) text += `\n*${a.name}*\nAED ${money(a.band.min)}–${money(a.band.max)}/year (indicative)\n${a.within_commute_jobs} potential jobs within ${v.candidate.max_commute_minutes} min both ways. Hours/licence need checking.\n${a.band.coverage_precision === "nearby_area_proxy" ? `Rent proxy: ${a.band.coverage_area}.\n` : ""}`;
  } else if (v.ready && v.candidate.home_neighborhood) {
    text += `*Jobs from ${v.areas.find(a => a.id === v.candidate.home_neighborhood)?.name}*\n`;
    if (!v.jobs.length) text += "No matching roles in this snapshot. Try another specialty or RESET.\n";
    for (const j of v.jobs.slice(0, 2)) {
      text += `\n*${j.title}* · ${j.employer}\n08:00 out / 18:00 back: ${j.morning === null ? "?" : Math.ceil(j.morning)} / ${j.evening === null ? "?" : Math.ceil(j.evening)} min\n${j.warnings.slice(0, 2).join("; ")}\n${j.apply_url}\n`;
    }
  }
  if (v.question) text += `\n${v.question.text}\n${v.question.choices.map((c, i) => `${i + 1}. ${c.label}`).join("\n")}\n${v.question.hint}`;
  else text += "\nType an area name to compare, or RESET to restart.";
  if (v.ready) text += "\nData snapshot, not confirmed job eligibility. Driving routes depart 08:00 / 18:00, not your work times.";
  if (v.ready && v.candidate.partner_work_location) text += "\nType PARTNER to calculate the partner's drive using Google Routes (the supplied workplace address is sent to Google).";
  return text.length <= 1550 ? text : text.slice(0, 1510) + "\nMore detail in the web demo.";
}
