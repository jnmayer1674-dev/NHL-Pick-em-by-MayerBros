document.addEventListener("DOMContentLoaded", () => {
  try { boot(); } catch (err) {
    console.error(err);
    alert("App crash. Open DevTools Console for details.\n\n" + (err?.stack || err));
  }
});

function boot() {
  // Required DOM
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

  // Constants
  const STORAGE_KEY_HS = "nhl_pickem_highscore_v7";
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

  // Logos: allow alternate file names
  const LOGO_MAP = { LAK: "LA", NJD: "NJ", TBL: "TB", SJS: "SJ" };

  // State
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

  // UI helpers
  function showError(msg) {
    elErrorBox.textContent = msg;
    elErrorBox.classList.remove("hidden");
    console.error(msg);
  }
  function hideError() {
    elErrorBox.textContent = "";
    elErrorBox.classList.add("hidden");
  }

  // Mode from URL
  const urlMode = (new URLSearchParams(window.location.search).get("mode") || "single").toLowerCase();
  gameMode = (urlMode === "two" || urlMode === "versus" || urlMode === "vs") ? MODE_TWO : MODE_SINGLE;

  // Events
  elModeBtn.addEventListener("click", () => {
    stopTimer();
    window.location.href = "index.html";
  });

  elNewBtn.addEventListener("click", () => startGame(gameMode));

  elDraftPos.addEventListener("change", () => { renderRosters(); renderPlayersTable(); });
  elPosFilter.addEventListener("change", renderPlayersTable);
  elSearch.addEventListener("input", renderPlayersTable);

  elResetHS.addEventListener("click", () => {
    localStorage.setItem(STORAGE_KEY_HS, "0");
    updateHighScoreUI();
  });

  // Init
  elStatus.textContent = "Loading…";
  elSubStatus.textContent = "Fetching players.json…";
  hideError();

  loadPlayers()
    .then(() => startGame(gameMode))
    .catch((err) => {
      showError(
        "Failed to load data/players.json.\n\n" +
        "Fix checklist:\n" +
        "1) Confirm file exists: /data/players.json\n" +
        "2) Confirm it is valid JSON\n" +
        "3) Hard refresh: Ctrl+Shift+R\n\n" +
        (err?.stack || String(err))
      );
      elStatus.textContent = "Error loading players.";
      elSubStatus.textContent = "";
      elPlayersTbody.innerHTML = `<tr><td colspan="3" class="muted">Could not load players.</td></tr>`;
    });

  // Data load
  async function loadPlayers() {
    const url = new URL("data/players.json", window.location.href);
    url.searchParams.set("v", String(Date.now())); // bust cache

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url.pathname}`);

    const raw = await res.json();
    const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.players) ? raw.players : null);
    if (!arr) throw new Error("players.json must be an array or { players: [...] }.");

    allPlayers = arr.map(normalizePlayer).filter(Boolean);
    if (!allPlayers.length) throw new Error("0 valid players after normalization.");

    elDataStamp.textContent = `Data: ${new Date().toISOString()}`;
    elSubStatus.textContent = `Loaded ${allPlayers.length} players.`;
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

  // Game flow
  function startGame(mode) {
    stopTimer();
    hideError();

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

    elDraftPos.value = "AUTO";
    elPosFilter.value = "ALL";
    elSearch.value = "";

    renderRosters();
    renderPlayersTable();
    nextPick();
  }

  function nextPick() {
    stopTimer();

    const totalPicks = SLOTS.length * game.playersCount;
    if (currentPickIndex >= totalPicks) {
      // IMPORTANT: keep last logo/team badge (don’t blank it)
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
    currentTeam = remainingTeams.shift() || currentTeam || "—";

    updateTeamBadge();
    elStatus.textContent = `Mode: ${gameMode === MODE_SINGLE ? "Single" : "Versus"} • Pick ${currentPickIndex + 1} • Team: ${currentTeam}`;
    elSubStatus.textContent = `On the clock: Player ${game.onClock}. Choose Draft Position then click a player.`;

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

  // Timer auto-pick: first open slot + random legal player for that slot
  function autoPickOnTimer() {
    const owner = game.onClock;
    const roster = game.rosters[owner];

    const firstOpenSlot = SLOTS.find(s => !roster[s.key]);
    if (!firstOpenSlot) { currentPickIndex++; nextPick(); return; }

    const legal = availablePlayers.filter(pl =>
      pl.team === currentTeam &&
      firstOpenSlot.accepts.includes(pl.pos)
    );

    if (!legal.length) { currentPickIndex++; nextPick(); return; }

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

    currentPickIndex++;
    nextPick();
  }

  // Snake order in 2P mode (block per roster round)
  function pickOwner(pickIndex) {
    if (game.playersCount === 1) return 1;
    const block = Math.floor(pickIndex / SLOTS.length);
    if (block % 2 === 0) return (pickIndex % 2 === 0) ? 1 : 2;
    return (pickIndex % 2 === 0) ? 2 : 1;
  }

  // Slot resolution:
  // - If Draft Position != AUTO, you can force a pick (e.g. goalie) if that slot is open.
  // - If AUTO, clicking a player places them in the first fitting open slot.
  function resolveSlotForPlayer(owner, player, draftPos) {
    const r = game.rosters[owner];

    if (draftPos !== "AUTO") {
      if (draftPos === "C" && player.pos === "C" && !r.C) return "C";
      if (draftPos === "LW" && player.pos === "LW" && !r.LW) return "LW";
      if (draftPos === "RW" && player.pos === "RW" && !r.RW) return "RW";
      if (draftPos === "G" && player.pos === "G" && !r.G) return "G";
      if (draftPos === "D" && player.pos === "D") { if (!r.D1) return "D1"; if (!r.D2) return "D2"; }
      if (draftPos === "FLEX" && ["C","LW","RW"].includes(player.pos)) { if (!r.FLEX1) return "FLEX1"; if (!r.FLEX2) return "FLEX2"; }
      return null;
    }

    // AUTO
    if (player.pos === "C" && !r.C) return "C";
    if (player.pos === "LW" && !r.LW) return "LW";
    if (player.pos === "RW" && !r.RW) return "RW";
    if (player.pos === "D") { if (!r.D1) return "D1"; if (!r.D2) return "D2"; }
    if (player.pos === "G" && !r.G) return "G";
    if (["C","LW","RW"].includes(player.pos)) { if (!r.FLEX1) return "FLEX1"; if (!r.FLEX2) return "FLEX2"; }

    return null;
  }

  // Render player list (only legal players for current team + selected draft rules)
  function renderPlayersTable() {
    let list = availablePlayers;

    if (currentTeam && currentTeam !== "—") list = list.filter(p => p.team === currentTeam);

    const pf = elPosFilter.value;
    if (pf !== "ALL") list = list.filter(p => p.pos === pf);

    const owner = game.onClock;
    const dp = elDraftPos.value || "AUTO";
    list = list.filter(p => resolveSlotForPlayer(owner, p, dp) !== null);

    const q = elSearch.value.trim().toLowerCase();
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q));

    if (!list.length) {
      elPlayersTbody.innerHTML = `<tr><td colspan="3" class="muted">No eligible players for this team/filters.</td></tr>`;
      return;
    }

    list = list.slice().sort((a,b) => (b.points - a.points) || a.name.localeCompare(b.name));

    elPlayersTbody.innerHTML = list.map(p => `
      <tr data-id="${esc(p.id)}">
        <td>${esc(p.name)}</td>
        <td class="colSmall">${esc(p.pos)}</td>
        <td class="colSmall">${esc(p.team)}</td>
      </tr>
    `).join("");

    [...elPlayersTbody.querySelectorAll("tr[data-id]")].forEach(tr => {
      tr.addEventListener("click", () => {
        const id = tr.getAttribute("data-id");
        const player = availablePlayers.find(x => x.id === id);
        if (!player) return;

        const owner = game.onClock;
        const slotKey = resolveSlotForPlayer(owner, player, elDraftPos.value || "AUTO");
        if (!slotKey) return;

        applyPick(player, owner, slotKey);
      });
    });
  }

  // Render rosters
  function renderRosters() {
    elRostersWrap.classList.toggle("two", game.playersCount === 2);

    const cards = [];
    for (let i = 1; i <= game.playersCount; i++) cards.push(renderRosterCard(i));
    elRostersWrap.innerHTML = cards.join("");
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
        <div class="${cls}">
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

  // Team badge logo (never blanks at end)
  function updateTeamBadge() {
    elTeamAbbrev.textContent = currentTeam || "—";
    if (!currentTeam || currentTeam === "—") return;

    const fileKey = LOGO_MAP[currentTeam] || currentTeam;
    const src = `assets/logos/${fileKey}.png`;

    // if a logo is missing, do NOT swap to a broken image
    const prev = elTeamLogo.src;
    elTeamLogo.onerror = () => {
      elTeamLogo.onerror = null;
      elTeamLogo.src = prev;
    };
    elTeamLogo.src = src;
  }

  // High score (single player only)
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

  // Helpers
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

  function must(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing required element #${id} in game.html`);
    return el;
  }
}
