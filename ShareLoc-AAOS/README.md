# ShareLoc – AAOS live vehicle location

ShareLoc is a small Android Automotive demo app. The driver starts location sharing, the app uploads the IVI position to the ANTools Live Tracker server, and the app creates a QR code/public link that can be sent by SMS or any Android sharing app.

## Included features

- Normal Android location permission; no root, `READ_LOGS`, ADB agent or privileged-app installation required.
- Foreground location service that keeps running after the Activity is closed.
- Approximately 1 Hz upload rate.
- Compatible with the supplied `antools-live-tracker-server` API.
- QR code containing the public tracking URL.
- SMS body pre-filled with the tracking link.
- Android Sharesheet support for Signal, WhatsApp, Gmail and other installed apps.
- Copy-link and open-map actions.
- New Škoda-inspired Emerald/Electric Green interface.
- Separate landscape layout for AAOS screens.
- Keeps only the newest unsent location and retries temporary network failures.

## 1. Configure the server

Copy:

```text
shareloc.properties.example
```

to:

```text
shareloc.properties
```

Fill in the values printed by the server deployment script:

```properties
apiBaseUrl=https://YOUR-CLOUD-RUN-SERVICE.run.app
uploadToken=YOUR_DEVICE_UPLOAD_TOKEN
vehicleId=IVI_001
publicShareUrl=https://track.antools.tech/track/YOUR_PUBLIC_SHARE_ID
```

The app sends positions to:

```text
<apiBaseUrl>/api/v1/position
```

For local server testing from the Android emulator:

```properties
apiBaseUrl=http://10.0.2.2:8080
publicShareUrl=http://10.0.2.2:8080/track/YOUR_PUBLIC_SHARE_ID
```

Debug builds allow cleartext HTTP. Release builds expect HTTPS.

## 2. Open and build

The ZIP does not bundle third-party Gradle binaries. Bootstrap the official wrapper once before the first Android Studio sync:

```powershell
.\bootstrap-wrapper.ps1
```

Alternatively, with Java already on `PATH`:

```powershell
.\gradlew.bat --version
```

The bootstrap verifies the Gradle wrapper JAR SHA-256 before installing it. Then:

1. Open this folder in Android Studio.
2. Allow Gradle sync to finish.
3. Select the `app` run configuration and your AAOS emulator.
4. Run the app.

Command-line debug build:

```bash
./gradlew assembleDebug
```

Windows:

```powershell
.\gradlew.bat assembleDebug
```

APK output:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## 3. Test in the AAOS emulator

1. Start the ANTools server.
2. Open ShareLoc and press **Share my location**.
3. Grant precise location and notification permissions.
4. Change the emulator location in Android Studio Extended Controls, or use:

```bash
adb emu geo fix 14.900155 50.4130567
```

The emulator command uses longitude first, then latitude.

5. Open the QR/public link in a browser. The marker should update in approximately one second.

## Server request produced by the app

```json
{
  "vehicleId": "IVI_001",
  "latitude": 50.4130567,
  "longitude": 14.900155,
  "speedKmh": 42.5,
  "bearing": 182.9,
  "accuracyMeters": 3.8,
  "source": "android-location:gps",
  "timestamp": 1785911234567
}
```

Header:

```text
Authorization: Bearer <uploadToken>
```

## Demo behavior

- **Share my location** starts the foreground service and displays the QR/link panel.
- **Stop sharing** stops location updates. The web page will become stale/offline based on its timeout rules.
- Closing the Activity does not stop the service.
- Force-stopping the application or pressing Stop does stop sharing.

## Security note

The upload token is embedded in the APK at build time. This is acceptable for a controlled demonstration, but it is not strong protection against someone who obtains and reverse-engineers the APK. Rotate the token after public demonstrations. A production version should use device-bound credentials or short-lived tokens.

## Branding note

The UI uses the current Emerald Green (`#0E3A2F`) and Electric Green (`#78FAAE`) color pair. The project does not bundle proprietary Škoda fonts or official logo artwork.
