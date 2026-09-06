import { EventEmitter } from "node:events";
import { config } from "./config.js";
import { bearingDegrees, haversineMeters } from "./geo.js";

const MOVING_SPEED_KMH = 3;

function newTrip(startedAt) {
  return {
    startedAt,
    distanceMeters: 0,
    movingMs: 0,
    maxSpeedKmh: 0,
    pointCount: 0,
  };
}

function newVehicle(vehicleId) {
  return {
    vehicleId,
    latest: null,
    trail: [],
    trip: null,
    navigation: null,
    route: null,
    enrichment: {
      speedLimitKmh: null,
      speedLimitUnlimited: false,
      roadName: null,
      address: null,
      updatedAt: null,
    },
  };
}

class TrackingStore extends EventEmitter {
  constructor() {
    super();
    this.vehicles = new Map();
  }

  vehicleForShare(shareId) {
    const vehicleId = config.shares.get(shareId);
    return vehicleId ? this.vehicle(vehicleId) : null;
  }

  vehicle(vehicleId) {
    let vehicle = this.vehicles.get(vehicleId);
    if (!vehicle) {
      vehicle = newVehicle(vehicleId);
      this.vehicles.set(vehicleId, vehicle);
    }
    return vehicle;
  }

  ingest(payload, receivedAt = Date.now()) {
    const vehicle = this.vehicle(payload.vehicleId);
    const previous = vehicle.latest;
    const point = {
      lat: payload.latitude,
      lon: payload.longitude,
      speedKmh: payload.speedKmh,
      bearing: payload.bearing,
      accuracyMeters: payload.accuracyMeters,
      source: payload.source,
      timestamp: payload.timestamp,
      receivedAt,
      speedLimitKmh: null,
    };

    if (!vehicle.trip || (previous && receivedAt - previous.receivedAt > config.tripGapMs)) {
      vehicle.trip = newTrip(receivedAt);
      vehicle.trail = [];
      previous && this.emit("trip-reset", vehicle);
    }

    if (previous) {
      const distance = haversineMeters(previous, point);
      const elapsedMs = Math.max(0, receivedAt - previous.receivedAt);
      // Ignore GNSS jitter below 1.5 m so a parked car does not accumulate distance.
      if (distance >= 1.5) vehicle.trip.distanceMeters += distance;
      const speed = point.speedKmh ?? (elapsedMs > 0 ? (distance / elapsedMs) * 3600 : 0);
      if (speed >= MOVING_SPEED_KMH) vehicle.trip.movingMs += elapsedMs;
      if (point.bearing == null && distance >= 3) point.bearing = bearingDegrees(previous, point);
    }
    if (point.bearing == null && previous?.bearing != null) point.bearing = previous.bearing;

    if (payload.navigation !== undefined) {
      const previousDestination = vehicle.navigation?.destination;
      vehicle.navigation = payload.navigation;
      const nextDestination = payload.navigation?.destination;
      if (!nextDestination || previousDestination?.lat !== nextDestination.lat || previousDestination?.lon !== nextDestination.lon) {
        vehicle.route = null;
        this.emit("route", vehicle);
      }
    }

    point.speedLimitKmh = vehicle.enrichment.speedLimitKmh;
    if (point.speedKmh != null) vehicle.trip.maxSpeedKmh = Math.max(vehicle.trip.maxSpeedKmh, point.speedKmh);
    vehicle.trip.pointCount += 1;
    vehicle.latest = point;

    const last = vehicle.trail[vehicle.trail.length - 1];
    if (!last || haversineMeters(last, point) >= 2 || receivedAt - last.receivedAt >= 5000) {
      vehicle.trail.push(point);
      if (vehicle.trail.length > config.maxTrailPoints) vehicle.trail.splice(0, vehicle.trail.length - config.maxTrailPoints);
    }

    this.emit("update", vehicle);
    return vehicle;
  }

  applyEnrichment(vehicleId, patch) {
    const vehicle = this.vehicle(vehicleId);
    Object.assign(vehicle.enrichment, patch, { updatedAt: Date.now() });
    if (vehicle.latest && patch.speedLimitKmh !== undefined) vehicle.latest.speedLimitKmh = patch.speedLimitKmh;
    this.emit("update", vehicle);
  }

  setRoute(vehicleId, route) {
    const vehicle = this.vehicle(vehicleId);
    vehicle.route = route;
    this.emit("route", vehicle);
  }

  status(vehicle, now = Date.now()) {
    if (!vehicle.latest) return "waiting";
    const age = now - vehicle.latest.receivedAt;
    if (age > config.offlineAfterMs) return "offline";
    if (age > config.staleAfterMs) return "stale";
    return "live";
  }

  snapshot(vehicle, { includeTrail = false, includeRoute = false } = {}) {
    const now = Date.now();
    const trip = vehicle.trip
      ? {
          ...vehicle.trip,
          averageSpeedKmh: vehicle.trip.movingMs > 0 ? (vehicle.trip.distanceMeters / vehicle.trip.movingMs) * 3600 : 0,
          durationMs: (vehicle.latest?.receivedAt ?? now) - vehicle.trip.startedAt,
        }
      : null;
    return {
      vehicleId: vehicle.vehicleId,
      serverTime: now,
      status: this.status(vehicle, now),
      latest: vehicle.latest,
      enrichment: vehicle.enrichment,
      trip,
      navigation: vehicle.navigation,
      ...(includeTrail ? { trail: vehicle.trail } : {}),
      ...(includeRoute ? { route: vehicle.route } : {}),
    };
  }
}

export const store = new TrackingStore();
