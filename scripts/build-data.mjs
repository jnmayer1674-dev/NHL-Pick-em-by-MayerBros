import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "data";
const OUT_FILE = path.join(OUT_DIR, "players.json");

const NHL = "https://api-web.nhle.com/v1";
const SEASON = "20242025";
const GAME_TYPE = 2; // regular season
const TOP_N = 300;

function n(x){ return Number(x ?? 0) || 0; }

function mapTeam(t){
  const s = String(t ?? "").toUpperCase().trim();
  if(!s) return "";
  if(s === "ARI") return "UTAH";
  return s;
}

// CBS Free Fantasy scoring
function cbsSkater(row, pos){
  const p = String(pos || "").toUpperCase();
  const isD = (p === "D");

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

// standings gives us all current NHL team abbrevs reliably
async function getTeams(){
  const data = await j(`${NHL}/standings/now`);
  const set = new Set();
  for(const row of (data?.standings ?? [])){
    const ab = row?.teamAbbrev?.default;
    if(ab) set.add(ab.toUpperCase());
  }
  return Array.from(set).sort();
}

// Club stats is complete for the season and includes the stars
async function getClubStats(teamAbbrev){
  // endpoint returns skaters + goalies season totals for a club
  // (path names can vary slightly; we handle both)
  const data = await j(`${NHL}/club-stats/${teamAbbrev}/${SEASON}/${GAME_TYPE}`);

  const skaters =
    data?.skaters ?? data?.skaterStats ?? data?.skatersStats ?? [];

  const goalies =
    data?.goalies ?? data?.goalieStats ?? data?.goaliesStats ?? [];

  return { skaters, goalies };
}

function normPos(p){
  const s = String(p ?? "").toUpperCase().trim();
  if(s === "L") return "LW";
  if(s === "R") return "RW";
  if(s === "LD" || s === "RD") return "D";
  if(["C","LW","RW","D","G"].includes(s)) return s;
  // sometimes forwards show "F"
  if(s === "F") return "C";
  return s || "C";
}

function playerName(row){
  // club stats usually provide fullName, but fallback
  return String(row.fullName ?? row.name ?? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()).trim();
}

function playerId(row){
  return String(row.playerId ?? row.id ?? row.playerID ?? "").trim();
}

async function main(){
  const teams = await getTeams();
  const players = new Map(); // id -> best row

  for(const team of teams){
    const t = mapTeam(team);
    const { skaters, goalies } = await getClubStats(team);

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

  // sort league-wide and take Top 300
  const outPlayers = Array.from(players.values())
    .sort((a,b) => (b.draftPoints - a.draftPoints) || a.name.localeCompare(b.name))
    .slice(0, TOP_N);

  const meta = {
    generatedAt: new Date().toISOString(),
    seasons: [SEASON],
    count: outPlayers.length,
    scoring: "CBS Sports NHL Fantasy (Free)",
    notes: `Complete 2024–2025 club stats, then Top ${TOP_N} league-wide by CBS fantasy points.`
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ meta, players: outPlayers }, null, 2), "utf8");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
