/**
 * Minesweeper – vanilla JavaScript implementation
 * Features: difficulty selection, flagging, chording, timer, win/loss overlay
 */

'use strict';

/* ── Difficulty presets ───────────────────────────────────────── */
const DIFFICULTIES = {
  beginner:     { rows: 9,  cols: 9,  mines: 10 },
  intermediate: { rows: 16, cols: 16, mines: 40 },
  expert:       { rows: 16, cols: 30, mines: 99 },
};

/* ── Layout constant (must match .cell width/height in style.css) */
const CELL_SIZE = 32; // px

/* ── State ────────────────────────────────────────────────────── */
let rows, cols, totalMines;
let board      = [];   // 2-D array of cell objects
let mineCount  = 0;    // remaining unflagged mines (can go negative)
let gameState  = 'idle';  // 'idle' | 'playing' | 'won' | 'lost'
let timerSecs  = 0;
let timerId    = null;
let firstClick = true;

/* ── DOM refs ─────────────────────────────────────────────────── */
const boardEl       = document.getElementById('board');
const mineCounterEl = document.getElementById('mine-counter');
const timerEl       = document.getElementById('timer');
const faceBtn       = document.getElementById('face-btn');
const diffSelect    = document.getElementById('difficulty');
const newGameBtn    = document.getElementById('new-game-btn');

/* ── Overlay (win / lose) ─────────────────────────────────────── */
const overlay = (() => {
  const el = document.createElement('div');
  el.id = 'message-overlay';
  el.className = 'hidden';
  el.innerHTML = `
    <div class="message-box">
      <h2 id="msg-title"></h2>
      <p  id="msg-body"></p>
      <button id="msg-btn">Play Again</button>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('#msg-btn').addEventListener('click', () => {
    el.className = 'hidden';
    initGame();
  });
  return el;
})();

function showOverlay(title, body) {
  document.getElementById('msg-title').textContent = title;
  document.getElementById('msg-body').textContent  = body;
  overlay.className = '';
}

/* ── Utility ──────────────────────────────────────────────────── */
function pad(n, len = 3) {
  const absClamped = Math.min(Math.abs(n), 999);
  const base = absClamped.toString().padStart(len, '0');
  return n < 0 ? '-' + base : base;
}

function neighbours(r, c) {
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        result.push(board[nr][nc]);
      }
    }
  }
  return result;
}

/* ── Timer ────────────────────────────────────────────────────── */
function startTimer() {
  if (timerId) return;
  timerSecs = 0;
  timerEl.textContent = '000';
  timerId = setInterval(() => {
    timerSecs = Math.min(timerSecs + 1, 999);
    timerEl.textContent = pad(timerSecs);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerId);
  timerId = null;
}

/* ── Initialise game ──────────────────────────────────────────── */
function initGame() {
  stopTimer();
  const preset   = DIFFICULTIES[diffSelect.value] || DIFFICULTIES.beginner;
  rows           = preset.rows;
  cols           = preset.cols;
  totalMines     = preset.mines;
  mineCount      = totalMines;
  gameState      = 'idle';
  firstClick     = true;
  timerSecs      = 0;
  timerEl.textContent       = '000';
  mineCounterEl.textContent = pad(mineCount);
  faceBtn.textContent       = '🙂';
  overlay.className         = 'hidden';

  // Build logical board
  board = [];
  for (let r = 0; r < rows; r++) {
    board[r] = [];
    for (let c = 0; c < cols; c++) {
      board[r][c] = { r, c, mine: false, revealed: false, flagged: false, question: false, adjMines: 0, el: null };
    }
  }

  renderBoard();
}

/* ── Render ───────────────────────────────────────────────────── */
function renderBoard() {
  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${cols}, ${CELL_SIZE}px)`;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board[r][c];
      const el   = document.createElement('div');
      el.className = 'cell';
      el.dataset.r = r;
      el.dataset.c = c;
      // Accessibility: expose cells as interactive, focusable controls
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.setAttribute('aria-label', 'Minesweeper cell');

      el.addEventListener('click',       onLeftClick);
      el.addEventListener('contextmenu', onRightClick);
      el.addEventListener('mousedown',   onMiddleDown);
      el.addEventListener('dblclick',    onDoubleClick);

      // Keyboard support: Enter/Space to reveal, "F" to toggle flag
      el.addEventListener('keydown', e => {
        const key = e.key;
        if (key === 'Enter' || key === ' ') {
          e.preventDefault();
          // Trigger existing click handler for reveal
          el.click();
        } else if (key === 'f' || key === 'F') {
          e.preventDefault();
          cycleFlag(cell);
        }
      });
      // Touch support – long press = flag
      let touchTimer = null;
      el.addEventListener('touchstart', e => {
        touchTimer = setTimeout(() => {
          touchTimer = null;
          e.preventDefault();
          cycleFlag(cell);
        }, 500);
      }, { passive: false });
      el.addEventListener('touchend', () => { clearTimeout(touchTimer); });
      el.addEventListener('touchmove', () => { clearTimeout(touchTimer); });

      cell.el = el;
      boardEl.appendChild(el);
    }
  }

  // Match panel width to board-container's total width:
  // board-container adds 4px padding + 4px border on each side = 16px total
  const panelEl = document.querySelector('.panel');
  if (panelEl) {
    panelEl.style.width = (cols * CELL_SIZE + 16) + 'px';
    panelEl.style.maxWidth = '100%';
  }
}

