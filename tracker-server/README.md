# ShareLoc live tracker (server + spectator map)

Node 20 service, no npm dependencies. Receives telemetry from the ShareLoc AAOS app, enriches it with
HERE data (speed limit, road name, address, route to destination) and serves the public spectator page.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/position` | Telemetry upload from the car (`Authorization: Bearer <UPLOAD_TOKEN>`) |
| `GET` | `/track/<shareId>` | Spectator page (Škoda-styled map) |
| `GET` | `/api/v1/track/<shareId>/state` | Full snapshot incl. trail and route (JSON) |
| `GET` | `/api/v1/track/<shareId>/stream` | Server-sent events: `update`, `route`, `trip-reset` |
| `GET` | `/healthz` | Health check |

The upload payload is the one documented in `ShareLoc-AAOS/README.md`; an optional `navigation`
object (destination, ETA, remaining distance/time, SoC, charging stop) is accepted as well.

## Spectator page features

- Škoda Emerald/Electric Green theme on HERE `explore.night` raster tiles
- Vehicle cursor rotated by heading, pulsing while live; amber when stale, grey when offline
- Follow mode (default on) and heading-up mode; manual pan pauses following, "Re-centre" brings it back
- Speed with speed-limit sign (HERE Route Matching); amber/red when over the limit
- Trail coloured by speed relative to the limit, trip stats (distance, average, max, duration)
- Road name and town (HERE reverse geocoding), freshness ("3 s ago"), stale/offline banners
- Arrival card with destination, ETA, remaining distance/time, battery at arrival and planned
  charging stop, plus the remaining route drawn on the map (HERE Routing v8)

## Configuration (environment variables)

| Variable | Required | Description |
| --- | --- | --- |
| `UPLOAD_TOKEN` | yes | Bearer token the car must present |
| `PUBLIC_SHARE_ID` | yes | Share id in the public URL, mapped to `VEHICLE_ID` |
| `VEHICLE_ID` | no | Defaults to `IVI_001` |
| `SHARE_MAP` | no | Extra shares as JSON, e.g. `{"abc":"IVI_002"}` |
| `HERE_API_KEY` | recommended | Enables tiles, speed limits, addresses and routes |
| `STALE_AFTER_SECONDS` | no | Default 20 |
| `OFFLINE_AFTER_SECONDS` | no | Default 120 |
| `TRIP_GAP_MINUTES` | no | Gap that starts a new trip (default 10) |

State is kept in memory. With `--min-instances 1` on Cloud Run the trail survives between uploads;
without it a cold start only loses the trail history, the live position reappears with the next upload.

## Local run

```bash
cd tracker-server
cp .env.example .env            # fill in HERE_API_KEY
node src/server.js               # http://localhost:8080/track/local-demo
node scripts/simulate-drive.js   # posts a simulated drive every second
```

## Deploy to Cloud Run (Cloud Shell)

```bash
gcloud config set project sharloc-504610
PROJECT_NUMBER=$(gcloud projects describe sharloc-504610 --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Secrets (create once; paste the values when prompted)
read -rs -p "HERE API key: " HERE_KEY; echo
printf '%s' "$HERE_KEY" | gcloud secrets create HERE_API_KEY --data-file=- || \
printf '%s' "$HERE_KEY" | gcloud secrets versions add HERE_API_KEY --data-file=-
read -rs -p "Upload token (uploadToken from shareloc.properties): " TOKEN; echo
printf '%s' "$TOKEN" | gcloud secrets create SHARELOC_UPLOAD_TOKEN --data-file=- || \
printf '%s' "$TOKEN" | gcloud secrets versions add SHARELOC_UPLOAD_TOKEN --data-file=-
for s in HERE_API_KEY SHARELOC_UPLOAD_TOKEN; do
  gcloud secrets add-iam-policy-binding "$s" --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor
done

# Deploy from source
git clone https://github.com/r9git/onmyway.git && cd onmyway && git checkout cursor/skoda-ui-redesign-1bcc
gcloud run deploy antools-live-tracker \
  --source tracker-server \
  --region europe-west1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --set-env-vars VEHICLE_ID=IVI_001,PUBLIC_SHARE_ID=65c2b7ec6023084437f43967ea8bdc0f4cbb \
  --set-secrets UPLOAD_TOKEN=SHARELOC_UPLOAD_TOKEN:latest,HERE_API_KEY=HERE_API_KEY:latest
```

The service URL stays the same, so `shareloc.properties` in the app does not change.

## HERE usage notes

- Route Matching is called at most every 2.5 s and only after the car moved 20 m; reverse geocoding
  every 8 s / 120 m; routing every 45 s / 400 m or when the destination changes.
- The API key is embedded in the spectator page for map tiles. Restrict it to your domain in the
  HERE platform and rotate it if it was ever shared in plain text.
