import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const ICONS_DIR = path.join(ROOT_DIR, 'icons');

const SIZES = [16, 32, 48, 128];

const SVG_CONTENT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" fill="none">
  <defs>
    <linearGradient id="bgGrad" x1="12" y1="8" x2="116" y2="120" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1b2236"/>
      <stop offset="100%" stop-color="#0b0e15"/>
    </linearGradient>
    <linearGradient id="borderGrad" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#8da8ff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#4e62a8" stop-opacity="0.25"/>
    </linearGradient>
    <linearGradient id="moonGrad" x1="28" y1="26" x2="96" y2="100" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#c7d5ff"/>
      <stop offset="48%" stop-color="#7c9bff"/>
      <stop offset="100%" stop-color="#a78bfa"/>
    </linearGradient>
    <radialGradient id="glowGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#6c8cff" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#6c8cff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="4" y="4" width="120" height="120" rx="28" fill="url(#bgGrad)" stroke="url(#borderGrad)" stroke-width="3"/>
  <circle cx="62" cy="64" r="44" fill="url(#glowGrad)"/>
  <path d="M74.5 29.5A34 34 0 1 0 98.5 85.2A27 27 0 0 1 74.5 29.5Z" fill="url(#moonGrad)"/>
  <path d="M88 30L90.8 37.2L98 40L90.8 42.8L88 50L85.2 42.8L78 40L85.2 37.2Z" fill="#eef2ff"/>
</svg>
`;

function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = buildCrc32Table();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function blendPixel(dst, srcR, srcG, srcB, srcA) {
  const sa = clamp(srcA, 0, 1);
  const da = dst.a;
  const outA = sa + da * (1 - sa);
  if (outA <= 0.0001) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  return {
    r: (srcR * sa + dst.r * da * (1 - sa)) / outA,
    g: (srcG * sa + dst.g * da * (1 - sa)) / outA,
    b: (srcB * sa + dst.b * da * (1 - sa)) / outA,
    a: outA
  };
}

function sdRoundedBox(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - (halfW - radius);
  const qy = Math.abs(py) - (halfH - radius);
  const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inDist = Math.min(Math.max(qx, qy), 0);
  return outDist + inDist - radius;
}

function sdSparkle(dx, dy, radius) {
  // 4-point star using curved diamond SDF
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const p = 0.56;
  const dist = Math.pow(ax / radius, p) + Math.pow(ay / radius, p);
  return (Math.pow(dist, 1 / p) - 1) * radius * 0.55;
}

function sampleIconColor(nx, ny, size) {
  const pxScale = 1 / size;
  const aa = pxScale * 1.15;

  // Rounded badge
  const boxDist = sdRoundedBox(nx - 0.5, ny - 0.5, 0.465, 0.465, 0.115);
  const boxCov = 1 - smoothstep(-aa * 0.6, aa * 0.6, boxDist);
  if (boxCov <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  // Background gradient (#1b2236 -> #0b0e15)
  const bgT = clamp((nx * 0.45 + ny * 0.55), 0, 1);
  let col = {
    r: mix(27, 11, bgT),
    g: mix(34, 14, bgT),
    b: mix(54, 21, bgT),
    a: boxCov
  };

  // Subtle luminous rim inside rounded square
  const rimWidth = Math.max(pxScale * 1.35, 0.024);
  const rimDist = Math.abs(boxDist + rimWidth * 0.5) - rimWidth * 0.5;
  const rimCov = (1 - smoothstep(-aa * 0.5, aa * 0.5, rimDist)) * boxCov;
  if (rimCov > 0) {
    const rimT = clamp((nx + ny) * 0.5, 0, 1);
    const rimA = mix(0.55, 0.24, rimT) * rimCov;
    col = blendPixel(col, mix(141, 78, rimT), mix(168, 98, rimT), mix(255, 168, rimT), rimA);
  }

  // Soft ambient indigo glow behind moon
  const glowDist = Math.hypot(nx - 0.48, ny - 0.52);
  const glowA = Math.pow(clamp(1 - glowDist / 0.38, 0, 1), 2.1) * 0.32 * boxCov;
  if (glowA > 0) {
    col = blendPixel(col, 108, 140, 255, glowA);
  }

  // Crescent moon SDF (outer circle minus inner cutout circle)
  const outerDist = Math.hypot(nx - 0.485, ny - 0.525) - 0.285;
  const innerDist = Math.hypot(nx - 0.605, ny - 0.415) - 0.228;
  const moonDist = Math.max(outerDist, -innerDist);
  const moonCov = (1 - smoothstep(-aa * 0.65, aa * 0.65, moonDist)) * boxCov;
  if (moonCov > 0) {
    const mt = clamp((nx - 0.2) * 0.7 + (ny - 0.2) * 0.7, 0, 1);
    const moonR = mt < 0.5 ? mix(199, 124, mt * 2) : mix(124, 167, (mt - 0.5) * 2);
    const moonG = mt < 0.5 ? mix(213, 155, mt * 2) : mix(155, 139, (mt - 0.5) * 2);
    const moonB = mt < 0.5 ? mix(255, 255, mt * 2) : mix(255, 250, (mt - 0.5) * 2);
    col = blendPixel(col, moonR, moonG, moonB, moonCov);
  }

  // 4-point star sparkle
  const starRadius = size <= 16 ? 0.11 : 0.088;
  const starDist = sdSparkle(nx - 0.695, ny - 0.305, starRadius);
  const starCov = (1 - smoothstep(-aa * 0.6, aa * 0.6, starDist)) * boxCov;
  if (starCov > 0) {
    col = blendPixel(col, 238, 242, 255, starCov);
  }

  return col;
}

function renderPng(size) {
  const samples = 4;
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);

  for (let y = 0; y < size; y++) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0; // PNG filter type 0 (None)

    for (let x = 0; x < size; x++) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const nx = (x + (sx + 0.5) / samples) / size;
          const ny = (y + (sy + 0.5) / samples) / size;
          const p = sampleIconColor(nx, ny, size);
          accR += p.r * p.a;
          accG += p.g * p.a;
          accB += p.b * p.a;
          accA += p.a;
        }
      }

      const nSamples = samples * samples;
      const outA = accA / nSamples;
      const outR = outA > 0.0001 ? accR / accA : 0;
      const outG = outA > 0.0001 ? accG / accA : 0;
      const outB = outA > 0.0001 ? accB / accA : 0;

      const idx = rowOffset + 1 + x * 4;
      raw[idx] = clamp(Math.round(outR), 0, 255);
      raw[idx + 1] = clamp(Math.round(outG), 0, 255);
      raw[idx + 2] = clamp(Math.round(outB), 0, 255);
      raw[idx + 3] = clamp(Math.round(outA * 255), 0, 255);
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function main() {
  fs.mkdirSync(ICONS_DIR, { recursive: true });

  const svgPath = path.join(ICONS_DIR, 'icon.svg');
  fs.writeFileSync(svgPath, SVG_CONTENT, 'utf8');
  console.log(`Generated ${path.relative(ROOT_DIR, svgPath)}`);

  for (const size of SIZES) {
    const pngPath = path.join(ICONS_DIR, `icon-${size}.png`);
    const pngBuffer = renderPng(size);
    fs.writeFileSync(pngPath, pngBuffer);
    console.log(`Generated ${path.relative(ROOT_DIR, pngPath)} (${pngBuffer.length} bytes, ${size}x${size})`);
  }
}

main();
