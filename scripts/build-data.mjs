import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "data";
const OUT_FILE = path.join(OUT_DIR, "players.json");

const NHL = "https://api-web.nhle.com/v1";
const SEASON = "20242025";
const GAME_TYPE = 2; // regular season
const TOP_N = 600;

function n(x){ return Number(x ?? 0) || 0; }

// Convert NHL localized objects into strings safely
function text(v){
  if(v === null || v === undefined) return "";
  if(typeof v === "string") return v.trim();
  if(typeof v === "number") return String(v);
  if(typeof v === "object"){
    if(typeof v.default === "string") return v.default.trim();
    if(typeof v.en === "string") return v.en.trim();
  }
  return "";
}

function mapTeam(t){
  const s = String(t ?? "").toUpperCase().trim();
  if(!s) return "";
  if(s === "ARI") return "UTAH";
  return s;
}

function playerId(row){
  const id = row?.playerId ?? row?.id ?? row?.playerID ?? "";
  return String(id).trim();
}

function playerName(row){
  const full = text(row?.fullName) || text(row?.name);
  if(full) return full;

  const first = text(row?.firstName);
  const last = text(row?.lastName);
  const combined = `${first} ${last}`.trim();
  return combined || "";
}

function normPos(rawPos){
  const s = text(rawPos).toUpperCase().trim();
  if(s === "L") return "LW";
  if(s === "R") return "RW";
  if(s === "LD" || s === "RD") return "D";
  if(["C","LW","RW","D","G"].includes(s)) return s;
  if(s === "F") return "C"; // fallback
  return s || "C";
}

// CBS Free Fantasy scoring
function cbsSkater(row, pos){
  const isD = pos === "D";
  const goals = n(row.goals);
  const assists = n(row.assists);
  const ppg = n(row.powerPlayGoals);
  const shg = n(row.shortHandedGoals);
  const plusMinus = n(row.plusMinus);
  const pim = n(row.pim);

  const goalPts = isD ? 5 : 3;
  const assistPts = isD ? 3 : 2;

  return (
    goals * goalPts +
    assists * assistPts +
    ppg * 1 +
    shg * 2 +
    plusMinus * 1 +
    pim * 0.25
  );
}

function cbsGoalie(row){
  const wins = n(row.wins);
  const shutouts = n(row.shutouts);
  const saves = n(row.saves);
  const ga = n(row.goalsAgainst);
  const assists = n(row.assists);
  const pim = n(row.pim);
  const goals = n(row.goals);

  return (
    wins * 5 +
    shutouts * 3 +
    saves * 0.2 +
    ga * -1 +
    assists * 3 +
    pim * 0.25 +
    goals * 5
  );
}

async function j(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return res.json();
}

async function getTeams(){
  const data = await j(`${NHL}/standings/now`);
  const set = new Set();
  for(const row of (data?.standings ?? [])){
    const ab = row?.teamAbbrev?.default ?? row?.teamAbbrev;
    if(ab) set.add(String(ab).toUpperCase());
  }
  return Array.from(set).sort();
}

async function getClubStats(teamAbbrev){
  const data = await j(`${NHL}/club-stats/${teamAbbrev}/${SEASON}/${GAME_TYPE}`);
  const skaters = data?.skaters ?? data?.skaterStats ?? data?.skatersStats ?? [];
  const goalies = data?.goalies ?? data?.goalieStats ?? data?.goaliesStats ?? [];
  return { skaters, goalies };
}

async function main(){
  const teams = await getTeams();
  const players = new Map();

  for(const team of teams){
    const { skaters, goalies } = await getClubStats(team);
    const t = mapTeam(team);

    for(const r of skaters){
      const id = playerId(r);
      const name = playerName(r);
      if(!id || !name) continue;

      const pos = normPos(r.positionCode ?? r.position ?? r.pos);
      const fp = cbsSkater(r, pos);

      players.set(id, {
        id,
        name,
        pos,
        team: t,
        draftPoints: Math.round(fp * 10) / 10,
        bestSeason: SEASON
      });
    }

    for(const r of goalies){
      const id = playerId(r);
      const name = playerName(r);
      if(!id || !name) continue;

      const fp = cbsGoalie(r);

      players.set(id, {
        id,
        name,
        pos: "G",
        team: t,
        draftPoints: Math.round(fp * 10) / 10,
        bestSeason: SEASON
      });
    }
  }

  const outPlayers = Array.from(players.values())
    .sort((a,b) => (b.draftPoints - a.draftPoints) || a.name.localeCompare(b.name))
    .slice(0, TOP_N);

  const meta = {
    generatedAt: new Date().toISOString(),
    seasons: [SEASON],
    count: outPlayers.length,
    scoring: "CBS Sports NHL Fantasy (Free)",
    notes: `Complete 2024–2025 club stats, then Top ${TOP_N} league-wide by CBS fantasy points. Position + name normalization fixed.`
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ meta, players: outPlayers }, null, 2), "utf8");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
