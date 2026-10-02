"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { AreaMatch, JobMatch, View } from "@/lib/types";
import type { PartnerRoute } from "@/lib/partner-routes";

const money = (n: number) => n.toLocaleString("en-US");
const readable = (s: string) => s.replaceAll("_", " ").replace(/^specialty:/, "");

function AreaRow({ area, rank, selected, disabled, limit, onSelect }: {
  area: AreaMatch; rank: number; selected: boolean; disabled: boolean; limit: number | null; onSelect: () => void;
}) {
  const band = area.band;
  const budget = { within: "Range within your budget", overlap: "Your budget covers part of this range", above: "Above your budget", unspecified: "Indicative annual rent" }[area.budget];
  return <article className={`area-row ${selected ? "is-selected" : ""}`}>
    <span className="row-rank" aria-hidden="true">{String(rank).padStart(2, "0")}</span>
    <div className="area-main">
      <div className="area-row-heading">
        <div><h3>{area.name}</h3><p className="secondary">{band.bedrooms} BHK · {band.property_type === "townhouse_or_villa" ? "Townhouse / villa" : readable(band.property_type)}</p></div>
        {selected && <span className="selected-label"><Check size={14} /> Selected</span>}
      </div>
      <div className="area-metrics">
        <div className="rent-metric"><span className="metric-label">Annual rent · AED</span><strong>{money(band.min)}–{money(band.max)}</strong><span className={`budget-text ${area.budget}`}>{budget}</span></div>
        <div><span className="metric-label">Potential roles within your drive limit</span><strong>{area.within_commute_jobs}<span className="metric-unit">{limit ? ` · ≤${limit} min each way` : ""}</span></strong><span className="secondary">Employer hours still need checking</span></div>
      </div>
      <div className="area-detail-line"><span>{area.commute_range ? `${Math.ceil(area.commute_range[0])}–${Math.ceil(area.commute_range[1])} min across those roles · 08:00 / 18:00 departures` : "No verified journey within your preferred limit"}</span></div>
      {band.coverage_precision === "nearby_area_proxy" && <p className="evidence-note">Rent proxy: {band.coverage_area}. The band does not cover every part of this combined area.</p>}
      {band.confidence === "low" && <p className="evidence-note">Limited rental evidence · low confidence</p>}
      <div className="row-actions"><a href={area.sources[0]?.url} target="_blank" rel="noreferrer">Rental source</a><Button disabled={disabled} onClick={onSelect} variant={selected ? "outline" : "default"}>{selected ? "View selected area" : "View jobs"}</Button></div>
    </div>
  </article>;
}

