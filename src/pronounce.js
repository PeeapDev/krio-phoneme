'use strict';

// Pronunciation engine: text -> tokens -> phoneme lookup -> audio playlist.
// No AI. Pure file lookup.

const { tokenize } = require('./tokenizer');
const { syllabifyTokens } = require('./syllables');

function buildPronunciation(text, registry, recordings) {
  const words = tokenize(text, registry);
  return words.map(w => {
    const syllables = syllabifyTokens(w.tokens, registry.phonemes);
    const playlist = [];
    for (const tok of w.tokens) {
      if (!tok.known) {
        playlist.push({ token: tok.token, audio: null, missing: true });
        continue;
      }
      const file = recordings.recordings[tok.token];
      playlist.push({
        token: tok.token,
        audio: file ? `/audio/${file}` : null,
        missing: !file
      });
    }
    return { word: w.word, tokens: w.tokens, syllables, playlist };
  });
}

module.exports = { buildPronunciation };
