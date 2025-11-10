const OVERLAY_ID = 'stockfish-best-move-overlay';
const ANALYSIS_DEBOUNCE = 600;
let lastFen = null;
let analyzeTimeout = null;
let activeBoard = null;
let overlayEl = null;
let isRequestInFlight = false;

const PIECE_CLASS_TO_SYMBOL = {
  king: 'k',
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
  pawn: 'p'
};

function initialize() {
  injectStylesheet();
  observeBoard();
}

function injectStylesheet() {
  const existing = document.querySelector(`link[data-extension="stockfish-overlay"]`);
  if (existing) {
    return;
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('overlay.css');
  link.dataset.extension = 'stockfish-overlay';
  document.head.appendChild(link);
}

function observeBoard() {
  const board = findBoardElement();
  if (!board) {
    setTimeout(observeBoard, 500);
    return;
  }

  activeBoard = board;
  ensureOverlay();
  scheduleAnalysis();

  const observer = new MutationObserver(() => {
    scheduleAnalysis();
  });

  observer.observe(board, {
    childList: true,
    subtree: true,
    attributes: true
  });
}

function findBoardElement() {
  return (
    document.querySelector('chess-board') ||
    document.querySelector('wc-chess-board') ||
    document.querySelector('.board')
  );
}

function ensureOverlay() {
  if (!activeBoard) {
    return;
  }

  if (getComputedStyle(activeBoard).position === 'static') {
    activeBoard.style.position = 'relative';
  }

  overlayEl = activeBoard.querySelector(`#${OVERLAY_ID}`);
  if (!overlayEl) {
    overlayEl = document.createElement('div');
    overlayEl.id = OVERLAY_ID;
    overlayEl.className = 'best-move-overlay';
    activeBoard.appendChild(overlayEl);
  }
}

function scheduleAnalysis() {
  if (!activeBoard) {
    return;
  }

  if (analyzeTimeout) {
    clearTimeout(analyzeTimeout);
  }

  analyzeTimeout = setTimeout(() => {
    analyzeTimeout = null;
    requestAnalysis();
  }, ANALYSIS_DEBOUNCE);
}

function requestAnalysis() {
  if (isRequestInFlight) {
    return;
  }

  const fen = extractFen(activeBoard);
  if (!fen || fen === lastFen) {
    return;
  }

  lastFen = fen;
  isRequestInFlight = true;
  chrome.runtime.sendMessage({ type: 'analyzePosition', fen }, (response) => {
    isRequestInFlight = false;

    if (chrome.runtime.lastError) {
      console.warn('Stockfish overlay: runtime error', chrome.runtime.lastError.message);
      return;
    }

    if (!response?.success || !response.bestMove) {
      console.warn('Stockfish overlay: invalid response', response);
      return;
    }

    highlightBestMove(response.bestMove);
  });
}

function extractFen(boardEl) {
  if (!boardEl) {
    return null;
  }

  const fenFromState = readFenFromBoardState(boardEl);
  if (fenFromState) {
    return normalizeFen(fenFromState);
  }

  const pieces = new Map();
  const pieceElements = boardEl.querySelectorAll('.piece');

  pieceElements.forEach((pieceEl) => {
    const classes = Array.from(pieceEl.classList);
    const squareClass = classes.find((cls) => cls.startsWith('square-'));
    const colorClass = classes.find((cls) => cls === 'white' || cls === 'black');
    const typeClass = classes.find((cls) => PIECE_CLASS_TO_SYMBOL[cls]);

    if (!squareClass || !colorClass || !typeClass) {
      return;
    }

    const match = squareClass.match(/square-(\d)(\d)/);
    if (!match) {
      return;
    }

    const fileIndex = parseInt(match[1], 10) - 1;
    const rankIndex = parseInt(match[2], 10) - 1;
    if (fileIndex < 0 || rankIndex < 0) {
      return;
    }

    const file = 'abcdefgh'[fileIndex];
    const rank = String(rankIndex + 1);
    const baseSymbol = PIECE_CLASS_TO_SYMBOL[typeClass];
    const pieceSymbol = colorClass === 'white' ? baseSymbol.toUpperCase() : baseSymbol;

    pieces.set(`${file}${rank}`, pieceSymbol);
  });

  if (pieces.size === 0) {
    return null;
  }

  const ranks = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    let emptyCount = 0;
    let rankFen = '';
    for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
      const file = 'abcdefgh'[fileIndex];
      const square = `${file}${rank}`;
      const piece = pieces.get(square);
      if (piece) {
        if (emptyCount > 0) {
          rankFen += emptyCount;
          emptyCount = 0;
        }
        rankFen += piece;
      } else {
        emptyCount += 1;
      }
    }

    if (emptyCount > 0) {
      rankFen += emptyCount;
    }

    ranks.push(rankFen);
  }

  const boardFen = ranks.join('/');
  const turn = detectTurn(boardEl);
  return `${boardFen} ${turn} - - 0 1`;
}

