const SLOT_ORDER = ["C","LW","RW","D","D","G","FLEX","FLEX"];
const FLEX_ALLOWED = new Set(["C","LW","RW"]);
const PICK_TIME = 30;

const TEAM_TO_LOGO = {
  ANA:"ANA", BOS:"BOS", BUF:"BUF", CAR:"CAR", CBJ:"CBJ", CGY:"CGY", CHI:"CHI",
  COL:"COL", DAL:"DAL", DET:"DET", EDM:"EDM", FLA:"FLA", LAK:"LA", LA:"LA",
  MIN:"MIN", MTL:"MTL", NJD:"NJ", NJ:"NJ", NSH:"NSH", NYI:"NYI", NYR:"NYR",
  OTT:"OTT", PHI:"PHI", PIT:"PIT", SEA:"SEA", SJS:"SJ", SJ:"SJ", STL:"STL",
  TBL:"TB", TB:"TB", TOR:"TOR", VAN:"VAN", VGK:"VGK", WPG:"WPG", WSH:"WSH",
  UTAH:"UTA", ARI:"UTA"
};

const el = {
  modeScreen: document.getElementById("modeScreen"),
  gameScreen: document.getElementById("gameScreen"),

  startSingle: document.getElementById("startSingle"),
  startVersus: document.getElementById("startVersus"),

  btnChangeMode: document.getElementById("btnChangeMode"),
  btnNewGame: document.getElementById("btnNewGame"),
  btnResetHighScore: document.getElementById("btnResetHighScore"),

  statusLine: document.getElementById("statusLine"),
  turnLine: document.getElementById("turnLine"),

  teamLogo: document.getElementById("teamLogo"),
  teamName: document.getElementById("teamName"),
  timer: document.getElementById("timer"),

  posFilter: document.getElementById("posFilter"),
  searchInput: document.getElementById("searchInput"),
  playersBody: document.getElementById("playersBody"),
  emptyMsg: document.getElementById("emptyMsg"),

  rostersOne: document.getElementById("rostersOne"),
  rostersTwo: document.getElementById("rostersTwo"),

  p1Score: document.getElementById("p1Score"),
  p1Slots: document.getElementById("p1Slots"),

  p1Score2: document.getElementById("p1Score2"),
  p1Slots2: document.getElementById("p1Slots2"),

  p2Score: document.getElementById("p2Score"),
  p2Slots: document.getElementById("p2Slots"),

  singleHighScore: document.getElementById("singleHighScore"),
  winnerLine: document.getElementById("winnerLine"),
};

let allPlayers = [];
let remainingPlayers = [];

let mode = null; // "single" | "versus"
let usedTeams = new Set();
let currentTeam = null;

let roundNum = 1;
let pickInRound = 0;
let currentPicker = 1;

let timerLeft = PICK_TIME;
let timerHandle = null;

let roster1 = SLOT_ORDER.map(slot => ({slot, player:null}));
let roster2 = SLOT_ORDER.map(slot => ({slot, player:null}));

let score1 = 0;
let score2 = 0;

let selectedSlotP1 = null;
let selectedSlotP2 = null;

// High Score (persist in localStorage)
let singlePlayerHighScore = Number(localStorage.getItem("singlePlayerHighScore") || 0);

function normalizePos(posRaw){
  if(!posRaw) return "";
  let p = String(posRaw).toUpperCase().trim();
  if(p === "LD" || p === "RD") return "D";
  if(p === "L") return "LW";
  if(p === "R") return "RW";
  if(p.includes("/")) p = p.split("/")[0].trim();
  if(["G","D","C","LW","RW"].includes(p)) return p;
  if(p === "F") return "C";
  return p;
}

function pts(p){ return Number(p.draftPoints ?? 0) || 0; }

function teamCode(t){
  let raw = (t ?? "").toString().trim().toUpperCase();
  if(!raw) return "";
  if(raw.includes(",")){
    raw = raw.split(",").map(x => x.trim()).filter(Boolean).pop() || raw;
  }
  return TEAM_TO_LOGO[raw] ? raw : raw;
}

function logoFile(team){
  const t = teamCode(team);
  const fileCode = TEAM_TO_LOGO[t] || t;
  return fileCode ? `assets/logos/${fileCode}.png` : "";
}

function getSelectedSlot(){
  return (mode === "single" || currentPicker === 1) ? selectedSlotP1 : selectedSlotP2;
}
function setSelectedSlot(idx){
  if(mode === "single" || currentPicker === 1) selectedSlotP1 = idx;
  else selectedSlotP2 = idx;
}
function clearSelectedSlot(){ setSelectedSlot(null); }

function slotAllowsPos(slot, pos){
  const p = normalizePos(pos);
  if(slot === "FLEX") return FLEX_ALLOWED.has(p);
  return slot === p;
}

