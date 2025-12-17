(function () {
  const mode = document.body.dataset.mode; // "single" | "vs"
  if (!mode) return;

  const TEAM_CODES = [
    "ANA","BOS","BUF","CAR","CBJ","CGY","CHI","COL","DAL","DET","EDM","FLA",
    "LA","MIN","MTL","NJ","NSH","NYI","NYR","OTT","PHI","PIT","SEA","SJ",
    "STL","TB","TOR","UTA","VAN","VGK","WPG","WSH"
  ];

  const SLOT_ORDER = ["C","LW","RW","D","D","G","FLEX","FLEX"];
  const FLEX_ALLOWED = new Set(["C","LW","RW"]);
  const HIGH_SCORE_KEY = "nhl_pickem_highscore_v5";
  const CLOCK_SECONDS = 30;

  const els = {
    heroLogo: document.getElementById("heroLogo"),
    roundPickLine: document.getElementById("roundPickLine"),
    playersList: document.getElementById("playersList"),
    searchInput: document.getElementById("searchInput"),
    clearFilterBtn: document.getElementById("clearFilterBtn"),
    filterLabel: document.getElementById("filterLabel"),
    dataStatus: document.getElementById("dataStatus"),
    endModal: document.getElementById("endModal"),
    endSummary: document.getElementById("endSummary"),
    playAgainBtn: document.getElementById("playAgainBtn"),
    timerText: document.getElementById("timerText"),
  };

  const single = mode === "single" ? {
    rosterList: document.getElementById("rosterList"),
    filledCount: document.getElementById("filledCount"),
    currentScore: document.getElementById("currentScore"),
    highScore: document.getElementById("highScore"),
    newGameBtn: document.getElementById("newGameBtn"),
    resetHighScoreBtn: document.getElementById("resetHighScoreBtn"),
  } : null;

  const vs = mode === "vs" ? {
    p1Roster: document.getElementById("p1Roster"),
    p2Roster: document.getElementById("p2Roster"),
    p1Filled: document.getElementById("p1Filled"),
    p2Filled: document.getElementById("p2Filled"),
    p1Total: document.getElementById("p1Total"),
    p2Total: document.getElementById("p2Total"),
    onClock: document.getElementById("onClock"),
    midLine: document.getElementById("midLine"),
    resetVsBtn: document.getElementById("resetVsBtn"),
    winnerTitle: document.getElementById("winnerTitle"),
    vsTeamMini: document.getElementById("vsTeamMini"),
  } : null;

  let allPlayers = [];
  let draftedIds = new Set();

  // filters / targeting
  let activeSlotFilter = null;  // view filter
  let activeSlotTarget = null;  // target slot for draft placement
  let searchText = "";

  let currentTeam = null;
  let teamBag = [];

  // single state
  let sRoster = Array(8).fill(null);
  let sPickIndex = 0;
  let sScore = 0;
  let highScore = 0;

  // vs state
  let vRoster1 = Array(8).fill(null);
  let vRoster2 = Array(8).fill(null);
  let vPickIndex = 0;

  // clock
  let clockInterval = null;
  let secondsLeft = CLOCK_SECONDS;

  function logoPath(teamCode) { return `assets/logos/${teamCode}.png`; }
  function safeText(v) { return (v ?? "").toString(); }

  function normalizePos(p) {
    if (Array.isArray(p)) return p.map(x => safeText(x).trim().toUpperCase()).filter(Boolean);
    const s = safeText(p).toUpperCase().trim();
    if (!s) return [];
    if (s.includes("/")) return s.split("/").map(x => x.trim()).filter(Boolean);
    if (s.includes(",")) return s.split(",").map(x => x.trim()).filter(Boolean);
    return [s];
  }

  function playerTeam(p) { return safeText(p.team || p.teamAbbrev || p.nhlTeam || p.Team).toUpperCase().trim(); }
  function playerName(p) { return safeText(p.name || p.fullName || p.player || p.Player || "Unknown"); }
  function playerPoints(p) {
    const v = p.draftPoints ?? p.fantasyPoints ?? p.points ?? p.Points ?? 0;
    const num = Number(v);
    return Number.isFinite(num) ? num : 0;
  }
  function playerPosList(p) { return normalizePos(p.pos ?? p.position ?? p.Position ?? p.positions); }
  function playerId(p) {
    return safeText(p.id || p.playerId || p.ID || p.key || (playerName(p) + "|" + playerTeam(p))).trim();
  }

  function sumRoster(roster) {
    return roster.filter(Boolean).reduce((a,p)=>a+playerPoints(p),0);
  }

  function loadHighScore() {
    const raw = localStorage.getItem(HIGH_SCORE_KEY);
    const val = raw ? Number(raw) : 0;
    return Number.isFinite(val) ? val : 0;
  }
  function saveHighScore(val) { localStorage.setItem(HIGH_SCORE_KEY, String(val)); }

  function makeTeamBag() {
    const arr = [...TEAM_CODES];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function setTeam(team) {
    currentTeam = team;
    if (vs?.vsTeamMini) vs.vsTeamMini.textContent = team;
    if (els.heroLogo) {
      els.heroLogo.src = logoPath(team);
      els.heroLogo.onerror = () => { els.heroLogo.src = ""; };
    }
  }

  function updateFilterLabel() {
    if (!els.filterLabel) return;
    if (!activeSlotFilter) els.filterLabel.textContent = "All positions";
    else if (activeSlotFilter === "FLEX") els.filterLabel.textContent = "Filter: FLEX (C/LW/RW)";
    else els.filterLabel.textContent = `Filter: ${activeSlotFilter}`;
  }

  function resetFiltersAfterPick() {
    activeSlotFilter = null;
    activeSlotTarget = null;
    searchText = "";
    if (els.searchInput) els.searchInput.value = "";
    updateFilterLabel();
    if (els.playersList) els.playersList.scrollTop = 0;
  }

  function isEligibleForSlot(player, slot) {
    const pos = new Set(playerPosList(player));
    if (slot === "FLEX") {
      for (const p of pos) if (FLEX_ALLOWED.has(p)) return true;
      return false;
    }
    return pos.has(slot);
  }

  function openSlotIndices(roster) {
    const idxs = [];
    for (let i = 0; i < SLOT_ORDER.length; i++) if (!roster[i]) idxs.push(i);
    return idxs;
  }

  function firstOpenMatchingIndex(roster, player) {
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      if (roster[i]) continue;
      const slot = SLOT_ORDER[i];
      if (isEligibleForSlot(player, slot)) return i;
    }
    return -1;
  }

  function firstOpenIndexForSlot(roster, slot) {
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      if (SLOT_ORDER[i] === slot && !roster[i]) return i;
    }
    return -1;
  }

  function availablePlayersForCurrentTeam() {
    return allPlayers.filter(p => playerTeam(p) === currentTeam && !draftedIds.has(playerId(p)));
  }

  function currentPickerRoster() {
    if (mode === "single") return sRoster;

    const pickNo = vPickIndex + 1;
    const round = Math.ceil(pickNo / 2);
    const firstInRound = pickNo % 2 === 1;

    const p1Turn = (round % 2 === 1) ? firstInRound : !firstInRound;
    return p1Turn ? vRoster1 : vRoster2;
  }

  function onClockLabel() {
    if (mode !== "vs") return "";
    return currentPickerRoster() === vRoster1 ? "Player 1" : "Player 2";
  }

  // Versus: both players draft from the same team for 2 picks, then reroll
  function shouldRerollTeamAfterPick() {
    if (mode === "single") return true;
    return (vPickIndex % 2 === 0); // after pick 2,4,6.. (end of team round)
  }

  function playerCanFillAnyOpenSlot(player, roster) {
    return firstOpenMatchingIndex(roster, player) !== -1;
  }

  function canDraftPlayerNow(player, roster) {
    if (activeSlotTarget) {
      const idx = firstOpenIndexForSlot(roster, activeSlotTarget);
      if (idx === -1) return false;
      return isEligibleForSlot(player, activeSlotTarget);
    }
    return playerCanFillAnyOpenSlot(player, roster);
  }

  function rerollTeamForRoster(roster) {
    const openIdxs = openSlotIndices(roster);
    if (openIdxs.length === 0) return;

    const openSlots = openIdxs.map(i => SLOT_ORDER[i]);

    let attempts = 0;
    while (attempts < 600) {
      if (teamBag.length === 0) teamBag = makeTeamBag();
      const team = teamBag.shift();

      const pool = allPlayers.filter(p => playerTeam(p) === team && !draftedIds.has(playerId(p)));
      const ok = pool.some(pl => openSlots.some(slot => isEligibleForSlot(pl, slot)));
      if (ok) {
        setTeam(team);
        return;
      }
      attempts++;
    }

    setTeam(TEAM_CODES[Math.floor(Math.random() * TEAM_CODES.length)]);
  }

  function renderPlayers() {
    const roster = currentPickerRoster();

    let pool = availablePlayersForCurrentTeam()
      .filter(p => playerCanFillAnyOpenSlot(p, roster));

    // If user clicked a slot, filter to only that slot
    if (activeSlotFilter) pool = pool.filter(p => isEligibleForSlot(p, activeSlotFilter));

    const q = searchText.trim().toLowerCase();
    if (q) {
      pool = pool.filter(p => {
        const n = playerName(p).toLowerCase();
        const m = playerPosList(p).join("/").toLowerCase();
        return n.includes(q) || m.includes(q);
      });
    }

    pool.sort((a,b) => playerName(a).localeCompare(playerName(b)));

    els.playersList.innerHTML = "";

    for (const p of pool) {
      const row = document.createElement("div");
      row.className = "player-row";

      const logo = document.createElement("img");
      logo.className = "player-logo";
      logo.src = logoPath(currentTeam);
      logo.alt = `${currentTeam} logo`;

      const info = document.createElement("div");
      const nm = document.createElement("div");
      nm.className = "player-name";
      nm.textContent = playerName(p);

      const meta = document.createElement("div");
      meta.className = "player-meta";
      meta.textContent = playerPosList(p).join("/") || "—";

      info.appendChild(nm);
      info.appendChild(meta);

      const btn = document.createElement("button");
      btn.className = "draft-btn";
      btn.textContent = "Draft";
      btn.disabled = !canDraftPlayerNow(p, roster);
      btn.addEventListener("click", () => draftPlayer(p, { isAuto: false }));

      row.appendChild(logo);
      row.appendChild(info);
      row.appendChild(btn);
      els.playersList.appendChild(row);
    }
  }

  function updateHeaderLines() {
    if (mode === "single") {
      els.roundPickLine.textContent =
        `Round ${Math.min(sPickIndex + 1, 8)} of 8 • Pick ${Math.min(sPickIndex + 1, 8)} of 8 • Team ${currentTeam || "—"}`;

      if (single?.filledCount) single.filledCount.textContent = String(sRoster.filter(Boolean).length);
      if (single?.currentScore) single.currentScore.textContent = String(Math.round(sScore));
      if (single?.highScore) single.highScore.textContent = String(Math.round(highScore));
    } else {
      const pickNo = vPickIndex + 1;
      const round = Math.ceil(pickNo / 2);
      const line = `Round ${Math.min(round, 8)} of 8 • Pick ${Math.min(pickNo, 16)} of 16 • Team ${currentTeam || "—"}`;
      els.roundPickLine.textContent = line;
      if (vs?.midLine) vs.midLine.textContent = line;
      if (vs?.onClock) vs.onClock.textContent = onClockLabel();

      if (vs?.p1Filled) vs.p1Filled.textContent = String(vRoster1.filter(Boolean).length);
      if (vs?.p2Filled) vs.p2Filled.textContent = String(vRoster2.filter(Boolean).length);

      if (vs?.p1Total) vs.p1Total.textContent = String(Math.round(sumRoster(vRoster1)));
      if (vs?.p2Total) vs.p2Total.textContent = String(Math.round(sumRoster(vRoster2)));
    }
  }

  function makeRosterLogo(teamCode) {
    const img = document.createElement("img");
    img.className = "slot-teamlogo";
    img.alt = teamCode ? `${teamCode} logo` : "";
    if (!teamCode) return img;
    img.src = logoPath(teamCode);
    img.onerror = () => { img.remove(); };
    return img;
  }

  function renderRoster(container, roster) {
    container.innerHTML = "";

    SLOT_ORDER.forEach((slot, i) => {
      const picked = roster[i];

      const row = document.createElement("div");
      row.className = "slot";

      const btn = document.createElement("button");
      btn.className = "slot-btn" + (activeSlotTarget === slot ? " active" : "");
      btn.textContent = slot;

      // Toggle slot targeting + filter
      btn.addEventListener("click", () => {
        const next = (activeSlotTarget === slot) ? null : slot;
        activeSlotTarget = next;
        activeSlotFilter = next;
        updateFilterLabel();
        renderAll();
      });

      const name = document.createElement("div");
      name.className = "slot-name" + (!picked ? " muted" : "");
      name.textContent = picked ? playerName(picked) : "—";

      // ✅ NEW: team logo next to drafted player name
      if (picked) {
        const t = playerTeam(picked);
        const logo = makeRosterLogo(t);
        row.appendChild(btn);
        row.appendChild(logo);
        row.appendChild(name);
      } else {
        row.appendChild(btn);
        row.appendChild(name);
      }

      container.appendChild(row);
    });
  }

  function isDraftOver() {
    if (mode === "single") return sPickIndex >= 8;
    return vPickIndex >= 16;
  }

  function formatTimer(sec) {
    const s = Math.max(0, sec);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm}:${String(ss).padStart(2, "0")}`;
  }

  function setTimerUI() {
    if (els.timerText) els.timerText.textContent = formatTimer(secondsLeft);
  }

  function stopClock() {
    if (clockInterval) {
      clearInterval(clockInterval);
      clockInterval = null;
    }
  }

  function startClockForPick() {
    stopClock();
    secondsLeft = CLOCK_SECONDS;
    setTimerUI();

    if (isDraftOver()) return;
    if (els.endModal && !els.endModal.classList.contains("hidden")) return;

    clockInterval = setInterval(() => {
      secondsLeft--;
      setTimerUI();

      if (secondsLeft <= 0) {
        stopClock();
        autoDraftOnTimeout();
      }
    }, 1000);
  }

  function autoDraftOnTimeout() {
    if (isDraftOver()) return;

    // reset view filters for a clean auto pick
    activeSlotTarget = null;
    activeSlotFilter = null;
    searchText = "";
    if (els.searchInput) els.searchInput.value = "";
    updateFilterLabel();

    const roster = currentPickerRoster();
    const pool = availablePlayersForCurrentTeam();

    let chosenPlayer = null;

    // choose best eligible by points for first open slot in roster order
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      if (roster[i]) continue;
      const slot = SLOT_ORDER[i];

      const eligible = pool.filter(p => isEligibleForSlot(p, slot));
      if (eligible.length === 0) continue;

      eligible.sort((a, b) => playerPoints(b) - playerPoints(a));
      chosenPlayer = eligible[0];
      break;
    }

    // fallback: best points among anyone who can fill anything
    if (!chosenPlayer) {
      const any = pool.filter(p => playerCanFillAnyOpenSlot(p, roster));
      if (any.length) {
        any.sort((a, b) => playerPoints(b) - playerPoints(a));
        chosenPlayer = any[0];
      }
    }

    if (chosenPlayer) draftPlayer(chosenPlayer, { isAuto: true });
    else stopClock();
  }

  function draftPlayer(player, { isAuto }) {
    const roster = currentPickerRoster();
    const id = playerId(player);
    if (draftedIds.has(id)) return;

    let placeIndex = -1;

    // If user targeted a slot manually (and this isn't auto-draft), enforce it
    if (activeSlotTarget && !isAuto) {
      const idx = firstOpenIndexForSlot(roster, activeSlotTarget);
      if (idx === -1) return;
      if (!isEligibleForSlot(player, activeSlotTarget)) return;
      placeIndex = idx;
    } else {
      // Otherwise: draft from list fills first open matching slot, main slots before FLEX
      const idx = firstOpenMatchingIndex(roster, player);
      if (idx === -1) return;
      placeIndex = idx;
    }

    roster[placeIndex] = player;
    draftedIds.add(id);

    if (mode === "single") {
      sScore += playerPoints(player);
      sPickIndex++;

      if (sScore > highScore) {
        highScore = Math.round(sScore);
        saveHighScore(highScore);
      }

      resetFiltersAfterPick();
      if (sPickIndex < 8) rerollTeamForRoster(sRoster);
    } else {
      vPickIndex++;

      resetFiltersAfterPick();
      if (vPickIndex < 16 && shouldRerollTeamAfterPick()) {
        // reroll based on next picker’s open needs
        rerollTeamForRoster(currentPickerRoster());
      }
    }

    renderAll();

    // End states
    if (mode === "single" && sPickIndex >= 8) {
      if (els.endSummary) els.endSummary.textContent = `Final Score: ${Math.round(sScore)} • High Score: ${Math.round(highScore)}`;
      if (els.endModal) els.endModal.classList.remove("hidden");
      stopClock();
      return;
    }

    if (mode === "vs" && vPickIndex >= 16) {
      const p1 = Math.round(sumRoster(vRoster1));
      const p2 = Math.round(sumRoster(vRoster2));

      if (vs?.winnerTitle) {
        if (p1 > p2) vs.winnerTitle.textContent = "PLAYER 1 WINS";
        else if (p2 > p1) vs.winnerTitle.textContent = "PLAYER 2 WINS";
        else vs.winnerTitle.textContent = "TIE";
      }

      if (els.endSummary) els.endSummary.textContent = `Final Score — Player 1: ${p1} • Player 2: ${p2}`;
      if (els.endModal) els.endModal.classList.remove("hidden");
      stopClock();
      return;
    }

    startClockForPick();
  }

  function renderAll() {
    updateHeaderLines();

    if (mode === "single") {
      renderRoster(single.rosterList, sRoster);
      renderPlayers();
    } else {
      renderRoster(vs.p1Roster, vRoster1);
      renderRoster(vs.p2Roster, vRoster2);
      renderPlayers();
    }
  }

  async function loadPlayers() {
    const res = await fetch("data/players.json", { cache:"no-store" });
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.players || []);
    allPlayers = list;

    // remove “Loaded X players…” everywhere
    if (els.dataStatus) els.dataStatus.textContent = "";
  }

  function resetSingle(keepHigh=true) {
    stopClock();
    draftedIds = new Set();
    teamBag = makeTeamBag();
    sRoster = Array(8).fill(null);
    sPickIndex = 0;
    sScore = 0;
    highScore = keepHigh ? loadHighScore() : 0;
    if (!keepHigh) saveHighScore(0);

    resetFiltersAfterPick();
    rerollTeamForRoster(sRoster);
    renderAll();

    if (els.endModal) els.endModal.classList.add("hidden");
    startClockForPick();
  }

  function resetVs() {
    stopClock();
    draftedIds = new Set();
    teamBag = makeTeamBag();
    vRoster1 = Array(8).fill(null);
    vRoster2 = Array(8).fill(null);
    vPickIndex = 0;

    resetFiltersAfterPick();
    rerollTeamForRoster(currentPickerRoster());
    renderAll();

    if (els.endModal) els.endModal.classList.add("hidden");
    startClockForPick();
  }

  function wire() {
    els.searchInput?.addEventListener("input", (e)=>{
      searchText = e.target.value || "";
      renderAll();
    });

    els.clearFilterBtn?.addEventListener("click", ()=>{
      activeSlotFilter = null;
      activeSlotTarget = null;
      updateFilterLabel();
      renderAll();
    });

    els.playAgainBtn?.addEventListener("click", ()=>{
      if (mode === "single") resetSingle(true);
      else resetVs();
    });

    if (mode === "single") {
      single.newGameBtn?.addEventListener("click", ()=> resetSingle(true));
      single.resetHighScoreBtn?.addEventListener("click", ()=>{
        highScore = 0;
        saveHighScore(0);
        renderAll();
      });
    } else {
      vs.resetVsBtn?.addEventListener("click", ()=> resetVs());
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopClock();
      else if (!isDraftOver() && els.endModal && els.endModal.classList.contains("hidden")) startClockForPick();
    });
  }

  (async function init(){
    wire();
    updateFilterLabel();
    await loadPlayers();

    teamBag = makeTeamBag();

    // Always ensure modal is hidden on load
    if (els.endModal) els.endModal.classList.add("hidden");

    if (mode === "single") {
      highScore = loadHighScore();
      rerollTeamForRoster(sRoster);
      renderAll();
      startClockForPick();
    } else {
      rerollTeamForRoster(currentPickerRoster());
      renderAll();
      startClockForPick();
    }
  })();
})();
