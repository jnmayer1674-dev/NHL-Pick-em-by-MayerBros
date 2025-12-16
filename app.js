document.addEventListener("DOMContentLoaded", () => {
  try { boot(); } catch (err) {
    console.error(err);
    alert("App crash. Open DevTools Console for details.\n\n" + (err?.stack || err));
  }
});

function boot() {
  const elStatus = must("statusLine");
  const elSubStatus = must("subStatusLine");
  const elModeBtn = must("btnMode");
  const elNewBtn = must("btnNew");

  const elTeamLogo = must("teamLogo");
  const elTeamAbbrev = must("teamAbbrev");
  const elTimer = must("timer");

  const elDraftPos = must("draftPos");
  const elPosFilter = must("posFilter");
  const elSearch = must("search");
  const elPlayersTbody = must("playersTbody");
  const elErrorBox = must("errorBox");
  const elDataStamp = must("dataStamp");

  const elRostersWrap = must("rostersWrap");
  const elSingleExtras = must("singleExtras");
  const elHighScore = must("highScore");
  const elResetHS = must("btnResetHS");

  const STORAGE_KEY_HS = "nhl_pickem_highscore_v9";
  const MODE_SINGLE = "single";
  const MODE_TWO = "two";

  const SLOTS = [
    { key: "C", label: "C", accepts: ["C"], draftPos: "C" },
    { key: "LW", label: "LW", accepts: ["LW"], draftPos: "LW" },
    { key: "RW", label: "RW", accepts: ["RW"], draftPos: "RW" },
    { key: "D1", label: "D", accepts: ["D"], draftPos: "D" },
    { key: "D2", label: "D", accepts: ["D"], draftPos: "D" },
    { key: "G", label: "G", accepts: ["G"], draftPos: "G" },
    { key: "FLEX1", label: "FLEX", accepts: ["C","LW","RW"], draftPos: "FLEX" },
    { key: "FLEX2", label: "FLEX", accepts: ["C","LW","RW"], draftPos: "FLEX" },
  ];

  const LOGO_MAP = { LAK:"LA", NJD:"NJ", TBL:"TB", SJS:"SJ" };

  let allPlayers = [];
  let availablePlayers = [];
  let gameMode = MODE_SINGLE;

  let currentPickIndex = 0;
  let currentTeam = null;
  let remainingTeams = [];
  let timerId = null;
  let timeLeft = 30;

  let selectedSlotKeyByPlayer = { 1:null, 2:null };
  let posFilterTempOverride = false;

  const game = {
    playersCount: 1,
    rosters: { 1:{}, 2:{} },
    scores: { 1:0, 2:0 },
    onClock: 1,
    winner: 0
  };

  function showError(msg){ elErrorBox.textContent=msg; elErrorBox.classList.remove("hidden"); }
  function hideError(){ elErrorBox.textContent=""; elErrorBox.classList.add("hidden"); }

  const urlMode = (new URLSearchParams(location.search).get("mode") || "single").toLowerCase();
  gameMode = (urlMode === "two" || urlMode === "versus") ? MODE_TWO : MODE_SINGLE;

  elModeBtn.onclick = () => location.href = "index.html";
  elNewBtn.onclick = () => startGame(gameMode);
  elSearch.oninput = renderPlayersTable;
  elPosFilter.onchange = () => { posFilterTempOverride=false; renderPlayersTable(); };
  elDraftPos.onchange = renderPlayersTable;

  elResetHS.onclick = () => {
    localStorage.setItem(STORAGE_KEY_HS,"0");
    updateHighScoreUI();
  };

  loadPlayers().then(()=>startGame(gameMode)).catch(err=>{
    showError(err.message);
  });

  async function loadPlayers(){
    const res = await fetch(`data/players.json?v=${Date.now()}`);
    const data = await res.json();
    allPlayers = data.map(p=>({
      id: p.id || `${p.name}-${p.team}-${p.pos}`,
      name: p.name,
      pos: p.pos,
      team: p.team,
      points: Number(p.points)||0
    }));
    elDataStamp.textContent = `Data loaded`;
  }

  function startGame(mode){
    stopTimer();
    gameMode = mode;
    game.playersCount = (mode===MODE_SINGLE)?1:2;
    game.winner = 0;

    game.rosters[1] = makeEmptyRoster();
    game.rosters[2] = makeEmptyRoster();
    game.scores[1]=0; game.scores[2]=0;

    availablePlayers = [...allPlayers];
    remainingTeams = shuffle([...new Set(allPlayers.map(p=>p.team))]);
    currentPickIndex=0;

    elDraftPos.value="AUTO";
    elPosFilter.value="ALL";
    elSearch.value="";

    if(mode===MODE_SINGLE){
      elSingleExtras.classList.remove("hidden");
      updateHighScoreUI();
    } else elSingleExtras.classList.add("hidden");

    nextPick();
  }

  function nextPick(){
    stopTimer();
    const totalPicks = SLOTS.length * game.playersCount;

    if(currentPickIndex>=totalPicks){
      finishGame();
      return;
    }

    game.onClock = (game.playersCount===1)?1:((currentPickIndex%2)===0?1:2);

    if(game.playersCount===1 || currentPickIndex%game.playersCount===0){
      currentTeam = remainingTeams.shift();
      if(!currentTeam){ remainingTeams = shuffle([...new Set(availablePlayers.map(p=>p.team))]); currentTeam=remainingTeams.shift(); }
    }

    updateTeamBadge();
    const round = Math.floor(currentPickIndex/game.playersCount)+1;
    elStatus.textContent = `Mode: ${gameMode==="single"?"Single":"Versus"} • Round ${round} of 8 • Team: ${currentTeam}`;
    elSubStatus.textContent = `On the clock: Player ${game.onClock}`;

    renderRosters();
    renderPlayersTable();

    timeLeft=30;
    elTimer.textContent="30s";
    timerId=setInterval(()=>{
      timeLeft--;
      elTimer.textContent=`${Math.max(0,timeLeft)}s`;
      if(timeLeft<=0){ stopTimer(); autoPick(); }
    },1000);
  }

  function finishGame(){
    stopTimer();
    if(game.playersCount===2){
      if(game.scores[1]>game.scores[2]) game.winner=1;
      else if(game.scores[2]>game.scores[1]) game.winner=2;
    } else updateHighScoreUI();

    elStatus.textContent = game.playersCount===2
      ? `Game complete • ${game.winner===0?"Tie Game":`Player ${game.winner} Wins!`}`
      : "Game complete";

    elSubStatus.textContent = game.playersCount===2
      ? `Final: P1 ${game.scores[1]} — P2 ${game.scores[2]}`
      : `Final Score: ${game.scores[1]}`;

    renderRosters();
  }

  function autoPick(){
    const roster = game.rosters[game.onClock];
    const slot = SLOTS.find(s=>!roster[s.key]);
    if(!slot){ currentPickIndex++; nextPick(); return; }
    const options = availablePlayers.filter(p=>p.team===currentTeam && slot.accepts.includes(p.pos));
    if(!options.length){ currentPickIndex++; nextPick(); return; }
    applyPick(options[Math.floor(Math.random()*options.length)], slot.key);
  }

  function applyPick(player, slotKey){
    game.rosters[game.onClock][slotKey]=player;
    game.scores[game.onClock]+=player.points;
    availablePlayers=availablePlayers.filter(p=>p.id!==player.id);
    elDraftPos.value="AUTO";
    if(posFilterTempOverride){ elPosFilter.value="ALL"; posFilterTempOverride=false; }
    currentPickIndex++;
    nextPick();
  }

  function renderPlayersTable(){
    let list = availablePlayers.filter(p=>p.team===currentTeam);
    if(elPosFilter.value!=="ALL") list=list.filter(p=>p.pos===elPosFilter.value);
    elPlayersTbody.innerHTML=list.map(p=>`
      <tr onclick="window.__pick('${p.id}')">
        <td>${p.name}</td><td>${p.pos}</td><td>${p.team}</td>
      </tr>`).join("");
    window.__pick = id=>{
      const p=availablePlayers.find(x=>x.id===id);
      const slot = SLOTS.find(s=>!game.rosters[game.onClock][s.key] && s.accepts.includes(p.pos));
      if(slot) applyPick(p,slot.key);
    };
  }

  function renderRosters(){
    elRostersWrap.innerHTML=[1,2].slice(0,game.playersCount).map(i=>{
      const win = (game.winner===i)?" winner":"";
      return `<div class="rosterCard${win}">
        <h3>Player ${i}</h3>
        ${SLOTS.map(s=>{
          const p=game.rosters[i][s.key];
          return `<div class="slot">${s.label}: ${p?p.name:"—"}</div>`;
        }).join("")}
      </div>`;
    }).join("");
  }

  function updateTeamBadge(){
    elTeamAbbrev.textContent=currentTeam;
    elTeamLogo.src=`assets/logos/${LOGO_MAP[currentTeam]||currentTeam}.png`;
  }

  function makeEmptyRoster(){ const r={}; SLOTS.forEach(s=>r[s.key]=null); return r; }
  function updateHighScoreUI(){ elHighScore.textContent=localStorage.getItem(STORAGE_KEY_HS)||"0"; }
  function shuffle(a){ return a.sort(()=>Math.random()-0.5); }
  function stopTimer(){ if(timerId) clearInterval(timerId); }
  function must(id){ const el=document.getElementById(id); if(!el) throw new Error(`Missing #${id}`); return el; }
}
