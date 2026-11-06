// Generate simple PNG icons for the Todo widget app
// Pure Node.js — no dependencies needed
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function createPNG(width, height) {
  // Each pixel: RGBA
  const rawData = Buffer.alloc((width * 4 + 1) * height);

  for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0; // filter byte
    for (let x = 0; x < width; x++) {
      const idx = y * (width * 4 + 1) + 1 + x * 4;
      const cx = x / width;
      const cy = y / height;

      // Gradient background (indigo to purple)
      const r = Math.round(99 + cx * 70);
      const g = Math.round(102 + cx * (-30));
      const b = Math.round(241 - cx * 70);

      // Rounded rect corners (transparent)
      const margin = width * 0.08;
      const cornerR = width * 0.18;
      const inRect = (x >= margin && x < width - margin && y >= margin && y < height - margin);

      // Simple rounded corner check
      let corner = false;
      for (const [cx2, cy2] of [[margin, margin], [width - margin, margin], [margin, height - margin], [width - margin, height - margin]]) {
        const dx = x - cx2;
        const dy = y - cy2;
        const cornerDist = Math.sqrt((dx / cornerR) ** 2 + (dy / cornerR) ** 2);
        if ((cx2 < width / 2 ? dx < 0 : dx > 0) && (cy2 < height / 2 ? dy < 0 : dy > 0) && cornerDist > 1) {
          corner = true;
        }
      }

      if (corner) {
        rawData[idx] = 0;
        rawData[idx + 1] = 0;
        rawData[idx + 2] = 0;
        rawData[idx + 3] = 0;
        continue;
      }

      if (!inRect) {
        rawData[idx] = 0;
        rawData[idx + 1] = 0;
        rawData[idx + 2] = 0;
        rawData[idx + 3] = 0;
        continue;
      }

      rawData[idx] = r;
      rawData[idx + 1] = g;
      rawData[idx + 2] = b;
      rawData[idx + 3] = 255;
    }
  }

  // Build PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT
  const compressed = zlib.deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);

  // IEND
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = crc32(typeAndData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([len, typeAndData, crcBuf]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate icons
const assetsDir = path.join(__dirname, 'assets');

[16, 32, 64, 192, 256, 512].forEach(size => {
  const png = createPNG(size, size);
  const filename = size <= 64 ? `icon-${size}.png` : `icon-${size}.png`;
  fs.writeFileSync(path.join(assetsDir, filename), png);
  console.log(`✅ ${filename} (${size}x${size})`);
});

// Also create main icon.png (256px) for Electron
const mainIcon = createPNG(256, 256);
fs.writeFileSync(path.join(assetsDir, 'icon.png'), mainIcon);
console.log('✅ icon.png (256x256)');
console.log('\n📦 All icons generated!');
