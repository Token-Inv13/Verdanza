import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import sharp from "sharp";

const officialFiles: Record<string, string> = {
  "public/brand/verdanza-v1/logos/verdanza-logo-horizontal-compact-full-color.svg": "ba7d294f5b719357288b9f0ca93c267415bd766c4a17ad7acebd797bd1c784f1",
  "public/brand/verdanza-v1/logos/verdanza-logo-horizontal-compact-mono-gold.svg": "d7deb1dac884e46de6a1a80ef8de63dafa4a0a7e2299d42694577dd3b54c16d5",
  "public/brand/verdanza-v1/logos/verdanza-logo-horizontal-primary-full-color.svg": "b4be50af2fdb42e75a0c546ffd29fff85b7d0ec625fda96bdb637fa7a84a0763",
  "public/brand/verdanza-v1/logos/verdanza-logo-stacked-compact-full-color.svg": "139aa904bed02c304fbc285bda6bed175e80d306b4bafeb09c4a504bed29717a",
  "public/brand/verdanza-v1/logos/verdanza-monogram-small-full-color.svg": "849916e51ac92eee39f1ced2de205edc0d9df79c97cae816a43c49b5b3340bf8",
  "public/brand/verdanza-v1/logos/verdanza-seal-full-color.svg": "ba42ca3702de76cfda84ee98e159f545f487fc3379ab112b31ed111b3fc7077c",
  "public/brand/verdanza-v1/email/verdanza-logo-horizontal-compact-full-color-512.png": "b5f3ddc42df54814e6123a674f84004b6785e0d50c585b980e8da2496190f420",
  "public/brand/verdanza-v1/documents/verdanza-logo-horizontal-primary-mono-charcoal-1024.png": "db394207bbbcda59e5c6f13579cf603bc128aca0d7188695c1c3d936981cc7d1",
  "public/brand/verdanza-v1/structured-data/verdanza-seal-full-color-512.png": "f39d4667a52805bbd433bf1dc984401c0819322b199e9b4b5db6aec6516ce147",
  "public/brand/verdanza-v1/favicons/favicon.ico": "40631f1720ef0e8f607a17a878e72f0ff7f1a1cffe293b54bedfc9779594b957",
  "public/brand/verdanza-v1/favicons/favicon.svg": "84ffee0425a3326a086a53e355d60595c078c38f8d47ee6077ec009b78ae35cb",
  "public/brand/verdanza-v1/favicons/favicon-16x16.png": "4a6a32a7e892abcb4626c112861c7478bd9e42e2322f4c630480c00f1efd7a16",
  "public/brand/verdanza-v1/favicons/favicon-32x32.png": "89ba01302f2fbb0ebcc962e998502eabb299431c488f5995ec6689532379c084",
  "public/brand/verdanza-v1/favicons/favicon-48x48.png": "0ab33d33e0a8dae58797d84e3d36bbe00ccda148d87b0912ffb6cd00c02da133",
  "public/brand/verdanza-v1/favicons/apple-touch-icon-180x180.png": "67d92d7c6729ccd4425910338975b87637a21e15565c58b9738375968be664cb",
  "public/brand/verdanza-v1/favicons/safari-pinned-tab.svg": "9ecd213b776fa6b357455ee5de7dbcb620722fc314f23ea2c56150d3c2ebe208",
  "public/brand/verdanza-v1/icons/android-chrome-192x192.png": "d0db4cc436f3fce2d6e03982d69da3b4eae92bbe221d53122c43835477f1d85c",
  "public/brand/verdanza-v1/icons/android-chrome-512x512.png": "798a4b53e955c1f060cb44c84278bd93c6b496897cc54f4fe2788b721df53d94",
  "public/brand/verdanza-v1/icons/maskable-icon-512x512.png": "adcba41343029de7e85b85954f5a4af799f39922faea7aaf93c0d9385ece798b",
};

