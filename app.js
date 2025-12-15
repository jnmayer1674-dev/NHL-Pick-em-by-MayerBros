/* NHL Pick’em by MayerBros — Final
   - Single Player score chase (random team per pick, no repeats)
   - 2 Player Versus snake (2 picks per team-round, 1 each, no repeats)
   - Timer: per PICK (30s). Expire => pass pick.
   - Roster: C, LW, RW, D, D, G, FLEX, FLEX (FLEX = C/LW/RW only)
   - Data: data/players.json built by GitHub Action (last 5 completed seasons)
*/

const SLOT_ORDER = ["C","LW","RW","D","D","G","FLEX","FLEX"];
const FLEX_ALLOWED = new Set(["C","LW","RW"]);
const PICK_TIME = 30;

const TEAM_TO_LOGO = {
  ANA:"ANA", BOS:"BOS", BUF:"BUF", CAR:"CAR", CBJ:"CBJ", CGY:"CGY", CHI:"CHI",
  COL:"COL", DAL:"DAL", DET:"DET", EDM:"EDM", FLA:"FLA", LAK:"LA", LA:"LA",
  MIN:"MIN", MTL:"MTL", NJD:"NJ", NJ:"NJ", NSH:"NSH", NYI:"NYI", NYR:"NYR",
  OTT:"OTT", PHI:"PHI", PIT:"PIT", SEA:"SEA", SJS:"SJ", SJ:"SJ", STL:"STL",
  TBL:"TB", TB:"TB", TOR:"TOR", VAN:"VAN", VGK:"VGK", WPG:"WPG", WSH:"WSH",
  UTAH:"UTAH", ARI:"UTAH" // treat ARI as UTAH for history
};

const el = {
  btnModeSingle: document.getElementById("btnModeSingle"),
  btnModeVersus: document.getElementById("btnModeVersus"),
  btnNewGame: document.getElementById("btnNewGame"),

  statusLine: document.getElementById("statusLine"),
  bestLine: document.getElementById("bestLine"),
  turnLine: document.getElementById("turnLine"),

  teamLogo: document.getElementById("teamLogo"),
  teamName: document.getElementById("teamName"),
  timer: document.getElementById("timer"),

  posFilter: document.getElementById("posFilter"),
  searchInput: document.getElementById("searchInput"),
  playersBody: document.getElementById("playersBody"),
  emptyMsg: document.getElementById("emptyMsg"),
  dataStamp: document.getElementById("dataStamp"),

  p1Score: document.getElementById("p1Score"),
  p2Score: document.getElementById("p2Score"),
  p1Slots: document.getElementById("p1Slots"),
  p2Slots: document.getElementById("p2Slots"),
  winnerLine: document.getElementById("winnerLine"),
};

function normalizePos(posRaw){
  if(!posRaw) return "";
  let p = String(posRaw).toUpperCase().trim();
  if(p === "LD" || p === "RD") return "D";
  if(p.includes("/")) p = p.split("/")[0].trim();
  if(p === "G") return "G";
  if(p === "D") return "D";
  if(p === "C" || p === "LW" || p === "RW") return p;
  if(p === "F") return "C"; // fallback
  return p;
}
function pts(p){ return Number(p.draftPoints ?? p.points ?? 0) || 0; }
function teamCode(t){
  const raw = (t ?? "").toString().trim().toUpperCase();
  if(!raw) return "";
  return TEAM_TO_LOGO[raw] ? raw : raw;
}
function logoFile(team){
  const t = teamCode(team);
  const fileCode = TEAM_TO_LOGO[t] || t;
  return fileCode ? `assets/logos/${fileCode}.png` : "";
}

let allPlayers = [];
let remainingPlayers = [];

let mode = "single"; // "single" or "versus"
let usedTeams = new Set();
let currentTeam = null;

let roundNum = 1;            // team-round number (1,2,3...)
let pickInRound = 0;         // 0 or 1 in versus, always 0 in single
let currentPicker = 1;       // 1 or 2

