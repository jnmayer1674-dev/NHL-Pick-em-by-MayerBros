(() => {
  // ===== Config =====
  const ROSTER_SLOTS = ["C","LW","RW","D","D","G","FLEX","FLEX"];
  const TOTAL_ROUNDS = 8;
  const TURN_SECONDS = 30;

  const LOGO_BASE = "assets/logos/";
  const DEFAULT_LOGO = ""; // if blank, we just keep last valid logo

  const HS_KEY = "nhl_pickem_highscore_v1";

  // ===== DOM =====
  const elStatus = document.getElementById("statusLine");
  const elSubStatus = document.getElementById("subStatusLine");
  const elBtnMode = document.getElementById("btnMode");
  const elBtnNew = document.getElementById("btnNew");

  const elTeamLogo = document.getElementById("teamLogo");
  const elTeamAbbrev = document.getElementById("teamAbbrev");
  const elTimer = document.getElementById("timer");

  const elDraftPos = document.getElementById("draftPos");
  const elPosFilter = document.getElementById("posFilter");
  const elSearch = document.getElementById("search");
  const elStamp = document.getElementById("dataStamp");

  const elPlayersTbody = document.getElementById("playersTbody");
  const elErrorBox = document.getElementById("errorBox");

  const elRostersWrap = document.getElementById("rostersWrap");

  const elSingleExtras = document.getElementById("singleExtras");
  const elHighScore = document.getElementById("highScore");
  const elBtnResetHS = document.getElementById("btnResetHS");

  // ===== State =====
  let mode = "single"; // 'single' | 'two'
  let allPlayers = [];
  let usedPlayerIds = new Set(); // prevent drafting same player twice

  let availableTeams = []; // shuffled once per game
  let usedTeams = new Set();

  let roundIndex = 0; // 0..7
  let pickInRound = 0; // 0 or 1 (two picks per round in both modes)
  let onClock = 0; // player index 0/1

  let timer = TURN_SECONDS;
  let timerHandle = null;

  // selection UX
  let clickedSlotOverride = null;     // e.g. "D" (from roster click)
  let usedTempDraftOverride = false; // only when Draft Position was AUTO and slot was clicked

  // logo fallback
  let lastGoodLogoSrc = "";

  // rosters
  const rosters = [
    makeEmptyRoster("Player 1"),
    makeEmptyRoster("Player 2")
  ];

  function makeEmptyRoster(name){
    return {
      name,
      slots: ROSTER_SLOTS.map((pos, idx) => ({
        idx,
        pos,
        filled: false,
        player: null
      })),
      score: 0
    };
  }

  // ===== Boot =====
  init();

  async function init(){
    // mode from URL
    const params = new URLSearchParams(location.search);
    const m = params.get("mode");
    mode = (m === "two") ? "two" : "single";

    document.body.classList.toggle("mode-two", mode === "two");
    document.body.classList.toggle("mode-single", mode === "single");

    // single extras visibility
    if (elSingleExtras){
      elSingleExtras.style.display = (mode === "single") ? "flex" : "none";
    }

    // buttons
    elBtnMode?.addEventListener("click", () => {
      // go back to main menu
      window.location.href = "index.html";
    });

    elBtnNew?.addEventListener("click", () => {
      resetFilters(true);
      startNewGame();
    });

    elDraftPos?.addEventListener("change", () => {
      // user manually changes it; no extra state needed
      renderPlayers();
    });

    elPosFilter?.addEventListener("change", () => renderPlayers());
    elSearch?.addEventListener("input", () => renderPlayers());

    elBtnResetHS?.addEventListener("click", () => {
      localStorage.setItem(HS_KEY, "0");
      updateHighScoreUI();
    });

    // load players
    await loadPlayers();

    // build rosters UI
    renderRosters();

    // load high score
    updateHighScoreUI();

    // start game
    startNewGame();
  }

  function showError(msg){
    if (!elErrorBox) return;
    elErrorBox.textContent = msg;
    elErrorBox.classList.remove("hidden");
  }
  function clearError(){
    if (!elErrorBox) return;
    elErrorBox.classList.add("hidden");
    elErrorBox.textContent = "";
  }

  async function loadPlayers(){
    clearError();
    try{
      const res = await fetch("data/players.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load data/players.json (HTTP ${res.status})`);
      const data = await res.json();

      // Handle: array, {players:[...]}, {data:[...]}, or map/object
      let raw = null;
      if (Array.isArray(data)) raw = data;
      else if (data && Array.isArray(data.players)) raw = data.players;
      else if (data && Array.isArray(data.data)) raw = data.data;
      else if (data && typeof data === "object") raw = Object.values(data);
      else raw = [];

      // normalize into consistent shape
      allPlayers = raw
        .map((p, i) => normalizePlayer(p, i))
        .filter(p => p && p.name && p.team && p.pos);

      if (!allPlayers.length){
        showError("No players loaded. Check that data/players.json contains an array of players (or {players:[...]}).");
      }

      // stamp
      const now = new Date().toISOString();
      elStamp.textContent = `Data: ${now}`;

      renderPlayers();
    }catch(err){
      showError(err.message || String(err));
      elPlayersTbody.innerHTML = `<tr><td colspan="3" class="muted">No players loaded yet. Make sure players.json is in the data folder.</td></tr>`;
    }
  }

  function normalizePlayer(p, fallbackId){
    if (!p || typeof p !== "object") return null;

    // common field names
    const name = p.name ?? p.player ?? p.fullName ?? p.Player ?? "";
    const team = (p.team ?? p.Team ?? p.abbrev ?? p.teamAbbrev ?? "").toString().toUpperCase().trim();
    const posRaw = (p.pos ?? p.position ?? p.Pos ?? "").toString().toUpperCase().trim();

    // fantasy points field names supported
    const ptsVal = p.points ?? p.draftPoints ?? p.fantasyPoints ?? p.fp ?? p.FP ?? 0;
    const points = Number(ptsVal) || 0;

    // ID to dedupe
    const id = (p.id ?? p.playerId ?? p.pid ?? `${name}|${team}|${posRaw}|${fallbackId}`).toString();

    // normalize positions (sometimes "C/LW" etc — take first)
    let pos = posRaw;
    if (pos.includes("/")) pos = pos.split("/")[0].trim();
    if (pos === "LD" || pos === "RD") pos = "D";
    if (pos === "G" || pos === "GK") pos = "G";

    return {
      id,
      name: String(name).trim(),
      team,
      pos,
      points
    };
  }

  // ===== Game Start / Flow =====
  function startNewGame(){
    stopTimer();

    // reset state
    usedPlayerIds = new Set();
    usedTeams = new Set();

    roundIndex = 0;
    pickInRound = 0;
    onClock = 0;

    // reset rosters
    rosters[0] = makeEmptyRoster("Player 1");
    rosters[1] = makeEmptyRoster("Player 2");

    // shuffle teams from data
    availableTeams = shuffle(uniqueTeamsFromPlayers(allPlayers));
    if (!availableTeams.length){
      setStatus("No teams available (data issue).");
      renderRosters();
      renderPlayers();
      return;
    }

    // clear selection UX
    clickedSlotOverride = null;
    usedTempDraftOverride = false;

    // reset filters (Show Position All, Search blank, DraftPos AUTO)
    resetFilters(true);

    // set first team
    setCurrentTeamForRound();

    // render
    renderRosters();
    renderPlayers();

    // start timer
    timer = TURN_SECONDS;
    startTimer();

    updateHeader();
  }

  function resetFilters(resetDraftPosToo){
    // reset Show Position & Search always
    if (elPosFilter) elPosFilter.value = "ALL";
    if (elSearch) elSearch.value = "";
    clickedSlotOverride = null;

    if (resetDraftPosToo && elDraftPos){
      elDraftPos.value = "AUTO";
      usedTempDraftOverride = false;
    }
    renderPlayers();
  }

  function updateHeader(extraMsg=""){
    const team = getCurrentTeam();
    const roundText = `Round ${roundIndex + 1} of ${TOTAL_ROUNDS}`;
    const pickText = `Pick ${roundIndex * 2 + pickInRound + 1} of ${TOTAL_ROUNDS * 2}`;
    const modeText = (mode === "two") ? "Versus" : "Single";

    const onClockName = (mode === "two") ? rosters[onClock].name : "Player 1";

    setStatus(`Mode: ${modeText} • ${roundText} • ${pickText} • Team: ${team}`);
    setSubStatus(`On the clock: ${onClockName}. Choose Draft Position then click a player.`);
    if (extraMsg) setSubStatus(extraMsg);

    setTeamBadge(team);
  }

  function setStatus(text){
    if (elStatus) elStatus.textContent = text;
  }
  function setSubStatus(text){
    if (elSubStatus) elSubStatus.textContent = text;
  }

  function setTeamBadge(team){
    if (elTeamAbbrev) elTeamAbbrev.textContent = team;

    const src = logoForTeam(team);

    // keep last good logo instead of broken at end
    if (src){
      elTeamLogo.src = src;
      elTeamLogo.onerror = () => {
        // revert to last good; if none, hide
        if (lastGoodLogoSrc){
          elTeamLogo.src = lastGoodLogoSrc;
        } else {
          elTeamLogo.removeAttribute("src");
        }
      };
      lastGoodLogoSrc = src;
    } else {
      // if we don't have a source, keep lastGoodLogoSrc
      if (lastGoodLogoSrc){
        elTeamLogo.src = lastGoodLogoSrc;
      } else {
        elTeamLogo.removeAttribute("src");
      }
    }
  }

  function logoForTeam(team){
    if (!team) return "";
    return `${LOGO_BASE}${team}.png`;
  }

  function uniqueTeamsFromPlayers(players){
    const s = new Set();
    for (const p of players){
      if (p.team) s.add(p.team.toUpperCase());
    }
    return [...s];
  }

  function setCurrentTeamForRound(){
    // each round uses a single team, used once per game
    const next = availableTeams.find(t => !usedTeams.has(t));
    if (!next){
      // no more teams; end game
      finishGame();
      return;
    }
    usedTeams.add(next);
    // store on window for easy access
    window.__currentRoundTeam = next;
  }

  function getCurrentTeam(){
    return window.__currentRoundTeam || "—";
  }

  function advanceTurnAfterPick(){
    // After any pick: reset Show Position to All and clear slot click override
    if (elPosFilter) elPosFilter.value = "ALL";
    clickedSlotOverride = null;

    // Also: if Draft Position was AUTO and we temporarily overrode it via slot-click,
    // revert it back to AUTO now.
    if (usedTempDraftOverride && elDraftPos){
      elDraftPos.value = "AUTO";
      usedTempDraftOverride = false;
    }

    // advance pick
    pickInRound++;

    if (mode === "two"){
      // two picks per round; snake who picks first each round
      // odd rounds: P1 first, even rounds: P2 first
      if (pickInRound === 1){
        // second pick of round
        onClock = (roundIndex % 2 === 0) ? 1 : 0;
      } else {
        // round over
        roundIndex++;
        pickInRound = 0;

        if (roundIndex >= TOTAL_ROUNDS){
          finishGame();
          return;
        }
        // new round team
        setCurrentTeamForRound();

        // first picker next round (snake)
        onClock = (roundIndex % 2 === 0) ? 0 : 1;
      }
    } else {
      // single: always player 1, but still 2 picks per round for "team by team" cadence
      if (pickInRound >= 2){
        roundIndex++;
        pickInRound = 0;

        if (roundIndex >= TOTAL_ROUNDS){
          finishGame();
          return;
        }
        setCurrentTeamForRound();
      }
      onClock = 0;
    }

    // reset timer each pick
    timer = TURN_SECONDS;
    renderPlayers();
    renderRosters();
    updateHeader();
  }

  function finishGame(){
    stopTimer();
    renderPlayers();
    renderRosters();

    if (mode === "single"){
      const score = rosters[0].score;
      setStatus("Game complete.");
      setSubStatus(`Final: ${score.toFixed(1)}`);

      // high score update
      const hs = Number(localStorage.getItem(HS_KEY) || "0") || 0;
      if (score > hs){
        localStorage.setItem(HS_KEY, String(score));
        updateHighScoreUI();
      }

      // keep last logo (do nothing to logo)
      return;
    }

    // Versus: declare winner + highlight
    const s1 = rosters[0].score;
    const s2 = rosters[1].score;

    let msg = `Final: P1 ${s1.toFixed(1)} — P2 ${s2.toFixed(1)}`;
    if (s1 > s2) msg += " • Winner: Player 1 🏆";
    else if (s2 > s1) msg += " • Winner: Player 2 🏆";
    else msg += " • Tie 🤝";

    setStatus("Game complete.");
    setSubStatus(msg);

    // winner highlight applied in renderRosters()
  }

  // ===== Timer =====
  function startTimer(){
    stopTimer();
    timerHandle = setInterval(() => {
      timer--;
      if (timer < 0) timer = 0;
      if (elTimer) elTimer.textContent = `${timer}s`;

      if (timer === 0){
        // auto-pick first open slot with random legal player
        autoPick();
      }
    }, 1000);
    if (elTimer) elTimer.textContent = `${timer}s`;
  }

  function stopTimer(){
    if (timerHandle){
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function autoPick(){
    // prevent repeated auto picks at 0
    if (!timerHandle) return;

    // pick a slot
    const roster = rosters[onClock];
    const firstOpen = roster.slots.find(s => !s.filled);
    if (!firstOpen){
      // roster full
      advanceTurnAfterPick();
      return;
    }

    const team = getCurrentTeam();
    const pool = eligiblePlayersFor(team, firstOpen.pos)
      .filter(p => !usedPlayerIds.has(p.id));

    if (!pool.length){
      // if no legal player for that slot/team, try next open slots
      const openSlots = roster.slots.filter(s => !s.filled);
      for (const s of openSlots){
        const pool2 = eligiblePlayersFor(team, s.pos).filter(p => !usedPlayerIds.has(p.id));
        if (pool2.length){
          const pick = pool2[Math.floor(Math.random() * pool2.length)];
          applyPick(pick, s.idx, true);
          return;
        }
      }
      // no legal players at all for this team -> advance
      advanceTurnAfterPick();
      return;
    }

    const player = pool[Math.floor(Math.random() * pool.length)];
    applyPick(player, firstOpen.idx, true);
  }

  // ===== Rendering =====
  function renderPlayers(){
    if (!elPlayersTbody) return;

    const team = getCurrentTeam();
    const search = (elSearch?.value || "").trim().toLowerCase();
    const showPos = elPosFilter?.value || "ALL";

    // If user clicked a roster slot while Draft Position is AUTO, filter list to that slot's legal positions.
    const slotFilter = clickedSlotOverride;

    let list = allPlayers.filter(p => p.team === team);
    list = list.filter(p => !usedPlayerIds.has(p.id));

    // show position dropdown filter
    if (showPos !== "ALL"){
      list = list.filter(p => p.pos === showPos);
    }

    // roster slot click filter (stronger filter)
    if (slotFilter){
      if (slotFilter === "FLEX"){
        list = list.filter(p => ["C","LW","RW"].includes(p.pos));
      } else {
        list = list.filter(p => p.pos === slotFilter);
      }
    }

    if (search){
      list = list.filter(p => p.name.toLowerCase().includes(search));
    }

    // sort by points desc
    list.sort((a,b) => (b.points - a.points) || a.name.localeCompare(b.name));

    if (!list.length){
      elPlayersTbody.innerHTML = `<tr><td colspan="3" class="muted">No eligible players for this team/filters.</td></tr>`;
      return;
    }

    const rows = list.slice(0, 300).map(p => {
      return `
        <tr data-pid="${escapeHtml(p.id)}">
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(p.pos)}</td>
          <td>${escapeHtml(p.team)}</td>
        </tr>
      `;
    }).join("");

    elPlayersTbody.innerHTML = rows;

    // click handlers
    [...elPlayersTbody.querySelectorAll("tr[data-pid]")].forEach(tr => {
      tr.addEventListener("click", () => {
        const pid = tr.getAttribute("data-pid");
        const player = allPlayers.find(x => x.id === pid);
        if (!player) return;
        handlePlayerClick(player);
      });
    });
  }

  function renderRosters(){
    if (!elRostersWrap) return;

    // winner highlight (versus end only)
    const gameOver = (roundIndex >= TOTAL_ROUNDS);
    const s1 = rosters[0].score;
    const s2 = rosters[1].score;
    const p1Winner = (mode === "two" && gameOver && s1 > s2);
    const p2Winner = (mode === "two" && gameOver && s2 > s1);

    elRostersWrap.innerHTML = "";

    const panels = (mode === "two") ? [0,1] : [0];

    for (const i of panels){
      const r = rosters[i];
      const panel = document.createElement("div");
      panel.className = "rosterPanel";
      if (i === 0 && p1Winner) panel.classList.add("winner");
      if (i === 1 && p2Winner) panel.classList.add("winner");

      const top = document.createElement("div");
      top.className = "rosterTop";
      top.innerHTML = `
        <div class="rosterName">${r.name}</div>
        <div class="rosterScore">Score: ${r.score.toFixed(1)}</div>
      `;
      panel.appendChild(top);

      r.slots.forEach(slot => {
        const row = document.createElement("div");
        row.className = "slotRow";
        row.setAttribute("data-slot-idx", String(slot.idx));
        row.setAttribute("data-roster", String(i));

        const playerName = slot.player ? slot.player.name : "—";
        const team = slot.player ? slot.player.team : "—";
        const state = slot.filled ? "FILLED" : "OPEN";

        row.innerHTML = `
          <div class="slotPos">${slot.pos}</div>
          <div class="slotPlayer">${escapeHtml(playerName)}</div>
          <div class="slotTeam">${escapeHtml(team)}</div>
          <div class="slotState ${slot.filled ? "filled" : ""}">${state}</div>
        `;

        // clicking a slot should:
        // - filter list to that position
        // - if Draft Position is AUTO, temporarily override just for this pick (then revert after pick)
        row.addEventListener("click", () => {
          // ignore clicks on FILLED slots
          if (slot.filled) return;

          // Only allow selecting a slot for the player who is currently on the clock
          if (mode === "two" && i !== onClock) return;
          if (mode === "single" && i !== 0) return;

          clickedSlotOverride = slot.pos;

          // Set Show Position dropdown:
          if (slot.pos === "FLEX"){
            // no FLEX in show dropdown; keep All but filter via slot override
            if (elPosFilter) elPosFilter.value = "ALL";
          } else {
            if (elPosFilter) elPosFilter.value = slot.pos;
          }

          // If Draft Position is AUTO, temporarily set Draft Position to this slot
          if (elDraftPos && elDraftPos.value === "AUTO"){
            elDraftPos.value = slot.pos;
            usedTempDraftOverride = true;
          }

          renderPlayers();
        });

        panel.appendChild(row);
      });

      elRostersWrap.appendChild(panel);
    }
  }

  function updateHighScoreUI(){
    if (!elHighScore) return;
    const hs = Number(localStorage.getItem(HS_KEY) || "0") || 0;
    elHighScore.textContent = hs.toFixed(1);
  }

  // ===== Picking Logic =====
  function handlePlayerClick(player){
    // Determine which slot index to fill
    const roster = rosters[onClock];
    if (!roster) return;

    let targetSlotIdx = null;

    const draftChoice = elDraftPos?.value || "AUTO";

    if (draftChoice === "AUTO"){
      // If AUTO: choose first legal open slot based on player pos
      targetSlotIdx = findFirstLegalSlotIdxForPlayer(roster, player);
    } else {
      // User specified a position:
      // fill the first open slot matching that choice
      targetSlotIdx = findFirstOpenSlotIdxOfType(roster, draftChoice);
      // If they chose FLEX, must be C/LW/RW player
      if (draftChoice === "FLEX" && !["C","LW","RW"].includes(player.pos)){
        flashSubStatus("Illegal pick: FLEX accepts C/LW/RW only.");
        return;
      }
      // If they chose D/G etc, must match
      if (draftChoice !== "FLEX" && draftChoice !== player.pos){
        flashSubStatus("Illegal pick for selected Draft Position.");
        return;
      }
    }

    if (targetSlotIdx == null){
      flashSubStatus("No open legal slot available for that player.");
      return;
    }

    // Validate legality against the slot type
    const slotType = roster.slots[targetSlotIdx].pos;
    if (!isPlayerLegalForSlot(player, slotType)){
      flashSubStatus("Illegal pick for that roster slot.");
      return;
    }

    applyPick(player, targetSlotIdx, false);
  }

  function applyPick(player, slotIdx, wasAuto){
    // Apply to roster
    const roster = rosters[onClock];
    const slot = roster.slots[slotIdx];
    if (!slot || slot.filled) return;

    // Prevent duplicates
    if (usedPlayerIds.has(player.id)) return;

    slot.filled = true;
    slot.player = player;
    roster.score += player.points;
    usedPlayerIds.add(player.id);

    // After ANY pick:
    // - reset Show Position to All
    // - reset Draft Position back to AUTO only if it was a temporary override
    // - reset roster slot override filter
    if (elPosFilter) elPosFilter.value = "ALL";
    clickedSlotOverride = null;

    if (usedTempDraftOverride && elDraftPos){
      elDraftPos.value = "AUTO";
      usedTempDraftOverride = false;
    }

    // If user had Draft Position set to a fixed non-AUTO, we leave it alone.

    // Render
    renderRosters();
    renderPlayers();

    // In single, update high score only at end; not here

    // Advance game
    timer = TURN_SECONDS;
    if (elTimer) elTimer.textContent = `${timer}s`;

    advanceTurnAfterPick();
  }

  function flashSubStatus(msg){
    setSubStatus(msg);
    setTimeout(() => {
      updateHeader();
    }, 1300);
  }

  function isPlayerLegalForSlot(player, slotType){
    if (slotType === "FLEX"){
      return ["C","LW","RW"].includes(player.pos);
    }
    return player.pos === slotType;
  }

  function findFirstOpenSlotIdxOfType(roster, type){
    if (type === "D"){
      // first open D among the two D slots
      const idx = roster.slots.findIndex(s => !s.filled && s.pos === "D");
      return idx >= 0 ? idx : null;
    }
    return findFirstOpenSlotIdxMatching(roster, s => !s.filled && s.pos === type);
  }

  function findFirstLegalSlotIdxForPlayer(roster, player){
    // Priority:
    // 1) exact pos slots (C/LW/RW/D/G)
    // 2) FLEX if skater and no exact slot available
    const exactIdx = roster.slots.findIndex(s => !s.filled && s.pos === player.pos);
    if (exactIdx >= 0) return exactIdx;

    if (["C","LW","RW"].includes(player.pos)){
      const flexIdx = roster.slots.findIndex(s => !s.filled && s.pos === "FLEX");
      if (flexIdx >= 0) return flexIdx;
    }
    return null;
  }

  function findFirstOpenSlotIdxMatching(roster, predicate){
    for (let i=0;i<roster.slots.length;i++){
      if (predicate(roster.slots[i])) return i;
    }
    return null;
  }

  function eligiblePlayersFor(team, slotType){
    let list = allPlayers.filter(p => p.team === team);
    if (slotType === "FLEX"){
      list = list.filter(p => ["C","LW","RW"].includes(p.pos));
    } else {
      list = list.filter(p => p.pos === slotType);
    }
    return list.filter(p => !usedPlayerIds.has(p.id));
  }

  // ===== Utils =====
  function shuffle(arr){
    const a = [...arr];
    for (let i=a.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function escapeHtml(s){
    return String(s)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }
})();
