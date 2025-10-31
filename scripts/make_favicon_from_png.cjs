#!/usr/bin/env node
// CommonJS version to work with projects using "type": "module"
const fs = require('fs');
const path = require('path');

const defaultInput = path.join(__dirname, '..', 'public', 'ChatGPT Image Oct 13, 2025, 01_56_50 PM.png');
const defaultOutput = path.join(__dirname, '..', 'public', 'favicon.ico');

const inputPath = process.argv[2] || defaultInput;
const outputPath = process.argv[3] || defaultOutput;

function parsePngSize(buf) {
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

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(width >= 256 ? 0 : (width || 0), 0);
  entry.writeUInt8(height >= 256 ? 0 : (height || 0), 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  const imageOffset = 6 + 16;
  entry.writeUInt32LE(imageOffset, 12);

  const ico = Buffer.concat([header, entry, png]);
  fs.writeFileSync(outputPath, ico);
  console.log('Wrote ICO to', outputPath);
} catch (err) {
  console.error('Failed to create favicon.ico:', err && err.message ? err.message : String(err));
  process.exit(1);
}
