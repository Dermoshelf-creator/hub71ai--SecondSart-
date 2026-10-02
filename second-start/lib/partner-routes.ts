import type { Neighborhood } from "./types.ts";
export type PartnerRoute = { neighborhoodId: string; morning: number | null; evening: number | null };
type Element = { originIndex?: number; destinationIndex?: number; status?: { code?: number }; condition?: string; duration?: string };
export function matrixDuration(e: Element | undefined): number | null {
  if (!e || (e.status?.code ?? 0) !== 0 || e.condition !== "ROUTE_EXISTS" || !/^\d+(?:\.\d+)?s$/.test(e.duration ?? "")) return null;
  return Number(e.duration!.slice(0, -1)) / 60;
}
export async function computePartnerRoutes(neighborhoods: Neighborhood[], workplace: string, key: string): Promise<{ routes: PartnerRoute[]; date: string; attribution: string }> {
  // Use the next business day, so both departure times are in the future.
  const future = new Date(Date.now() + 86400000);
  let date = future.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  while ([0, 6].includes(new Date(date + "T12:00:00+04:00").getUTCDay())) { future.setUTCDate(future.getUTCDate() + 1); date = future.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" }); }
  const homes = neighborhoods.map(n => ({ waypoint: { address: `${n.name}, Abu Dhabi, United Arab Emirates` } }));
  const partner = [{ waypoint: { address: workplace } }];
  async function matrix(reverse: boolean): Promise<Element[]> {
    const response = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", { method: "POST", signal: AbortSignal.timeout(7000), headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,duration" }, body: JSON.stringify({ origins: reverse ? partner : homes, destinations: reverse ? homes : partner, travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE", departureTime: new Date(`${date}T${reverse ? "18" : "08"}:00:00+04:00`).toISOString() }) });
    if (!response.ok) throw new Error("Partner routes unavailable. Check the Maps key, billing and Routes API access.");
    const elements = await response.json(); if (!Array.isArray(elements)) throw new Error("Unexpected Routes response"); return elements as Element[];
  }
  const [morning, evening] = await Promise.all([matrix(false), matrix(true)]);
  return { date, attribution: `Powered by Google, ©${new Date().getFullYear()} Google`, routes: neighborhoods.map((n, i) => ({ neighborhoodId: n.id, morning: matrixDuration(morning.find(e => (e.originIndex ?? 0) === i && (e.destinationIndex ?? 0) === 0)), evening: matrixDuration(evening.find(e => (e.destinationIndex ?? 0) === i && (e.originIndex ?? 0) === 0)) })) };
}
