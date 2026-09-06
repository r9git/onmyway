# ShareLoc demo – setup runbook

Everything needed to rebuild the demo from zero: cloud backend, HERE key, Android app, Škoda IVI
emulator, and how to verify each step. Commands are PowerShell on Windows unless a block says
`bash` (Google Cloud Shell).

Reference values used by the current demo (change them if you set up a new project):

| Item | Value |
| --- | --- |
| Google Cloud project | `sharloc-504610` (project number `292065373585`) |
| Cloud Run service / region | `antools-live-tracker` / `europe-west1` |
| Service URL | `https://antools-live-tracker-292065373585.europe-west1.run.app` |
| Cloud Run runtime service account | `antools-tracker-runtime@sharloc-504610.iam.gserviceaccount.com` |
| Secrets in Secret Manager | `SHARELOC_UPLOAD_TOKEN`, `HERE_API_KEY` |
| Vehicle id / public share id | `IVI_001` / `65c2b7ec6023084437f43967ea8bdc0f4cbb` |
| Public tracking link | `https://antools-live-tracker-292065373585.europe-west1.run.app/track/65c2b7ec6023084437f43967ea8bdc0f4cbb` |
| App package (debug build) | `tech.antools.shareloc.debug` |
| Git branch | `cursor/skoda-ui-redesign-1bcc` in `https://github.com/r9git/onmyway` |

Secrets (HERE key, upload token) are **not** in the repo. Keep them in Secret Manager and in the
local, git-ignored `ShareLoc-AAOS/shareloc.properties`.

---

## 1. Prerequisites

- Windows PC with **Android Studio** (bundled JBR = JDK 21) and the Android SDK
  (`%LOCALAPPDATA%\Android\Sdk`, platform-tools included).
- The **Škoda IVI emulator** image (AVD `OIA_Vertical` / `OIA_Horizontal`, Android 14) and the
  external storage images (`hcp3Card.raw`, `ext-storage.raw`, `navdb.img`).
- Git for Windows.
- A Google account with owner/editor rights on the Cloud project; **Cloud Shell** is enough, no
  local `gcloud` needed.
- A **HERE** developer account (Freemium plan is sufficient) with an API key that has
  Raster Tile API v3, Route Matching v8, Routing v8 and Geocoding & Search enabled.

---

## 2. Get the code

```powershell
cd C:\Users\Rob\Desktop\Work\DEMO
git clone --branch cursor/skoda-ui-redesign-1bcc https://github.com/r9git/onmyway.git onmyway
cd onmyway
```

Later updates: `git pull` inside `onmyway`.

Working from the release ZIP instead: unzip it, then `git init` is not required; all commands
below work from the unzipped folder.

---

## 3. Backend on Google Cloud Run (Cloud Shell)

Open https://console.cloud.google.com/?cloudshell=true&project=sharloc-504610 and run:

```bash
gcloud config set project sharloc-504610

# 3.1 Secrets (values are prompted, nothing is echoed). Re-running adds a new version.
read -rs -p "HERE API key: " K; echo
printf '%s' "$K" | gcloud secrets create HERE_API_KEY --data-file=- 2>/dev/null || \
printf '%s' "$K" | gcloud secrets versions add HERE_API_KEY --data-file=-
read -rs -p "Upload token (any long random string; goes into shareloc.properties too): " T; echo
printf '%s' "$T" | gcloud secrets create SHARELOC_UPLOAD_TOKEN --data-file=- 2>/dev/null || \
printf '%s' "$T" | gcloud secrets versions add SHARELOC_UPLOAD_TOKEN --data-file=-

# 3.2 Let the Cloud Run runtime identity read the secrets.
# Check which service account the service uses (empty output = default compute SA):
gcloud run services describe antools-live-tracker --region europe-west1 \
  --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null
SA="antools-tracker-runtime@sharloc-504610.iam.gserviceaccount.com"   # or <projectNumber>-compute@developer.gserviceaccount.com
for s in HERE_API_KEY SHARELOC_UPLOAD_TOKEN; do
  gcloud secrets add-iam-policy-binding "$s" --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor >/dev/null
done

# 3.3 Deploy from source (builds the container with Cloud Build, ~3 minutes)
rm -rf ~/onmyway && git clone -q --branch cursor/skoda-ui-redesign-1bcc https://github.com/r9git/onmyway.git ~/onmyway
gcloud run deploy antools-live-tracker \
  --source ~/onmyway/tracker-server \
  --region europe-west1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --set-env-vars VEHICLE_ID=IVI_001,PUBLIC_SHARE_ID=65c2b7ec6023084437f43967ea8bdc0f4cbb \
  --set-secrets UPLOAD_TOKEN=SHARELOC_UPLOAD_TOKEN:latest,HERE_API_KEY=HERE_API_KEY:latest
```

Answer `Y` if asked to enable APIs or create the Artifact Registry repository.

Verify (note: `/healthz` is intercepted by Google Frontend on `run.app` and returns a Google 404;
use the namespaced paths):

```bash
URL=https://antools-live-tracker-292065373585.europe-west1.run.app
curl -s $URL/api/v1/health
curl -s $URL/api/v1/track/65c2b7ec6023084437f43967ea8bdc0f4cbb/state
```

