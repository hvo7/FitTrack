/* FitTrack — icon generator.
 *
 * Writes the PWA icon set with no image dependencies: rasterises a few rounded
 * rectangles into an RGBA buffer and encodes a PNG by hand with zlib. Run it
 * only when the mark changes; the output is committed.
 *
 *   node tools/gen-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');

// ── PNG encoding ─────────────────────────────────────────────────────────────
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  // 10-12: deflate / adaptive filtering / no interlace, all zero

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Drawing ──────────────────────────────────────────────────────────────────
/* Coverage of a rounded rectangle at a point, sampled 3x3 for antialiasing.
 * Everything in this icon is a rounded rect, so this is the only primitive. */
function roundRectCoverage(px, py, x0, y0, x1, y1, r) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const x = px + (sx + 0.5) / 3;
      const y = py + (sy + 0.5) / 3;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;

      // Inside the straight edges, or within r of the nearest corner centre.
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) hits++;
    }
  }
  return hits / 9;
}

function blend(buf, i, r, g, b, a) {
  if (a <= 0) return;
  const dstA = buf[i + 3] / 255;
  const outA = a + dstA * (1 - a);
  if (outA <= 0) return;
  buf[i]     = Math.round((r * a + buf[i]     * dstA * (1 - a)) / outA);
  buf[i + 1] = Math.round((g * a + buf[i + 1] * dstA * (1 - a)) / outA);
  buf[i + 2] = Math.round((b * a + buf[i + 2] * dstA * (1 - a)) / outA);
  buf[i + 3] = Math.round(outA * 255);
}

function makeIcon(size, { maskable }) {
  const buf = Buffer.alloc(size * size * 4); // transparent
  const S = (v) => v * size;                 // fractional coords -> pixels

  // Background plate. A maskable icon is full-bleed because the launcher
  // applies its own mask; the standard icon keeps its own rounded corners.
  const bg = maskable
    ? { x0: 0, y0: 0, x1: size, y1: size, r: 0 }
    : { x0: 0, y0: 0, x1: size, y1: size, r: S(0.22) };

  // The mark shrinks on the maskable variant to survive aggressive cropping.
  const scale = maskable ? 0.68 : 0.86;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cov = roundRectCoverage(x, y, bg.x0, bg.y0, bg.x1, bg.y1, bg.r);
      if (cov <= 0) continue;
      // Indigo -> violet, top to bottom.
      const t = y / size;
      const r = Math.round(0x63 + (0xa8 - 0x63) * t);
      const g = Math.round(0x66 + (0x55 - 0x66) * t);
      const b = Math.round(0xf1 + (0xf7 - 0xf1) * t);
      blend(buf, (y * size + x) * 4, r, g, b, cov);
    }
  }

  // Barbell, centred, in units of the full canvas before `scale` is applied.
  const bar = [
    // [x0, y0, x1, y1, radius]
    [0.235, 0.470, 0.765, 0.530, 0.030],  // bar
    [0.170, 0.395, 0.250, 0.605, 0.028],  // inner plate, left
    [0.750, 0.395, 0.830, 0.605, 0.028],  // inner plate, right
    [0.108, 0.435, 0.170, 0.565, 0.024],  // outer collar, left
    [0.830, 0.435, 0.892, 0.565, 0.024],  // outer collar, right
  ];

  for (const [x0, y0, x1, y1, r] of bar) {
    // Scale about the centre of the canvas.
    const sx0 = S(0.5 + (x0 - 0.5) * scale), sx1 = S(0.5 + (x1 - 0.5) * scale);
    const sy0 = S(0.5 + (y0 - 0.5) * scale), sy1 = S(0.5 + (y1 - 0.5) * scale);
    const sr = S(r) * scale;

    const lo = Math.max(0, Math.floor(sy0) - 1), hi = Math.min(size, Math.ceil(sy1) + 1);
    const loX = Math.max(0, Math.floor(sx0) - 1), hiX = Math.min(size, Math.ceil(sx1) + 1);

    for (let y = lo; y < hi; y++) {
      for (let x = loX; x < hiX; x++) {
        const cov = roundRectCoverage(x, y, sx0, sy0, sx1, sy1, sr);
        if (cov > 0) blend(buf, (y * size + x) * 4, 255, 255, 255, cov);
      }
    }
  }

  return encodePng(size, buf);
}

// ── ICO ──────────────────────────────────────────────────────────────────────
/* Windows needs a real .ico: Explorer, the taskbar and shortcuts each pick a
 * different size out of it. Shipping one also keeps electron-builder from
 * having to convert a PNG itself — that conversion runs through the winCodeSign
 * toolchain, which cannot be extracted on a machine without symlink privilege.
 *
 * Entries are stored as PNG, which every Windows since Vista reads. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);           // reserved
  header.writeUInt16LE(1, 2);           // type: icon
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + pngs.length * 16;
  const entries = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;      // 0 means 256
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;                           // palette size
    e[3] = 0;                           // reserved
    e.writeUInt16LE(1, 4);              // colour planes
    e.writeUInt16LE(32, 6);             // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, size, opts] of [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
]) {
  fs.writeFileSync(path.join(OUT, name), makeIcon(size, opts));
  console.log('wrote', path.relative(path.join(__dirname, '..'), path.join(OUT, name)));
}

const ico = encodeIco(ICO_SIZES.map((size) => ({ size, data: makeIcon(size, { maskable: false }) })));
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico);
console.log('wrote', path.relative(path.join(__dirname, '..'), path.join(OUT, 'icon.ico')),
            `(${ICO_SIZES.join(', ')})`);
