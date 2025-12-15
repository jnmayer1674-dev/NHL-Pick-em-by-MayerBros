import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join("assets", "logos");
fs.mkdirSync(OUT_DIR, { recursive: true });

async function downloadToFile(url, filePath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url} (${res.status})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
}

function writeUtahPlaceholder() {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <rect width="100%" height="100%" rx="40" ry="40" fill="#111827"/>
  <text x="50%" y="46%" text-anchor="middle" font-size="44" fill="#e5e7eb"
        font-family="Arial" font-weight="700">UTA</text>
  <text x="50%" y="64%" text-anchor="middle" font-size="18" fill="#9ca3af"
        font-family="Arial">Mammoth</text>
</svg>`;
  fs.writeFileSync(path.join(OUT_DIR, "UTA.svg"), svg, "utf8");
}

async function main() {
  const api =
    "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams";

  const response = await fetch(api);
  const data = await response.json();

  const teams =
    data?.sports?.[0]?.leagues?.[0]?.teams?.map(t => t.team) ?? [];

  let count = 0;

  for (const team of teams) {
    const abbr = team.abbreviation;
    const logoUrl = team.logos?.[0]?.href;

    if (!abbr || !logoUrl) continue;

    const outPath = path.join(OUT_DIR, `${abbr}.png`);
    await downloadToFile(logoUrl, outPath);
    count++;
  }

  writeUtahPlaceholder();
  console.log(`Saved ${count} team logos`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