const compatibilityAliases: Record<string, string> = {
  "public/favicon.ico": officialFiles["public/brand/verdanza-v1/favicons/favicon.ico"],
  "public/favicon.svg": officialFiles["public/brand/verdanza-v1/favicons/favicon.svg"],
  "public/favicon-16x16.png": officialFiles["public/brand/verdanza-v1/favicons/favicon-16x16.png"],
  "public/favicon-32x32.png": officialFiles["public/brand/verdanza-v1/favicons/favicon-32x32.png"],
  "public/favicon-48x48.png": officialFiles["public/brand/verdanza-v1/favicons/favicon-48x48.png"],
  "public/favicon-192x192.png": officialFiles["public/brand/verdanza-v1/icons/android-chrome-192x192.png"],
  "public/favicon-512x512.png": officialFiles["public/brand/verdanza-v1/icons/android-chrome-512x512.png"],
  "public/apple-touch-icon.png": officialFiles["public/brand/verdanza-v1/favicons/apple-touch-icon-180x180.png"],
  "public/icons/pwa-192.png": officialFiles["public/brand/verdanza-v1/icons/android-chrome-192x192.png"],
  "public/icons/pwa-512.png": officialFiles["public/brand/verdanza-v1/icons/android-chrome-512x512.png"],
  "public/icons/pwa-maskable-512.png": officialFiles["public/brand/verdanza-v1/icons/maskable-icon-512x512.png"],
  "public/verdanza-logo.png": "3ada46934e9f6a56d5c4223e51686478c0563931d124fdafabf5fb26f614af3b",
  "public/verdanza-badge.png": "bb6774daa5f18176709e1b44f141a9c05094a8f0d6acffc00ab1d9ac77867a51",
  "public/verdanza-label.png": "fe95d1e8bcaad1083f7d45627a900e011bfd6f8825a0b4bc2fe328b765b124ca",
};

const obsoleteHashes = new Set([
  "3e05ebbb72b2359d837c346896bd4ad2acca6db84a043ab626b68fd8c613a90d",
  "16ef8553084312d921971e9e0577e917e91bb55e25479d880a4e32c756586367",
  "37bcc6fe3e839cbc3722a333c12cd81d47bdbf2490e680e24d9faa44661c618c",
  "9fee8dbc915243b00a3a3ed0364c77dbbb2821a29bccfeb0f3d0a84233e9cd43",
  "17cf2899415b76fab349dd0fcc1da0d60fec2c80e7b47ca1fe0f80321acb5870",
  "56e1aa7c0def8d4ca1b5e4181c93bc332a937e99abfd871346aee1c6efba23b9",
  "253fe5de17d2dcfbe74a57dc090f438a17b80d683cfa372ec5fc699ff85f8da7",
  "403b089a79efa5fa507555217f0c2143d85dc6b1962bbaaca6f19532f3d096ed",
  "0300215dae7a2db7c901ad91c3c57d0946c8b20d98e7fe56a5b949644835dc33",
  "a9aa6a5ae1d182136cc773014b699276905d0fe59d90d2d95b612dd7c8cbe397",
  "6a78843cf1f6de42abd6e428424416805f1ca3ade961fa224bc101f16b64167d",
  "8c2feb33cd2dc74bb2474254b327c3a8c34703fe7395ec8ce59c283922e0c8c3",
  "b8258571daacda71d898ec0999b2d21dd1bfaab03769d7b1d9131ed54e708fc4",
  "f31fd1759bfca50401d1044ae61a5bb122989729b19d07d5b386d6fd129c6336",
  "827c0a71f81f2f7277a81f3a02cc7a9593b6a97a1d11767175023ffb33f6d5bc",
  "fee1392ea3314fa7f24f6247d0a8beefb4611aed6031bc8ce7b76681cbae377c",
  "13f8d588ab346fe86ca58257a78dc1abd7a018b207ba0d80d94d6b57993c29cc",
  "69c066531f22595c3863197034bfc8461bde301e1e6afd015af142d9e242f5df",
  "0f608c9c61228f5276bf7b29c3882b2f8c714afe71a23cb40747a53d118ec240",
  "b70f72f6f7c9face1c351e182ac3e88e7a6f8adcb8d7011863723c5e87284af7",
  "2a1492bea98ed8d6842311fe63e834edda34a7e0bd2c7b13211e0311447e3f36",
  "13dd9914b9d61e3d4a44f4ee607d6792c2afdb074c2e455a3ea11151ab581d0d",
  "fda715d3161f1b6913e61603c4de51de6733b5b571b6b56612fc651b4d9d0276",
  "2ff719665b6b7a1a74da4255004665c1dc614731a5a2782397da51da95277b8b",
  "b07ae0ec435b14d41ddb12e565ea8773504e3fc835754b49d477dcc521630839",
  "637a8714ccba6e1f46651569680528979fd28b86f59243b5ee3c4aff9e0ca074",
  "7551576ea0e377c8f2fcdafd00d7f43b95a82346756110edb49b0d199d3db454",
  "08fb3f355a22c5aa5e1573449254f518858ef93c1dad4b2fb0e1fbb2511cc1e5",
  "175d73070d70dcd0b18c47fc2db7311d3ed3cf56a670bc11d589b70e79478754",
  "7ec869ec37541c7d40e623c39595ad63c63fdb52853480d2ec8b74775b7b9935",
  "cb5ec995df2fdc5124995377b741546bbb48bdcd37282cb2cf6441c609505048",
  "0ea9e2bfa936dc2e00a744c30b83eccf86a51a1e0a28eb3f47b216ff1303eb2f",
  "b8b75bf51bf3e2567d2116d02a58361c9e94e4bde6a39ad9cede8a94cfb9939b",
]);

