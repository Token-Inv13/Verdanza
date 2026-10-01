import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const validPositions = new Set([
  "centre",
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
  "entropy",
  "attention",
]);
const maxBytes = 200 * 1024;
const targets = [
  { key: "square", suffix: "1x1", width: 800, height: 800, quality: 76 },
  { key: "landscape", suffix: "4x3", width: 1040, height: 780, quality: 76 },
  { key: "wide", suffix: "16x9", width: 1600, height: 900, quality: 72 },
] as const;

const slug = argument("slug");
const source = argument("source");
const outputBase = argument("base") || `${slug}-editorial`;

if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
  throw new Error("Provide a kebab-case --slug value.");
}
if (!source || !existsSync(resolve(source))) {
  throw new Error("Provide an existing master image with --source.");
}
if (!outputBase || !/^[a-z0-9-]+$/.test(outputBase)) {
  throw new Error("The optional --base value must be kebab-case.");
}

const sourceFile = resolve(source);
const sourceBuffer = readFileSync(sourceFile);
const sourceMetadata = await sharp(sourceBuffer).metadata();
if ((sourceMetadata.width || 0) < 1200 || (sourceMetadata.height || 0) < 900) {
  throw new Error(
    `Editorial master is too small: ${sourceMetadata.width || 0}x${sourceMetadata.height || 0}. Minimum 1200x900.`,
  );
}

const report = [];
for (const target of targets) {
  const position = argument(`${target.key}-position`) || "centre";
  if (!validPositions.has(position)) {
    throw new Error(`Unsupported ${target.key} crop position: ${position}`);
  }

  const outputFile = resolve(`public/images/blog/${outputBase}-${target.suffix}.webp`);
  mkdirSync(dirname(outputFile), { recursive: true });
  const result = await renderWithinBudget({
    sourceBuffer,
    width: target.width,
    height: target.height,
    position,
    initialQuality: target.quality,
  });
  writeFileSync(outputFile, result.buffer);
  report.push({
    ratio: target.suffix,
    dimensions: `${target.width}x${target.height}`,
    position,
    quality: result.quality,
    KB: Math.round(result.buffer.length / 1024),
    output: outputFile,
  });
}

console.log(`Imported Verdanza editorial artwork for ${slug}.`);
console.table(report);

async function renderWithinBudget({
  sourceBuffer,
  width,
  height,
  position,
  initialQuality,
}: {
  sourceBuffer: Buffer;
  width: number;
  height: number;
  position: string;
  initialQuality: number;
}) {
  for (let quality = initialQuality; quality >= 64; quality -= 2) {
    const buffer = await sharp(sourceBuffer)
      .rotate()
      .resize({ width, height, fit: "cover", position })
      .webp({ quality, effort: 6, smartSubsample: true })
      .toBuffer();
    if (buffer.length <= maxBytes) return { buffer, quality };
  }
  throw new Error(`Unable to keep ${width}x${height} WebP below 200 KB without excessive compression.`);
}

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}
