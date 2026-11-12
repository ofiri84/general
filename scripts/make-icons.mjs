// Renders the app icon (two interlocking rings = "together") to PNG without any dependencies.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function crc32(buf) {
  let c,
    crc = ~0;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function render(size, { rounded }) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 3;
  const s = size / 512;
  const ring = (x, y, cx, cy) => Math.abs(Math.hypot(x - cx, y - cy) - 92 * s) <= 15 * s;
  const inRounded = (x, y) => {
    if (!rounded) return true;
    const r = 112 * s;
    const dx = Math.max(r - x, 0, x - (size - r));
    const dy = Math.max(r - y, 0, y - (size - r));
    return dx * dx + dy * dy <= r * r;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          if (!inRounded(fx, fy)) continue;
          const t = (fx + fy) / (2 * size);
          let c = [99 + (67 - 99) * t, 102 + (56 - 102) * t, 241 + (202 - 241) * t];
          if (ring(fx, fy, 200 * s, 256 * s)) c = [255, 255, 255];
          if (ring(fx, fy, 312 * s, 256 * s)) c = [253, 230, 138];
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      px[i] = a ? r / (a / 255) : 0;
      px[i + 1] = a ? g / (a / 255) : 0;
      px[i + 2] = a ? b / (a / 255) : 0;
      px[i + 3] = a / n;
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = new URL("../apps/web/public/", import.meta.url).pathname;
writeFileSync(out + "icon-192.png", render(192, { rounded: true }));
writeFileSync(out + "icon-512.png", render(512, { rounded: false }));
writeFileSync(out + "apple-touch-icon.png", render(180, { rounded: false }));
console.log("icons written to", out);
