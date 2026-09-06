(() => {
  const boot = window.__TRACK__ || {};
  const ELECTRIC = "#78FAAE";
  const AMBER = "#FFC857";
  const RED = "#FF6B6B";

  const el = (id) => document.getElementById(id);
  const ui = {
    vehicleId: el("vehicleId"),
    statusPill: el("statusPill"),
    statusText: el("statusText"),
    statusAge: el("statusAge"),
    banner: el("banner"),
    panel: el("panel"),
    speedValue: el("speedValue"),
    roadName: el("roadName"),
    address: el("address"),
    limitSign: el("limitSign"),
    limitValue: el("limitValue"),
    statDistance: el("statDistance"),
    statAvg: el("statAvg"),
    statMax: el("statMax"),
    statDuration: el("statDuration"),
    coords: el("coords"),
    btnFollow: el("btnFollow"),
    btnHeading: el("btnHeading"),
    btnFit: el("btnFit"),
    btnZoomIn: el("btnZoomIn"),
    btnZoomOut: el("btnZoomOut"),
    btnRecenter: el("btnRecenter"),
    btnCopy: el("btnCopy"),
    navCard: el("navCard"),
    navName: el("navName"),
    navAddress: el("navAddress"),
    navEta: el("navEta"),
    navRemaining: el("navRemaining"),
    navSoc: el("navSoc"),
    navCharging: el("navCharging"),
  };

  ui.vehicleId.textContent = boot.vehicleId ? `Vehicle ${boot.vehicleId}` : "Live vehicle location";

  const state = {
    follow: true,
    headingUp: false,
    serverOffsetMs: 0,
    snapshot: null,
    trail: [],
    route: null,
    hasCentered: false,
    programmaticMove: false,
  };

  // ---------- Map ----------
  const tileUrl = boot.hereApiKey
    ? `https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png8?apiKey=${encodeURIComponent(boot.hereApiKey)}&style=explore.night&size=512&lang=en`
    : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileSize = boot.hereApiKey ? 512 : 256;
  const attribution = boot.hereApiKey ? "© HERE" : "© OpenStreetMap contributors";

  const map = new maplibregl.Map({
    container: "map",
    center: [14.9013, 50.4127],
    zoom: 6,
    attributionControl: false,
    style: {
      version: 8,
      sources: { base: { type: "raster", tiles: [tileUrl], tileSize, attribution } },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#071F19" } },
        { id: "base", type: "raster", source: "base", paint: { "raster-saturation": -0.45, "raster-brightness-max": 0.9, "raster-contrast": 0.05 } },
        { id: "tint", type: "background", paint: { "background-color": "#0E3A2F", "background-opacity": 0.3 } },
      ],
    },
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
  map.touchZoomRotate.disableRotation();

  const emptyFC = () => ({ type: "FeatureCollection", features: [] });

  map.on("load", () => {
    map.addSource("route", { type: "geojson", data: emptyFC() });
    map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#071F19", "line-width": 9, "line-opacity": 0.8 } });
    map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#9FBDB2", "line-width": 4.5, "line-dasharray": [1.6, 1.2] } });

    map.addSource("trail", { type: "geojson", data: emptyFC() });
    map.addLayer({ id: "trail-glow", type: "line", source: "trail", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 12, "line-opacity": 0.22, "line-blur": 4 } });
    map.addLayer({ id: "trail", type: "line", source: "trail", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 4.5, "line-opacity": 0.95 } });
    if (state.snapshot) render(state.snapshot);
  });

  // ---------- Vehicle marker ----------
  const markerEl = document.createElement("div");
  markerEl.className = "vehicle-marker";
  markerEl.dataset.status = "waiting";
  markerEl.innerHTML = `
    <div class="pulse"></div>
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <circle cx="48" cy="48" r="40" fill="rgba(120,250,174,0.16)"/>
      <circle cx="48" cy="48" r="40" fill="none" stroke="#78FAAE" stroke-opacity=".5" stroke-width="1.5"/>
      <path d="M48 14 L70 72 L48 60 L26 72 Z" fill="#071F19"/>
      <path class="arrow" d="M48 20 L65 67 L48 57.5 L31 67 Z"/>
      <path d="M48 20 L48 57.5 L31 67 Z" fill="#0E3A2F" fill-opacity=".35"/>
    </svg>`;
  const marker = new maplibregl.Marker({ element: markerEl, rotationAlignment: "map", pitchAlignment: "map" });

  const destEl = document.createElement("div");
  destEl.className = "dest-marker";
  destEl.innerHTML = `<svg viewBox="0 0 54 54" aria-hidden="true"><path fill="#78FAAE" d="M27 2C16.5 2 8 10.5 8 21c0 14.1 19 31 19 31s19-16.9 19-31C46 10.5 37.5 2 27 2z"/><circle cx="27" cy="21" r="9" fill="#0E3A2F"/><path d="M22 21h10M27 16v10" stroke="#78FAAE" stroke-width="3" stroke-linecap="round" fill="none"/></svg>`;
  const destMarker = new maplibregl.Marker({ element: destEl, anchor: "bottom" });
  let destShown = false;

  // ---------- Helpers ----------
  const fmtSpeed = (v) => (v == null ? "—" : String(Math.round(v)));
  const fmtDistance = (m) => (m == null ? "—" : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
  const fmtDuration = (ms) => {
    if (ms == null) return "—";
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  };
  const fmtMinutes = (sec) => {
    if (sec == null) return "—";
    const m = Math.round(sec / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
  };
  const fmtClock = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
  const now = () => Date.now() + state.serverOffsetMs;

  function segmentColor(speed, limit) {
    if (speed == null) return ELECTRIC;
    if (limit) {
      const ratio = speed / limit;
      return ratio <= 1.02 ? ELECTRIC : ratio <= 1.15 ? AMBER : RED;
    }
    const t = Math.min(1, Math.max(0, speed / 130));
    return t < 0.5 ? "#3FBF7E" : ELECTRIC;
  }

  function trailGeoJson() {
    const features = [];
    for (let i = 1; i < state.trail.length; i++) {
      const a = state.trail[i - 1];
      const b = state.trail[i];
      features.push({
        type: "Feature",
        properties: { color: segmentColor(b.speedKmh, b.speedLimitKmh) },
        geometry: { type: "LineString", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
      });
    }
    return { type: "FeatureCollection", features };
  }

  function overLimitLevel(speed, limit) {
    if (speed == null || !limit) return "none";
    if (speed > limit * 1.15 + 2) return "hard";
    if (speed > limit + 3) return "soft";
    return "none";
  }

  function setFollow(on) {
    state.follow = on;
    ui.btnFollow.classList.toggle("active", on);
    ui.btnFollow.setAttribute("aria-pressed", String(on));
    ui.btnRecenter.hidden = on || !state.snapshot?.latest;
    if (on) centerOnVehicle(true);
  }

  function centerOnVehicle(animated) {
    const latest = state.snapshot?.latest;
    if (!latest) return;
    state.programmaticMove = true;
    const options = {
      center: [latest.lon, latest.lat],
      bearing: state.headingUp ? latest.bearing ?? 0 : 0,
      pitch: state.headingUp ? 48 : 0,
      duration: animated ? 900 : 0,
      essential: true,
    };
    if (!state.hasCentered || map.getZoom() < 10) {
      options.zoom = 16;
      state.hasCentered = true;
    } else if (state.headingUp && map.getZoom() < 15) {
      options.zoom = 16.5;
    }
    if (!map.isStyleLoaded() || !animated) {
      map.jumpTo(options);
      state.programmaticMove = false;
      return;
    }
    map.easeTo(options);
    map.once("moveend", () => { state.programmaticMove = false; });
  }

  function userInteracted() {
    if (state.programmaticMove || !state.follow) return;
    setFollow(false);
  }
  map.on("dragstart", userInteracted);
  map.on("wheel", userInteracted);
  map.on("touchstart", (e) => { if (e.points?.length > 1) userInteracted(); });

  // ---------- Rendering ----------
  function render(snapshot) {
    state.snapshot = snapshot;
    state.serverOffsetMs = snapshot.serverTime - Date.now();
    const latest = snapshot.latest;
    const enrichment = snapshot.enrichment || {};
    const trip = snapshot.trip;

    ui.statusPill.dataset.status = snapshot.status;
    markerEl.dataset.status = snapshot.status;
    ui.statusText.textContent = { live: "Live", stale: "Signal lost", offline: "Sharing stopped", waiting: "Waiting for vehicle" }[snapshot.status] || snapshot.status;
    renderAge();

    if (!latest) {
      ui.roadName.textContent = "Waiting for the first position…";
      return;
    }

    ui.speedValue.textContent = fmtSpeed(latest.speedKmh);
    ui.panel.dataset.over = overLimitLevel(latest.speedKmh, enrichment.speedLimitKmh);
    document.body.dataset.over = ui.panel.dataset.over;

    if (enrichment.speedLimitUnlimited) {
      ui.limitSign.hidden = false;
      ui.limitSign.classList.add("unlimited");
      ui.limitValue.textContent = "∞";
    } else if (enrichment.speedLimitKmh) {
      ui.limitSign.hidden = false;
      ui.limitSign.classList.remove("unlimited");
      ui.limitValue.textContent = String(enrichment.speedLimitKmh);
    } else {
      ui.limitSign.hidden = true;
    }

    let road = enrichment.roadName || enrichment.address?.street;
    if (road && /^[\dA-Z]{1,6}$/.test(road)) road = enrichment.address?.street ? `${enrichment.address.street} (${road})` : `Road ${road}`;
    ui.roadName.textContent = road || (snapshot.status === "live" ? "On the road" : "Last known position");
    const place = [enrichment.address?.district && enrichment.address.district !== enrichment.address.city ? enrichment.address.district : null, enrichment.address?.city]
      .filter(Boolean).join(", ");
    ui.address.textContent = place || "";
    ui.coords.textContent = `${latest.lat.toFixed(5)}, ${latest.lon.toFixed(5)}${latest.accuracyMeters != null ? ` · ±${Math.round(latest.accuracyMeters)} m` : ""}`;

    if (trip) {
      ui.statDistance.textContent = fmtDistance(trip.distanceMeters);
      ui.statAvg.textContent = trip.averageSpeedKmh ? `${Math.round(trip.averageSpeedKmh)} km/h` : "—";
      ui.statMax.textContent = trip.maxSpeedKmh ? `${Math.round(trip.maxSpeedKmh)} km/h` : "—";
      ui.statDuration.textContent = fmtDuration(trip.durationMs);
    }

    marker.setLngLat([latest.lon, latest.lat]).setRotation(latest.bearing ?? 0);
    if (!marker._map) marker.addTo(map);

    const last = state.trail[state.trail.length - 1];
    if (!last || last.receivedAt !== latest.receivedAt) {
      if (!last || Math.abs(last.lat - latest.lat) > 1e-6 || Math.abs(last.lon - latest.lon) > 1e-6) state.trail.push(latest);
    }
    if (map.getSource("trail")) map.getSource("trail").setData(trailGeoJson());

    if ("route" in snapshot) state.route = snapshot.route;
    renderNavigation(snapshot.navigation, state.route);
    renderBanner(snapshot);

    if (state.follow) centerOnVehicle(true);
    ui.btnRecenter.hidden = state.follow;
  }

  function renderNavigation(nav, route) {
    if (!ui.navCard) return;
    if (!nav || !nav.destination) {
      ui.navCard.hidden = true;
      if (destShown) { destMarker.remove(); destShown = false; }
      if (map.getSource("route")) map.getSource("route").setData(emptyFC());
      return;
    }
    ui.navCard.hidden = false;
    ui.navName.textContent = nav.destination.name || "Destination";
    ui.navAddress.textContent = nav.destination.address || "";
    ui.navEta.textContent = fmtClock(nav.etaEpochMs);
    ui.navRemaining.textContent = `${fmtDistance(nav.remainingMeters)} · ${fmtMinutes(nav.remainingSeconds)}`;
    if (nav.socPercent != null || nav.arrivalSocPercent != null) {
      ui.navSoc.hidden = false;
      ui.navSoc.textContent = nav.socPercent != null && nav.arrivalSocPercent != null
        ? `Battery ${Math.round(nav.socPercent)}% → ${Math.round(nav.arrivalSocPercent)}% at arrival`
        : nav.socPercent != null ? `Battery ${Math.round(nav.socPercent)}%` : `${Math.round(nav.arrivalSocPercent)}% at arrival`;
    } else {
      ui.navSoc.hidden = true;
    }
    if (nav.chargingStop?.name) {
      ui.navCharging.hidden = false;
      ui.navCharging.textContent = `⚡ ${nav.chargingStop.name} in ${fmtDistance(nav.chargingStop.distanceMeters)}${nav.chargingStop.chargingSeconds ? ` · ${fmtMinutes(nav.chargingStop.chargingSeconds)} charge` : ""}`;
    } else {
      ui.navCharging.hidden = true;
    }
    if (nav.destination.lat != null && nav.destination.lon != null) {
      destMarker.setLngLat([nav.destination.lon, nav.destination.lat]);
      if (!destShown) { destMarker.addTo(map); destShown = true; }
    }
    if (map.getSource("route")) {
      map.getSource("route").setData(route?.coordinates?.length
        ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.coordinates } }] }
        : emptyFC());
    }
  }

  function renderBanner(snapshot) {
    const latest = snapshot.latest;
    if (snapshot.status === "offline" && latest) {
      ui.banner.hidden = false;
      ui.banner.dataset.tone = "error";
      ui.banner.textContent = `Sharing stopped · last seen ${new Date(latest.receivedAt).toLocaleTimeString()}`;
    } else if (snapshot.status === "stale") {
      ui.banner.hidden = false;
      ui.banner.dataset.tone = "warn";
      ui.banner.textContent = "No update from the vehicle for a while. Showing the last known position.";
    } else {
      ui.banner.hidden = true;
    }
  }

  function renderAge() {
    const latest = state.snapshot?.latest;
    if (!latest) { ui.statusAge.textContent = ""; return; }
    const age = Math.max(0, Math.round((now() - latest.receivedAt) / 1000));
    ui.statusAge.textContent = age < 2 ? "· just now" : age < 60 ? `· ${age} s ago` : age < 3600 ? `· ${Math.floor(age / 60)} min ago` : `· ${new Date(latest.receivedAt).toLocaleTimeString()}`;
  }
  setInterval(renderAge, 1000);

  // ---------- Controls ----------
  ui.btnFollow.addEventListener("click", () => setFollow(!state.follow));
  ui.btnRecenter.addEventListener("click", () => setFollow(true));
  ui.btnHeading.addEventListener("click", () => {
    state.headingUp = !state.headingUp;
    ui.btnHeading.classList.toggle("active", state.headingUp);
    ui.btnHeading.setAttribute("aria-pressed", String(state.headingUp));
    if (!state.follow) setFollow(true); else centerOnVehicle(true);
  });
  ui.btnFit.addEventListener("click", () => {
    const points = state.trail.map((p) => [p.lon, p.lat]);
    if (state.snapshot?.navigation?.destination?.lon != null) points.push([state.snapshot.navigation.destination.lon, state.snapshot.navigation.destination.lat]);
    if (points.length < 2) return;
    setFollow(false);
    const bounds = points.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(points[0], points[0]));
    state.programmaticMove = true;
    map.fitBounds(bounds, { padding: { top: 110, bottom: 240, left: 40, right: 80 }, bearing: 0, pitch: 0, duration: 900 });
    map.once("moveend", () => { state.programmaticMove = false; });
  });
  ui.btnZoomIn.addEventListener("click", () => { state.programmaticMove = true; map.zoomIn(); map.once("moveend", () => { state.programmaticMove = false; }); });
  ui.btnZoomOut.addEventListener("click", () => { state.programmaticMove = true; map.zoomOut(); map.once("moveend", () => { state.programmaticMove = false; }); });
  ui.btnCopy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      ui.btnCopy.textContent = "Copied";
      setTimeout(() => (ui.btnCopy.textContent = "Copy link"), 1500);
    } catch {
      prompt("Tracking link", location.href);
    }
  });

  // ---------- Data ----------
  const base = `/api/v1/track/${encodeURIComponent(boot.shareId)}`;

  async function loadState() {
    const response = await fetch(`${base}/state`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.json();
    state.trail = snapshot.trail || [];
    state.route = snapshot.route || null;
    render(snapshot);
  }

  function connectStream() {
    if (!("EventSource" in window)) {
      setInterval(() => loadState().catch(() => {}), 3000);
      return;
    }
    const source = new EventSource(`${base}/stream`);
    source.addEventListener("update", (event) => render(JSON.parse(event.data)));
    source.addEventListener("trip-reset", (event) => {
      state.trail = [];
      render(JSON.parse(event.data));
    });
    source.addEventListener("route", (event) => {
      state.route = JSON.parse(event.data).route;
      if (state.snapshot) renderNavigation(state.snapshot.navigation, state.route);
    });
    source.onerror = () => {
      ui.statusText.textContent = "Reconnecting…";
      // EventSource reconnects on its own; refresh the full state to catch up on missed points.
      setTimeout(() => loadState().catch(() => {}), 2000);
    };
  }

  loadState()
    .catch((error) => {
      ui.banner.hidden = false;
      ui.banner.dataset.tone = "error";
      ui.banner.textContent = `Could not load tracking data (${error.message}).`;
    })
    .finally(connectStream);
})();