let timerLeft = PICK_TIME;
let timerHandle = null;

let roster1 = SLOT_ORDER.map(slot => ({slot, player:null}));
let roster2 = SLOT_ORDER.map(slot => ({slot, player:null}));

let score1 = 0;
let score2 = 0;

function setMode(next){
  mode = next;
  el.btnModeSingle.classList.toggle("btn-active", mode==="single");
  el.btnModeVersus.classList.toggle("btn-active", mode==="versus");
  resetGame();
}

function buildTeamListFromRemaining(){
  const s = new Set();
  for(const p of remainingPlayers){
    const t = teamCode(p.team);
    if(t) s.add(t);
  }
  return Array.from(s).sort();
}

function pickRandomTeam(){
  const teams = buildTeamListFromRemaining().filter(t => !usedTeams.has(t));
  if(teams.length === 0) return null;
  return teams[Math.floor(Math.random()*teams.length)];
}

function startTimer(){
  stopTimer();
  timerHandle = setInterval(() => {
    timerLeft -= 1;
    renderHeader();
    if(timerLeft <= 0){
      handleTimerExpire();
    }
  }, 1000);
}
function stopTimer(){
  if(timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function handleTimerExpire(){
  // pass pick
  advancePickOrTeam(true);
}

function bestKey(){
  return mode === "single" ? "nhl_pickem_best_single" : "nhl_pickem_best_versus_p1"; // just track P1 for versus
}
function updateBest(){
  const key = bestKey();
  const stored = Number(localStorage.getItem(key) || "0");
  const current = score1; // single uses P1; versus tracks P1
  const best = Math.max(stored, current);
  localStorage.setItem(key, String(best));
  el.bestLine.textContent = `Best (this browser): ${best}`;
}

function nextOpenSlotIndex(roster, pos){
  const p = normalizePos(pos);

  // exact slots first
  for(let i=0;i<roster.length;i++){
    if(roster[i].player) continue;
    if(roster[i].slot === p) return i;
  }
  // flex
  if(FLEX_ALLOWED.has(p)){
    for(let i=0;i<roster.length;i++){
      if(roster[i].player) continue;
      if(roster[i].slot === "FLEX") return i;
    }
  }
  return -1;
}

function canPickForRoster(roster, player){
  return nextOpenSlotIndex(roster, player.pos) !== -1;
}

function isPickLegal(player){
  if(!currentTeam) return false;
  if(teamCode(player.team) !== teamCode(currentTeam)) return false;
  if(mode === "single") return canPickForRoster(roster1, player);
  return currentPicker === 1 ? canPickForRoster(roster1, player) : canPickForRoster(roster2, player);
}

function applyPick(player){
  if(!isPickLegal(player)) return;

  const targetRoster = (mode === "single" || currentPicker === 1) ? roster1 : roster2;
  const idx = nextOpenSlotIndex(targetRoster, player.pos);
  if(idx === -1) return;

  targetRoster[idx].player = player;

  if(mode === "single" || currentPicker === 1) score1 += pts(player);
  else score2 += pts(player);

  // remove from remaining pool
  remainingPlayers = remainingPlayers.filter(p => String(p.id) !== String(player.id));

  advancePickOrTeam(false);
}

function rosterFilled(roster){
  return roster.every(r => !!r.player);
}

function gameOver(){
  if(!currentTeam) return true;
  if(mode === "single") return rosterFilled(roster1) || pickRandomTeam() === null;
  return (rosterFilled(roster1) && rosterFilled(roster2)) || pickRandomTeam() === null;
}

function snakeOrderForRound(r){
  // odd: P1 then P2. even: P2 then P1
  return (r % 2 === 1) ? [1,2] : [2,1];
}

function advancePickOrTeam(fromTimer){
  stopTimer();

  if(mode === "single"){
    // one pick per team
    usedTeams.add(teamCode(currentTeam));
    roundNum += 1;
    currentTeam = pickRandomTeam();
    timerLeft = PICK_TIME;

    renderAll();

    if(gameOver()){
      finishGame();
      return;
    }
    startTimer();
    return;
  }

  // versus: 2 picks per team-round, exactly one each
  const order = snakeOrderForRound(roundNum);

  if(pickInRound === 0){
    // move to second pick in the same team
    pickInRound = 1;
    currentPicker = order[1];
    timerLeft = PICK_TIME;
    renderAll();

    if(gameOver()){
      finishGame();
      return;
    }
    startTimer();
    return;
  }

  // finished both picks => next team-round
  pickInRound = 0;
  usedTeams.add(teamCode(currentTeam));
  roundNum += 1;
  currentTeam = pickRandomTeam();
  const nextOrder = snakeOrderForRound(roundNum);
  currentPicker = nextOrder[0];
  timerLeft = PICK_TIME;

  renderAll();

  if(gameOver()){
    finishGame();
    return;
  }
  startTimer();
}

function finishGame(){
  stopTimer();
  renderAll();

  if(mode === "single"){
    el.winnerLine.textContent = `Final Score: ${score1}.`;
  } else {
    let msg = `Final — Player 1: ${score1} vs Player 2: ${score2}. `;
    if(score1 > score2) msg += "Player 1 wins.";
    else if(score2 > score1) msg += "Player 2 wins.";
    else msg += "Tie game.";
    el.winnerLine.textContent = msg;
  }
  updateBest();
}

function renderHeader(){
  const team = currentTeam ? teamCode(currentTeam) : "—";
  const displayTeam = currentTeam ? team : "—";

  el.teamName.textContent = displayTeam;
  el.timer.textContent = `${timerLeft}s`;

  const lf = logoFile(team);
  if(lf){
    el.teamLogo.src = lf;
    el.teamLogo.style.display = "block";
  } else {
    el.teamLogo.removeAttribute("src");
    el.teamLogo.style.display = "none";
  }

  if(mode === "single"){
    el.statusLine.textContent = `Mode: Single • Round ${roundNum} • Team: ${displayTeam}`;
    el.turnLine.textContent = `Pick: Player 1`;
  } else {
    const order = snakeOrderForRound(roundNum);
    const pickLabel = pickInRound === 0 ? "Pick 1 of 2" : "Pick 2 of 2";
    el.statusLine.textContent = `Mode: Versus • Round ${roundNum} • Team: ${displayTeam} • ${pickLabel} • Snake: ${order[0]}→${order[1]}`;
    el.turnLine.textContent = `On the clock: Player ${currentPicker}`;
  }

  el.p1Score.textContent = `Score: ${score1}`;
  el.p2Score.textContent = `Score: ${score2}`;

  updateBest();
}

function renderRoster(targetEl, roster){
  targetEl.innerHTML = roster.map(r => {
    const filled = !!r.player;
    const name = filled ? r.player.name : "OPEN";
    const t = filled ? teamCode(r.player.team) : "";
    const p = filled ? pts(r.player) : "";
    const status = filled ? "FILLED" : "OPEN";
    return `
      <div class="slot-row">
        <div class="slot-tag">${r.slot}</div>
        <div class="slot-name">${name}</div>
        <div class="slot-team">${t}</div>
        <div class="slot-pts">${p}</div>
        <div class="slot-status">${status}</div>
      </div>
    `;
  }).join("");
}

function matchesFilters(p){
  const posFilter = (el.posFilter.value || "All").toUpperCase();
  const q = (el.searchInput.value || "").trim().toLowerCase();
  const pPos = normalizePos(p.pos);
  const pName = (p.name || "").toLowerCase();

  if(currentTeam && teamCode(p.team) !== teamCode(currentTeam)) return false;
  if(posFilter !== "ALL" && posFilter !== pPos) return false;
  if(q && !pName.includes(q)) return false;
  return true;
}

function renderPlayers(){
  if(!allPlayers.length){
    el.emptyMsg.classList.remove("hidden");
    el.playersBody.innerHTML = "";
    return;
  }
  el.emptyMsg.classList.add("hidden");

  let list = remainingPlayers.filter(matchesFilters);
  list.sort((a,b) => pts(b) - pts(a));

  el.playersBody.innerHTML = list.map(p => {
    const legal = isPickLegal(p);
    return `
      <tr class="${legal ? "" : "illegal"}" data-id="${p.id}">
        <td>${p.name}</td>
        <td>${normalizePos(p.pos)}</td>
        <td>${teamCode(p.team)}</td>
        <td class="right">${pts(p)}</td>
      </tr>
    `;
  }).join("");

  Array.from(el.playersBody.querySelectorAll("tr")).forEach(tr => {
    tr.addEventListener("click", () => {
      if(tr.classList.contains("illegal")) return;
      const id = tr.getAttribute("data-id");
      const player = remainingPlayers.find(p => String(p.id) === String(id));
      if(player) applyPick(player);
    });
  });
}

function renderAll(){
  renderHeader();
  renderRoster(el.p1Slots, roster1);

  // in single mode, we still show P2 but visually it just stays empty
  if(mode === "single"){
    el.p2Score.textContent = `Score: 0`;
    renderRoster(el.p2Slots, SLOT_ORDER.map(slot => ({slot, player:null})));
  } else {
    renderRoster(el.p2Slots, roster2);
  }
  renderPlayers();
}

function resetGame(){
  stopTimer();

  // clear
  usedTeams = new Set();
  roundNum = 1;
  pickInRound = 0;
  timerLeft = PICK_TIME;

  roster1 = SLOT_ORDER.map(slot => ({slot, player:null}));
  roster2 = SLOT_ORDER.map(slot => ({slot, player:null}));
  score1 = 0;
  score2 = 0;

  remainingPlayers = [...allPlayers];

  currentTeam = pickRandomTeam();

  if(mode === "single") currentPicker = 1;
  else currentPicker = snakeOrderForRound(roundNum)[0];

  el.winnerLine.textContent = "";
  renderAll();

  if(!currentTeam){
    finishGame();
    return;
  }
  startTimer();
}

async function loadPlayers(){
  const res = await fetch("data/players.json", { cache: "no-store" });
  if(!res.ok) throw new Error("Could not load data/players.json");

  const json = await res.json();
  const meta = json.meta || {};
  const raw = Array.isArray(json.players) ? json.players : (Array.isArray(json) ? json : []);
  if(!raw.length) throw new Error("players.json loaded but has no players.");

  el.dataStamp.textContent = meta.generatedAt ? `${meta.generatedAt}` : "loaded";

  // sanitize
  return raw.map((p, i) => ({
    id: p.id ?? `${p.name}-${i}`,
    name: p.name ?? "",
    team: teamCode(p.team),
    pos: normalizePos(p.pos),
    draftPoints: Number(p.draftPoints ?? p.points ?? 0) || 0,
    bestSeason: p.bestSeason ?? ""
  })).filter(p => p.name && p.team && p.pos);
}

function hookUI(){
  el.btnModeSingle.addEventListener("click", () => setMode("single"));
  el.btnModeVersus.addEventListener("click", () => setMode("versus"));
  el.btnNewGame.addEventListener("click", resetGame);

  el.posFilter.addEventListener("change", renderPlayers);
  el.searchInput.addEventListener("input", renderPlayers);
}

(async function init(){
  hookUI();

  try{
    allPlayers = await loadPlayers();
    remainingPlayers = [...allPlayers];
    el.emptyMsg.classList.add("hidden");
    resetGame();
  } catch (err){
    console.error(err);
    el.statusLine.textContent = "Could not load players.json. Run the GitHub Action ‘Build players.json’ then redeploy.";
    el.emptyMsg.classList.remove("hidden");
  }
})();
