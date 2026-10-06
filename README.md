# Find the Bridge

A small browser game about connecting distant ideas with a short chain of words.

The player starts with one word and enters bridge words one at a time. A word is accepted only when it is semantically close enough to the current word and moves the route closer to the destination. After at least three accepted bridges, the player can finish when the current word is close enough to the destination. Each puzzle allows at most six bridge words.

## Run locally

The game has no runtime dependencies or build step. Serve the static directory so the browser can load its binary embedding files:

```sh
python3 -m http.server 4173 -d dist
```

Then open `http://localhost:4173`.

Run the scoring checks with:

```sh
node tests/scoring.test.mjs
```

## Architecture

- `dist/index.html` contains the game surface and accessible structure.
- `dist/styles.css` contains the responsive visual system.
- `dist/app.js` owns sequential play, local session history, results, Canvas animation, and optional WebMCP actions.
- `dist/scoring.mjs` contains acceptance thresholds, cosine similarity, step labels, and route scoring.
- `dist/data/` contains the fixed vocabulary, quantized vectors, and global PCA coordinates used in the browser.
- `scripts/build-embeddings.mjs` reproduces the static data from a pretrained model.
- `tests/scoring.test.mjs` checks the scoring invariants.

Everything runs in the browser. There is no backend, account, paid API, or network call after the static files load.

## Embeddings

V1 uses approximately 4,000 common content words extracted from 50-dimensional GloVe vectors. GloVe is intentionally conservative here: it is small enough for a browser prototype, well understood, and its pretrained data is distributed under the Public Domain Dedication and License. The source model is `glove-wiki-gigaword-50`, derived from [Stanford GloVe](https://nlp.stanford.edu/projects/glove/).

Each vector is L2-normalized offline. In plain language, this scales every vector to the same length, so cosine similarity compares direction—semantic relationship—rather than raw magnitude. Each normalized value is then stored as a signed 8-bit integer. The browser payload is about 270 KB before transfer compression:

- 196 KB for 4,000 × 50 quantized embedding dimensions.
- 32 KB for two projection coordinates per word.
- About 40 KB for vocabulary metadata.

A static CSV would not provide row-level database queries in the browser. Without a server or a separately maintained byte index, the browser would still download and parse the entire CSV. The indexed binary layout is smaller and lets the browser jump directly to a word's fixed-width vector.

The two PCA dimensions are only for drawing the map. Scoring always uses all 50 dimensions. Increasing the drawing projection to 32 dimensions would not improve a two-dimensional screen visualization; it would only create an intermediate representation that still has to be projected down to two.

To rebuild the data, pass a gzipped word2vec-format GloVe file:

```sh
node scripts/build-embeddings.mjs /path/to/glove-wiki-gigaword-50.gz
```

## Word acceptance

Words are submitted sequentially instead of filling every slot in advance. A bridge is accepted when:

1. It exists in the fixed vocabulary.
2. It has not already appeared in the route.
3. Its cosine similarity to the current word is at least `0.20`.
4. Its similarity to the destination is greater than the current word's similarity to the destination.

The `0.20` threshold deliberately permits lateral “leap” guesses. It is isolated in `scoring.mjs` so playtesting can tune it without changing the interface.

The final crossing becomes available after three bridge words when the current word has at least `0.34` similarity to the destination. If the player reaches six words without that proximity, they can undo and try another direction.

When the final crossing unlocks, the interface announces it with a short animation and makes further bridge words explicitly optional. Exact similarity values remain hidden during play so the player reasons about words rather than optimizing a visible metric; the completed results reveal the overall score and every step similarity.

## Scoring

Cosine similarity is transformed into step quality on a 0–1 scale. That mapping is a product choice, not a standard embedding formula; it makes raw similarities easier to combine and tune for a game.

```text
continuity =
  50% × geometric mean of step qualities
+ 35% × weakest step
+ 15% × average quality, reduced when steps are inconsistent

score = 100 × continuity × progression × efficiency
```

“Mean quality” is the ordinary average of all normalized step qualities. It is multiplied by a consistency factor, so a route with one unusually weak jump does not receive the same credit as a uniformly strong route.

The geometric mean and explicit weakest-step term ensure that one excellent pair cannot compensate for an implausible jump. The efficiency multiplier gives shorter comparable routes a small advantage.

## Session history and visualization

Completed scores are stored in `sessionStorage`. They survive refreshes in the same tab but disappear when the tab's session ends. That provides a lightweight sense of a play session without introducing a database or identity system.

The semantic map uses the Canvas API. It draws the vocabulary as a faint field, then animates the completed route with a sketch-like line and interactive word markers. This keeps the visual playful without adding an animation framework. The UI explicitly notes that the 2D PCA map is only an approximation of the 50-dimensional space used for scoring.

## V1 puzzles

- volcano → bank
- bee → democracy
- telescope → soup
- violin → desert

Daily puzzles, sharing, hints, generated shortest paths, multiplayer, accounts, and phrase embeddings are deliberately deferred.
