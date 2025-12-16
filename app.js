(() => {
  const $ = (id) => document.getElementById(id);

  const statusText = $("statusText");
  const timerText = $("timerText");
  const teamLogo = $("teamLogo");
  const playersTbody = $("playersTbody");
  const rostersWrap = $("rostersWrap");
  const draftPositionSelect = $("draftPositionSelect");
  const showPositionSelect = $("showPositionSelect");
  const searchInput = $("searchInput");
  const dataStamp = $("dataStamp");
  const errorBar = $("errorBar");
  const newGameBtn = $("newGameBtn");
  const changeModeBtn = $("changeModeBtn");
  const roundText = $("roundText");

  // If app.js gets loaded on index.html by accident, exit safely.
  if (!statusText || !rostersWrap) return;

  const SLOTS = ["C", "LW", "RW", "D", "D", "G", "FLEX", "FLEX"];
  const FLEX_OK = new Set(["C", "LW", "RW"]);

  const TEAMS = [
    "ANA","BOS","BUF","CAR","CBJ","CGY","CHI","COL","DAL","DET","EDM",
    "FLA","LAK","MIN","MTL","NJD","NSH","NYI","NYR","OTT","PHI","PIT",
    "SEA","SJS","STL","TBL","TOR","UTA","VAN","VGK","WPG","WSH"
  ];

  function nowStamp() {
    return new Date().toISOString().replace("T", " ").slice(0, 19);
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function teamLogoPath(teamAbbr) {
    if (!teamAbbr) return "";
    return `assets/logos/${teamAbbr.toUpperCase()}.png`;
  }

  function getMode() {
    const p = new URLSearchParams(location.search);
    const m = (p.get("mode") || "").toLowerCase();
    if (m === "single") return "single";
    if (m === "two") return "two";
    return null;
  }

  const mode = getMode();
  if (!mode) {
    location.href = "index.html";
    return;
  }

  // State
  let allPlayers = [];
  let drafted = new Set();

  let timer = 30;
  let timerHandle = null;

  let round = 1;       // 1..8
  let pickInRound = 1; // 1..(two?2:1)

  let roundTeams = [];
  let currentTeam = null;
  let lastTeamShown = null;

  const rosters = [
    { name: "Player 1", picks: Array(8).fill(null), score: 0 },
    { name: "Player 2", picks: Array(8).fill(null), score: 0 },
  ];

  let tempOverrideSlot = null; // clicked roster slot when Draft Position=AUTO (one-pick override)
  let selectedRosterRowEl = null;

  function setError(msg) {
    if (!msg) {
      errorBar.style.display = "none";
      errorBar.textContent = "";
      return;
    }
    errorBar.style.display = "block";
    errorBar.textContent = msg;
  }

  async function loadPlayers() {
    const res = await fetch("data/players.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data/players.json (${res.status})`);
    const json = await res.json();

    let arr = null;
    if (Array.isArray(json)) arr = json;
    else if (json && Array.isArray(json.players)) arr = json.players;
    else if (json && Array.isArray(json.data)) arr = json.data;

    if (!Array.isArray(arr)) throw new Error("players.json must be an array or {players:[…]}");

    return arr.map(p => {
      const name = p.name || p.player || p.Player || "";
      const pos = (p.pos || p.position || p.Pos || "").toUpperCase();
      const team = (p.team || p.Team || "").toUpperCase();
      const pts = Number(p.points ?? p.fantasyPoints ?? p.pts ?? p.PTS ?? 0);
      return { name, pos, team, pts, key: `${name}__${pos}__${team}`.toLowerCase() };
    }).filter(p => p.name && p.pos && p.team);
  }

  function getCurrentPickerIndex() {
    if (mode === "single") return 0;
    // Snake by round: odd rounds P1 then P2, even rounds P2 then P1
    const odd = (round % 2) === 1;
    if (odd) return (pickInRound === 1) ? 0 : 1;
    return (pickInRound === 1) ? 1 : 0;
  }

  function getNextOpenSlotIndex(roster) {
    for (let i = 0; i < SLOTS.length; i++) {
      if (!roster.picks[i]) return i;
    }
    return -1;
  }

  function isPlayerLegalForSlot(playerPos, slot) {
    if (!slot) return false;
    if (slot === "FLEX") return FLEX_OK.has(playerPos);
    return playerPos === slot;
  }

  function getActiveDraftSlot() {
    // Priority:
    // 1) If Draft Position dropdown not AUTO -> use it
    // 2) If AUTO and user clicked roster slot -> use tempOverrideSlot (one pick)
    // 3) Else AUTO -> first open slot in current picker roster
    const dp = draftPositionSelect.value;
    if (dp !== "AUTO") return dp;
    if (tempOverrideSlot) return tempOverrideSlot;

    const r = rosters[getCurrentPickerIndex()];
    const idx = getNextOpenSlotIndex(r);
    return idx === -1 ? null : SLOTS[idx];
  }

  function currentTeamPlayers() {
    return allPlayers.filter(p => p.team === currentTeam && !drafted.has(p.key));
  }

  function filteredPlayersForList() {
    const showPos = showPositionSelect.value;
    const q = (searchInput.value || "").trim().toLowerCase();

    let list = currentTeamPlayers();

    if (showPos !== "All") list = list.filter(p => p.pos === showPos);
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q));

    // Sort by points desc
    list.sort((a,b) => b.pts - a.pts);
    return list;
  }

  function renderHeader() {
    roundText.textContent = `Round ${round} of 8`;

    const modeLabel = (mode === "single") ? "Single" : "Versus";
    const who = (mode === "single")
      ? "Player 1"
      : (getCurrentPickerIndex() === 0 ? "Player 1" : "Player 2");

    const pickLabel = (mode === "single")
      ? `Pick ${round}`
      : `Pick ${pickInRound} of 2`;

    statusText.textContent = `Mode: ${modeLabel} · Round ${round} of 8 · ${pickLabel} · Team: ${currentTeam} · On the clock: ${who}`;

    const teamToShow = currentTeam || lastTeamShown;
    if (teamToShow) {
      teamLogo.src = teamLogoPath(teamToShow);
      teamLogo.onerror = () => {
        if (lastTeamShown) teamLogo.src = teamLogoPath(lastTeamShown);
      };
    }
  }

  function renderPlayers() {
    const list = filteredPlayersForList();

    if (!list.length) {
      playersTbody.innerHTML = `<tr><td colspan="4" style="opacity:.75;">No eligible players for this team/filters.</td></tr>`;
      return;
    }

    playersTbody.innerHTML = list.map(p => `
      <tr data-key="${p.key}">
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.pos)}</td>
        <td>${escapeHtml(p.team)}</td>
        <td class="right">${Number(p.pts).toFixed(1)}</td>
      </tr>
    `).join("");
  }

  function renderRosters() {
    const gameOver = isGameOver();
    const winnerIndex = (mode === "two" && gameOver) ? calcWinnerIndex() : null;

    const cards = [];
    const howMany = (mode === "single") ? 1 : 2;

    for (let p = 0; p < howMany; p++) {
      const r = rosters[p];
      const isWinner = (winnerIndex !== null && winnerIndex === p);

      cards.push(`
        <div class="rosterCard ${isWinner ? "winner" : ""}">
          <div class="rosterHead">
            <div class="rosterTitle">${r.name}${isWinner ? " — WINNER" : ""}</div>
            <div class="rosterScore">Score: ${r.score.toFixed(1)}</div>
          </div>
          ${SLOTS.map((slot, i) => {
            const pick = r.picks[i];
            const filled = !!pick;
            const label = filled ? `${escapeHtml(pick.name)} <span style="opacity:.7;">(${pick.team})</span>` : `<span style="opacity:.55;">—</span>`;
            const status = filled ? `<span class="filled">FILLED</span>` : `<span class="open">OPEN</span>`;

            // clickable roster rows for CURRENT picker only
            const clickable = !filled && !gameOver && (getCurrentPickerIndex() === p) ? "clickable" : "";
            return `
              <div class="rosterRow ${clickable}" data-playerindex="${p}" data-slotindex="${i}">
                <div class="slot">${slot}</div>
                <div>${label}</div>
                <div style="text-align:right;">${status}</div>
              </div>
            `;
          }).join("")}
        </div>
      `);
    }

    rostersWrap.innerHTML = cards.join("");

    // Attach click handlers for roster slots
    [...rostersWrap.querySelectorAll(".rosterRow.clickable")].forEach(el => {
      el.addEventListener("click", () => {
        // If Draft Position = AUTO, do one-pick override
        if (draftPositionSelect.value === "AUTO") {
          const slotIdx = Number(el.getAttribute("data-slotindex"));
          tempOverrideSlot = SLOTS[slotIdx];

          // visual selection
          if (selectedRosterRowEl) selectedRosterRowEl.classList.remove("selected");
          selectedRosterRowEl = el;
          selectedRosterRowEl.classList.add("selected");

          // Show Position should switch to that position for the list view
          showPositionSelect.value = (tempOverrideSlot === "FLEX") ? "All" : tempOverrideSlot;
          renderPlayers();
        }
      });
    });
  }

  function isGameOver() {
    if (mode === "single") {
      return rosters[0].picks.every(Boolean);
    }
    return rosters[0].picks.every(Boolean) && rosters[1].picks.every(Boolean);
  }

  function calcWinnerIndex() {
    if (rosters[0].score > rosters[1].score) return 0;
    if (rosters[1].score > rosters[0].score) return 1;
    return 0; // tie -> highlight Player 1 (simple)
  }

  function resetTimer() {
    timer = 30;
    timerText.textContent = `${timer}s`;
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      timer = Math.max(0, timer - 1);
      timerText.textContent = `${timer}s`;
      if (timer === 0) {
        clearInterval(timerHandle);
        timerHandle = null;
        autoPickOnTimeout();
      }
    }, 1000);
  }

  function advanceTurn() {
    // after a pick: Show Position resets to All (you wanted this)
    showPositionSelect.value = "All";

    // IMPORTANT: if Draft Position was AUTO and we used tempOverrideSlot, flip back behavior (clear override)
    if (draftPositionSelect.value === "AUTO") {
      tempOverrideSlot = null;
      if (selectedRosterRowEl) selectedRosterRowEl.classList.remove("selected");
      selectedRosterRowEl = null;
    }

    if (mode === "single") {
      round++;
      if (round > 8) {
        // Game complete
        currentTeam = null;
        renderHeader();
        renderRosters();
        renderPlayers();
        return;
      }
      currentTeam = roundTeams[round - 1];
      lastTeamShown = currentTeam;
      renderHeader();
      renderRosters();
      renderPlayers();
      resetTimer();
      return;
    }

    // two-player mode: same team for both picks in the round
    if (pickInRound === 1) {
      pickInRound = 2;
    } else {
      pickInRound = 1;
      round++;
    }

    if (round > 8) {
      currentTeam = null;
      renderHeader();
      renderRosters();
      renderPlayers();
      return;
    }

    currentTeam = roundTeams[round - 1];
    lastTeamShown = currentTeam;

    renderHeader();
    renderRosters();
    renderPlayers();
    resetTimer();
  }

  function pickPlayer(player) {
    if (!player) return;

    const picker = getCurrentPickerIndex();
    const roster = rosters[picker];

    const slot = getActiveDraftSlot();
    if (!slot) return;

    // Find a legal open slot index for that slot type
    let slotIndex = -1;

    if (slot === "AUTO") {
      slotIndex = getNextOpenSlotIndex(roster);
    } else {
      for (let i = 0; i < SLOTS.length; i++) {
        if (!roster.picks[i] && SLOTS[i] === slot) {
          slotIndex = i;
          break;
        }
      }
      // FLEX needs any open FLEX slot
      if (slot === "FLEX" && slotIndex === -1) {
        for (let i = 0; i < SLOTS.length; i++) {
          if (!roster.picks[i] && SLOTS[i] === "FLEX") {
            slotIndex = i;
            break;
          }
        }
      }
    }

    if (slotIndex === -1) {
      setError("No open roster slot available for that Draft Position.");
      return;
    }

    // Validate legality
    if (!isPlayerLegalForSlot(player.pos, SLOTS[slotIndex])) {
      setError("Illegal pick for that slot.");
      return;
    }

    setError(null);

    roster.picks[slotIndex] = player;
    roster.score += player.pts;

    drafted.add(player.key);

    renderRosters();
    renderPlayers();
    renderHeader();

    // If user manually selected a Draft Position (not AUTO), KEEP it.
    // If Draft Position is AUTO, we already clear override on advanceTurn, but Draft Position stays AUTO.
    advanceTurn();
  }

  function autoPickOnTimeout() {
    if (isGameOver()) return;

    // Auto select first open slot, then random legal player
    const picker = getCurrentPickerIndex();
    const roster = rosters[picker];
    const openIndex = getNextOpenSlotIndex(roster);
    if (openIndex === -1) return;

    const slot = SLOTS[openIndex];

    const pool = currentTeamPlayers().filter(p => isPlayerLegalForSlot(p.pos, slot));
    if (!pool.length) {
      // if no legal player exists, just advance (rare)
      advanceTurn();
      return;
    }

    const choice = pool[Math.floor(Math.random() * pool.length)];
    // Force pick into that open slot type
    tempOverrideSlot = slot;
    pickPlayer(choice);
  }

  function startNewGame() {
    drafted = new Set();
    rosters[0].picks = Array(8).fill(null);
    rosters[1].picks = Array(8).fill(null);
    rosters[0].score = 0;
    rosters[1].score = 0;

    round = 1;
    pickInRound = 1;

    // Reset dropdowns/filters
    draftPositionSelect.value = "AUTO";
    showPositionSelect.value = "All";
    searchInput.value = "";
    tempOverrideSlot = null;
    selectedRosterRowEl = null;

    // Create unique teams per round
    roundTeams = shuffle(TEAMS).slice(0, 8);
    currentTeam = roundTeams[0];
    lastTeamShown = currentTeam;

    setError(null);
    dataStamp.textContent = `Data: ${nowStamp()}`;

    renderHeader();
    renderRosters();
    renderPlayers();
    resetTimer();
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // -------------------------
  // Events
  // -------------------------
  newGameBtn.addEventListener("click", () => {
    showPositionSelect.value = "All";
    draftPositionSelect.value = "AUTO";
    tempOverrideSlot = null;
    if (selectedRosterRowEl) selectedRosterRowEl.classList.remove("selected");
    selectedRosterRowEl = null;
    startNewGame();
  });

  changeModeBtn.addEventListener("click", () => {
    showPositionSelect.value = "All";
    draftPositionSelect.value = "AUTO";
    tempOverrideSlot = null;
    if (selectedRosterRowEl) selectedRosterRowEl.classList.remove("selected");
    selectedRosterRowEl = null;
    location.href = "index.html";
  });

  showPositionSelect.addEventListener("change", () => renderPlayers());
  searchInput.addEventListener("input", () => renderPlayers());

  draftPositionSelect.addEventListener("change", () => {
    // If user moves off AUTO, cancel any one-pick override highlight
    if (draftPositionSelect.value !== "AUTO") {
      tempOverrideSlot = null;
      if (selectedRosterRowEl) selectedRosterRowEl.classList.remove("selected");
      selectedRosterRowEl = null;
    }
  });

  playersTbody.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-key]");
    if (!tr) return;
    const key = tr.getAttribute("data-key");
    const player = allPlayers.find(p => p.key === key);
    if (!player) return;
    pickPlayer(player);
  });

  // -------------------------
  // Init
  // -------------------------
  (async function init() {
    try {
      setError(null);
      dataStamp.textContent = `Data: ${nowStamp()}`;
      allPlayers = await loadPlayers();
      startNewGame();
    } catch (err) {
      setError(String(err.message || err));
      playersTbody.innerHTML = `<tr><td colspan="4" style="opacity:.75;">Failed to load players.</td></tr>`;
    }
  })();
})();
