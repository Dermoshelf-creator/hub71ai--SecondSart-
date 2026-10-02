import "server-only";
import { createHash } from "node:crypto";
import jobsFile from "../data/jobs_with_commute_times.json";
import propertyFile from "../data/property_dump.json";
import type { Candidate, Dataset } from "./types.ts";
import { newCandidate } from "./flow.ts";
export type Config = {
  SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string;
  OPENAI_API_KEY?: string; OPENAI_MODEL?: string;
  TWILIO_AUTH_TOKEN?: string; WHATSAPP_WEBHOOK_URL?: string; GOOGLE_MAPS_API_KEY?: string;
};
export function config(): Config { return process.env as Config; }
// Privileged keys stay on the server. Visitors use only our cookie-scoped API.
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const c = config(), key = c.SUPABASE_SECRET_KEY || c.SUPABASE_SERVICE_ROLE_KEY;
  if (!c.SUPABASE_URL || !key) throw new Error("SUPABASE_NOT_CONFIGURED");
  const url = new URL(c.SUPABASE_URL);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("SUPABASE_URL_INVALID");
  if (url.username || url.password) throw new Error("SUPABASE_URL_INVALID");
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  // The new sb_secret key is opaque, not a JWT. Legacy keys are JWTs.
  if (key.startsWith("eyJ")) headers.set("Authorization", `Bearer ${key}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(new URL(`/rest/v1/${path}`, url), {
    ...init, headers, cache: "no-store", signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`SUPABASE_REQUEST_FAILED_${response.status}`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}
const rpc = <T>(name: string, args: object = {}) => request<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
const params = (values: Record<string, string>) => new URLSearchParams(values).toString();
let cached: { value: Dataset; expires: number } | null = null;
let pending: Promise<Dataset> | null = null;
const initialDataset = { jobs: jobsFile.jobs, neighborhoods: propertyFile.neighborhoods, sources: propertyFile.sources };
const initialVersion = createHash("sha256").update(JSON.stringify([jobsFile, propertyFile])).digest("hex").slice(0, 16);
export async function dataset(): Promise<Dataset> {
  if (cached && cached.expires > Date.now()) return cached.value;
  pending ??= rpc<Dataset>("second_start_dataset").then(async value => {
    if (!value.jobs?.length || !value.neighborhoods?.length) {
      await rpc<boolean>("second_start_import_dataset", { p_dataset: initialDataset, p_version: initialVersion });
      value = await rpc<Dataset>("second_start_dataset");
    }
    if (!value.jobs?.length || !value.neighborhoods?.length || !value.sources?.length || !value.version) throw new Error("SUPABASE_DATASET_NOT_SEEDED");
    cached = { value, expires: Date.now() + 60000 }; return value;
  }).finally(() => { pending = null; });
  return pending;
}
export async function candidate(id: string, channel: Candidate["channel"]): Promise<Candidate> {
  return rpc<Candidate>("second_start_open_session", { p_candidate: newCandidate(id, channel) });
}
export async function previousEvent(id: string, candidateId: string): Promise<string | null> {
  const rows = await request<{ response: unknown }[]>(`second_start_events?${params({ select: "response", id: `eq.${id}`, candidate_id: `eq.${candidateId}`, expires_at: `gt.${new Date().toISOString()}`, limit: "1" })}`);
  return rows[0] ? JSON.stringify(rows[0].response) : null;
}
export async function saveCandidate(p: Candidate, oldRevision: number, eventId: string, response: string): Promise<boolean> {
  return rpc<boolean>("second_start_save_answer", { p_candidate: p, p_old_revision: oldRevision, p_event_id: eventId, p_response: JSON.parse(response) });
}
export async function saveCachedEvent(id: string, candidateId: string, response: unknown, expiresAt: string): Promise<void> {
  await request("second_start_events?on_conflict=id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id, candidate_id: candidateId, response, expires_at: expiresAt }),
  });
}
export async function whatsappId(phone: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(config().TWILIO_AUTH_TOKEN!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(phone));
  return "wa_" + Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