function JobRow({ job, rank }: { job: JobMatch; rank: number }) {
  return <article className="job-row">
    <span className="row-rank" aria-hidden="true">{String(rank).padStart(2, "0")}</span>
    <div className="job-main">
      <p className="employer-name">{job.employer}</p><h3>{job.title}</h3><p className="secondary">{job.area} · {readable(job.employment_type)}</p>
      <div className="journey-metrics">
        <div><span className="metric-label">08:00 outbound</span><strong>{job.morning === null ? "Unknown" : `${Math.ceil(job.morning)} min`}</strong></div>
        <div><span className="metric-label">18:00 return</span><strong>{job.evening === null ? "Unknown" : `${Math.ceil(job.evening)} min`}</strong></div>
        <p className="journey-status">{job.within_commute === true ? "Within your drive preference" : job.within_commute === false ? "Longer than your drive preference" : "Route needs confirmation"}</p>
      </div>
      {job.warnings.length > 0 && <div className="employer-checks"><span>Check with the employer</span><ul>{job.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}
      <div className="row-actions"><span className="secondary">Potential match · confirm before applying</span><Button variant="outline" asChild><a href={job.apply_url} target="_blank" rel="noreferrer">View vacancy</a></Button></div>
    </div>
  </article>;
}

export default function Page() {
  const [v, setV] = useState<View | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [answer, setAnswer] = useState(""), [error, setError] = useState(""), [tab, setTab] = useState("areas"), [showAll, setShowAll] = useState(false);
  const latest = useRef<View | null>(null), lock = useRef(false), resultsPanel = useRef<HTMLElement | null>(null), wasReady = useRef(false);
  const [partner, setPartner] = useState<{ routes: PartnerRoute[]; date: string; attribution: string } | null>(null), [partnerBusy, setPartnerBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await fetch("/api/session", { cache: "no-store" }); if (!r.ok) throw new Error("Unable to open your session. Please try again."); const value = await r.json() as View; latest.current = value; setV(value); setError(""); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const lifecycle = new AbortController();
    void fetch("/api/session", { cache: "no-store", signal: lifecycle.signal }).then(async r => { if (!r.ok) throw new Error("Unable to open your session. Please try again."); return await r.json() as View; }).then(value => { latest.current = value; setV(value); setError(""); setLoading(false); }).catch(e => { if (!lifecycle.signal.aborted) { setError((e as Error).message); setLoading(false); } });
    return () => lifecycle.abort();
  }, []);

  const send = useCallback(async (value: string, action?: string) => {
    const state = latest.current; if (!state || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const r = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: value, action, revision: state.candidate.revision, eventId: crypto.randomUUID() }) });
      const result = await r.json() as View & { latest?: View; error?: string };
      if (!r.ok) { if (result.latest) { setV(result.latest); latest.current = result.latest; } throw new Error(result.error ?? "Couldn't save your answer."); }
      setV(result); latest.current = result; setAnswer("");
      if (action === "select_area" || !result.question) setTab("jobs");
      if (action === "reset" || action === "sarah") { setTab("areas"); setShowAll(false); setPartner(null); }
      return { step: result.candidate.conversation_step, saved: true };
    } catch (e) { setError((e as Error).message); throw e; } finally { lock.current = false; setBusy(false); }
  }, []);
  const answerNow = (value: string, action?: string) => { void send(value, action).catch(() => {}); };

  const calculatePartner = async () => {
    setPartnerBusy(true); setError("");
    try { const r = await fetch("/api/partner-routes", { method: "POST" }); const result = await r.json() as { routes: PartnerRoute[]; date: string; attribution: string; error?: string }; if (!r.ok) throw new Error(result.error ?? "Partner routes unavailable"); setPartner(result); }
    catch (e) { setError((e as Error).message); } finally { setPartnerBusy(false); }
  };

  useEffect(() => {
    if (v?.ready && !wasReady.current && window.matchMedia("(max-width: 760px)").matches) resultsPanel.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    wasReady.current = v?.ready ?? false;
  }, [v?.ready]);

  useEffect(() => {
    const context = (document as unknown as { modelContext?: { registerTool: (tool: object, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools = [
      { name: "read_relocation_profile", description: "Read the current visitor's saved profile, current question, and calculated comparison. Does not edit answers.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: (input: unknown) => { if (!input || typeof input !== "object" || Object.keys(input).length) throw new Error("Expected an empty object"); const s = latest.current; return { profile: s?.candidate, question: s?.question, areas: s?.areas.map(a => ({ id: a.id, name: a.name, rent: [a.band.min, a.band.max], potentialJobsWithinDrive: a.within_commute_jobs })) }; } },
      { name: "answer_relocation_question", description: "Save the visitor's answer to the currently visible question, advancing the same guided flow as the page. Do not answer on the visitor's behalf without their instruction.", inputSchema: { type: "object", properties: { answer: { type: "string", minLength: 1, maxLength: 2000 } }, required: ["answer"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async (input: unknown) => { const x = input as { answer?: unknown }; if (!x || typeof x.answer !== "string" || !x.answer.trim() || x.answer.length > 2000 || Object.keys(x).length !== 1) throw new Error("Invalid answer"); return await send(x.answer); } },
    ];
    for (const tool of tools) { try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch {} }
    return () => lifecycle.abort();
  }, [send]);

  const p = v?.candidate, q = v?.question, ready = v?.ready ?? false;
  const selected = v?.areas.find(a => a.id === p?.home_neighborhood);
  const areaList = v?.areas ?? [], shownAreas = showAll ? areaList : areaList.slice(0, 3);
  const jobList = v?.jobs ?? [], shownJobs = showAll ? jobList : jobList.slice(0, 3);
  const conversation = (p?.history ?? []).filter(m => !(m.role === "assistant" && m.text === q?.text)).slice(-4);
  const stage = !ready ? 0 : selected ? 2 : 1;
  const aiStatus = v?.ai === "used" ? "Answer interpreted with OpenAI" : v?.ai === "available" ? "AI interpretation available" : v?.ai === "fallback" ? "Use the options while AI is unavailable" : "Guided questions · English / Türkçe";

  return <div className="site-shell">
    <header className="site-header"><Link className="wordmark" href="/" aria-label="Second Start home">Second Start<span>.</span></Link><div className="header-tools"><span className="city-label">Abu Dhabi</span></div></header>
    <main className="main-workspace">
      <div className="journey-nav" aria-label="Journey progress">{["Your situation", "Choose an area", "Find work"].map((label, i) => <div key={label} className={stage === i ? "current-stage" : stage > i ? "past-stage" : ""}><span>{String(i + 1).padStart(2, "0")}</span><span className="stage-label">{label}</span></div>)}</div>
      <div className="workspace-grid">
        <aside className="conversation-panel" aria-label="Your situation">
          <div className="conversation-header"><h2>Your situation</h2><Button variant="ghost" disabled={busy || !v} onClick={() => answerNow("", "reset")}>Start over</Button></div>
          <Progress className="profile-progress" value={v?.progress ?? 0} aria-label="Profile completion" />
          <div className="conversation-body">
            {conversation.length > 0 && <div className="conversation-history" aria-label="Recent answers">{conversation.map((m, i) => <div key={`${i}-${m.text}`} className={`history-entry ${m.role}`}><span>{m.role === "user" ? "You" : "Second Start"}</span><p>{m.text}</p></div>)}</div>}
            <div className="current-question" aria-live="polite">
              {loading ? <><h1>Getting your profile ready.</h1><Skeleton className="question-skeleton" /></> : q ? <><h1>{q.text}</h1><p className="question-hint">{q.hint}</p><div className={`answer-options ${q.choices.length > 5 ? "many-options" : ""}`}>{q.choices.map((c, i) => <Button key={c.value} variant="outline" disabled={busy} onClick={() => answerNow(c.value)}><span className="option-number">{String(i + 1).padStart(2, "0")}</span><span className="option-copy">{c.label}{q.key === "home_status" && <small>{c.value === "found" ? "Find work from your current neighborhood." : "Compare work and rent before choosing an area."}</small>}</span></Button>)}</div></> : v ? <><h1>Your shortlist is ready.</h1><p className="question-hint">Check the role, the journey and the employer’s hours before you apply.</p>{selected && <div className="chosen-area"><span>Selected neighborhood</span><strong>{selected.name}</strong></div>}</> : <h1>Let’s try that again.</h1>}
            </div>
            {v?.message && <p className="feedback-message" role="status">{v.message}</p>}
            {error && <div className="error-message" role="alert"><p>{error}</p>{!v && <Button variant="outline" onClick={() => void load()}>Try again</Button>}</div>}
            {q && <form className="answer-form" onSubmit={e => { e.preventDefault(); if (answer.trim()) answerNow(answer.trim()); }}><label htmlFor="answer">Or write your answer</label><div><Input id="answer" value={answer} onChange={e => setAnswer(e.target.value)} placeholder={q.key === "work_hours" ? "For example, 8am to 3pm" : "Type here…"} maxLength={2000} disabled={busy} /><Button type="submit" size="icon" disabled={busy || !answer.trim()} aria-label="Send answer"><Send size={17} /></Button></div></form>}
          </div>
          <div className="conversation-footer"><span role="status">{busy ? "Saving your answer…" : "Answers saved as you go"}</span><span>{aiStatus}</span></div>
        </aside>

        <section className="results-panel" ref={resultsPanel} aria-label="Your shortlist">
          <div className="results-heading"><div><p className="section-label">{ready ? (selected ? "Your selected area" : "Based on your answers") : "Work + home"}</p><h2>{ready ? (tab === "jobs" ? "Your job shortlist" : "Compare neighborhoods") : "Your shortlist"}</h2></div><span className="data-date">Data: 02 Oct 2026</span></div>

          {!ready ? <div className="profile-brief">
            <p className="brief-intro">Start with the questions on the {" "}<span className="desktop-word">left</span><span className="mobile-word">top</span>. Your answers will bring the right areas and roles into view.</p>
            <dl><div><dt>Work</dt><dd>{p?.job_role ? readable(p.job_role) : p?.profession_category ? readable(p.profession_category) : "Your profession and specialty"}</dd></div><div><dt>Your day</dt><dd>{p?.work_constraints.earliest_start ? `${p.work_constraints.earliest_start}–${p.work_constraints.latest_finish}${p.work_constraints.strict ? " · essential" : ""}` : p?.answers.work_hours === "flexible" ? "Flexible hours" : "Hours that work for you"}</dd></div><div><dt>The journey</dt><dd>{p?.max_commute_minutes ? `Up to ${p.max_commute_minutes} minutes each way` : "Your preferred drive time"}</dd></div><div><dt>Home</dt><dd>{selected ? selected.name : p?.home_status === "not_found" ? "Looking for a neighborhood" : "Your current area, or a new one"}</dd></div></dl>
            <div className="example-line"><span>Want to see how the comparison works?</span><Button variant="link" disabled={!v || busy} onClick={() => answerNow("", "sarah")}>Use Sarah’s example</Button></div>
          </div> : <>
            <div className="profile-summary"><span>{p?.job_role ? readable(p.job_role) : p?.profession_category}</span>{p?.work_constraints.latest_finish && <span>Finish by {p.work_constraints.latest_finish}</span>}{p?.max_commute_minutes && <span>Drive ≤{p.max_commute_minutes} min</span>}{p?.housing.bedrooms && <span>{p.housing.bedrooms} BHK</span>}{p?.housing.annual_budget_aed && <span>AED {money(p.housing.annual_budget_aed)} / year</span>}</div>
            <Tabs className="comparison-tabs" value={tab} onValueChange={value => { setTab(value); setShowAll(false); }}>
              <TabsList className="view-tabs" variant="line" aria-label="Comparison view"><TabsTrigger value="areas">Neighborhoods<span>{areaList.length}</span></TabsTrigger><TabsTrigger value="jobs">Jobs{selected && <span>{jobList.length}</span>}</TabsTrigger></TabsList>
              <TabsContent value={tab}>
                {tab === "areas" ? <><div className="area-list">{shownAreas.map((a, i) => <AreaRow key={a.id} rank={i + 1} area={a} selected={a.id === p?.home_neighborhood} disabled={busy} limit={p?.max_commute_minutes ?? null} onSelect={() => answerNow(a.id, "select_area")} />)}</div><Button className="show-more" variant="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? "Show top 3 areas" : `Compare all ${areaList.length} neighborhoods`}</Button></> : <div className="jobs-list">{shownJobs.map((j, i) => <JobRow key={j.id} rank={i + 1} job={j} />)}{!jobList.length && <div className="empty-results"><h3>{selected ? "No matching roles in this snapshot." : "Choose a neighborhood first."}</h3><p>{selected ? "You can start over with a different specialty, or compare another area." : "See the rent and journey comparison, then select an area to view its roles."}</p><Button variant="outline" onClick={() => setTab("areas")}>Compare neighborhoods</Button></div>}{jobList.length > 3 && <Button className="show-more" variant="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? "Show top 3 jobs" : `See all ${jobList.length} potential matches`}</Button>}</div>}
              </TabsContent>
            </Tabs>
          </>}

          {ready && p?.partner_work_location && <div className="partner-section"><h3>Your partner’s journey</h3><p>{p.partner_work_location}</p><p className="secondary">{v?.partnerRoutesEnabled ? "Calculate for the next business day. The workplace address is sent to Google Routes." : "Partner journey times are not included in this snapshot."}</p>{v?.partnerRoutesEnabled && <Button variant="outline" disabled={partnerBusy} onClick={() => void calculatePartner()}>{partnerBusy ? "Calculating…" : "Compare partner’s drive"}</Button>}{partner && <><div className="partner-grid">{partner.routes.map(r => <div key={r.neighborhoodId}><strong>{v?.areas.find(a => a.id === r.neighborhoodId)?.name}</strong><span>{r.morning === null ? "?" : Math.ceil(r.morning)} / {r.evening === null ? "?" : Math.ceil(r.evening)} min</span></div>)}</div><p className="secondary">{partner.date} · 08:00 outbound / 18:00 return · area reference points · {partner.attribution}</p></>}</div>}

          <div className="data-notes"><h3>How to read the results</h3><p>Rent bands are indicative annual rents. Driving times depart at 08:00 and 18:00 from area reference points. They do not confirm arrival at work or a 15:00 return. Employer hours still need checking.</p><span>{v?.totalJobs ?? 60} vacancies · {v?.totalNeighborhoods ?? 10} neighborhoods · 1–3 BHK</span></div>
        </section>
      </div>
    </main>
    <footer className="site-footer"><span>Second Start</span><span>Abu Dhabi relocation</span><Button variant="link" disabled={!v || busy} onClick={() => answerNow("", "sarah")}>Sarah’s example</Button></footer>


  </div>;
}
