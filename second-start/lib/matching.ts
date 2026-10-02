import type { AreaMatch, Candidate, Dataset, Job, JobMatch, Neighborhood } from "./types.ts";
const validDuration = (r: { status: string; duration_minutes: number | null } | undefined) => r?.status === "ok" && typeof r.duration_minutes === "number" && Number.isFinite(r.duration_minutes) && r.duration_minutes >= 0 ? r.duration_minutes : null;
const minutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export function matchJob(p: Candidate, j: Job, n: Neighborhood, today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" })): JobMatch | null {
  if (!p.profession_category || !p.job_role || j.profession_category !== p.profession_category || j.matching_metadata.requires_manual_review) return null;
  if (j.deadline && j.deadline < today) return null;
  if (!p.role_tags.some(t => j.role_tags.includes(t))) return null;
  if (p.job_role !== "leadership" && j.role_tags.includes("leadership")) return null;
  if (p.employment_preference && p.employment_preference !== "either" && !["unknown", "full_time_or_part_time", p.employment_preference].includes(j.employment_type)) return null;
  if (p.visa_status === "needs_sponsorship" && j.visa_sponsorship === "no") return null;
  if (j.license_requirement === "required" && p.professional_license_status === "no") return null;
  const s = j.work_schedule, w: string[] = [];
  if (p.work_constraints.strict && s) {
    if (s.start && p.work_constraints.earliest_start && minutes(s.start) < minutes(p.work_constraints.earliest_start)) return null;
    if (s.end && p.work_constraints.latest_finish && minutes(s.end) > minutes(p.work_constraints.latest_finish)) return null;
  }
  for (const field of ["evenings", "weekends", "shift_work"] as const) {
    if (p.availability[field] === false && s?.[field] === true) return null;
    if (p.availability[field] === false && s?.[field] == null) w.push(`${field.replace("_", " ")} requirement unverified`);
  }
  if (p.work_constraints.earliest_start && (!s?.start || !s?.end)) w.push(`Confirm hours${p.work_constraints.latest_finish ? `: finish by ${p.work_constraints.latest_finish}` : ""}`);
  if (j.employment_type === "unknown") w.push("Employment arrangement unverified");
  if (p.profession_category !== "marketing" && j.license_requirement === "unknown") w.push("Professional licence requirement unverified");
  if (j.license_requirement === "required" && p.professional_license_status !== "yes") w.push("Licence must be confirmed before applying");
  if (p.visa_status === "needs_sponsorship" && j.visa_sponsorship === "unknown") w.push("Visa sponsorship unverified");
  if (!j.start_timing) w.push("Start date unverified");
  if (!j.deadline) w.push("Listing availability must be rechecked");
  const route = j.commute_by_neighborhood[n.commute_key];
  const morning = validDuration(route?.morning_08_to_job), evening = validDuration(route?.evening_18_from_job);
  const longest = morning !== null && evening !== null ? Math.max(morning, evening) : null;
  const within = longest !== null && p.max_commute_minutes !== null ? longest <= p.max_commute_minutes : null;
  if (longest === null) w.push("Commute unavailable: missing or unresolved address");
  if (within === false) w.push("Journey exceeds your preferred drive time");
  const futureStart = j.start_timing?.value.match(/^\d{4}-\d{2}/)?.[0];
  if (futureStart && futureStart > today.slice(0, 7)) w.push(`Advertised start: ${j.start_timing!.value}; compare with your availability`);
  return { id: j.id, title: j.title, employer: j.employer, area: j.area, apply_url: j.apply_url, employment_type: j.employment_type, contract_type: j.contract_type, start_timing: j.start_timing, morning, evening, within_commute: within, warnings: w, score: (within === true ? 100 : within === false ? 20 : 0) + (j.employment_type !== "unknown" ? 10 : 0) - (longest ?? 180) / 10 - w.length };
}
export function jobMatches(p: Candidate, d: Dataset, n: Neighborhood, today?: string): JobMatch[] { return d.jobs.map(j => matchJob(p, j, n, today)).filter((j): j is JobMatch => j !== null).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)); }
export function areaMatches(p: Candidate, d: Dataset, today?: string): AreaMatch[] {
  return d.neighborhoods.map(n => {
    const jobs = jobMatches(p, d, n, today), band = n.rent_ranges[`${p.housing.bedrooms ?? 2}br`], b = p.housing.annual_budget_aed;
    const budget: AreaMatch["budget"] = b === null ? "unspecified" : band.max <= b ? "within" : band.min <= b ? "overlap" : "above";
    const within = jobs.filter(j => j.within_commute === true), durations = within.flatMap(j => [j.morning!, j.evening!]);
    const range: [number, number] | null = durations.length ? [Math.min(...durations), Math.max(...durations)] : null;
    return { id: n.id, name: n.name, band, budget, potential_jobs: jobs.length, within_commute_jobs: within.length, unknown_commute_jobs: jobs.filter(j => j.within_commute === null && (j.morning === null || j.evening === null)).length, commute_range: range, jobs, sources: d.sources.filter(s => band.source_ids.includes(s.id)), rent_data_date: n.rent_data_date, score: (budget === "within" ? 30 : budget === "overlap" ? 10 : budget === "above" ? -40 : 0) + within.length * 20 - (range?.[0] ?? 180) / 10 - band.min / 100000 };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
