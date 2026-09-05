// Decoder for HERE Flexible Polyline (https://github.com/heremaps/flexible-polyline).
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const INDEX = new Map([...ALPHABET].map((ch, i) => [ch, i]));

function decodeUnsigned(encoded) {
  const values = [];
  let result = 0;
  let shift = 0;
  for (const ch of encoded) {
    const value = INDEX.get(ch);
    if (value === undefined) throw new Error("invalid flexible polyline character");
    result += (value & 0x1f) * 2 ** shift;
    if (value & 0x20) {
      shift += 5;
    } else {
      values.push(result);
      result = 0;
      shift = 0;
    }
  }
  return values;
}

function toSigned(value) {
  return value % 2 === 1 ? -(value + 1) / 2 : value / 2;
}

/** Returns an array of [lon, lat] pairs (GeoJSON order). */
export function decodeFlexPolyline(encoded) {
  const values = decodeUnsigned(encoded);
  if (values.shift() !== 1) throw new Error("unsupported flexible polyline version");
  const header = values.shift();
  const precision = header & 15;
  const thirdDim = (header >> 4) & 7;
  const factor = 10 ** precision;
  const stride = thirdDim ? 3 : 2;
  const coordinates = [];
  let lat = 0;
  let lon = 0;
  for (let i = 0; i + 1 < values.length; i += stride) {
    lat += toSigned(values[i]);
    lon += toSigned(values[i + 1]);
    coordinates.push([lon / factor, lat / factor]);
  }
  return coordinates;
}
