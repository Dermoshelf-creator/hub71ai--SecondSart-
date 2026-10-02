import type { Candidate, Choice, Dataset, Question } from "./types.ts";

const C = (value: string, label: string, tags?: string[]): Choice => ({ value, label, ...(tags ? { tags } : {}) });
export const roles: Record<string, Choice[]> = {
  teaching: [C("primary", "Primary / homeroom", ["primary_general"]), C("early_years", "Early years / kindergarten", ["early_years", "kindergarten"]), C("english", "English / drama", ["english", "drama"]), C("stem", "Computing / design technology", ["computing", "computer_science", "design_technology", "food_technology"]), C("pe", "Physical education", ["physical_education"]), C("music", "Music", ["music"]), C("humanities", "Humanities / social studies", ["humanities", "social_studies"]), C("leadership", "School leadership", ["leadership"])],
  healthcare: [C("nursing", "Nursing / surgical first assist", ["nursing"]), C("hospitalist", "Hospitalist", ["hospitalist"]), C("emergency", "Emergency medicine", ["emergency_medicine"]), C("pediatrics", "Paediatrics / general practice", ["pediatrics", "general_practice"]), C("cardiac", "Cardiology / cardiac surgery", ["interventional_cardiology", "cardiac_surgery"]), C("dermatology", "Dermatology", ["dermatology"]), C("therapy", "Occupational therapy", ["occupational_therapy"]), C("lab", "Laboratory / clinical research", ["laboratory", "clinical_coordination", "research"]), C("other", "Another clinical specialty")],
  marketing: [C("digital", "Digital marketing", ["digital_marketing", "digital_communications"]), C("communications", "Communications / marketing", ["communications", "marketing"]), C("events", "Events / exhibitions", ["events", "exhibitions"]), C("creative", "Design / multimedia", ["creative_design", "graphic_design", "multimedia"]), C("program", "Program / project management", ["program_management", "project_management"]), C("hospitality", "Hospitality / guest experience", ["hospitality", "guest_experience"])],
};
export function newCandidate(id: string, channel: Candidate["channel"] = "web"): Candidate {
  return { id, channel, revision: 0, home_status: null, home_neighborhood: null, partner_work_location: null, profession_category: null, job_role: null, role_tags: [], professional_license_status: null, professional_license_authority: null, visa_status: null, employment_preference: null, availability_to_start: null, work_constraints: { earliest_start: null, latest_finish: null, strict: null }, availability: { evenings: null, weekends: null, shift_work: null }, max_commute_minutes: null, housing: { bedrooms: null, annual_budget_aed: null }, answers: {}, history: [], conversation_step: "home_status", updated_at: new Date().toISOString() };
}
export function questions(p: Candidate, d: Dataset): Question[] {
  const q = (key: string, text: string, choices: Choice[] = [], hint = "Choose a number or write your answer.", freeText = false): Question => ({ key, text, choices, hint, freeText });
  const yn = [C("yes", "Yes"), C("no", "No")];
  const list = [q("home_status", "Have you already found your home in Abu Dhabi?", [C("found", "Yes, I have a home"), C("not_found", "I'm still looking")], "Your answer decides whether we start with jobs or compare places to live.")];
  if (p.home_status === "found") list.push(q("home_neighborhood", "Where is your home?", d.neighborhoods.map(n => C(n.id, n.name)), "Choose one of the 10 areas covered by our dataset."));
  list.push(q("profession_category", "What kind of work are you looking for?", [C("teaching", "Teaching"), C("healthcare", "Healthcare"), C("marketing", "Marketing / communications")]));
  list.push(q("job_role", "What is your specialty?", roles[p.profession_category ?? "teaching"], "Choose a specialty. Clinical specialists can write their exact role.", true));
  if (p.profession_category === "healthcare" && p.job_role === "other") {
    const clinical = d.jobs.filter(j => j.profession_category === "healthcare");
    list.push(q("clinical_specialty", "Which clinical specialty matches your qualifications?", clinical.filter((j, i) => clinical.findIndex(x => x.role_type === j.role_type) === i).map(j => C(j.role_type, j.role_type.replaceAll("_", " "), j.role_tags.filter(t => t !== "physician"))), "Choose your exact clinical specialty; we do not assume every physician role fits."));
  }
  if (p.profession_category && p.profession_category !== "marketing") list.push(q("professional_license_status", "Do you have a relevant UAE professional licence?", [C("yes", "Yes"), C("no", "No"), C("in_progress", "Application in progress"), C("not_sure", "Not sure")], "Employer requirements still need confirmation. We don't infer eligibility from your profession."));
  list.push(q("visa_status", "What is your visa situation?", [C("own_or_family", "Own / family visa"), C("golden_visa", "Golden Visa"), C("needs_sponsorship", "I need employer sponsorship"), C("not_sure", "Not sure")]));
  list.push(q("employment_preference", "Which work arrangement suits you?", [C("full_time", "Full time"), C("part_time", "Part time"), C("either", "Either")]));
  list.push(q("availability_to_start", "When could you start?", [C("immediate", "Immediately"), C("within_2_weeks", "Within 2 weeks"), C("within_1_month", "Within 1 month"), C("within_3_months", "Within 3 months")]));
  list.push(q("work_hours", "What hours can you work?", [C("08:00-15:00", "08:00 – 15:00"), C("09:00-17:00", "09:00 – 17:00"), C("flexible", "Flexible")], "For example: 8am to 3pm, or 08:30-16:00. These are work hours, not departure times.", true));
  if (p.answers.work_hours !== "flexible") list.push(q("strict_hours", "Is finishing within those hours essential?", [C("yes", "Yes, essential"), C("no", "A preference")], "Unknown employer hours remain possible matches, with a clear confirmation flag."));
  if (p.profession_category === "healthcare") list.push(q("shift_work", "Can you work rotating shifts?", yn));
  if (p.profession_category === "healthcare" || p.role_tags.includes("events") || p.role_tags.includes("hospitality")) {
    list.push(q("evenings", "Can you work evenings?", yn), q("weekends", "Can you work weekends?", yn));
  }
  list.push(q("max_commute_minutes", "What is your preferred maximum one-way drive?", [C("20", "20 minutes"), C("30", "30 minutes"), C("45", "45 minutes"), C("60", "60 minutes")], "We check both the 08:00 outbound and 18:00 return snapshots. Longer journeys stay visible.", true));
  if (p.home_status === "not_found") {
    list.push(q("partner_work_location", "Where does your partner work?", [C("skip", "Skip / not applicable")], "Optional workplace address. This is saved separately; partner routes need Google Maps setup.", true));
    list.push(q("bedrooms", "How many bedrooms do you need?", [C("1", "1 BHK"), C("2", "2 BHK"), C("3", "3 BHK")]));
    list.push(q("annual_budget_aed", "What is your annual rent budget in AED?", [C("80000", "80,000 AED"), C("110000", "110,000 AED"), C("150000", "150,000 AED"), C("skip", "No budget yet")], "Annual rent only. Deposits, utilities, fees and transport are extra.", true));
    list.push(q("choose_neighborhood", "Choose an area to see your job shortlist.", d.neighborhoods.map(n => C(n.id, n.name)), "Compare the area cards first. You can change the selected area later."));
  }
  return list;
}
export function currentQuestion(p: Candidate, d: Dataset): Question | null { return questions(p, d).find(q => !(q.key in p.answers)) ?? null; }
const normal = (s: string) => s.toLowerCase().trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, "");
export function parseHours(input: string): { earliest_start: string | null; latest_finish: string | null } | null {
  if (/^(flexible|esnek)$/i.test(input.trim())) return { earliest_start: null, latest_finish: null };
  const match = input.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|ile)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let a = Number(match[1]), b = Number(match[4]);
  const am = Number(match[2] ?? 0), bm = Number(match[5] ?? 0);
  if ((match[3] && (a < 1 || a > 12)) || (match[6] && (b < 1 || b > 12))) return null;
  if (match[3]) a = a % 12 + (match[3] === "pm" ? 12 : 0);
  if (match[6]) b = b % 12 + (match[6] === "pm" ? 12 : 0);
  if (!match[6] && !match[5] && b < a && b <= 7 && a <= 12) b += 12;
  if (a > 23 || b > 23 || am > 59 || bm > 59 || a * 60 + am >= b * 60 + bm) return null;
  return { earliest_start: `${String(a).padStart(2, "0")}:${String(am).padStart(2, "0")}`, latest_finish: `${String(b).padStart(2, "0")}:${String(bm).padStart(2, "0")}` };
}
export function resolveAnswer(q: Question, raw: string): string | null {
  const v = normal(raw);
  const numbered = /^\d{1,2}$/.test(v) ? q.choices[Number(v) - 1] : undefined;
  if (numbered) return numbered.value;
  const exact = q.choices.find(c => normal(c.value) === v || normal(c.label) === v);
  if (exact) return exact.value;
  const aliases: Record<string, Record<string, string>> = {
    home_status: { yes: "found", evet: "found", no: "not_found", hayir: "not_found" },
    profession_category: { teacher: "teaching", ogretmen: "teaching", ogretmenlik: "teaching", saglik: "healthcare", nurse: "healthcare", doctor: "healthcare", pazarlama: "marketing" },
    job_role: { "primary teacher": "primary", "primary school teacher": "primary", "ilkokul ogretmeni": "primary", nurse: "nursing", "registered nurse": "nursing" },
    visa_status: { "family visa": "own_or_family", "own visa": "own_or_family" },
    employment_preference: { "full time": "full_time", "part time": "part_time", "tam zamanli": "full_time", "yari zamanli": "part_time" },
  };
  if (aliases[q.key]?.[v] && q.choices.some(c => c.value === aliases[q.key][v])) return aliases[q.key][v];
  if (q.choices.some(c => c.value === "yes") && /^(evet|yes|true)$/.test(v)) return "yes";
  if (q.choices.some(c => c.value === "no") && /^(hayir|no|false)$/.test(v)) return "no";
  if (q.key === "work_hours") { const h = parseHours(raw); if (h) return h.earliest_start ? `${h.earliest_start}-${h.latest_finish}` : "flexible"; }
  if (q.key === "max_commute_minutes") { const n = Number(v.replace(/\s*(minutes?|mins?|dakika|dk)$/, "")); if (Number.isInteger(n) && n >= 5 && n <= 180) return String(n); }
  if (q.key === "annual_budget_aed") { const n = Number(v.replace(/\s*aed$/, "").replace(/,/g, "").replace(/k$/, "000")); if (Number.isFinite(n) && n >= 10000 && n <= 2000000) return String(n); }
  if (q.key === "partner_work_location" && raw.trim().length >= 3 && raw.length <= 300) return raw.trim();
  return null;
}
export function applyAnswer(p: Candidate, d: Dataset, value: string): Candidate {
  const q = currentQuestion(p, d); if (!q) return p;
  const v = resolveAnswer(q, value); if (v === null) throw new Error("Please choose a listed option, or use the format shown below.");
  const n = structuredClone(p); n.answers[q.key] = v;
  switch (q.key) {
    case "home_status": n.home_status = v as Candidate["home_status"]; break;
    case "home_neighborhood": case "choose_neighborhood": n.home_neighborhood = v; break;
    case "profession_category": n.profession_category = v as Candidate["profession_category"]; break;
    case "job_role": { const role = roles[n.profession_category!].find(c => c.value === v); n.job_role = v; n.role_tags = role?.tags ?? (v.startsWith("specialty:") ? [normal(v.slice(10)).replace(/\s+/g, "_")] : []); break; }
    case "clinical_specialty": n.role_tags = q.choices.find(c => c.value === v)?.tags ?? []; n.answers.job_role = v; n.job_role = v; break;
    case "professional_license_status": n.professional_license_status = v; break;
    case "visa_status": n.visa_status = v; break;
    case "employment_preference": n.employment_preference = v; break;
    case "availability_to_start": n.availability_to_start = v; break;
    case "work_hours": Object.assign(n.work_constraints, parseHours(v)); if (v === "flexible") n.work_constraints.strict = false; break;
    case "strict_hours": n.work_constraints.strict = v === "yes"; break;
    case "shift_work": case "evenings": case "weekends": n.availability[q.key] = v === "yes"; break;
    case "max_commute_minutes": n.max_commute_minutes = Number(v); break;
    case "partner_work_location": n.partner_work_location = v === "skip" ? null : v; break;
    case "bedrooms": n.housing.bedrooms = Number(v); break;
    case "annual_budget_aed": n.housing.annual_budget_aed = v === "skip" ? null : Number(v); break;
  }
  n.revision++; n.updated_at = new Date().toISOString(); n.conversation_step = currentQuestion(n, d)?.key ?? "complete";
  n.history.push({ role: "user", text: q.choices.find(c => c.value === v)?.label ?? value });
  n.history = n.history.slice(-36);
  return n;
}
export function sarahCandidate(id: string, d: Dataset): Candidate {
  let p = newCandidate(id);
  for (const value of ["not_found", "teaching", "primary", "not_sure", "own_or_family", "full_time", "within_1_month", "08:00-15:00", "yes", "30", "skip", "2", "110000"]) p = applyAnswer(p, d, value);
  return p;
}
