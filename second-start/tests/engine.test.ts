import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyAnswer, currentQuestion, newCandidate, parseHours, sarahCandidate } from "../lib/flow.ts";
import { areaMatches, jobMatches, matchJob } from "../lib/matching.ts";
import type { Dataset } from "../lib/types.ts";
const j = JSON.parse(readFileSync(new URL("../data/jobs_with_commute_times.json", import.meta.url), "utf8"));
const n = JSON.parse(readFileSync(new URL("../data/property_dump.json", import.meta.url), "utf8"));
const d: Dataset = { jobs: j.jobs, neighborhoods: n.neighborhoods, sources: n.sources, version: "test" };
const today = "2026-10-02";
test("Sarah reaches area selection and rent bands are sourced for 2 BHK", () => {
  const p = sarahCandidate("test", d);
  assert.equal(currentQuestion(p, d)?.key, "choose_neighborhood");
  assert.equal(p.work_constraints.latest_finish, "15:00");
  const areas = areaMatches(p, d, today); assert.equal(areas.length, 10);
  assert.ok(areas.every(a => a.band.bedrooms === 2 && a.sources.length));
  assert.ok(areas.some(a => a.within_commute_jobs > 0));
  console.log("Sarah top areas:", areas.slice(0, 3).map(a => ({ name: a.name, jobsWithinDrive: a.within_commute_jobs, rent: [a.band.min, a.band.max] })));
});
test("home found branch skips partner, BHK and budget questions", () => {
  let p = newCandidate("found");
  for (const v of ["found", "khalifa_city", "marketing", "digital", "own_or_family", "either", "immediate", "flexible", "30"]) p = applyAnswer(p, d, v);
  assert.equal(currentQuestion(p, d), null); assert.equal(p.home_neighborhood, "khalifa_city");
  assert.equal(p.professional_license_status, null); assert.equal(p.housing.bedrooms, null);
});
test("invalid answers don't advance the profile", () => {
  const p = newCandidate("invalid"); assert.throws(() => applyAnswer(p, d, "maybe")); assert.equal(p.revision, 0); assert.equal(p.home_status, null);
});
test("ambiguous everyday hours normalise, invalid times do not", () => {
  assert.deepEqual(parseHours("8am to 3pm"), { earliest_start: "08:00", latest_finish: "15:00" });
  assert.deepEqual(parseHours("8-3"), { earliest_start: "08:00", latest_finish: "15:00" });
  assert.equal(parseHours("08:90-15:00"), null); assert.equal(parseHours("25-26"), null); assert.equal(parseHours("4pm to 3pm"), null);
});
test("primary teaching cannot match music specialists or leadership", () => {
  const p = sarahCandidate("teacher", d), jobs = jobMatches(p, d, d.neighborhoods[0], today);
  assert.ok(jobs.length); assert.ok(jobs.every(x => !/music|head of|lead/i.test(x.title)));
  assert.ok(jobs.every(x => x.warnings.some(w => /Confirm hours/.test(w))));
});
test("known strict schedule conflict excludes; unknown schedule remains flagged", () => {
  const p = sarahCandidate("schedule", d), original = d.jobs.find(j => j.role_tags.includes("primary_general") && !j.matching_metadata.requires_manual_review)!;
  assert.equal(matchJob(p, { ...original, work_schedule: { start: "08:00", end: "17:00" } }, d.neighborhoods[0], today), null);
  assert.ok(matchJob(p, { ...original, work_schedule: null }, d.neighborhoods[0], today)?.warnings.some(w => /Confirm hours/.test(w)));
});
test("both directions must fit the drive preference and missing routes are not zero", () => {
  const p = sarahCandidate("route", d), n = d.neighborhoods[0], original = d.jobs.find(j => j.role_tags.includes("primary_general") && !j.matching_metadata.requires_manual_review)!;
  const edited = structuredClone(original);
  edited.commute_by_neighborhood[n.commute_key] = { morning_08_to_job: { status: "ok", duration_minutes: 20 }, evening_18_from_job: { status: "ok", duration_minutes: 40 } };
  assert.equal(matchJob(p, edited, n, today)?.within_commute, false);
  edited.commute_by_neighborhood[n.commute_key].evening_18_from_job = { status: "address_missing", duration_minutes: null };
  const m = matchJob(p, edited, n, today); assert.equal(m?.evening, null); assert.equal(m?.within_commute, null);
});
test("manual review and expired jobs are excluded", () => {
  const p = sarahCandidate("review", d), j = d.jobs.find(j => j.role_tags.includes("primary_general"))!;
  assert.equal(matchJob(p, { ...j, matching_metadata: { requires_manual_review: true, notes: [] } }, d.neighborhoods[0], today), null);
  assert.equal(matchJob(p, { ...j, deadline: "2026-09-30" }, d.neighborhoods[0], today), null);
});
test("part time rejects known full time and accepts mixed arrangements", () => {
  const p = sarahCandidate("part", d); p.employment_preference = "part_time";
  const j = d.jobs.find(j => j.role_tags.includes("primary_general"))!;
  assert.equal(matchJob(p, { ...j, employment_type: "full_time" }, d.neighborhoods[0], today), null);
  assert.ok(matchJob(p, { ...j, employment_type: "full_time_or_part_time" }, d.neighborhoods[0], today));
});
test("clinical specialty must match, licence and visa unknowns are not invented", () => {
  const p = newCandidate("nurse"); Object.assign(p, { profession_category: "healthcare", job_role: "nursing", role_tags: ["nursing"], visa_status: "needs_sponsorship", professional_license_status: "no", max_commute_minutes: 30 });
  const n = d.neighborhoods[0], matches = jobMatches(p, d, n, today);
  assert.ok(matches.every(m => /first assist/i.test(m.title)));
  const j = d.jobs.find(j => j.role_tags.includes("nursing"))!;
  assert.equal(matchJob(p, { ...j, license_requirement: "required" }, n, today), null);
  assert.equal(matchJob(p, { ...j, visa_sponsorship: "no" }, n, today), null);
  assert.ok(matchJob(p, j, n, today)?.warnings.some(w => /Visa sponsorship unverified/.test(w)));
});
test("the Gate/Bloom rent proxy remains explicit, 3BHK type differs", () => {
  const n = d.neighborhoods.find(n => /Bloom/.test(n.name))!;
  assert.equal(n.rent_ranges["2br"].confidence, "low"); assert.match(n.rent_ranges["2br"].coverage_area, /Rabdan/);
  assert.equal(n.rent_ranges["3br"].property_type, "townhouse_or_villa");
});
test("every neighborhood joins every supplied job's commute map exactly", () => {
  assert.equal(d.jobs.length, 60); assert.equal(d.neighborhoods.length, 10);
  for (const n of d.neighborhoods) for (const j of d.jobs) assert.ok(n.commute_key in j.commute_by_neighborhood);
});
test("other clinical specialty asks a precise follow-up and does not match all physicians", () => {
  let p = newCandidate("specialist");
  for (const v of ["not_found", "healthcare", "other", "allergist_immunologist"]) p = applyAnswer(p, d, v);
  assert.equal(currentQuestion(p, d)?.key, "professional_license_status");
  assert.ok(!p.role_tags.includes("physician"));
  const matches = jobMatches(p, d, d.neighborhoods[0], today);
  assert.ok(matches.length); assert.ok(matches.every(m => /allergist|immunologist/i.test(m.title)));
});
