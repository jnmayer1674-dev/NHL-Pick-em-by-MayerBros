import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "data";
const OUT_FILE = path.join(OUT_DIR, "players.json");

const API = "https://api.nhle.com/stats/rest/en";
const LIMIT = 1000;
const GAME_TYPE = 2; // regular season
const SEASONS_BACK = 7;

/* ---------- helpers ---------- */
function n(x){ return Number(x ?? 0) || 0; }
function get(row, keys){
  for(const k of keys){
    if(row && row[k] !== undefined && row[k] !== null) return row[k];
  }
  return 0;
}

/* ---------- CBS FANTASY SCORING ---------- */
/*
CBS Free Fantasy Hockey:
Skaters (C/LW/RW):
  Goal 3, Assist 2, PPG +1, SHG +2, +/- ±1, PIM 0.25
Defense:
  Goal 5, Assist 3, PPG +1, SHG +2, +/- ±1, PIM 0.25
Goalies:
  Win 5, Shutout 3, Save 0.2, GA -1, Assist 3, PIM 0.25, Goal 5
*/

function fantasySkater(row, pos){
  const isD = pos === "D";

  const goals = n(get(row, ["goals","g"]));
  const assists = n(get(row, ["assists","a"]));
  const ppg = n(get(row, ["powerPlayGoals","ppGoals","ppg"]));
  const shg = n(get(row, ["shortHandedGoals","shGoals","shg"]));
  const plusMinus = n(get(row, ["plusMinus","plusminus","plus_minus"]));
  const pim = n(get(row, ["penaltyMinutes","pim"]));

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

function fantasyGoalie(row){
  const wins = n(get(row, ["wins","w"]));
  const shutouts = n(get(row, ["shutouts","so"]));
  const saves = n(get(row, ["saves","s"]));
  const ga = n(get(row, ["goalsAgainst","ga"]));
  const assists = n(get(row, ["assists","a"]));
  const pim = n(get(row, ["penaltyMinutes","pim"]));
  const goals = n(get(row, ["goals","g"]));

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

/* ---------- team / season helpers ---------- */
function mapTeam(abbrev){
  let t = String(abbrev || "").toUpperCase().trim();
  if(!t) return "";
  if(t.includes(",")){
    t = t.split(",").map(x => x.trim()).filter(Boolean).pop();
  }
  if(t === "ARI") return "UTAH";
  return t;
}

function lastCompletedSeasonEndYear(){
  const now = new Date();
  return (now.getUTCMonth() + 1 >= 7) ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}
function seasonIdFromEndYear(endYear){
  return Number(`${endYear - 1}${endYear}`);
}
function lastNSeasons(n){
  const end = lastCompletedSeasonEndYear();
  return Array.from({length:n}, (_,i)=>seasonIdFromEndYear(end-i));
}

/* ---------- fetch helpers ---------- */
async function fetchPaged(urlBase){
  let start = 0;
  let all = [];
  while(true){
    const url = `${urlBase}&start=${start}&limit=${LIMIT}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error(`Fetch failed ${res.status}`);
    const json = await res.json();
    const rows = json?.data || [];
    all = all.concat(rows);
    if(rows.length < LIMIT) break;
    start += LIMIT;
  }
  return all;
}

async function getSkaters(seasonId){
  const cayenne = encodeURIComponent(`gameTypeId=${GAME_TYPE} and seasonId=${seasonId}`);
  const sort = encodeURIComponent(`[{"property":"playerId","direction":"ASC"}]`);
  return fetchPaged(`${API}/skater/summary?isAggregate=false&isGame=false&sort=${sort}&cayenneExp=${cayenne}`);
}

async function getGoalies(seasonId){
  const cayenne = encodeURIComponent(`gameTypeId=${GAME_TYPE} and seasonId=${seasonId}`);
  const sort = encodeURIComponent(`[{"property":"playerId","direction":"ASC"}]`);
  return fetchPaged(`${API}/goalie/summary?isAggregate=false&isGame=false&sort=${sort}&cayenneExp=${cayenne}`);
}

function posFromRow(row, isGoalie){
  if(isGoalie) return "G";
  const p = String(row.positionCode || "").toUpperCase();
  if(p === "L") return "LW";
  if(p === "R") return "RW";
  if(p === "LD" || p === "RD") return "D";
  if(["C","LW","RW","D"].includes(p)) return p;
  return "C";
}

/* ---------- build ---------- */
async function main(){
  const seasons = lastNSeasons(SEASONS_BACK);
  const players = new Map();

  for(const seasonId of seasons){
    const [skaters, goalies] = await Promise.all([
      getSkaters(seasonId),
      getGoalies(seasonId)
    ]);

    for(const r of skaters){
      const id = r.playerId;
      if(!id) continue;

      const name = r.skaterFullName || r.playerFullName || r.fullName;
      const team = mapTeam(r.teamAbbrev || r.teamAbbrevs);
      if(!name || !team) continue;

      const pos = posFromRow(r,false);
      const fp = fantasySkater(r,pos);

      const cur = players.get(id) || { id, name, pos, seasons: [] };
      cur.seasons.push({ seasonId, team, fantasyPoints: fp });
      players.set(id,cur);
    }

    for(const r of goalies){
      const id = r.playerId;
      if(!id) continue;

      const name = r.goalieFullName || r.playerFullName || r.fullName;
      const team = mapTeam(r.teamAbbrev || r.teamAbbrevs);
      if(!name || !team) continue;

      const fp = fantasyGoalie(r);

      const cur = players.get(id) || { id, name, pos:"G", seasons: [] };
      cur.seasons.push({ seasonId, team, fantasyPoints: fp });
      players.set(id,cur);
    }
  }

  const outPlayers = [];
  for(const p of players.values()){
    if(!p.seasons.length) continue;

    const best = p.seasons.reduce((a,b)=>b.fantasyPoints>a.fantasyPoints?b:a);
    const recent = p.seasons.reduce((a,b)=>b.seasonId>a.seasonId?b:a);

    outPlayers.push({
      id: p.id,
      name: p.name,
      pos: p.pos,
      team: recent.team,
      draftPoints: Math.round(best.fantasyPoints * 10) / 10,
      bestSeason: String(best.seasonId)
    });
  }

  outPlayers.sort((a,b)=>b.draftPoints-a.draftPoints);

  const meta = {
    generatedAt: new Date().toISOString(),
    seasons: seasons.map(String),
    count: outPlayers.length,
    scoring: "CBS Sports NHL Fantasy (Free)",
    notes: "draftPoints = highest CBS fantasy season in last 7 completed seasons; team = most recent team in window"
  };

  fs.mkdirSync(OUT_DIR,{recursive:true});
  fs.writeFileSync(OUT_FILE, JSON.stringify({meta, players:outPlayers}, null, 2));
}

main().catch(err=>{
  console.error(err);
  process.exit(1);
});
