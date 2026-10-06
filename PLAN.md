# Find the Bridge — Prototype Plan
## Goal
Build a small, playful browser game in which players connect two semantically distant words with a short sequence of intermediate words. Scoring and visualization run entirely in the browser, with no backend or paid API dependency.
## 1. Technical architecture
Use a buildless static web application:

- Plain HTML, CSS, and JavaScript modules.
  
- Semantic scoring and visualization run entirely in the browser.
  
- No backend, {==database==}{>>IT would be cool to have the notion of a session so the player could play a few times and see their previous scores... what do you think?<<}{id="c1" by="user" at="2026-10-06T20:21:06.013Z"}, authentication, or paid API.
  
- Static embedding data loads once and is cached by the browser.
  
- {==SVG provides the interactive route visualization==}{>>I'm thinking of using Sketch and Canvas animations. What do you think?<<}{id="c2" by="user" at="2026-10-06T20:22:32.327Z"}.
  
- The deployable output can be hosted directly on Cloudflare Pages.
  

This keeps V1 fast and inexpensive while leaving clean seams for later features.
## 2. Embedding strategy
### Recommended V1 dataset
- Start with approximately 4,000 common English words.
  
- Extract 50-dimensional vectors from {==Stanford's GloVe 6B==}{>>Why this one?<<}{id="c3" by="user" at="2026-10-06T20:23:05.028Z"} model.
  
- Lowercase and {==L2-normalize==}{>>What does this mean?<<}{id="c4" by="user" at="2026-10-06T20:23:18.039Z"} every vector offline.
  
- Quantize normalized values to signed 8-bit integers.
  
- {==Calculate a global two-dimensional PCA projection offline==}{>>Isn't this too little? Why not at least 32?<<}{id="c5" by="user" at="2026-10-06T20:23:39.607Z"}.
  
- Ship the vocabulary metadata, quantized vectors, and projection as static files.
  

{==The estimated browser payload is approximately 250–500 KB compressed, depending on the final metadata representation.==}{>>Can't this rely on a local csv as the database? this way it would only load the datapoints needed, i.e. words input by the user and /or chosen as star/end?<<}{id="c6" by="user" at="2026-10-06T20:24:10.315Z"}

GloVe is a good fit because it includes 50-dimensional pretrained vectors and its pretrained data is available under the Public Domain Dedication and License. [Stanford GloVe](https://nlp.stanford.edu/projects/glove/)

fastText is a possible future alternative, especially for unfamiliar words through subword information, but its standard pretrained vectors are 300-dimensional and need more aggressive reduction. [Official fastText vectors](https://fasttext.cc/docs/en/english-vectors.html)
### Input constraints
- V1 supports individual English words rather than phrases.
  
- Unknown words are rejected with friendly vocabulary suggestions.
  
- All curated puzzle endpoints are guaranteed to exist in the vocabulary.
  
## 3. Scoring function
For each consecutive pair in the route, calculate cosine similarity and transform it into a {==normalized step quality,==}{>>Did you just come up with it?<<}{id="c7" by="user" at="2026-10-06T20:25:57.384Z"} `qᵢ`, between 0 and 1.

```text
continuity = 50% × geometric mean of step qualities + 35% × weakest step + 15% × {==mean quality==}{>>What is mean quality?<<}{id="c8" by="user" at="2026-10-06T20:26:11.176Z"} adjusted for inconsistency
```

Apply two modest multipliers:

- **Progression:** rewards routes whose words generally become closer to the destination.
  
- {==**Efficiency:** subtracts approximately 3.5% for each bridge word beyond three.==}{>>COuldn't any word act as a bridge word? Under what scenarios would a word be rejected? If we don't define that, every round is 3 plays that are always accepted.<<}{id="c9" by="user" at="2026-10-06T20:26:56.834Z"}
  

```text
score = 100 × continuity × progression × efficiency
```
### Why this structure
- The geometric mean strongly punishes isolated bad jumps.
  
- The explicit weakest-step term prevents one excellent pair from hiding a terrible pair.
  
- The consistency term rewards evenly plausible routes.
  
- Progression matters without forbidding lateral-thinking detours.
  
- Fewer words help without making longer creative paths pointless.
  
### Results shown to the player
- Raw cosine similarity for every step.
  
- A human-readable label such as **Close**, **Solid**, **Stretch**, or **Leap**.
  
- The route's weakest link.
  
- Overall score out of 100.
  
- A short explanation of what affected the score.
  
## 4. Minimal repository structure
```text
find-the-bridge/
├── dist/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── data/
│       ├── vocabulary.json
│       ├── vectors.bin
│       └── projection.bin
├── scripts/
│   └── build-embeddings.mjs
├── tests/
│   └── scoring.test.mjs
└── README.md
```

`dist/` is intentionally deployable without a build command. The embedding script documents and reproduces the offline preparation process.
## 5. Smallest playable prototype
### Puzzles
Include four curated start/end pairs:

- volcano → bank
  
- bee → democracy
  
- telescope → soup
  
- violin → desert
  
### Gameplay
- Show four bridge slots initially.
  
- Allow the player to adjust the route from three to six bridge words.
  
- Provide vocabulary-aware suggestions and keyboard navigation.
  
- {==Validate that all slots are complete and contain supported words.==}{>>OH so the user has to put in all the words before getting the results / hitting submit? I think they would need to start from a first word, then hit enter, then the word is only accepted if it's less than X distance away (would need to be decided later, allowing for "leap" guesses), then subsequent answers are only accepted if they are going closer, not farther from the final goal word. What do you think?<<}{id="c10" by="user" at="2026-10-06T20:29:09.278Z"}
  
- Prevent accidental repetition of endpoints.
  
### Results and visualization
- Render the completed route as a connected sequence of word nodes.
  
- Show the score and similarity for every step.
  
- Highlight the weakest semantic jump.
  
- Plot the route on an interactive SVG using the precomputed PCA coordinates.
  
- Clearly state that the two-dimensional map is only an approximation of the full embedding space.
  
### Experience
- Open directly on the playable game rather than a marketing page.
  
- Use a clean, playful visual direction inspired by word and tabletop games.
  
- Make the main instruction understandable within a few seconds.
  
- Support desktop, mobile, keyboard, and touch input.
  
## 6. Verification
Check that:

- Known sensible routes score well.
  
- Deliberately broken routes score poorly.
  
- One excellent pair cannot conceal a bad jump.
  
- Shorter comparable routes receive a modest advantage.
  
- Unknown words produce useful validation feedback.
  
- The interface remains usable at mobile widths and with keyboard navigation.
  
- All assets work as static files without a backend.
  
## 7. Deliberately out of scope for V1
- Daily puzzles.
  
- Shareable result cards.
  
- Machine-generated shortest paths.
  
- Hints.
  
- Accounts or persistent cloud data.
  
- Multiplayer modes.
  
- Phrase embeddings.
  
- Procedurally generated puzzle endpoints.
  

The puzzle data, scoring module, and static embedding loader should remain separate so these features can be added later without rewriting the core game.
## 8. Implementation sequence
1. Prepare and validate the fixed vocabulary and quantized embedding files.
  
2. Build the playable puzzle surface and vocabulary-aware inputs.
  
3. Implement step scoring, overall scoring, and explanatory results.
  
4. Add the connected route view and interactive two-dimensional projection.
  
5. Add responsive and accessible interaction states.
  
6. Run scoring, behavior, and static-hosting checks.
  
7. Publish a private preview for review.
