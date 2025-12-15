import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "data";
const OUT_FILE = path.join(OUT_DIR, "players.json");

const API = "https://api.nhle.com/stats/rest/en";
const LIMIT = 1000;
const GAME_TYPE = 2; // regular season

// Eligibility thresholds (LOCKED)
const MIN_GP_SKATER = 51; // GP > 50
const MIN_GP_GOALIE = 16; // GP > 15

function fantasySkater(row){
  return Number(row.points ?? 0) || 0;
}
function fantasyGoalie(row){
  const wins = Number(row.wins ?? 0) || 0;
  const shutouts = Number(row.shutouts ?? 0) || 0;
  const saves = Number(row.saves ?? 0) || 0;
  const ga = Number(row.goalsAgainst ?? 0) || 0;
  return (2*wins) + (3*shutouts) + (0.1*saves) - (1*ga);
}

function mapTeam(abbrev){
  const t = String(abbrev || "").toUpperCase().trim();
  if(!t) return "";
  if(t === "ARI") return "UTAH";
  return t;
}

function lastCompletedSeasonEndYear(now = new Date()){
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return (m >= 7) ? y : (y - 1);
}
function seasonIdFromEndYear(endYear){
  const startYear = endYear - 1;
  return Number(`${startYear}${endYear}`);
}
function lastNSeasons(n = 5){
  const end = lastCompletedSeasonEndYear();
  const seasons = [];
  for(let i=0;i<n;i++){
    const endYear = end - i;
    seasons.push(seasonIdFromEndYear(endYear));
  }
  return seasons;
}

async function fetchPaged(urlBase){
  let start = 0;
  let all = [];
  while(true){
    const url = `${urlBase}&start=${start}&limit=${LIMIT}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
    const json = await res.json();
    const rows = json?.data || [];
    all = all.concat(rows);
    if(rows.length < LIMIT) break;
    start += LIMIT;
  }
  return all;
}

async function getSkaterRows(seasonId){
  const cayenne = encodeURIComponent(`gameTypeId=${GAME_TYPE} and seasonId=${seasonId}`);
  const sort = encodeURIComponent(`[{"property":"points","direction":"DESC"}]`);
  const urlBase = `${API}/skater/summary?isAggregate=false&isGame=false&sort=${sort}&cayenneExp=${cayenne}`;
  return fetchPaged(urlBase);
}

async function getGoalieRows(seasonId){
  const cayenne = encodeURIComponent(`gameTypeId=${GAME_TYPE} and seasonId=${seasonId}`);
  const sort = encodeURIComponent(`[{"property":"wins","direction":"DESC"}]`);
  const urlBase = `${API}/goalie/summary?isAggregate=false&isGame=false&sort=${sort}&cayenneExp=${cayenne}`;
  return fetchPaged(urlBase);
}

function pickBestSeason(eligibleSeasons){
  let best = null;
  for(const s of eligibleSeasons){
    if(!best || s.fantasyPoints > best.fantasyPoints) best = s;
  }
  return best;
}

function posFromRow(row, isGoalie){
  if(isGoalie) return "G";
  const p = String(row.positionCode || "").toUpperCase().trim();
  if(p === "C" || p === "LW" || p === "RW" || p === "D") return p;
  if(p === "LD" || p === "RD") return "D";
  if(p === "F") return "C";
  return p || "C";
}

async function main(){
  const seasons = lastNSeasons(5);
  const players = new Map();

  for(const seasonId of seasons){
    console.log(`Season ${seasonId}…`);
    const [skaters, goalies] = await Promise.all([
      getSkaterRows(seasonId),
      getGoalieRows(seasonId)
    ]);

    for(const r of skaters){
      const id = r.playerId ?? r.playerId2 ?? r.playerId3 ?? r.playerId4 ?? r.playerId5;
      if(!id) continue;

      const gp = Number(r.gamesPlayed ?? 0) || 0;
      if(gp < MIN_GP_SKATER) continue;

      const name = r.skaterFullName || r.playerFullName || r.playerName || r.fullName;
      const team = mapTeam(r.teamAbbrev || r.teamAbbrevs || r.teamAbbreviation || r.team);
      if(!name || !team) continue;

      const fp = fantasySkater(r);
      const pos = posFromRow(r, false);

      const cur = players.get(String(id)) || { id: String(id), name, pos, seasons: [] };
      if(!cur.name) cur.name = name;
      if(!cur.pos) cur.pos = pos;

      cur.seasons.push({ seasonId, team, gp, fantasyPoints: fp });
      players.set(String(id), cur);
    }

    for(const r of goalies){
      const id = r.playerId;
      if(!id) continue;

      const gp = Number(r.gamesPlayed ?? 0) || 0;
      if(gp < MIN_GP_GOALIE) continue;

      const name = r.goalieFullName || r.playerFullName || r.playerName || r.fullName;
      const team = mapTeam(r.teamAbbrev || r.teamAbbrevs || r.teamAbbreviation || r.team);
      if(!name || !team) continue;

      const fp = fantasyGoalie(r);

      const cur = players.get(String(id)) || { id: String(id), name, pos: "G", seasons: [] };
      if(!cur.name) cur.name = name;
      cur.pos = "G";

      cur.seasons.push({ seasonId, team, gp, fantasyPoints: fp });
      players.set(String(id), cur);
    }
  }

  const outPlayers = [];
  for(const p of players.values()){
    if(!p.seasons?.length) continue;
    const best = pickBestSeason(p.seasons);
    if(!best) continue;

    outPlayers.push({
      id: p.id,
      name: p.name,
      pos: p.pos,
      team: best.team,
      draftPoints: Math.round(best.fantasyPoints * 10) / 10,
      bestSeason: String(best.seasonId)
    });
  }

  outPlayers.sort((a,b) => (b.draftPoints - a.draftPoints) || a.name.localeCompare(b.name));

  const meta = {
    generatedAt: new Date().toISOString(),
    seasons: seasons.map(String),
    count: outPlayers.length,
    eligibility: { skaters: "GP>50", goalies: "GP>15" },
    notes: "draftPoints = best eligible season points in last-5 completed seasons; ARI mapped to UTAH."
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ meta, players: outPlayers }, null, 2), "utf8");

  console.log(`Wrote ${OUT_FILE} with ${outPlayers.length} players.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
