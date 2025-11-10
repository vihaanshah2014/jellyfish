/* global STOCKFISH */

// Ensure the Stockfish wasm file is located via chrome.runtime.getURL.
self.Module = {
  locateFile(path) {
    if (path.endsWith('.wasm')) {
      return chrome.runtime.getURL(`engine/${path}`);
    }
    return path;
  }
};

importScripts('engine/stockfish.js');

let engineInstance = null;
let pendingResolver = null;
let pendingRejector = null;
let engineReady = false;

function ensureEngine() {
  if (engineInstance) {
    return engineInstance;
  }

  engineInstance = STOCKFISH();
  engineInstance.onmessage = (event) => {
    const line = typeof event === 'string' ? event : event.data;
    if (!line) {
      return;
    }

    if (line === 'uciok') {
      engineReady = true;
      return;
    }

    if (line.startsWith('bestmove') && pendingResolver) {
      const parts = line.split(/\s+/);
      const bestMove = parts[1];
      const ponder = parts[3] && parts[2] === 'ponder' ? parts[3] : undefined;
      pendingResolver({ bestMove, ponder });
      pendingResolver = null;
      pendingRejector = null;
    }
  };

  engineInstance.postMessage('uci');
  engineInstance.postMessage('setoption name Threads value 1');
  engineInstance.postMessage('setoption name Skill Level value 20');

  return engineInstance;
}

function analyzePosition(fen, options = {}) {
  const depth = options.depth || 14;
  const engine = ensureEngine();

  return new Promise((resolve, reject) => {
    pendingResolver = resolve;
    pendingRejector = reject;

    if (!engineReady) {
      let timeoutId = null;
      const waitForReady = setInterval(() => {
        if (engineReady) {
          clearInterval(waitForReady);
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          engine.postMessage('ucinewgame');
          engine.postMessage(`position fen ${fen}`);
          engine.postMessage(`go depth ${depth}`);
        }
      }, 50);

      timeoutId = setTimeout(() => {
        if (!engineReady && pendingRejector) {
          clearInterval(waitForReady);
          pendingRejector(new Error('Engine failed to initialize'));
          pendingResolver = null;
          pendingRejector = null;
        }
      }, 5000);

      return;
    }

    engine.postMessage('stop');
    engine.postMessage('ucinewgame');
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage(`go depth ${depth}`);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'analyzePosition') {
    analyzePosition(message.fen, { depth: message.depth })
      .then((result) => {
        sendResponse({ success: true, ...result });
      })
      .catch((error) => {
        console.error('Stockfish analysis failed', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep the message channel open for async response.
  }

  return undefined;
});

chrome.runtime.onInstalled.addListener(() => {
  ensureEngine();
});
