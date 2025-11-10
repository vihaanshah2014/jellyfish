# jellyfish

a way to play chess using stockfish suggestions but NOT cheating

## Browser extension

The repository contains a Manifest V3 Chrome extension under [`extension/`](extension/) that overlays Stockfish 11 engine evaluations on live boards at [chess.com](https://www.chess.com/).

### Features

- Loads the Stockfish 11 WebAssembly engine inside the background service worker for fast UCI analysis.
- Detects the active chessboard on chess.com, extracts the current position, and requests best-move advice from the background worker.
- Renders an overlay on top of the board highlighting the suggested move squares.

### Development workflow

1. Install dependencies once:
   ```bash
   npm install
   ```
2. Lint the extension (optional but recommended):
   ```bash
   npm run lint
   ```
3. Build a distributable `.zip` with the extension artifacts:
   ```bash
   npm run build
   ```
   The packaged build is emitted into `dist/`.
4. To test locally, load the `extension/` directory as an unpacked extension in Chrome or any Chromium-based browser that supports Manifest V3.

### Stockfish engine asset

The Stockfish JavaScript harness (`engine/stockfish.js`) is included, but the WebAssembly binary must be downloaded separately before you can run the extension locally. Fetch the prebuilt Stockfish 11 WebAssembly build from the official project and place it under `extension/engine/stockfish.wasm`:

```bash
curl -L -o stockfish-11-js.tgz https://stockfishchess.org/files/stockfish-11-js.tgz
tar -xzf stockfish-11-js.tgz stockfish.wasm
mv stockfish.wasm extension/engine/stockfish.wasm
```

Once the file is in place you can load the unpacked extension or build a distributable archive.
