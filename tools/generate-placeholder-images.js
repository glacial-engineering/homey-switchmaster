'use strict';

// Generates solid-colour placeholder PNGs so the app validates. Replace these
// with real branded artwork before publishing. No external dependencies (uses
// only zlib + fs), so it can run in a minimal Docker node image with just this
// project folder mapped.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BRAND = { r: 0x25, g: 0x63, b: 0xeb };

const CRC_TABLE = (() => {
  const table = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePng(width, height, color) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // colour type: truecolour RGB
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const rowLength = width * 3;
  const raw = Buffer.alloc((rowLength + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowLength + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = color.r;
      raw[p + 1] = color.g;
      raw[p + 2] = color.b;
    }
  }

  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  ['assets/images/small.png', 250, 175],
  ['assets/images/large.png', 500, 350],
  ['assets/images/xlarge.png', 1000, 700],
];

for (const [rel, w, h] of targets) {
  const file = path.join(__dirname, '..', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, makePng(w, h, BRAND));
  console.log(`wrote ${rel} (${w}x${h})`);
}