Expected: `{"ok":true,...}` and a JSON state with `"status":"waiting"` until the car uploads.

Generate a new share id when you want a fresh link: `openssl rand -hex 18`, then redeploy with the
new `PUBLIC_SHARE_ID` and update `publicShareUrl` in the app.

`--min-instances 1` keeps the trail in memory between uploads (small monthly cost). Without it a
cold start only loses the trail history; the live position reappears on the next upload.

---

## 4. Build the Android app (Windows)

### 4.1 Configuration

```powershell
cd C:\Users\Rob\Desktop\Work\DEMO\onmyway\ShareLoc-AAOS
Copy-Item shareloc.properties.example shareloc.properties
notepad shareloc.properties
```

Content:

```properties
apiBaseUrl=https://antools-live-tracker-292065373585.europe-west1.run.app
uploadToken=<the same value you stored in SHARELOC_UPLOAD_TOKEN>
vehicleId=IVI_001
publicShareUrl=https://antools-live-tracker-292065373585.europe-west1.run.app/track/65c2b7ec6023084437f43967ea8bdc0f4cbb
```

`local.properties` is created by Android Studio; if building only from the command line, create it with
`sdk.dir=C\:\\Users\\Rob\\AppData\\Local\\Android\\Sdk`. Both files are git-ignored.

### 4.2 Java for Gradle

Gradle 8.14.5 supports Java 17–24. Android Studio's bundled JBR (JDK 21) is the safe choice:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
& "$env:JAVA_HOME\bin\java.exe" -version
```

In Android Studio: Settings → Build, Execution, Deployment → Build Tools → Gradle → *Gradle JDK* = JBR 21.

### 4.3 Build

```powershell
.\bootstrap-wrapper.ps1          # first time only: downloads gradle-wrapper.jar
.\gradlew.bat :app:assembleDebug
```

APK: `app\build\outputs\apk\debug\app-debug.apk`.

---

## 5. Škoda IVI emulator

### 5.1 Start (known-good command, with public DNS so the guest can reach the internet)

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\emulator\qemu\windows-x86_64\qemu-system-x86_64.exe" -avd OIA_Vertical `
  -selinux permissive -cores 4 -memory 8096 -no-snapshot-load -writable-system -gpu host `
  -dns-server 8.8.8.8,1.1.1.1 `
  -prop qemu.eso.coding.Dia_Anp_5133=EU -prop qemu.eso.coding.Dia_Anp_4984=GB -prop qemu.eso.coding.Dia_Cod_255=BEV `
  -prop qemu.eso.coding.Dia_Anp_5159=true -prop qemu.eso.coding.Dia_Anp_5153=true -prop qemu.eso.coding.Dia_Anp_5165=true `
  -prop qemu.eso.coding.Dia_Anp_5168=true -prop qemu.eso.coding.timeout=0 `
  -sdcard G:\ext_storage\hcp3Card.raw `
  -qemu -drive if=virtio,format=raw,file=G:\ext_storage\ext-storage.raw -drive if=virtio,format=raw,file=G:\ext_storage\navdb.img
```

Wait until the Škoda home screen is up, then:

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$pkg = "tech.antools.shareloc.debug"
& $adb devices -l            # must list emulator-5554 ... device
```

If it says `no devices/emulators found`, wait a bit and retry, or `& $adb kill-server; & $adb devices`.

### 5.2 Install and grant permissions

```powershell
cd C:\Users\Rob\Desktop\Work\DEMO\onmyway\ShareLoc-AAOS
& $adb install -r -g .\app\build\outputs\apk\debug\app-debug.apk
& $adb shell pm grant $pkg android.permission.ACCESS_FINE_LOCATION
& $adb shell pm grant $pkg android.permission.ACCESS_COARSE_LOCATION
& $adb shell pm grant $pkg android.permission.POST_NOTIFICATIONS
& $adb shell pm grant $pkg android.permission.READ_LOGS        # optional: navi destination/ETA/SoC feed
& $adb shell settings put secure location_mode 3
& $adb shell cmd location set-location-enabled true
& $adb shell settings put global http_proxy :0                 # make sure no debug proxy is set
```

### 5.3 Launch (the Škoda launcher does not list third-party apps)

```powershell
& $adb shell am start -W -n "$pkg/tech.antools.shareloc.MainActivity"
```

Press **Share my location** on the screen. Alternatively start sharing headless:

```powershell
& $adb shell am start-foreground-service -n "$pkg/tech.antools.shareloc.VehicleTrackingService" -a tech.antools.shareloc.START
```

Stop: `& $adb shell am startservice -n "$pkg/tech.antools.shareloc.VehicleTrackingService" -a tech.antools.shareloc.STOP`

### 5.4 Feed a position

Android location (what ShareLoc reads):

```powershell
& $adb emu geo fix 14.9013 50.4127        # longitude first, then latitude
```

Škoda navi position (so the built-in map and guidance move too):

