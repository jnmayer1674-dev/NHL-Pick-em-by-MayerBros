/* NHL Pick’em Draft by MayerBros
   - Static site: HTML/CSS/Vanilla JS
   - Data expected at: data/players.json
   - Logos expected at: assets/logos/TEAM.png (TEAM = ANA, BOS, UTA, etc)
*/

(function () {
  const mode = document.body.dataset.mode; // "single" | "vs" | undefined (home)
  if (!mode) return;

  const TEAM_CODES = [
    "ANA","BOS","BUF","CAR","CBJ","CGY","CHI","COL","DAL","DET","EDM","FLA",
    "LA","MIN","MTL","NJ","NSH","NYI","NYR","OTT","PHI","PIT","SEA","SJ",
    "STL","TB","TOR","UTA","VAN","VGK","WPG","WSH"
  ];

  // ----- DOM -----
  const els = {
    teamLogo: document.getElementById("teamLogo"),
    teamCode: document.getElementById("teamCode"),
    roundPickLine: document.getElementById("roundPickLine"),
    playersList: document.getElementById("playersList"),
    searchInput: document.getElementById("searchInput"),
    clearFilterBtn: document.getElementById("clearFilterBtn"),
    filterLabel: document.getElementById("filterLabel"),
    dataStatus: document.getElementById("dataStatus"),
    endModal: document.getElementById("endModal"),
    endSummary: document.getElementById("endSummary"),
    playAgainBtn: document.getElementById("playAgainBtn"),
  };

  // single-only
  const single = mode === "single" ? {
    rosterList: document.getElementById("rosterList"),
    filledCount: document.getElementById("filledCount"),
    currentScore: document.getElementById("currentScore"),
    highScore: document.getElementById("highScore"),
    newGameBtn: document.getElementById("newGameBtn"),
    resetHighScoreBtn: document.getElementById("resetHighScoreBtn"),
  } : null;

  // vs-only
  const vs = mode === "vs" ? {
    p1Roster: document.getElementById("p1Roster"),
    p2Roster: document.getElementById("p2Roster"),
    p1Filled: document.getElementById("p1Filled"),
    p2Filled: document.getElementById("p2Filled"),
    onClock: document.getElementById("onClock"),
    midLine: document.getElementById("midLine"),
    resetVsBtn: document.getElementById("resetVsBtn"),
    winnerTitle: document.getElementById("winnerTitle"),
    vsTeamMini: document.getElementById("vsTeamMini"),
  } : null;

  // ----- Constants -----
  const SLOT_ORDER = ["C","LW","RW","D","D","G","FLEX","FLEX"];
  const FLEX_ALLOWED = new Set(["C","LW","RW"]);
  const HIGH_SCORE_KEY = "nhl_pickem_highscore_v1";

  // ----- State -----
  let allPlayers = [];         // loaded from JSON
  let draftedIds = new Set();  // globally drafted (per game)
  let teamBag = [];            // remaining teams for this cycle
  let currentTeam = null;

  // filters (must reset after every pick)
  let activeSlotFilter = null; // "C"|"LW"|"RW"|"D"|"G"|"FLEX"|null
  let searchText = "";

  // single state
  let sRoster = [];
  let sPickIndex = 0; // 0..7
  let sScore = 0;
  let highScore = 0;

  // vs state
  let vRoster1 = [];
  let vRoster2 = [];
  let vPickIndex = 0; // 0..15

  // ----- Helpers -----
  function safeText(v) { return (v ?? "").toString(); }

  function loadHighScore() {
    const raw = localStorage.getItem(HIGH_SCORE_KEY);
    const val = raw ? Number(raw) : 0;
    return Number.isFinite(val) ? val : 0;
  }
  function saveHighScore(val) {
    localStorage.setItem(HIGH_SCORE_KEY, String(val));
  }

  function logoPath(teamCode) {
    return `assets/logos/${teamCode}.png`;
  }

  function normalizePos(p) {
    // Accept "C", "LW", "RW", "D", "G" or arrays like ["LW","RW"] or string "LW/RW"
    if (Array.isArray(p)) return p.map(x => safeText(x).trim()).filter(Boolean);
    const s = safeText(p).toUpperCase().trim();
    if (!s) return [];
    if (s.includes("/")) return s.split("/").map(x => x.trim()).filter(Boolean);
    if (s.includes(",")) return s.split(",").map(x => x.trim()).filter(Boolean);
    return [s];
  }

  function playerTeam(p) {
    return safeText(p.team || p.teamAbbrev || p.nhlTeam || p.Team).toUpperCase().trim();
  }
  function playerName(p) {
    return safeText(p.name || p.fullName || p.player || p.Player || "Unknown");
  }
  function playerNumber(p) {
    const n = p.number ?? p.jersey ?? p.sweater ?? p.sweaterNumber ?? "";
    return safeText(n).trim();
  }
  function playerPoints(p) {
    const v = p.draftPoints ?? p.fantasyPoints ?? p.points ?? p.Points ?? 0;
    const num = Number(v);
    return Number.isFinite(num) ? num : 0;
  }
  function playerPosList(p) {
    const raw = p.pos ?? p.position ?? p.Position ?? p.positions;
    return normalizePos(raw);
  }

  function makeTeamBag() {
    const arr = [...TEAM_CODES];
    // shuffle
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function resetFilters() {
    activeSlotFilter = null;
    searchText = "";
    if (els.searchInput) els.searchInput.value = "";
    updateFilterLabel();
    // scroll to top for “broadcast board” feel
    if (els.playersList) els.playersList.scrollTop = 0;
  }

  function updateFilterLabel() {
    if (!els.filterLabel) return;
    if (!activeSlotFilter) {
      els.filterLabel.textContent = "All positions";
    } else if (activeSlotFilter === "FLEX") {
      els.filterLabel.textContent = "Filter: FLEX (C/LW/RW)";
    } else {
      els.filterLabel.textContent = `Filter: ${activeSlotFilter}`;
    }
  }

  function nextOpenSlot(roster) {
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      if (!roster[i]) return SLOT_ORDER[i];
    }
    return null;
  }

  function isEligibleForSlot(player, slot) {
    const pos = new Set(playerPosList(player));
    if (!slot) return false;
    if (slot === "FLEX") {
      for (const p of pos) if (FLEX_ALLOWED.has(p)) return true;
      return false;
    }
    return pos.has(slot);
  }

  function availablePlayersForTeam(teamCode) {
    return allPlayers.filter(p => {
      const tid = safeText(p.id || p.playerId || p.ID || p.key || playerName(p) + "|" + playerTeam(p)).trim();
      if (draftedIds.has(tid)) return false;
      return playerTeam(p) === teamCode;
    });
  }

  function pickTeamThatCanSatisfy(slotNeeded) {
    // A) re-roll until team has at least 1 eligible available player for slotNeeded
    // If teamBag empties, reshuffle and continue
    let attempts = 0;
    while (attempts < 200) {
      if (teamBag.length === 0) teamBag = makeTeamBag();
      const team = teamBag.shift();

      const pool = availablePlayersForTeam(team);
      const ok = pool.some(p => isEligibleForSlot(p, slotNeeded));
      if (ok) return team;

      attempts++;
    }
    // last resort: return any team (shouldn’t happen with real data)
    return TEAM_CODES[Math.floor(Math.random() * TEAM_CODES.length)];
  }

  function setCurrentTeam(teamCode) {
    currentTeam = teamCode;
    if (els.teamCode) els.teamCode.textContent = teamCode;
    if (vs?.vsTeamMini) vs.vsTeamMini.textContent = teamCode;

    if (els.teamLogo) {
      els.teamLogo.src = logoPath(teamCode);
      els.teamLogo.onerror = () => {
        els.teamLogo.src = "";
        els.teamLogo.alt = `Missing logo: ${teamCode}.png`;
      };
    }
  }

  // ----- UI: Roster rendering -----
  function renderRosterSingle() {
    const roster = sRoster;
    single.filledCount.textContent = String(roster.filter(Boolean).length);

    single.rosterList.innerHTML = "";
    SLOT_ORDER.forEach((slot, idx) => {
      const picked = roster[idx];
      const row = document.createElement("div");
      row.className = "slot";

      const btn = document.createElement("button");
      btn.className = "slot-btn" + (activeSlotFilter === slot ? " active" : "");
      btn.textContent = slot;
      btn.addEventListener("click", () => {
        // clicking position filters player list to that slot (current team only)
        activeSlotFilter = (activeSlotFilter === slot) ? null : slot;
        updateFilterLabel();
        renderPlayers();
        // NOTE: pick still goes to next open slot order; filter is just a view
        highlightActiveButtons();
      });

      const name = document.createElement("div");
      name.className = "slot-name" + (!picked ? " muted" : "");
      name.textContent = picked ? playerName(picked) : "—";

      row.appendChild(btn);
      row.appendChild(name);
      single.rosterList.appendChild(row);
    });

    single.currentScore.textContent = String(Math.round(sScore));
    single.highScore.textContent = String(Math.round(highScore));
  }

  function renderRosterVs() {
    const r1 = vRoster1;
    const r2 = vRoster2;

    vs.p1Filled.textContent = String(r1.filter(Boolean).length);
    vs.p2Filled.textContent = String(r2.filter(Boolean).length);

    const build = (container, roster, side) => {
      container.innerHTML = "";
      SLOT_ORDER.forEach((slot, idx) => {
        const picked = roster[idx];
        const row = document.createElement("div");
        row.className = "slot";

        const btn = document.createElement("button");
        btn.className = "slot-btn" + (activeSlotFilter === slot ? " active" : "");
        btn.textContent = slot;
        btn.addEventListener("click", () => {
          activeSlotFilter = (activeSlotFilter === slot) ? null : slot;
          updateFilterLabel();
          renderPlayers();
          highlightActiveButtons();
        });

        const name = document.createElement("div");
        name.className = "slot-name" + (!picked ? " muted" : "");
        name.textContent = picked ? playerName(picked) : "—";

        row.appendChild(btn);
        row.appendChild(name);
        container.appendChild(row);
      });
    };

    build(vs.p1Roster, r1, "p1");
    build(vs.p2Roster, r2, "p2");
  }

  function highlightActiveButtons() {
    // Rerender rosters to update active class (simple + safe)
    if (mode === "single") renderRosterSingle();
    else renderRosterVs();
  }

  // ----- UI: Players rendering -----
  function renderPlayers() {
    if (!els.playersList) return;

    const slotNeeded = (mode === "single")
      ? nextOpenSlot(sRoster)
      : nextOpenSlot(currentPickerRoster());

    const pool = availablePlayersForTeam(currentTeam)
      .filter(p => {
        const name = playerName(p).toLowerCase();
        const meta = playerPosList(p).join("/").toLowerCase();
        const q = searchText.toLowerCase();
        if (q && !name.includes(q) && !meta.includes(q)) return false;

        // filter view (only affects list, not slot assignment)
        if (activeSlotFilter) return isEligibleForSlot(p, activeSlotFilter);
        return true;
      })
      // prefer eligibility for the next required slot so list feels smart
      .sort((a,b) => {
        const ea = isEligibleForSlot(a, slotNeeded) ? 0 : 1;
        const eb = isEligibleForSlot(b, slotNeeded) ? 0 : 1;
        if (ea !== eb) return ea - eb;
        return playerName(a).localeCompare(playerName(b));
      });

    els.playersList.innerHTML = "";

    if (!currentTeam) return;

    if (pool.length === 0) {
      const empty = document.createElement("div");
      empty.className = "note";
      empty.textContent = "No available players for this view. Try clearing the filter.";
      els.playersList.appendChild(empty);
      return;
    }

    for (const p of pool) {
      const row = document.createElement("div");
      row.className = "player-row";

      const logo = document.createElement("img");
      logo.className = "player-logo";
      logo.alt = `${currentTeam} logo`;
      logo.src = logoPath(currentTeam);
      logo.onerror = () => (logo.style.visibility = "hidden");

      const info = document.createElement("div");
      const nm = document.createElement("div");
      nm.className = "player-name";
      nm.textContent = playerName(p);

      const pos = playerPosList(p).join("/");
      const num = playerNumber(p);
      const meta = document.createElement("div");
      meta.className = "player-meta";
      meta.textContent = `${pos || "—"}${num ? ` • #${num}` : ""}`;

      info.appendChild(nm);
      info.appendChild(meta);

      const btn = document.createElement("button");
      btn.className = "draft-btn";
      btn.textContent = "Draft";
      btn.addEventListener("click", () => draftPlayer(p));

      row.appendChild(logo);
      row.appendChild(info);
      row.appendChild(btn);

      els.playersList.appendChild(row);
    }
  }

  // ----- Draft logic -----
  function currentPickerIndexVs() {
    // 16 picks total, 2 per round, snake by round:
    // round 1: P1, P2
    // round 2: P2, P1
    // ...
    const pickNo = vPickIndex + 1; // 1..16
    const round = Math.ceil(pickNo / 2); // 1..8
    const withinRound = (pickNo % 2 === 1) ? 0 : 1; // 0 first, 1 second

    if (round % 2 === 1) {
      return withinRound === 0 ? 0 : 1; // P1 then P2
    } else {
      return withinRound === 0 ? 1 : 0; // P2 then P1
    }
  }

  function currentPickerRoster() {
    if (mode !== "vs") return sRoster;
    return currentPickerIndexVs() === 0 ? vRoster1 : vRoster2;
  }

  function ensureTeamReadyForNextPick() {
    const slotNeeded = (mode === "single")
      ? nextOpenSlot(sRoster)
      : nextOpenSlot(currentPickerRoster());

    if (!slotNeeded) return; // draft complete

    // If current team can't satisfy slotNeeded, re-roll
    if (currentTeam) {
      const pool = availablePlayersForTeam(currentTeam);
      const ok = pool.some(p => isEligibleForSlot(p, slotNeeded));
      if (ok) return;
    }

    const team = pickTeamThatCanSatisfy(slotNeeded);
    setCurrentTeam(team);
  }

  function updateHeaderLines() {
    if (mode === "single") {
      const round = sPickIndex + 1;
      els.roundPickLine.textContent = `Round ${round} of 8 • Pick ${round} of 8`;
    } else {
      const pickNo = vPickIndex + 1; // 1..16
      const round = Math.ceil(pickNo / 2);
      const onClock = currentPickerIndexVs() === 0 ? "Player 1" : "Player 2";
      vs.onClock.textContent = onClock;

      const line = `Round ${round} of 8 • Team ${currentTeam || "—"} • Pick ${pickNo} of 16`;
      els.roundPickLine.textContent = line;
      vs.midLine.textContent = line;
    }
  }

  function assignToNextOpenSlot(roster, player) {
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      if (!roster[i]) {
        const slot = SLOT_ORDER[i];
        if (!isEligibleForSlot(player, slot)) return false;
        roster[i] = player;
        return true;
      }
    }
    return false;
  }

  function draftPlayer(player) {
    // Always draft into next required slot (order-based), not the clicked filter.
    const tid = safeText(player.id || player.playerId || player.ID || player.key || playerName(player) + "|" + playerTeam(player)).trim();
    if (draftedIds.has(tid)) return;

    if (mode === "single") {
      const slotNeeded = nextOpenSlot(sRoster);
      if (!slotNeeded) return;

      // Must be eligible for next slot
      if (!isEligibleForSlot(player, slotNeeded)) return;

      const ok = assignToNextOpenSlot(sRoster, player);
      if (!ok) return;

      draftedIds.add(tid);
      sScore += playerPoints(player);
      sPickIndex++;

      // High score updates live; persists across New Game via localStorage
      if (sScore > highScore) {
        highScore = Math.round(sScore);
        saveHighScore(highScore);
      }

      // After selection: reset filters and ensure next team
      resetFilters();
      ensureTeamReadyForNextPick();
      updateHeaderLines();
      renderRosterSingle();
      renderPlayers();

      // End condition
      if (sPickIndex >= 8) {
        showEndModalSingle();
      }
      return;
    }

    // VS
    const roster = currentPickerRoster();
    const slotNeeded = nextOpenSlot(roster);
    if (!slotNeeded) return;
    if (!isEligibleForSlot(player, slotNeeded)) return;

    const ok = assignToNextOpenSlot(roster, player);
    if (!ok) return;

    draftedIds.add(tid);
    vPickIndex++;

    // After selection: reset filters, reroll team for next pick if needed
    resetFilters();
    ensureTeamReadyForNextPick();
    updateHeaderLines();
    renderRosterVs();
    renderPlayers();

    if (vPickIndex >= 16) {
      showEndModalVs();
    }
  }

  function showEndModalSingle() {
    els.endSummary.textContent = `Final Score: ${Math.round(sScore)} • High Score: ${Math.round(highScore)}`;
    els.endModal.classList.remove("hidden");
  }

  function showEndModalVs() {
    // Determine winner internally; show ONLY winner text (no totals)
    const sum = (roster) => roster.filter(Boolean).reduce((acc,p) => acc + playerPoints(p), 0);
    const p1 = sum(vRoster1);
    const p2 = sum(vRoster2);

    if (p1 > p2) vs.winnerTitle.textContent = "PLAYER 1 WINS";
    else if (p2 > p1) vs.winnerTitle.textContent = "PLAYER 2 WINS";
    else vs.winnerTitle.textContent = "TIE";

    els.endSummary.textContent = "Draft complete.";
    els.endModal.classList.remove("hidden");
  }

  function hideEndModal() {
    els.endModal.classList.add("hidden");
  }

  // ----- Reset / New Game -----
  function resetGameSingle(keepHighScore = true) {
    draftedIds = new Set();
    teamBag = makeTeamBag();
    currentTeam = null;

    sRoster = Array(8).fill(null);
    sPickIndex = 0;
    sScore = 0;

    highScore = keepHighScore ? loadHighScore() : 0;
    if (!keepHighScore) saveHighScore(0);

    resetFilters();
    ensureTeamReadyForNextPick();
    updateHeaderLines();
    renderRosterSingle();
    renderPlayers();
    hideEndModal();
  }

  function resetGameVs() {
    draftedIds = new Set();
    teamBag = makeTeamBag();
    currentTeam = null;

    vRoster1 = Array(8).fill(null);
    vRoster2 = Array(8).fill(null);
    vPickIndex = 0;

    resetFilters();
    ensureTeamReadyForNextPick();
    updateHeaderLines();
    renderRosterVs();
    renderPlayers();
    hideEndModal();
  }

  // ----- Data load -----
  async function loadPlayers() {
    try {
      const res = await fetch("data/players.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // accept either {players:[...]} or [...]
      const list = Array.isArray(data) ? data : (data.players || data.Players || []);
      if (!Array.isArray(list) || list.length === 0) throw new Error("No players in JSON");

      allPlayers = list;

      if (els.dataStatus) {
        els.dataStatus.textContent = `Loaded ${allPlayers.length} players from data/players.json`;
      }
    } catch (e) {
      allPlayers = [];
      if (els.dataStatus) {
        els.dataStatus.textContent =
          "Could not load data/players.json. Make sure your GitHub Action generated it, then refresh.";
      }
      console.error(e);
    }
  }

  // ----- Events -----
  function wireEvents() {
    if (els.searchInput) {
      els.searchInput.addEventListener("input", (ev) => {
        searchText = ev.target.value || "";
        renderPlayers();
      });
    }

    if (els.clearFilterBtn) {
      els.clearFilterBtn.addEventListener("click", () => {
        activeSlotFilter = null;
        updateFilterLabel();
        renderPlayers();
      });
    }

    if (els.playAgainBtn) {
      els.playAgainBtn.addEventListener("click", () => {
        if (mode === "single") resetGameSingle(true);
        else resetGameVs();
      });
    }

    if (mode === "single") {
      single.newGameBtn.addEventListener("click", () => resetGameSingle(true));
      single.resetHighScoreBtn.addEventListener("click", () => {
        highScore = 0;
        saveHighScore(0);
        renderRosterSingle();
      });
    } else {
      vs.resetVsBtn.addEventListener("click", () => resetGameVs());
    }
  }

  // ----- Init -----
  (async function init() {
    wireEvents();
    updateFilterLabel();
    await loadPlayers();

    // If no data, still render shell
    teamBag = makeTeamBag();

    if (mode === "single") {
      highScore = loadHighScore();
      resetGameSingle(true);
    } else {
      resetGameVs();
    }
  })();
})();
