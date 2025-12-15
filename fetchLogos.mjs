import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join("assets", "logos");
fs.mkdirSync(OUT_DIR, { recursive: true });

async function downloadToFile(url, filePath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buf);
}

function writeUtahPlaceholder() {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <rect width="100%" height="100%" rx="40" ry="40" fill="#111827"/>
  <text x="50%" y="46%" text-anchor="middle" font-size="44" fill="#e5e7eb" font-family="Arial" font-weight="700">UTA</text>
  <text x="50%" y="64%" text-anchor="middle" font-size="18" fill="#9ca3af" font-family="Arial">Mammoth</text>
</svg>`;
  fs.writeFileSync(path.join(OUT_DIR, "UTA.svg"), svg, "utf8");
}

async function main() {
  // ESPN NHL teams endpoint
  const api = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams";
  const data = await (await fetch(api)).json();

  const teams =
    data?.sports?.[0]?.leagues?.[0]?.teams?.map(t => t.team) ?? [];

  let count = 0;

  for (const t of teams) {
    const abbr = t.abbreviation;     // ex: TOR
    const logos = t.logos || [];
    const logoUrl = logos[0]?.href;  // usually PNG

    if (!abbr || !logoUrl) continue;

    const outPath = path.join(OUT_DIR, `${abbr}.png`);
    await downloadToFile(logoUrl, outPath);
    count++;
  }

  writeUtahPlaceholder();

  console.log(`Saved ${count} team logos to ${OUT_DIR}/ and added UTA.svg`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