function showModeScreen(){
  stopTimer();
  mode = null;
  el.modeScreen.classList.remove("hidden");
  el.gameScreen.classList.add("hidden");
}

function startGame(nextMode){
  mode = nextMode;
  el.modeScreen.classList.add("hidden");
  el.gameScreen.classList.remove("hidden");

  if(mode === "single"){
    el.rostersOne.classList.remove("hidden");
    el.rostersTwo.classList.add("hidden");
    el.singleHighScore.style.display = "block";
    el.btnResetHighScore.style.display = "block";
  } else {
    el.rostersOne.classList.add("hidden");
    el.rostersTwo.classList.remove("hidden");
    el.singleHighScore.style.display = "none";
    el.btnResetHighScore.style.display = "none";
  }

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

function snakeOrderForRound(r){
  return (r % 2 === 1) ? [1,2] : [2,1];
}

function startTimer(){
  stopTimer();
  timerHandle = setInterval(() => {
    timerLeft -= 1;
    renderHeader();
    if(timerLeft <= 0) handleTimerExpire();
  }, 1000);
}
function stopTimer(){
  if(timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function handleTimerExpire(){
  advancePickOrTeam(true);
}

function nextOpenSlotIndex(roster, pos){
  const p = normalizePos(pos);
  for(let i=0;i<roster.length;i++){
    if(roster[i].player) continue;
    if(roster[i].slot === p) return i;
  }
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

function activeRoster(){
  if(mode === "single") return roster1;
  return currentPicker === 1 ? roster1 : roster2;
}

function isPickLegal(player){
  if(!currentTeam) return false;
  if(teamCode(player.team) !== teamCode(currentTeam)) return false;

  const roster = activeRoster();
  const sel = getSelectedSlot();

  if(sel !== null){
    const row = roster[sel];
    if(!row || row.player) return false;
    return slotAllowsPos(row.slot, player.pos);
  }
  return canPickForRoster(roster, player);
}

function applyPick(player){
  if(!isPickLegal(player)) return;

  const roster = activeRoster();
  const sel = getSelectedSlot();

  const idx = (sel !== null)
    ? (roster[sel] && !roster[sel].player && slotAllowsPos(roster[sel].slot, player.pos) ? sel : -1)
    : nextOpenSlotIndex(roster, player.pos);

  if(idx === -1) return;

  roster[idx].player = player;

  if(mode === "single" || currentPicker === 1) score1 += pts(player);
  else score2 += pts(player);

  remainingPlayers = remainingPlayers.filter(p => String(p.id) !== String(player.id));

  clearSelectedSlot();
  advancePickOrTeam(false);
}

function rosterFilled(roster){ return roster.every(r => !!r.player); }

function gameOver(){
  if(!currentTeam) return true;
  if(mode === "single") return rosterFilled(roster1) || pickRandomTeam() === null;
  return (rosterFilled(roster1) && rosterFilled(roster2)) || pickRandomTeam() === null;
}

function advancePickOrTeam(fromTimer){
  stopTimer();
  clearSelectedSlot();

  if(mode === "single"){
    usedTeams.add(teamCode(currentTeam));
    roundNum += 1;
    currentTeam = pickRandomTeam();
    timerLeft = PICK_TIME;

    renderAll();
    if(gameOver()) return finishGame();
    return startTimer();
  }

  const order = snakeOrderForRound(roundNum);

  if(pickInRound === 0){
    pickInRound = 1;
    currentPicker = order[1];
    timerLeft = PICK_TIME;
    renderAll();
    if(gameOver()) return finishGame();
    return startTimer();
  }

  pickInRound = 0;
  usedTeams.add(teamCode(currentTeam));
  roundNum += 1;
  currentTeam = pickRandomTeam();

  const nextOrder = snakeOrderForRound(roundNum);
  currentPicker = nextOrder[0];
  timerLeft = PICK_TIME;

  renderAll();
  if(gameOver()) return finishGame();
  return startTimer();
}

function finishGame(){
  stopTimer();
  renderAll();

  if(mode === "single"){
    el.winnerLine.textContent = `Final Score: ${score1}.`;
    if(score1 > singlePlayerHighScore){
      singlePlayerHighScore = score1;
      localStorage.setItem("singlePlayerHighScore", singlePlayerHighScore);
    }
    updateSingleHighScoreUI();
  } else {
    let msg = `Final — Player 1: ${score1} vs Player 2: ${score2}. `;
    msg += score1>score2 ? "Player 1 wins." : score2>score1 ? "Player 2 wins." : "Tie game.";
    el.winnerLine.textContent = msg;
  }
}

function updateSingleHighScoreUI(){
  el.singleHighScore.textContent = `High Score: ${singlePlayerHighScore}`;
}

function renderHeader(){
  const team = currentTeam ? teamCode(currentTeam) : "—";
  el.teamName.textContent = currentTeam ? team : "—";
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
    el.statusLine.textContent = `Mode: Single • Round ${roundNum} • Team: ${team}`;
    el.turnLine.textContent = `On the clock: Player 1`;
    el.p1Score.textContent = `Score: ${score1}`;
  } else {
    const order = snakeOrderForRound(roundNum);
    const pickLabel = pickInRound === 0 ? "Pick 1 of 2" : "Pick 2 of 2";
    el.statusLine.textContent = `Mode: Versus • Round ${roundNum} • Team: ${team} • ${pickLabel} • Snake: ${order[0]}→${order[1]}`;
    el.turnLine.textContent = `On the clock: Player ${currentPicker}`;
    el.p1Score2.textContent = `Score: ${score1}`;
    el.p2Score.textContent = `Score: ${score2}`;
  }
}

function renderRoster(targetEl, roster, isActive){
  targetEl.innerHTML = roster.map((r, i) => {
    const filled = !!r.player;
    const name = filled ? r.player.name : "OPEN";
    const t = filled ? teamCode(r.player.team) : "";
    const status = filled ? "FILLED" : "OPEN";
    const selected = (!filled && isActive && getSelectedSlot() === i) ? "selected" : "";
    return `
      <div class="slot-row ${selected}" data-idx="${i}">
        <div class="slot-tag">${r.slot}</div>
        <div class="slot-name">${name}</div>
        <div class="slot-team">${t}</div>
        <div class="slot-status">${status}</div>
      </div>
    `;
  }).join("");

  Array.from(targetEl.querySelectorAll(".slot-row")).forEach(div => {
    div.addEventListener("click", () => {
      const idx = Number(div.getAttribute("data-idx"));
      if(!isActive) return;
      if(roster[idx].player) return;
      setSelectedSlot(idx);
      renderAll();
    });
  });
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
        <td class="right pts-col">${pts(p)}</td>
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

  if(mode === "single"){
    renderRoster(el.p1Slots, roster1, true);
  } else {
    renderRoster(el.p1Slots2, roster1, currentPicker === 1);
    renderRoster(el.p2Slots, roster2, currentPicker === 2);
  }

  renderPlayers();
}

function resetGame(){
  stopTimer();
  usedTeams = new Set();
  roundNum = 1;
  pickInRound = 0;
  timerLeft = PICK_TIME;

  roster1 = SLOT_ORDER.map(slot => ({slot, player:null}));
  roster2 = SLOT_ORDER.map(slot => ({slot, player:null}));
  score1 = 0;
  score2 = 0;

  selectedSlotP1 = null;
  selectedSlotP2 = null;

  remainingPlayers = [...allPlayers];
  currentTeam = pickRandomTeam();

  currentPicker = (mode === "single") ? 1 : snakeOrderForRound(roundNum)[0];
  el.winnerLine.textContent = "";

  renderAll();

  if(!currentTeam) return finishGame();
  startTimer();
}

async function loadPlayers(){
  const res = await fetch("data/players.json", { cache: "no-store" });
  if(!res.ok) throw new Error("Could not load data/players.json");

  const json = await res.json();
  const raw = Array.isArray(json.players) ? json.players : [];
  if(!raw.length) throw new Error("players.json loaded but has no players.");

  return raw.map((p, i) => ({
    id: p.id ?? `${p.name}-${i}`,
    name: p.name ?? "",
    team: teamCode(p.team),
    pos: normalizePos(p.pos),
    draftPoints: Number(p.draftPoints ?? 0) || 0
  })).filter(p => p.name && p.team && p.pos);
}

function hookUI(){
  el.startSingle.addEventListener("click", () => startGame("single"));
  el.startVersus.addEventListener("click", () => startGame("versus"));

  el.btnChangeMode.addEventListener("click", showModeScreen);
  el.btnNewGame.addEventListener("click", resetGame);

  el.posFilter.addEventListener("change", renderPlayers);
  el.searchInput.addEventListener("input", renderPlayers);

  el.btnResetHighScore.addEventListener("click", () => {
    singlePlayerHighScore = 0;
    localStorage.setItem("singlePlayerHighScore", "0");
    updateSingleHighScoreUI();
  });
}

(async function init(){
  hookUI();
  try{
    allPlayers = await loadPlayers();
    remainingPlayers = [...allPlayers];
    el.emptyMsg.classList.add("hidden");
    updateSingleHighScoreUI();
    showModeScreen();
  } catch (err){
    console.error(err);
    showModeScreen();
    el.emptyMsg.classList.remove("hidden");
  }
})();
