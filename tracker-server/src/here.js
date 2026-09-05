import { config } from "./config.js";
import { haversineMeters } from "./geo.js";
import { store } from "./store.js";
import { decodeFlexPolyline } from "./flexpolyline.js";

const MATCH_MIN_INTERVAL_MS = 2500;
const MATCH_MIN_DISTANCE_M = 20;
const MATCH_MAX_AGE_MS = 15000;
const GEOCODE_MIN_INTERVAL_MS = 8000;
const GEOCODE_MIN_DISTANCE_M = 120;
const REQUEST_TIMEOUT_MS = 6000;

const perVehicle = new Map();

function state(vehicleId) {
  let s = perVehicle.get(vehicleId);
  if (!s) {
    s = {
      matchAt: 0, matchPoint: null, matchBusy: false,
      geocodeAt: 0, geocodePoint: null, geocodeBusy: false,
      routeAt: 0, routeOrigin: null, routeDestinationKey: null, routeBusy: false,
    };
    perVehicle.set(vehicleId, s);
  }
  return s;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseSpeedLimit(link) {
  const limits = link?.attributes?.SPEED_LIMITS_FCN?.[0];
  if (!limits) return null;
  // A negative linkId means the vehicle travels against the link's reference direction.
  const againstReference = String(link.linkId).startsWith("-");
  const primary = Number(againstReference ? limits.TO_REF_SPEED_LIMIT : limits.FROM_REF_SPEED_LIMIT);
  const secondary = Number(againstReference ? limits.FROM_REF_SPEED_LIMIT : limits.TO_REF_SPEED_LIMIT);
  let value = primary > 0 ? primary : secondary;
  if (!(value > 0)) return null;
  if (limits.SPEED_LIMIT_UNIT === "M") value = Math.round(value * 1.609344);
  return value >= 250 ? { speedLimitKmh: null, speedLimitUnlimited: true } : { speedLimitKmh: value, speedLimitUnlimited: false };
}

function parseRoadName(link) {
  const names = link?.attributes?.ROAD_NAME_FCN?.[0]?.NAMES;
  if (!names) return null;
  // Entries are separated by RS (0x1e): <lang3><type1><exonym1><name>. Prefer the base name.
  const entries = names.split("\u001e");
  const base = entries.find((entry) => entry.length > 5 && entry[3] === "B") ?? entries[0];
  return base.length > 5 ? base.slice(5) : null;
}

async function matchRoute(vehicle) {
  const s = state(vehicle.vehicleId);
  const latest = vehicle.latest;
  const now = Date.now();
  const moved = s.matchPoint ? haversineMeters(s.matchPoint, latest) : Infinity;
  if (s.matchBusy || now - s.matchAt < MATCH_MIN_INTERVAL_MS) return;
  if (moved < MATCH_MIN_DISTANCE_M && now - s.matchAt < MATCH_MAX_AGE_MS) return;

  s.matchBusy = true;
  s.matchAt = now;
  s.matchPoint = { lat: latest.lat, lon: latest.lon };
  try {
    const recent = vehicle.trail.slice(-6);
    if (!recent.length || recent[recent.length - 1] !== latest) recent.push(latest);
    const params = new URLSearchParams({
      apikey: config.hereApiKey,
      routeMatch: "1",
      mode: "fastest;car;traffic:disabled",
      attributes: "SPEED_LIMITS_FCn(*),ROAD_NAME_FCn(*)",
    });
    recent.forEach((p, i) => params.set(`waypoint${i}`, `${p.lat},${p.lon}`));
    const data = await fetchJson(`https://routematching.hereapi.com/v8/match/routelinks?${params}`);
    const route = data?.response?.route?.[0];
    const links = route?.leg?.[0]?.link ?? [];
    const lastWaypoint = route?.waypoint?.[route.waypoint.length - 1];
    const matchedId = lastWaypoint?.linkId?.replace("+", "");
    const link = links.find((l) => String(l.linkId).replace("+", "") === matchedId) ?? links[links.length - 1];
    if (!link) return;
    const limit = parseSpeedLimit(link) ?? { speedLimitKmh: null, speedLimitUnlimited: false };
    const roadName = parseRoadName(link);
    store.applyEnrichment(vehicle.vehicleId, { ...limit, ...(roadName ? { roadName } : {}) });
  } catch (error) {
    console.warn(`[here] route match failed for ${vehicle.vehicleId}: ${error.message}`);
  } finally {
    s.matchBusy = false;
  }
}

async function reverseGeocode(vehicle) {
  const s = state(vehicle.vehicleId);
  const latest = vehicle.latest;
  const now = Date.now();
  const moved = s.geocodePoint ? haversineMeters(s.geocodePoint, latest) : Infinity;
  if (s.geocodeBusy || now - s.geocodeAt < GEOCODE_MIN_INTERVAL_MS) return;
  if (moved < GEOCODE_MIN_DISTANCE_M) return;

  s.geocodeBusy = true;
  s.geocodeAt = now;
  s.geocodePoint = { lat: latest.lat, lon: latest.lon };
  try {
    const params = new URLSearchParams({ at: `${latest.lat},${latest.lon}`, lang: "en", apiKey: config.hereApiKey });
    const data = await fetchJson(`https://revgeocode.search.hereapi.com/v1/revgeocode?${params}`);
    const address = data?.items?.[0]?.address;
    if (!address) return;
    const patch = {
      address: {
        label: address.label ?? null,
        street: address.street ?? null,
        city: address.city ?? null,
        district: address.district ?? null,
        countryCode: address.countryCode ?? null,
      },
    };
    if (!vehicle.enrichment.roadName && address.street) patch.roadName = address.street;
    store.applyEnrichment(vehicle.vehicleId, patch);
  } catch (error) {
    console.warn(`[here] reverse geocode failed for ${vehicle.vehicleId}: ${error.message}`);
  } finally {
    s.geocodeBusy = false;
  }
}

const ROUTE_MIN_INTERVAL_MS = 45000;
const ROUTE_REFRESH_DISTANCE_M = 400;

async function refreshRoute(vehicle) {
  const s = state(vehicle.vehicleId);
  const latest = vehicle.latest;
  const destination = vehicle.navigation?.destination;
  if (!destination || destination.lat == null || destination.lon == null) return;
  const now = Date.now();
  const moved = s.routeOrigin ? haversineMeters(s.routeOrigin, latest) : Infinity;
  const destinationKey = `${destination.lat},${destination.lon}`;
  const sameDestination = s.routeDestinationKey === destinationKey;
  if (s.routeBusy) return;
  if (sameDestination && vehicle.route && now - s.routeAt < ROUTE_MIN_INTERVAL_MS && moved < ROUTE_REFRESH_DISTANCE_M) return;
  if (sameDestination && vehicle.route && now - s.routeAt < 5000) return;

  s.routeBusy = true;
  s.routeAt = now;
  s.routeOrigin = { lat: latest.lat, lon: latest.lon };
  s.routeDestinationKey = destinationKey;
  try {
    const params = new URLSearchParams({
      apikey: config.hereApiKey,
      transportMode: "car",
      origin: `${latest.lat},${latest.lon}`,
      destination: `${destination.lat},${destination.lon}`,
      return: "polyline,summary",
    });
    const stop = vehicle.navigation?.chargingStop;
    if (stop?.lat != null && stop?.lon != null) params.set("via", `${stop.lat},${stop.lon}`);
    const data = await fetchJson(`https://router.hereapi.com/v8/routes?${params}`);
    const sections = data?.routes?.[0]?.sections ?? [];
    if (!sections.length) return;
    const coordinates = sections.flatMap((section) => decodeFlexPolyline(section.polyline));
    const lengthMeters = sections.reduce((sum, section) => sum + (section.summary?.length ?? 0), 0);
    const durationSeconds = sections.reduce((sum, section) => sum + (section.summary?.duration ?? 0), 0);
    store.setRoute(vehicle.vehicleId, { coordinates, lengthMeters, durationSeconds, updatedAt: Date.now() });
  } catch (error) {
    console.warn(`[here] routing failed for ${vehicle.vehicleId}: ${error.message}`);
  } finally {
    s.routeBusy = false;
  }
}

export function startHereEnrichment() {
  if (!config.hereApiKey) return;
  store.on("update", (vehicle) => {
    if (!vehicle.latest) return;
    void matchRoute(vehicle);
    void reverseGeocode(vehicle);
    void refreshRoute(vehicle);
  });
}
