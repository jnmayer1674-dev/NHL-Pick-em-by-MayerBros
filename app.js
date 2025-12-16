// --- High Score Setup ---
let highScore = Number(localStorage.getItem('highScore')) || 0;

// DOM elements
const p1ScoreEl = document.getElementById('p1Score');
const highScoreEl = document.getElementById('singleHighScore');
const resetBtn = document.getElementById('resetHighScore');

const gameScreen = document.getElementById('gameScreen');
const modeScreen = document.getElementById('modeScreen');
const rostersOne = document.getElementById('rostersOne');
const rostersTwo = document.getElementById('rostersTwo');

// --- Initialize High Score display ---
function showHighScore() {
  highScoreEl.textContent = `High Score: ${highScore}`;
}
showHighScore();

// --- High Score Functions ---
function updateHighScore(score) {
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('highScore', highScore);
    showHighScore();
  }
}

function resetHighScore() {
  highScore = 0;
  localStorage.removeItem('highScore');
  showHighScore();
}

resetBtn.addEventListener('click', resetHighScore);

// --- Mode Selection ---
document.getElementById('startSingle').addEventListener('click', () => {
  modeScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  rostersOne.classList.remove('hidden');
  rostersTwo.classList.add('hidden');
  highScoreEl.parentElement.style.display = 'block';
});

document.getElementById('startVersus').addEventListener('click', () => {
  modeScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  rostersOne.classList.add('hidden');
  rostersTwo.classList.remove('hidden');
  highScoreEl.parentElement.style.display = 'none';
});

// --- Example: Update Player 1 Score ---
let p1Score = 0;
function updatePlayer1Score(points) {
  p1Score = points;
  p1ScoreEl.firstChild.textContent = `Score: ${p1Score}\n`;
  updateHighScore(p1Score);
}

// --- New Game Button ---
document.getElementById('btnNewGame').addEventListener('click', () => {
  if (!rostersOne.classList.contains('hidden')) {
    p1Score = 0;
    p1ScoreEl.firstChild.textContent = `Score: ${p1Score}\n`;
    showHighScore();
  }
  if (!rostersTwo.classList.contains('hidden')) {
    document.getElementById('p1Score2').textContent = 'Score: 0';
    document.getElementById('p2Score').textContent = 'Score: 0';
  }
  // TODO: reset rosters/slots if needed
});