```powershell
& $adb shell appops set technology.cariad.navi.oi.skoda android:mock_location allow
& $adb shell am broadcast -a de.esolutions.navigation.SET_POSITION --ef latitude 50.4127 --ef longitude 14.9013 --ef bearing 20
& $adb shell am broadcast -a de.esolutions.navigation.REPLAY_ROUTE     # replay a demo route
```

For the arrival card on the web map, start a route in the navi (the ETA, destination, battery and
charging stop are read from the navi's log output; requires the `READ_LOGS` grant above).

---

## 6. Verify end to end

1. IVI screen: header pill turns green "Location sharing is active"; subtitle "Connected to server";
   *Last upload* ticks every second. With an active navi route the subtitle shows
   "→ destination · arriving hh:mm · xx km".
2. Web: open the public tracking link on a phone (scan the QR) or browser. Expect the vehicle
   cursor, "Live · just now", speed-limit sign after a few seconds, road name, and, with a navi
   route, the arrival card and dashed route.
3. Server state in Cloud Shell:
   `curl -s $URL/api/v1/track/65c2b7ec6023084437f43967ea8bdc0f4cbb/state | head -c 600`
4. Logs: Cloud Console → Cloud Run → antools-live-tracker → Logs. HERE failures are logged as
   `[here] ... failed`.

---

## 7. Troubleshooting (everything that bit us so far)

| Symptom | Cause / fix |
| --- | --- |
| `Incompatible Gradle JVM version ... JVM 25` | Gradle 8.14.5 needs Java 17–24. Set `JAVA_HOME` to Android Studio's `jbr` and/or set Gradle JDK in Android Studio. |
| `JAVA_HOME is set to an invalid directory` | Path typo; verify `Test-Path "$env:JAVA_HOME\bin\java.exe"`. |
| `Manifest merger failed ... usesCleartextTraffic` | Fixed in repo (`app/src/debug/AndroidManifest.xml` uses `tools:replace`). Pull latest. |
| Gradle wrapper download 404 | Run `.\bootstrap-wrapper.ps1` (uses the GitHub mirror URL). |
| `adb.exe: no devices/emulators found` | Emulator still booting or adb server stale: `adb kill-server`, `adb devices -l`. |
| `Activity class ... does not exist` | APK not installed yet (see previous row); reinstall. |
| App: `Server unavailable: Failed to connect to /10.0.2.2:9000` | A global proxy is set in the guest: `adb shell settings put global http_proxy :0`, restart the app. |
| App: `Server unavailable: Unable to resolve host` / `Network is unreachable` | Guest DNS broken. Start the emulator with `-dns-server 8.8.8.8,1.1.1.1`. |
| App: `Server rejected update: HTTP 401` | `uploadToken` in `shareloc.properties` ≠ `SHARELOC_UPLOAD_TOKEN` secret. Fix one side, rebuild or redeploy. |
| App: `Server configuration is incomplete` | `shareloc.properties` still has `CHANGE_ME` values. |
| Deploy: `Permission denied on secret ... for Revision service account X` | Grant `roles/secretmanager.secretAccessor` on both secrets to *that* service account (see 3.2), redeploy. |
| `curl /healthz` shows a Google 404 page | Expected on `run.app`; use `/api/v1/health`. |
| Web map: "Waiting for vehicle" forever | No uploads reaching the server: check app status line; check `state` endpoint; check the app points at the right `apiBaseUrl`. |
| Web map: no tiles / grey background | `HERE_API_KEY` missing or invalid on the service; check Cloud Run env, and the HERE key's enabled APIs. |
| Web map: no speed-limit sign | Normal off-road or on roads without HERE limit data; appears within ~3 s on mapped roads. |
| No arrival card although the navi is guiding | `READ_LOGS` not granted, or the app was started before the grant (force-stop and restart), or no `sendNavRouteParameters` lines in logcat (check with `adb logcat -v raw \| findstr sendNavRouteParameters`). |
| Right edge of the IVI UI cut off | Report `adb shell wm size` / `wm density`; layout was designed for 1920×1080 landscape. |
| Emulator on a cloud VM | Not possible without nested KVM; run the emulator on the Windows PC. |

---

## 8. Security and housekeeping

- Rotate the HERE key and the upload token after public demos (`gcloud secrets versions add ...`,
  then redeploy; update `shareloc.properties` and rebuild for the token).
- Restrict the HERE key to the tracker's domain in the HERE platform (it is embedded in the web page for tiles).
- `READ_LOGS` is a development-only permission; do not ship release builds relying on it.
- `drawable/ic_vehicle_cursor.xml` is a placeholder; replace with the official cursor asset (see `ShareLoc-AAOS/BRANDING.md`).

---

## 9. Local development without the cloud

```bash
cd tracker-server
cp .env.example .env         # set HERE_API_KEY, keep UPLOAD_TOKEN=LOCAL_EMULATOR_TEST
node src/server.js           # http://localhost:8080/track/local-demo
node scripts/simulate-drive.js
```

Point the app at it with `apiBaseUrl=http://10.0.2.2:8080`, `uploadToken=LOCAL_EMULATOR_TEST`,
`publicShareUrl=http://10.0.2.2:8080/track/local-demo` (debug builds allow cleartext HTTP).
