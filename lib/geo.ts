type Coord = [number, number];

export const coordsFromPosList = (posList?: string): Coord[] | null => {
  if (!posList) return null;
  const numbers = posList
    .trim()
    .split(/\s+/)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));
  if (numbers.length < 4 || numbers.length % 2 !== 0) return null;
  const coords: Coord[] = [];
  for (let i = 0; i < numbers.length; i += 2) {
    const lat = numbers[i];
    const lon = numbers[i + 1];
    coords.push([lon, lat]);
  }
  return coords;
};

export const ensureClosedRing = (coords: Coord[]): Coord[] => {
  if (coords.length === 0) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return coords;
  return [...coords, first];
};

export const centroidFromPolygon = (coords: Coord[]): { lat: number; lon: number } | null => {
  if (coords.length < 3) return null;
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[i + 1];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  if (twiceArea === 0) return null;
  const area = twiceArea / 2;
  return { lon: x / (6 * area), lat: y / (6 * area) };
};

export const bboxFromCoords = (coords: Coord[]): [number, number, number, number] | null => {
  if (!coords.length) return null;
  let minLon = coords[0][0];
  let maxLon = coords[0][0];
  let minLat = coords[0][1];
  let maxLat = coords[0][1];
  coords.forEach(([lon, lat]) => {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  });
  return [minLon, minLat, maxLon, maxLat];
};