function readFenFromBoardState(boardEl) {
  const directFen = boardEl.getAttribute('data-fen') || boardEl.dataset?.fen;
  if (directFen) {
    return directFen;
  }

  const stateAttr = boardEl.getAttribute('data-state');
  if (!stateAttr) {
    return null;
  }

  try {
    const state = JSON.parse(stateAttr);
    if (state?.fen) {
      return state.fen;
    }
  } catch (error) {
    // Some pages encode JSON via HTML entities; try to decode.
    try {
      const decoded = stateAttr.replace(/&quot;/g, '"');
      const state = JSON.parse(decoded);
      if (state?.fen) {
        return state.fen;
      }
    } catch (innerError) {
      console.debug('Stockfish overlay: unable to parse board state', innerError);
    }
  }

  return null;
}

function normalizeFen(fen) {
  if (!fen) {
    return fen;
  }

  const parts = fen.trim().split(/\s+/);
  if (parts.length >= 4) {
    return `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]} ${parts[4] ?? '0'} ${parts[5] ?? '1'}`;
  }

  // If only board layout exists, extend to full FEN.
  return `${parts[0]} w - - 0 1`;
}

function detectTurn(boardEl) {
  const datasetTurn = boardEl.dataset?.playerTurn || boardEl.dataset?.turn || boardEl.dataset?.turnColor;
  if (datasetTurn) {
    return datasetTurn.startsWith('b') ? 'b' : 'w';
  }

  const moveList = document.querySelectorAll('[data-cy="move-list"] .move, .vertical-move-list .move, chess-move-list .move');
  if (moveList.length > 0) {
    return moveList.length % 2 === 0 ? 'w' : 'b';
  }

  return 'w';
}

function highlightBestMove(bestMove) {
  ensureOverlay();
  if (!overlayEl) {
    return;
  }

  overlayEl.innerHTML = '';

  if (!bestMove || bestMove.length < 4) {
    return;
  }

  const fromSquare = bestMove.slice(0, 2);
  const toSquare = bestMove.slice(2, 4);

  overlayEl.appendChild(createSquareHighlight(fromSquare, 'from'));
  overlayEl.appendChild(createSquareHighlight(toSquare, 'to'));
}

function createSquareHighlight(square, role) {
  const { xIndex, yIndex } = squareToOverlayPosition(square);
  const squareEl = document.createElement('div');
  squareEl.className = `best-move-overlay__square best-move-overlay__square--${role}`;
  squareEl.style.left = `${(xIndex / 8) * 100}%`;
  squareEl.style.top = `${(yIndex / 8) * 100}%`;
  squareEl.style.width = `${100 / 8}%`;
  squareEl.style.height = `${100 / 8}%`;
  return squareEl;
}

function squareToOverlayPosition(square) {
  if (!activeBoard) {
    return { xIndex: 0, yIndex: 0 };
  }

  const file = square.charCodeAt(0) - 97; // 'a'.charCodeAt(0)
  const rank = parseInt(square[1], 10) - 1;
  const orientation = (activeBoard.getAttribute('orientation') || activeBoard.dataset?.orientation || 'white').toLowerCase();

  const xIndex = orientation === 'white' ? file : 7 - file;
  const yIndex = orientation === 'white' ? 7 - rank : rank;
  return { xIndex, yIndex };
}

initialize();
