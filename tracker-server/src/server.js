import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { store } from "./store.js";
import { startHereEnrichment } from "./here.js";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const sseClients = new Map(); // shareId -> Set<ServerResponse>

function sendJson(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(data);
}

function tokenMatches(header) {
  if (!config.uploadToken || !header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7).trim());
  const expected = Buffer.from(config.uploadToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value, max = 160) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function validateNavigation(raw) {
  if (raw === null) return null;
  if (typeof raw !== "object") return undefined;
  const destLat = finiteOrNull(raw.destination?.lat);
  const destLon = finiteOrNull(raw.destination?.lon);
  const destination = raw.destination
    ? { name: text(raw.destination.name), address: text(raw.destination.address, 240), lat: destLat, lon: destLon }
    : null;
  if (!destination?.name && destLat === null) return null;
  const stop = raw.chargingStop && typeof raw.chargingStop === "object"
    ? {
        name: text(raw.chargingStop.name),
        distanceMeters: finiteOrNull(raw.chargingStop.distanceMeters),
        chargingSeconds: finiteOrNull(raw.chargingStop.chargingSeconds),
        lat: finiteOrNull(raw.chargingStop.lat),
        lon: finiteOrNull(raw.chargingStop.lon),
      }
    : null;
  return {
    destination,
    etaEpochMs: finiteOrNull(raw.etaEpochMs),
    remainingMeters: finiteOrNull(raw.remainingMeters),
    remainingSeconds: finiteOrNull(raw.remainingSeconds),
    socPercent: finiteOrNull(raw.socPercent),
    arrivalSocPercent: finiteOrNull(raw.arrivalSocPercent),
    chargingStop: stop?.name ? stop : null,
    updatedAt: Date.now(),
  };
}

function validatePosition(raw) {
  const latitude = finiteOrNull(raw.latitude);
  const longitude = finiteOrNull(raw.longitude);
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw Object.assign(new Error("latitude/longitude are required numbers"), { status: 400 });
  }
  const vehicleId = typeof raw.vehicleId === "string" && raw.vehicleId.trim() ? raw.vehicleId.trim().slice(0, 64) : null;
  if (!vehicleId) throw Object.assign(new Error("vehicleId is required"), { status: 400 });
  const timestamp = finiteOrNull(raw.timestamp);
  return {
    vehicleId,
    latitude,
    longitude,
    speedKmh: finiteOrNull(raw.speedKmh),
    bearing: finiteOrNull(raw.bearing),
    accuracyMeters: finiteOrNull(raw.accuracyMeters),
    source: typeof raw.source === "string" ? raw.source.slice(0, 120) : "unknown",
    timestamp: timestamp && timestamp > 0 ? timestamp : Date.now(),
    ...("navigation" in raw ? { navigation: validateNavigation(raw.navigation) } : {}),
  };
}

async function handlePosition(req, res) {
  if (!tokenMatches(req.headers.authorization)) return sendJson(res, 401, { error: "invalid upload token" });
  let payload;
  try {
    payload = validatePosition(JSON.parse(await readBody(req)));
  } catch (error) {
    return sendJson(res, error.status ?? 400, { error: error.message || "invalid JSON" });
  }
  const vehicle = store.ingest(payload);
  sendJson(res, 200, { ok: true, receivedAt: vehicle.latest.receivedAt, status: store.status(vehicle) });
}

function handleState(res, shareId) {
  const vehicle = store.vehicleForShare(shareId);
  if (!vehicle) return sendJson(res, 404, { error: "unknown share" });
  sendJson(res, 200, store.snapshot(vehicle, { includeTrail: true, includeRoute: true }));
}

function handleStream(req, res, shareId) {
  const vehicle = store.vehicleForShare(shareId);
  if (!vehicle) return sendJson(res, 404, { error: "unknown share" });
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: 3000\n\n`);
  res.write(`event: update\ndata: ${JSON.stringify(store.snapshot(vehicle))}\n\n`);

  let clients = sseClients.get(shareId);
  if (!clients) sseClients.set(shareId, (clients = new Set()));
  clients.add(res);
  const heartbeat = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

function broadcast(vehicle, eventName, data = store.snapshot(vehicle)) {
  for (const [shareId, vehicleId] of config.shares) {
    if (vehicleId !== vehicle.vehicleId) continue;
    const clients = sseClients.get(shareId);
    if (!clients?.size) continue;
    const frame = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) client.write(frame);
  }
}

// Re-emit status changes (live -> stale -> offline) even when no new fix arrives.
const lastStatus = new Map();
setInterval(() => {
  for (const vehicle of store.vehicles.values()) {
    const status = store.status(vehicle);
    if (lastStatus.get(vehicle.vehicleId) !== status) {
      lastStatus.set(vehicle.vehicleId, status);
      broadcast(vehicle, "update");
    }
  }
}, 2000);

store.on("update", (vehicle) => {
  lastStatus.set(vehicle.vehicleId, store.status(vehicle));
  broadcast(vehicle, "update");
});
store.on("trip-reset", (vehicle) => broadcast(vehicle, "trip-reset"));
store.on("route", (vehicle) => broadcast(vehicle, "route", { route: vehicle.route }));

let trackTemplate = null;
async function handleTrackPage(res, shareId) {
  const vehicle = store.vehicleForShare(shareId);
  if (!vehicle) return notFound(res);
  trackTemplate ??= await readFile(join(publicDir, "track.html"), "utf8");
  const bootstrap = {
    shareId,
    vehicleId: vehicle.vehicleId,
    hereApiKey: config.hereApiKey,
    staleAfterMs: config.staleAfterMs,
    offlineAfterMs: config.offlineAfterMs,
  };
  const html = trackTemplate.replace("/*__BOOTSTRAP__*/", `window.__TRACK__=${JSON.stringify(bootstrap).replace(/</g, "\\u003c")};`);
  res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
  res.end(html);
}

function serveStatic(res, urlPath) {
  const relative = normalize(urlPath.replace(/^\/static\//, "")).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, relative);
  if (!filePath.startsWith(publicDir) || !existsSync(filePath) || !statSync(filePath).isFile()) return notFound(res);
  res.writeHead(200, {
    "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
    "Cache-Control": "public, max-age=300",
  });
  createReadStream(filePath).pipe(res);
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  try {
    if (req.method === "POST" && path === "/api/v1/position") return await handlePosition(req, res);
    if (req.method === "GET" || req.method === "HEAD") {
      // Note: Google Frontend answers /healthz itself on run.app domains, so use a namespaced path.
      if (path === "/api/v1/health" || path === "/healthz") return sendJson(res, 200, { ok: true, vehicles: store.vehicles.size });
      let match = path.match(/^\/api\/v1\/track\/([^/]+)\/state$/);
      if (match) return handleState(res, decodeURIComponent(match[1]));
      match = path.match(/^\/api\/v1\/track\/([^/]+)\/stream$/);
      if (match) return handleStream(req, res, decodeURIComponent(match[1]));
      match = path.match(/^\/track\/([^/]+)\/?$/);
      if (match) return await handleTrackPage(res, decodeURIComponent(match[1]));
      if (path.startsWith("/static/")) return serveStatic(res, path);
      if (path === "/") {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("ShareLoc live tracker");
      }
    }
    notFound(res);
  } catch (error) {
    console.error(`${req.method} ${path} failed:`, error);
    if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    else res.end();
  }
});

startHereEnrichment();
server.listen(config.port, () => {
  console.log(`ShareLoc tracker listening on :${config.port} (shares: ${[...config.shares.keys()].join(", ") || "none"})`);
});