const failures: string[] = [];

for (const [file, expectedHash] of Object.entries({ ...officialFiles, ...compatibilityAliases })) {
  if (!existsSync(file)) {
    failures.push(`missing ${file}`);
  } else if (sha256(file) !== expectedHash) {
    failures.push(`SHA-256 mismatch ${file}`);
  }
}

const socialImage = "public/brand/verdanza-v1/social/verdanza-default-og-1200x630.png";
if (!existsSync(socialImage)) failures.push(`missing ${socialImage}`);
else {
  const metadata = await sharp(socialImage).metadata();
  if (metadata.width !== 1200 || metadata.height !== 630) failures.push("social image dimensions mismatch");
}

for (const file of Object.keys(officialFiles).filter((name) => name.endsWith(".svg"))) {
  const svg = readFileSync(file, "utf8");
  if (/<image\b|data:image|base64/i.test(svg)) failures.push(`embedded raster found in ${file}`);
  if (file.includes("/logos/")) {
    for (const color of ["#0E3726", "#B48948", "#FDF9F4", "#343333", "#FFFFFF", "#000000"]) {
      if (!svg.includes(color)) failures.push(`official palette metadata missing ${color} in ${file}`);
    }
  }
}

if (existsSync("public/favicon-96x96.png")) failures.push("obsolete 96px favicon remains");
for (const oldDirectory of ["logo", "public/images/brand"]) {
  if (existsSync(oldDirectory) && walkGraphics(oldDirectory).length > 0) {
    failures.push(`obsolete brand files remain: ${oldDirectory}`);
  }
}

const graphicRoots = ["public", "src", "logo", "dist"].filter(existsSync);
for (const file of graphicRoots.flatMap(walkGraphics)) {
  if (obsoleteHashes.has(sha256(file))) {
    failures.push(`obsolete brand fingerprint found in ${relative(process.cwd(), file)}`);
  }
}

const emailSource = readFileSync("api/_server/email.ts", "utf8");
const brandSource = readFileSync("src/lib/brandAssets.ts", "utf8");
if (
  !emailSource.includes("BRAND_EMAIL_LOGO_URL") ||
  !brandSource.includes("https://verdanza.fr${BRAND_EMAIL_LOGO}")
) {
  failures.push("absolute production email logo URL is missing");
}
if (!emailSource.includes('alt="Verdanza"')) failures.push("email logo alt text is missing");

if (failures.length) {
  console.error("Brand identity audit failures:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(
    `Brand identity audit passed for ${Object.keys(officialFiles).length} official file(s), ${Object.keys(compatibilityAliases).length} compatibility alias(es), and ${graphicRoots.length} scanned tree(s).`,
  );
}

function sha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function walkGraphics(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return walkGraphics(file);
    return [".svg", ".png", ".webp", ".jpg", ".jpeg", ".ico"].includes(
      extname(entry.name).toLowerCase(),
    )
      ? [resolve(file)]
      : [];
  });
}
