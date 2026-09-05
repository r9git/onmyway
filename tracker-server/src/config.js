import { readFileSync } from "node:fs";

function loadDotEnv() {
  if (process.env.NODE_ENV === "production") return;
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
    }
  } catch {
    // no .env file; rely on the real environment
  }
}

loadDotEnv();

function number(name, fallback) {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseShareMap() {
  const shares = new Map();
  const vehicleId = process.env.VEHICLE_ID || "IVI_001";
  if (process.env.PUBLIC_SHARE_ID) shares.set(process.env.PUBLIC_SHARE_ID, vehicleId);
  if (process.env.SHARE_MAP) {
    try {
      for (const [shareId, vehicle] of Object.entries(JSON.parse(process.env.SHARE_MAP))) {
        shares.set(String(shareId), String(vehicle));
      }
    } catch (error) {
      console.error("SHARE_MAP is not valid JSON:", error.message);
    }
  }
  return shares;
}

export const config = {
  port: number("PORT", 8080),
  uploadToken: process.env.UPLOAD_TOKEN || "",
  hereApiKey: process.env.HERE_API_KEY || "",
  shares: parseShareMap(),
  staleAfterMs: number("STALE_AFTER_SECONDS", 20) * 1000,
  offlineAfterMs: number("OFFLINE_AFTER_SECONDS", 120) * 1000,
  tripGapMs: number("TRIP_GAP_MINUTES", 10) * 60 * 1000,
  maxTrailPoints: number("MAX_TRAIL_POINTS", 3000),
};

if (!config.uploadToken) console.warn("UPLOAD_TOKEN is empty: all position uploads will be rejected.");
if (!config.hereApiKey) console.warn("HERE_API_KEY is empty: map tiles, speed limits and addresses are disabled.");
if (config.shares.size === 0) console.warn("No shares configured: set PUBLIC_SHARE_ID (and optionally SHARE_MAP).");
