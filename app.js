// === ELEMENT SELECTORS ===
const modeScreen = document.getElementById("modeScreen");
const startSingle = document.getElementById("startSingle");
const startVersus = document.getElementById("startVersus");
const gameScreen = document.getElementById("gameScreen");

const btnChangeMode = document.getElementById("btnChangeMode");
const btnNewGame = document.getElementById("btnNewGame");
const resetHighScoreBtn = document.getElementById("resetHighScore");

const playersBody = document.getElementById("playersBody");
const posFilter = document.getElementById("posFilter");
const searchInput = document.getElementById("searchInput");
const emptyMsg = document.getElementById("emptyMsg");

const rostersOne = document.getElementById("rostersOne");
const rostersTwo = document.getElementById("rostersTwo");

const p1Score = document.getElementById("p1Score");
const singleHighScore = document.getElementById("singleHighScore");
const p1Score2 = document.getElementById("p1Score2");
const p2Score = document.getElementById("p2Score");

const teamLogo = document.getElementById("teamLogo");
const teamName = document.getElementById("teamName");
const statusLine = document.getElementById("statusLine");
const turnLine = document.getElementById("turnLine");

// === GAME STATE ===
let allPlayers = [];
let filteredPlayers = [];
let gameMode = null; // "single" or "versus"
let currentTurn = 1;
let player1Score = 0;
let player2Score = 0;
let highScore = parseInt(localStorage.getItem("nhlHighScore") || "0");

// === FETCH PLAYERS ===
async function loadPlayers() {
  try {
    const res = await fetch("data/players.json"); // <-- updated path
    if (!res.ok) throw new Error("Network error");
    const data = await res.json();
    allPlayers = data;
    filteredPlayers = allPlayers;
    renderPlayers();
  } catch (err) {
    console.error(err);
    emptyMsg.classList.remove("hidden");
    emptyMsg.textContent = "Error loading players. Make sure the file exists in data/ folder.";
  }
}

// === RENDER PLAYERS ===
function renderPlayers() {
  playersBody.innerHTML = "";
  filteredPlayers.forEach(player => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${player.name}</td>
      <td>${player.pos}</td>
      <td>${player.team}</td>
      <td class="right pts-col">${player.pts}</td>
    `;
    playersBody.appendChild(tr);
  });
}

// === FILTER PLAYERS ===
function applyFilters() {
  const pos = posFilter.value;
  const search = searchInput.value.toLowerCase();
  filteredPlayers = allPlayers.filter(p => 
    (pos === "All" || p.pos === pos) &&
    p.name.toLowerCase().includes(search)
  );
  renderPlayers();
}

// === GAME MODE BUTTONS ===
startSingle.addEventListener("click", () => startGame("single"));
startVersus.addEventListener("click", () => startGame("versus"));

function startGame(mode) {
  gameMode = mode;
  modeScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  rostersOne.classList.toggle("hidden", mode !== "single");
  rostersTwo.classList.toggle("hidden", mode !== "versus");
  resetGame();
  updateHighScoreUI();
}

// === NEW GAME ===
btnNewGame.addEventListener("click", resetGame);

function resetGame() {
  player1Score = 0;
  player2Score = 0;
  currentTurn = 1;
  p1Score.textContent = `Score: ${player1Score}`;
  p1Score2.textContent = `Score: ${player1Score}`;
  p2Score.textContent = `Score: ${player2Score}`;
  statusLine.textContent = "New game started.";
  turnLine.textContent = gameMode === "versus" ? "Player 1's turn" : "";
}

// === HIGH SCORE ===
function updateHighScoreUI() {
  if (gameMode === "single") {
    singleHighScore.textContent = `High Score: ${highScore}`;
    resetHighScoreBtn.classList.remove("hidden");
  } else {
    singleHighScore.textContent = "";
    resetHighScoreBtn.classList.add("hidden");
  }
}

resetHighScoreBtn.addEventListener("click", () => {
  highScore = 0;
  localStorage.setItem("nhlHighScore", highScore);
  updateHighScoreUI();
});

// === CHANGE MODE ===
btnChangeMode.addEventListener("click", () => {
  gameScreen.classList.add("hidden");
  modeScreen.classList.remove("hidden");
});

// === FILTER EVENTS ===
posFilter.addEventListener("change", applyFilters);
searchInput.addEventListener("input", applyFilters);

// === INIT ===
loadPlayers();
updateHighScoreUI();