/* ── Mine placement (deferred to first click) ─────────────────── */
function placeMines(safeR, safeC) {
  const safe = new Set();
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nr = safeR + dr, nc = safeC + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        safe.add(`${nr},${nc}`);
      }
    }
  }

  let placed = 0;
  while (placed < totalMines) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    if (!board[r][c].mine && !safe.has(`${r},${c}`)) {
      board[r][c].mine = true;
      placed++;
    }
  }

  // Compute adjacency numbers
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!board[r][c].mine) {
        board[r][c].adjMines = neighbours(r, c).filter(n => n.mine).length;
      }
    }
  }
}

/* ── Reveal logic ─────────────────────────────────────────────── */
function revealCell(cell) {
  if (cell.revealed || cell.flagged) return;

  // Clear question marker (if any) when revealing
  if (cell.question) cell.question = false;
  cell.revealed = true;
  updateCellEl(cell);

  if (cell.mine) {
    cell.el.classList.add('exploded');
    endGame(false, cell);
    return;
  }

  // Flood-fill for zeros
  if (cell.adjMines === 0) {
    neighbours(cell.r, cell.c).forEach(n => {
      if (!n.revealed && !n.flagged) revealCell(n);
    });
  }

  checkWin();
}

function updateCellEl(cell) {
  const el = cell.el;
  el.className = 'cell';
  el.textContent = '';
  el.removeAttribute('data-num');

  if (cell.revealed) {
    el.classList.add('revealed');
    if (cell.adjMines > 0 && !cell.mine) {
      el.textContent = cell.adjMines;
      el.dataset.num = cell.adjMines;
    }
  } else if (cell.flagged) {
    el.classList.add('flagged');
  } else if (cell.question) {
    el.classList.add('question');
  }
}

/* ── Flag cycling: unrevealed → flagged → question → unrevealed ── */
function cycleFlag(cell) {
  if (cell.revealed || gameState === 'won' || gameState === 'lost') return;

  if (!cell.flagged && !cell.question) {
    // unrevealed → flagged
    cell.flagged = true;
    mineCount--;
  } else if (cell.flagged) {
    // flagged → question
    cell.flagged  = false;
    cell.question = true;
    mineCount++;
  } else {
    // question → unrevealed
    cell.question = false;
  }

  mineCounterEl.textContent = pad(mineCount);
  updateCellEl(cell);
}

/* ── Chord (reveal all neighbours if flagged count matches num) ── */
function chord(cell) {
  if (!cell.revealed || cell.adjMines === 0) return;
  const nbrs        = neighbours(cell.r, cell.c);
  const flaggedCount = nbrs.filter(n => n.flagged).length;
  if (flaggedCount === cell.adjMines) {
    nbrs.forEach(n => { if (!n.flagged) revealCell(n); });
  }
}

/* ── Win / Loss ───────────────────────────────────────────────── */
function checkWin() {
  const unrevealedSafe = board.flat().filter(c => !c.revealed && !c.mine);
  if (unrevealedSafe.length === 0) {
    endGame(true);
  }
}

function endGame(won, explodedCell = null) {
  stopTimer();
  gameState = won ? 'won' : 'lost';
  faceBtn.textContent = won ? '😎' : '😵';

  if (won) {
    // Flag all remaining mines
    board.flat().forEach(cell => {
      if (cell.mine && !cell.flagged) {
        cell.flagged = true;
        updateCellEl(cell);
      }
    });
    mineCount = 0;
    mineCounterEl.textContent = '000';
    setTimeout(() => showOverlay('You Win! 🎉', `Cleared in ${timerSecs}s`), 300);
  } else {
    // Reveal all mines
    board.flat().forEach(cell => {
      if (cell.mine && !cell.flagged && cell !== explodedCell) {
        cell.el.classList.add('cell', 'revealed', 'mine-revealed');
      }
      if (cell.flagged && !cell.mine) {
        // Clear flag/question state so only the wrong-flag indicator is shown
        cell.flagged = false;
        if (cell.question) {
          cell.question = false;
        }
        cell.el.classList.remove('flagged', 'question');
        cell.el.classList.add('wrong-flag');
        cell.el.textContent = '❌';
      }
    });
    setTimeout(() => showOverlay('Game Over 💥', 'You hit a mine!'), 400);
  }
}

/* ── Event handlers ───────────────────────────────────────────── */
function getCellFromEvent(e) {
  const el = e.currentTarget;
  return board[+el.dataset.r][+el.dataset.c];
}

function onLeftClick(e) {
  const cell = getCellFromEvent(e);
  if (gameState === 'won' || gameState === 'lost') return;
  if (cell.flagged || cell.question) return;

  if (cell.revealed) {
    chord(cell);
    return;
  }

  if (firstClick) {
    firstClick = false;
    placeMines(cell.r, cell.c);
    gameState = 'playing';
    startTimer();
  }

  revealCell(cell);
}

function onRightClick(e) {
  e.preventDefault();
  const cell = getCellFromEvent(e);
  if (gameState === 'won' || gameState === 'lost') return;
  cycleFlag(cell);
}

function onMiddleDown(e) {
  if (e.button !== 1) return;
  e.preventDefault();
  const cell = getCellFromEvent(e);
  if (gameState === 'won' || gameState === 'lost') return;
  chord(cell);
}

function onDoubleClick(e) {
  const cell = getCellFromEvent(e);
  if (gameState === 'won' || gameState === 'lost') return;
  chord(cell);
}

/* ── Toolbar buttons ──────────────────────────────────────────── */
faceBtn.addEventListener('click', initGame);
newGameBtn.addEventListener('click', initGame);
diffSelect.addEventListener('change', initGame);

/* ── Bootstrap ────────────────────────────────────────────────── */
initGame();
