// Simulates a vehicle driving from Mladá Boleslav towards Harrachov and posts telemetry like the IVI app.
// Usage: node scripts/simulate-drive.js [baseUrl] [token]
const baseUrl = (process.argv[2] || process.env.API_BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const token = process.argv[3] || process.env.UPLOAD_TOKEN || "LOCAL_EMULATOR_TEST";
const vehicleId = process.env.VEHICLE_ID || "IVI_001";

const waypoints = [
  [50.4127, 14.9013],
  [50.4188, 14.9102],
  [50.4302, 14.9310],
  [50.4451, 14.9580],
  [50.4633, 14.9905],
  [50.4871, 15.0314],
  [50.5129, 15.0790],
  [50.5402, 15.1301],
];
const navigation = {
  destination: { name: "ČEZ Harrachov OC Mamut", address: "Nový Svět 101, 512 46 Harrachov (CZE)", lat: 50.78082, lon: 15.42037 },
  etaEpochMs: Date.now() + 1809 * 1000,
  remainingMeters: 25048,
  remainingSeconds: 1809,
  socPercent: 79,
  arrivalSocPercent: 66,
  chargingStop: { name: "ČEZ Harrachov OC Mamut", distanceMeters: 25048, chargingSeconds: 300, lat: 50.78082, lon: 15.42037 },
};

function interpolate(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function bearing(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const stepsPerLeg = 12;
let leg = 0;
let step = 0;
let tick = 0;

async function send() {
  const a = waypoints[leg];
  const b = waypoints[leg + 1];
  const [lat, lon] = interpolate(a, b, step / stepsPerLeg);
  const speed = 45 + 40 * Math.sin(tick / 9) + (leg > 3 ? 30 : 0);
  const payload = {
    vehicleId,
    latitude: lat,
    longitude: lon,
    speedKmh: Math.max(0, speed),
    bearing: bearing(a, b),
    accuracyMeters: 3.5,
    source: "simulator",
    timestamp: Date.now(),
    navigation: { ...navigation, remainingMeters: Math.max(0, navigation.remainingMeters - tick * 30), remainingSeconds: Math.max(0, navigation.remainingSeconds - tick) },
  };
  try {
    const response = await fetch(`${baseUrl}/api/v1/position`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    console.log(`${new Date().toISOString()} ${lat.toFixed(5)},${lon.toFixed(5)} ${Math.round(speed)} km/h -> HTTP ${response.status}`);
  } catch (error) {
    console.error("upload failed:", error.message);
  }
  tick += 1;
  step += 1;
  if (step > stepsPerLeg) {
    step = 0;
    leg = (leg + 1) % (waypoints.length - 1);
  }
}

send();
setInterval(send, 1000);
