#!/usr/bin/env node
// Small script to create a favicon.ico that embeds a PNG image (modern ICO supports PNG inside)
// Usage: node make_favicon_from_png.js [input-png-path] [output-ico-path]

const fs = require('fs');
const path = require('path');

const defaultInput = path.join(__dirname, '..', 'public', 'ChatGPT Image Oct 13, 2025, 01_56_50 PM.png');
const defaultOutput = path.join(__dirname, '..', 'public', 'favicon.ico');

const inputPath = process.argv[2] || defaultInput;
const outputPath = process.argv[3] || defaultOutput;

function parsePngSize(buf) {
  // PNG IHDR at offset 16 (width) and 20 (height) after signature and IHDR header
  if (buf.length < 24) return { width: 0, height: 0 };
  const pngSig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  if (!buf.slice(0,8).equals(pngSig)) return { width: 0, height: 0 };
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

try {
  const png = fs.readFileSync(inputPath);
  const { width, height } = parsePngSize(png);

  // ICONDIR header: 6 bytes
  const header = Buffer.alloc(6);
  // reserved
  header.writeUInt16LE(0, 0);
  // type 1 = icon
  header.writeUInt16LE(1, 2);
  // count = 1
  header.writeUInt16LE(1, 4);

  // ICONDIRENTRY: 16 bytes
  const entry = Buffer.alloc(16);
  // width: 1 byte (0 means 256)
  entry.writeUInt8(width >= 256 ? 0 : (width || 0), 0);
  // height
  entry.writeUInt8(height >= 256 ? 0 : (height || 0), 1);
  // color count (0 for PNG)
  entry.writeUInt8(0, 2);
  // reserved
  entry.writeUInt8(0, 3);
  // planes (set 1)
  entry.writeUInt16LE(1, 4);
  // bitcount (32 for alpha)
  entry.writeUInt16LE(32, 6);
  // bytes in resource (png length)
  entry.writeUInt32LE(png.length, 8);
  // image offset: header (6) + entries (16 * count)
  const imageOffset = 6 + 16;
  entry.writeUInt32LE(imageOffset, 12);

  const ico = Buffer.concat([header, entry, png]);
  fs.writeFileSync(outputPath, ico);
  console.log('Wrote ICO to', outputPath);
} catch (err) {
  console.error('Failed to create favicon.ico:', err.message);
  process.exit(1);
}
