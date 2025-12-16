// ==== NHL Pick'em App.js ====

let players = [];
let gameMode = null; // "single" or "versus"
let currentPlayer = 1;
let p1Score = 0;
let p2Score = 0;
let highScore = parseInt(localStorage.getItem("nhlHighScore")) || 0;

// DOM elements
const modeScreen = document.getElementById("modeScreen");
const gameScreen = document.getElementById("gameScreen");
const startSingle = document.getElementById("startSingle");
const startVersus = document.getElementById("startVersus");
const btnChangeMode = document.getElementById("btnChangeMode");
const btnNewGame = document.getElementById("btnNewGame");
const resetHighScoreBtn = document.getElementById("resetHighScore");
const statusLine = document.getElementById("statusLine");
const turnLine = document.getElementById("turnLine");
const playersBody = document.getElementById("playersBody");
const posFilter = document.getElementById("posFilter");
const searchInput = document.getElementById("searchInput");

const rostersOne = document.getElementById("rostersOne");
const rostersTwo = document.getElementById("rostersTwo");
const p1ScoreEl = document.getElementById("p1Score");
const singleHighScoreEl = document.getElementById("singleHighScore");
const p1Score2El = document.getElementById("p1Score2");
const p2ScoreEl = document.getElementById("p2Score");

// Load players
async function loadPlayers() {
  try {
    const res = await fetch("data/players.json", { cache: "no-store" });
    players = await res.json();
    renderPlayers();
  } catch (err) {
    playersBody.innerHTML = `<tr><td colspan="4" style="color:red;">Error loading players. Make sure you're running on a local server.</td></tr>`;
    console.error(err);
  }
}

// Render player table
function renderPlayers() {
  const pos = posFilter.value;
  const search = searchInput.value.toLowerCase();

  const filtered = players.filter(p => {
    return (pos === "All" || p.position === pos) &&
           (!search || p.name.toLowerCase().includes(search));
  });

  playersBody.innerHTML = "";
  filtered.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="slot-name">${p.name}</td>
      <td>${p.position}</td>
      <td>${p.team}</td>
      <td class="right pts-col">${p.points}</td>
    `;
    tr.addEventListener("click", () => pickPlayer(p));
    playersBody.appendChild(tr);
  });
}

// Handle player pick
function pickPlayer(player) {
  if (gameMode === "single") {
    const slot = document.createElement("div");
    slot.textContent = player.name + " (" + player.position + ")";
    rostersOne.querySelector("#p1Slots").appendChild(slot);
    p1Score += player.points;
    p1ScoreEl.innerHTML = `Score: ${p1Score}<br/><span class="high-score">High Score: ${highScore}</span>`;
    updateHighScore();
  } else if (gameMode === "versus") {
    const rosterEl = currentPlayer === 1 ? rostersTwo.querySelector("#p1Slots2") : rostersTwo.querySelector("#p2Slots");
    rosterEl.appendChild(document.createElement("div")).textContent = player.name + " (" + player.position + ")";
    if (currentPlayer === 1) {
      p1Score += player.points;
      p1Score2El.textContent = `Score: ${p1Score}`;
      currentPlayer = 2;
    } else {
      p2Score += player.points;
      p2ScoreEl.textContent = `Score: ${p2Score}`;
      currentPlayer = 1;
    }
  }
}

// Update high score in localStorage
function updateHighScore() {
  if (p1Score > highScore) {
    highScore = p1Score;
    localStorage.setItem("nhlHighScore", highScore);
    singleHighScoreEl.textContent = `High Score: ${highScore}`;
  }
}

// Reset high score
function resetHighScore() {
  highScore = 0;
  localStorage.removeItem("nhlHighScore");
  singleHighScoreEl.textContent = `High Score: ${highScore}`;
}

// Start single player
startSingle.addEventListener("click", () => {
  gameMode = "single";
  modeScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  rostersOne.classList.remove("hidden");
  rostersTwo.classList.add("hidden");
  currentPlayer = 1;
  p1Score = 0;
  p1ScoreEl.textContent = `Score: ${p1Score}<br/><span class="high-score">High Score: ${highScore}</span>`;
  renderPlayers();
});

// Start versus mode
startVersus.addEventListener("click", () => {
  gameMode = "versus";
  modeScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  rostersOne.classList.add("hidden");
  rostersTwo.classList.remove("hidden");
  currentPlayer = 1;
  p1Score = p2Score = 0;
  p1Score2El.textContent = `Score: ${p1Score}`;
  p2ScoreEl.textContent = `Score: ${p2Score}`;
  renderPlayers();
});

// Change mode
btnChangeMode.addEventListener("click", () => {
  gameMode = null;
  modeScreen.classList.remove("hidden");
  gameScreen.classList.add("hidden");
});

// New game
btnNewGame.addEventListener("click", () => {
  // Clear rosters
  rostersOne.querySelector("#p1Slots").innerHTML = "";
  rostersTwo.querySelector("#p1Slots2").innerHTML = "";
  rostersTwo.querySelector("#p2Slots").innerHTML = "";
  p1Score = p2Score = 0;
  if (gameMode === "single") {
    p1ScoreEl.innerHTML = `Score: ${p1Score}<br/><span class="high-score">High Score: ${highScore}</span>`;
  } else if (gameMode === "versus") {
    p1Score2El.textContent = `Score: ${p1Score}`;
    p2ScoreEl.textContent = `Score: ${p2Score}`;
  }
});

// Filters
posFilter.addEventListener("change", renderPlayers);
searchInput.addEventListener("input", renderPlayers);

// Reset high score
resetHighScoreBtn.addEventListener("click", resetHighScore);

// Initial load
loadPlayers();
