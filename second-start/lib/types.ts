export type Profession = "teaching" | "healthcare" | "marketing";
export type Choice = { value: string; label: string; tags?: string[] };
export type Question = { key: string; text: string; hint: string; choices: Choice[]; freeText?: boolean };
export type Candidate = {
  id: string; channel: "web" | "whatsapp"; revision: number;
  home_status: "found" | "not_found" | null;
  home_neighborhood: string | null; partner_work_location: string | null;
  profession_category: Profession | null; job_role: string | null; role_tags: string[];
  professional_license_status: string | null; professional_license_authority: string | null;
  visa_status: string | null; employment_preference: string | null; availability_to_start: string | null;
  work_constraints: { earliest_start: string | null; latest_finish: string | null; strict: boolean | null };
  availability: { evenings: boolean | null; weekends: boolean | null; shift_work: boolean | null };
  max_commute_minutes: number | null;
  housing: { bedrooms: number | null; annual_budget_aed: number | null };
  answers: Record<string, string>; history: { role: "assistant" | "user"; text: string }[];
  conversation_step: string; updated_at: string;
};
export type RouteValue = { status: string; duration_minutes: number | null };
export type Job = {
  id: string; title: string; employer: string; area: string; address: string | null;
  apply_url: string; deadline?: string | null; profession_category: Profession;
  role_type: string; role_tags: string[]; employment_type: string; contract_type: string;
  license_requirement: string; license_authority: string | null; visa_sponsorship: string;
  work_schedule: null | { start?: string | null; end?: string | null; shift_work?: boolean | null; evenings?: boolean | null; weekends?: boolean | null };
  start_timing: null | { value: string; precision: string }; commute_available: boolean;
  matching_metadata: { requires_manual_review: boolean; notes: string[] };
  commute_by_neighborhood: Record<string, { morning_08_to_job: RouteValue; evening_18_from_job: RouteValue }>;
};
export type RentBand = {
  bedrooms: number; min: number; max: number; property_type: string;
  coverage_area: string; coverage_precision: string; confidence: string;
  source_ids: string[]; notes: string[];
};
export type Neighborhood = {
  id: string; name: string; commute_key: string; rent_data_date: string;
  rent_ranges: Record<string, RentBand>; notes: string[];
};
export type Source = { id: string; publisher: string; url: string; accessed_on: string; evidence_summary: string };
export type Dataset = { jobs: Job[]; neighborhoods: Neighborhood[]; sources: Source[]; version: string };
export type JobMatch = {
  id: string; title: string; employer: string; area: string; apply_url: string; employment_type: string;
  contract_type: string; start_timing: Job["start_timing"]; morning: number | null; evening: number | null;
  within_commute: boolean | null; warnings: string[]; score: number;
};
export type AreaMatch = {
  id: string; name: string; band: RentBand; budget: "within" | "overlap" | "above" | "unspecified";
  potential_jobs: number; within_commute_jobs: number; unknown_commute_jobs: number;
  commute_range: [number, number] | null; jobs: JobMatch[]; score: number;
  sources: Source[]; rent_data_date: string;
};
export type View = {
  candidate: Candidate; question: Question | null; progress: number; areas: AreaMatch[]; jobs: JobMatch[];
  ready: boolean; message: string; ai: "off" | "available" | "used" | "fallback";
  partnerRoutesEnabled: boolean; totalJobs: number; totalNeighborhoods: number; datasetVersion: string;
};
