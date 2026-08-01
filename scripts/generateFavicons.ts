import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const sourcePath = resolve("public/verdanza-badge.png");
const pngTargets = [
  { path: resolve("public/favicon-48x48.png"), size: 48 },
  { path: resolve("public/favicon-96x96.png"), size: 96 },
  { path: resolve("public/favicon-192x192.png"), size: 192 },
  { path: resolve("public/favicon-512x512.png"), size: 512 },
  { path: resolve("public/apple-touch-icon.png"), size: 180 },
];

const source = readFileSync(sourcePath);
const metadata = await sharp(source).metadata();
if (!metadata.width || !metadata.height || metadata.width !== metadata.height) {
  throw new Error("The official Verdanza badge must be a square image.");
}

for (const target of pngTargets) {
  const output = await renderPng(target.size);
  writeIfChanged(target.path, output);
}

const icoSizes = [16, 32, 48];
const icoImages = await Promise.all(icoSizes.map((size) => renderPng(size)));
writeIfChanged(resolve("public/favicon.ico"), encodeIco(icoSizes, icoImages));

console.log(
  `Favicons generated from public/verdanza-badge.png: ${pngTargets
    .map((target) => `${target.size}x${target.size}`)
    .join(", ")} and ICO ${icoSizes.join("/")} px.`,
);

function renderPng(size: number) {
  return sharp(source)
    .resize({
      width: size,
      height: size,
      fit: "contain",
      position: "centre",
      kernel: sharp.kernel.lanczos3,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function encodeIco(sizes: number[], images: Buffer[]) {
  const directorySize = 6 + images.length * 16;
  const header = Buffer.alloc(directorySize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = directorySize;
  images.forEach((image, index) => {
    const size = sizes[index];
    const entryOffset = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset);
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(image.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += image.length;
  });

  return Buffer.concat([header, ...images]);
}

function writeIfChanged(path: string, output: Buffer) {
  if (existsSync(path) && readFileSync(path).equals(output)) return;
  writeFileSync(path, output);
}
