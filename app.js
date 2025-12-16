/* NHL Pick’em by MayerBros — TWO-PAGE VERSION (index.html -> game.html)
   Draft behavior:
   - Draft Position dropdown:
       * AUTO = click any player, auto-fills first open matching slot (uses FLEX for C/LW/RW if needed)
       * C/LW/RW/D/G/FLEX = list filters to eligible + click player fills the first open slot of that type
   - Timer hits 0 => auto-pick (auto-select first open slot and random legal player)
   - High score persists ONLY in single mode, never shown in 2P
   - Logos mapped to your filenames (LA.png, NJ.png, TB.png, SJ.png)
*/

(function () {
  // Guard: only run on game page
  if (!document.getElementById("playersTbody")) return;

  // ---------- DOM ----------
  const elStatus = document.getElementById("statusLine");
  const elSubStatus = document.getElementById("subStatusLine");
  const elModeBtn = document.getElementById("btnMode");
  const elNewBtn = document.getElementById("btnNew");

  const elTeamLogo = document.getElementById("teamLogo");
  const elTeamAbbrev = document.getElementById("teamAbbrev");
  const elTimer = document.getElementById("timer");

  const elDraftPos = document.getElementById("draftPos");
  const elPosFilter = document.getElementById("posFilter");
  const elSearch = document.getElementById("search");
  const elPlayersTbody = document.getElementById("playersTbody");
  const elErrorBox = document.getElementById("errorBox");
  const elDataStamp = document.getElementById("dataStamp");

  const elRostersWrap = document.getElementById("rostersWrap");
  const elSingleExtras = document.getElementById("singleExtras");
  const elHighScore = document.getElementById("highScore");
  const elResetHS = document.getElementById("btnResetHS");

  // ---------- CONSTANTS ----------
  const STORAGE_KEY_HS = "nhl_pickem_highscore_v4";
  const MODE_SINGLE = "single";
  const MODE_TWO = "two";

  const SLOTS = [
    { key: "C", label: "C", accepts: ["C"] },
    { key: "LW", label: "LW", accepts: ["LW"] },
    { key: "RW", label: "RW", accepts: ["RW"] },
    { key: "D1", label: "D", accepts: ["D"] },
    { key: "D2", label: "D", accepts: ["D"] },
    { key: "G", label: "G", accepts: ["G"] },
    { key: "FLEX1", label: "FLEX", accepts: ["C", "LW", "RW"] },
    { key: "FLEX2", label: "FLEX", accepts: ["C", "LW", "RW"] },
  ];

  const LOGO_MAP = {
    LAK: "LA",
    NJD: "NJ",
    TBL: "TB",
    SJS: "SJ",
  };

  // ---------- STATE ----------
  let allPlayers = [];
  let availablePlayers = [];
  let gameMode = MODE_SINGLE;

  let currentPickIndex = 0;
  let currentTeam = null;
  let remainingTeams = [];

  let timerId = null;
  let timeLeft = 30;

  const game = {
    playersCount: 1,
    rosters: { 1: makeEmptyRoster(), 2: makeEmptyRoster() },
    scores: { 1: 0, 2: 0 },
    onClock: 1,
  };

  // ---------- URL MODE ----------
  const urlMode = (new URLSearchParams(window.location.search).get("mode") || "single").toLowerCase();
  gameMode = (urlMode === "two" || urlMode === "versus" || urlMode === "vs") ? MODE_TWO : MODE_SINGLE;

  // ---------- EVENTS ----------
  elModeBtn.addEventListener("click", () => {
    // go back to the separate mode page
    stopTimer();
    window.location.href = "index.html";
  });

  elNewBtn.addEventListener("click", () => {
    startGame(gameMode);
  });

  elDraftPos.addEventListener("change", () => {
    renderRosters();
    renderPlayersTable();
  });
  elPosFilter.addEventListener("change", renderPlayersTable);
  elSearch.addEventListener("input", renderPlayersTable);

  elResetHS.addEventListener("click", () => {
    localStorage.setItem(STORAGE_KEY_HS, "0");
    updateHighScoreUI();
  });

  // ---------- INIT ----------
  loadPlayers()
    .then(() => {
      startGame(gameMode);
    })
    .catch((err) => {
      showError(
        "Failed to load data/players.json.\n\n" +
        "Common causes:\n" +
        "- players.json not valid JSON\n" +
        "- missing name/pos/team fields\n\n" +
        String(err)
      );
      elStatus.textContent = "Error loading players.";
      elSubStatus.textContent = "";
    });

  // ---------- DATA ----------
  async function loadPlayers() {
    hideError();

    const url = new URL("data/players.json", window.location.href);
    url.searchParams.set("v", String(Date.now()));

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url.pathname}`);

    const raw = await res.json();
    const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.players) ? raw.players : null);
    if (!arr) throw new Error("players.json must be an array or { players: [...] }.");

    allPlayers = arr.map(normalizePlayer).filter(Boolean);
    if (!allPlayers.length) throw new Error("players.json loaded but 0 valid players after normalization.");

    elDataStamp.textContent = `Data: ${new Date().toISOString()}`;
  }

  function normalizePlayer(p) {
    const name = p.name ?? p.player ?? p.fullName ?? p.Player ?? p.PLAYER ?? p.playerName ?? null;
    const pos = p.pos ?? p.position ?? p.Position ?? p.POS ?? null;
    const team = p.team ?? p.teamAbbrev ?? p.Team ?? p.TEAM ?? p.team_abbrev ?? null;
    const points = p.points ?? p.fantasyPoints ?? p.fp ?? p.FP ?? p.totalPoints ?? p.draftPoints ?? 0;

    if (!name || !pos || !team) return null;

    const cleanPos = String(pos).toUpperCase().trim();
    const cleanTeam = String(team).toUpperCase().trim();
    const allowed = ["C", "LW", "RW", "D", "G"];
    if (!allowed.includes(cleanPos)) return null;

    return {
      id: String(p.id ?? `${name}-${cleanTeam}-${cleanPos}`),
      name: String(name).trim(),
      pos: cleanPos,
      team: cleanTeam,
      points: Number(points) || 0
    };
  }

  // ---------- GAME ----------
  function startGame(mode) {
    stopTimer();

    gameMode = mode;
    game.playersCount = (mode === MODE_SINGLE) ? 1 : 2;

    if (mode === MODE_SINGLE) {
      elSingleExtras.classList.remove("hidden");
      updateHighScoreUI();
    } else {
      elSingleExtras.classList.add("hidden");
    }

    game.rosters[1] = makeEmptyRoster();
    game.rosters[2] = makeEmptyRoster();
    game.scores[1] = 0;
    game.scores[2] = 0;

    currentPickIndex = 0;
    game.onClock = 1;

    availablePlayers = [...allPlayers];
    remainingTeams = shuffle(uniqueTeams(availablePlayers));
    currentTeam = null;

    // default UI
    elDraftPos.value = "AUTO";
    elPosFilter.value = "ALL";
    elSearch.value = "";

    nextPick();
  }

  function nextPick() {
    stopTimer();

    const totalPicks = SLOTS.length * game.playersCount;
    if (currentPickIndex >= totalPicks) {
      currentTeam = "—";
      updateTeamBadge();
      elTimer.textContent = "0s";
      updateScoresAndHighScore();
      elStatus.textContent = "Game complete.";
      elSubStatus.textContent = (game.playersCount === 1)
        ? `Final: P1 ${formatScore(game.scores[1])}`
        : `Final: P1 ${formatScore(game.scores[1])} — P2 ${formatScore(game.scores[2])}`;
      renderRosters();
      renderPlayersTable();
      return;
    }

    game.onClock = pickOwner(currentPickIndex);

    if (remainingTeams.length === 0) remainingTeams = shuffle(uniqueTeams(availablePlayers));
    currentTeam = remainingTeams.shift() || "—";

    updateTeamBadge();
    updateStatusText();
    renderRosters();
    renderPlayersTable();

    timeLeft = 30;
    elTimer.textContent = `${timeLeft}s`;
    timerId = setInterval(() => {
      timeLeft -= 1;
      elTimer.textContent = `${Math.max(0, timeLeft)}s`;
      if (timeLeft <= 0) {
        stopTimer();
        autoPickOnTimer();
      }
    }, 1000);
  }

  // Timer hits 0 => pick random legal player for FIRST OPEN slot (AUTO logic)
  function autoPickOnTimer() {
    const owner = game.onClock;
    const roster = game.rosters[owner];

    const firstOpenSlot = SLOTS.find(s => !roster[s.key]);
    if (!firstOpenSlot) {
      currentPickIndex += 1;
      nextPick();
      return;
    }

    const legal = availablePlayers.filter(pl =>
      pl.team === currentTeam &&
      firstOpenSlot.accepts.includes(pl.pos)
    );

    if (!legal.length) {
      currentPickIndex += 1;
      nextPick();
      return;
    }

    const chosen = legal[Math.floor(Math.random() * legal.length)];
    applyPick(chosen, owner, firstOpenSlot.key);
  }

  function applyPick(player, owner, slotKey) {
    if (game.rosters[owner][slotKey]) return;

    const slot = SLOTS.find(s => s.key === slotKey);
    if (!slot || !slot.accepts.includes(player.pos)) return;
    if (player.team !== currentTeam) return;

    availablePlayers = availablePlayers.filter(p => p.id !== player.id);

    game.rosters[owner][slotKey] = player;
    game.scores[owner] = calcScore(owner);

    currentPickIndex += 1;
    nextPick();
  }

  // Snake order: alternate picks, reverse every 8 picks (slot block)
  function pickOwner(pickIndex) {
    if (game.playersCount === 1) return 1;
    const block = Math.floor(pickIndex / SLOTS.length); // 0 or 1
    if (block % 2 === 0) return (pickIndex % 2 === 0) ? 1 : 2;
    return (pickIndex % 2 === 0) ? 2 : 1;
  }

  // ---------- DRAFT POSITION LOGIC ----------
  function resolveSlotForPlayer(owner, player, draftPos) {
    const roster = game.rosters[owner];

    // Helper: find first open slot among a set of slot keys
    const firstOpenAmong = (keys) => {
      for (const k of keys) {
        if (!roster[k]) return k;
      }
      return null;
    };

    // Slot key groups
    const group = {
      C: ["C"],
      LW: ["LW"],
      RW: ["RW"],
      D: ["D1", "D2"],
      G: ["G"],
      FLEX: ["FLEX1", "FLEX2"],
      AUTO: ["C", "LW", "RW", "D1", "D2", "G", "FLEX1", "FLEX2"]
    };

    // If draft position is chosen, we try to place in that group first (and must be eligible)
    if (draftPos && draftPos !== "AUTO") {
      const keys = group[draftPos] || [];
      // must accept player position
      const candidate = keys.find(k => {
        const slotDef = SLOTS.find(s => s.key === k);
        return slotDef && !roster[k] && slotDef.accepts.includes(player.pos);
      });
      if (candidate) return candidate;

      // if they chose FLEX and player is C/LW/RW, but FLEX slots full -> no
      // if they chose C/LW/RW and those slots full -> no
      return null;
    }

    // AUTO placement:
    // 1) try dedicated slot (C/LW/RW/D/G)
    if (player.pos === "C" && !roster.C) return "C";
    if (player.pos === "LW" && !roster.LW) return "LW";
    if (player.pos === "RW" && !roster.RW) return "RW";
    if (player.pos === "D") {
      if (!roster.D1) return "D1";
      if (!roster.D2) return "D2";
    }
    if (player.pos === "G" && !roster.G) return "G";

    // 2) if skater C/LW/RW and dedicated slot full, use FLEX
    if (["C", "LW", "RW"].includes(player.pos)) {
      if (!roster.FLEX1) return "FLEX1";
      if (!roster.FLEX2) return "FLEX2";
    }

    return null;
  }

  // ---------- UI ----------
  function updateStatusText() {
    elStatus.textContent = `Mode: ${gameMode === MODE_SINGLE ? "Single" : "Versus"} • Pick ${currentPickIndex + 1} • Team: ${currentTeam}`;
    elSubStatus.textContent = `On the clock: Player ${game.onClock}. Choose Draft Position or click a roster slot, then click a player.`;
  }

  function renderPlayersTable() {
    if (!allPlayers.length) {
      elPlayersTbody.innerHTML = `<tr><td colspan="3" class="muted">No players loaded yet.</td></tr>`;
      return;
    }

    let list = availablePlayers;

    // current team only
    if (currentTeam && currentTeam !== "—") {
      list = list.filter(p => p.team === currentTeam);
    }

    // show position dropdown (optional)
    const pf = elPosFilter.value;
    if (pf !== "ALL") list = list.filter(p => p.pos === pf);

    // draft position filter (important)
    const draftPos = elDraftPos.value || "AUTO";
    if (draftPos !== "AUTO") {
      // only show players who can fit the chosen draft position for onClock roster
      const owner = game.onClock;
      list = list.filter(p => resolveSlotForPlayer(owner, p, draftPos) !== null);
    } else {
      // AUTO: only show players that can fit somewhere (so you don't see dead picks)
      const owner = game.onClock;
      list = list.filter(p => resolveSlotForPlayer(owner, p, "AUTO") !== null);
    }

    // search
    const q = elSearch.value.trim().toLowerCase();
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q));

    if (!list.length) {
      elPlayersTbody.innerHTML = `<tr><td colspan="3" class="muted">No eligible players for this team/filters.</td></tr>`;
      return;
    }

    // sort best-to-worst for usability
    list = list.slice().sort((a,b) => (b.points - a.points) || a.name.localeCompare(b.name));

    elPlayersTbody.innerHTML = list.map(p => `
      <tr data-id="${esc(p.id)}">
        <td>${esc(p.name)}</td>
        <td class="colSmall">${esc(p.pos)}</td>
        <td class="colSmall">${esc(p.team)}</td>
      </tr>
    `).join("");

    // click a player -> place into the correct slot based on Draft Position (or AUTO)
    [...elPlayersTbody.querySelectorAll("tr[data-id]")].forEach(tr => {
      tr.addEventListener("click", () => {
        const id = tr.getAttribute("data-id");
        const player = availablePlayers.find(x => x.id === id);
        if (!player) return;

        const owner = game.onClock;
        const draftPos = elDraftPos.value || "AUTO";
        const slotKey = resolveSlotForPlayer(owner, player, draftPos);

        if (!slotKey) return; // blocked illegal pick
        applyPick(player, owner, slotKey);
      });
    });
  }

  function renderRosters() {
    elRostersWrap.classList.toggle("two", game.playersCount === 2);

    const cards = [];
    for (let i = 1; i <= game.playersCount; i++) cards.push(renderRosterCard(i));
    elRostersWrap.innerHTML = cards.join("");

    // Optional: clicking a roster slot sets Draft Position dropdown to match
    for (let i = 1; i <= game.playersCount; i++) {
      SLOTS.forEach(slot => {
        const el = document.getElementById(`slot_${i}_${slot.key}`);
        if (!el) return;

        el.addEventListener("click", () => {
          if (i !== game.onClock) return;
          if (game.rosters[i][slot.key]) return;

          // Set Draft Position selector based on the slot clicked
          if (slot.key === "C") elDraftPos.value = "C";
          else if (slot.key === "LW") elDraftPos.value = "LW";
          else if (slot.key === "RW") elDraftPos.value = "RW";
          else if (slot.key === "G") elDraftPos.value = "G";
          else if (slot.key === "D1" || slot.key === "D2") elDraftPos.value = "D";
          else if (slot.key === "FLEX1" || slot.key === "FLEX2") elDraftPos.value = "FLEX";

          renderPlayersTable();
        });
      });
    }
  }

  function renderRosterCard(owner) {
    const score = game.scores[owner] || 0;

    const slotsHtml = SLOTS.map(slot => {
      const picked = game.rosters[owner][slot.key];
      const open = !picked;

      const cls = ["slot", open ? "open" : "filled"].join(" ");
      const name = picked ? picked.name : "—";
      const team = picked ? picked.team : "—";
      const state = open ? "OPEN" : "FILLED";

      return `
        <div class="${cls}" id="slot_${owner}_${slot.key}">
          <div class="slotTag">${slot.label}</div>
          <div class="slotName">${esc(name)}</div>
          <div class="slotTeam">${esc(team)}</div>
          <div class="slotState">${state}</div>
        </div>
      `;
    }).join("");

    return `
      <div class="rosterCard">
        <div class="rosterTop">
          <div class="rosterName">Player ${owner}</div>
          <div class="rosterScore">Score: ${formatScore(score)}</div>
        </div>
        ${slotsHtml}
      </div>
    `;
  }

  function updateTeamBadge() {
    elTeamAbbrev.textContent = currentTeam || "—";

    if (!currentTeam || currentTeam === "—") {
      elTeamLogo.src = "";
      return;
    }

    const fileKey = LOGO_MAP[currentTeam] || currentTeam;
    elTeamLogo.src = `assets/logos/${fileKey}.png`;
    elTeamLogo.onerror = () => { elTeamLogo.src = ""; };
  }

  // ---------- SCORE / HIGH SCORE ----------
  function updateScoresAndHighScore() {
    game.scores[1] = calcScore(1);
    game.scores[2] = calcScore(2);

    if (gameMode === MODE_SINGLE) {
      const hs = getHighScore();
      if (game.scores[1] > hs) setHighScore(game.scores[1]);
      updateHighScoreUI();
    }
  }

  function updateHighScoreUI() {
    elHighScore.textContent = formatScore(getHighScore());
  }

  function getHighScore() {
    const v = Number(localStorage.getItem(STORAGE_KEY_HS) || "0");
    return Number.isFinite(v) ? v : 0;
  }

  function setHighScore(val) {
    localStorage.setItem(STORAGE_KEY_HS, String(val || 0));
  }

  // ---------- HELPERS ----------
  function makeEmptyRoster() {
    const r = {};
    SLOTS.forEach(s => r[s.key] = null);
    return r;
  }

  function calcScore(owner) {
    const roster = game.rosters[owner];
    let total = 0;
    for (const s of SLOTS) {
      const p = roster[s.key];
      if (p && typeof p.points === "number") total += p.points;
    }
    return total;
  }

  function uniqueTeams(players) {
    return [...new Set(players.map(p => p.team).filter(Boolean))].sort();
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function formatScore(n) {
    return (Math.round((Number(n) || 0) * 10) / 10).toFixed(1);
  }

  function esc(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showError(msg) {
    elErrorBox.textContent = msg;
    elErrorBox.classList.remove("hidden");
    console.error(msg);
  }

  function hideError() {
    elErrorBox.textContent = "";
    elErrorBox.classList.add("hidden");
  }
})();
