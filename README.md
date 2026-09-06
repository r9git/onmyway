# ShareLoc demo – live vehicle location from a Škoda IVI

Two parts:

| Folder | What it is |
| --- | --- |
| `ShareLoc-AAOS/` | Android Automotive app for the Škoda IVI emulator. Streams GNSS position (and, optionally, navi route guidance) to the tracker and shows a QR/link for spectators. |
| `tracker-server/` | Node 20 service for Google Cloud Run. Receives telemetry, enriches it with HERE (speed limit, address, route) and serves the Škoda-styled live map. |

Start here:

- **[SETUP.md](SETUP.md)** – complete runbook to rebuild the whole demo from scratch (Google Cloud, HERE, Android build, emulator, verification, troubleshooting).
- `ShareLoc-AAOS/README.md` – app details and the telemetry payload.
- `tracker-server/README.md` – server endpoints, configuration and deployment.

Release archive: run `scripts/make-release-zip.sh` (Linux/macOS/Cloud Shell) or
`scripts/make-release-zip.ps1` (Windows) to produce `dist/shareloc-demo-<date>.zip` with all sources and docs.
GitHub's *Code → Download ZIP* on the branch produces the same content.
