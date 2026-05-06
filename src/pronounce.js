'use strict';

// Pronunciation engine: text -> tokens -> phoneme lookup -> audio playlist.
// No AI. Pure file lookup.

const { tokenize } = require('./tokenizer');
const { syllabifyTokens } = require('./syllables');

// wordAudio: optional { word -> "/audio/words/x.wav" } map.
// When a word has a recorded audio file, the playlist becomes a single word-level
// utterance instead of phoneme concatenation. Phoneme fallback is used otherwise.
function buildPronunciation(text, registry, recordings, wordAudio = {}) {
  const words = tokenize(text, registry);
  return words.map(w => {
    const syllables = syllabifyTokens(w.tokens, registry.phonemes);
    const wordKey = w.word.toLowerCase();

    // Prefer word-level recording when available.
    if (wordAudio[wordKey]) {
      return {
        word: w.word,
        tokens: w.tokens,
        syllables,
        source: 'word',
        playlist: [{ token: w.word, audio: wordAudio[wordKey], missing: false }]
      };
    }

    // Fallback: phoneme concatenation.
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
    return { word: w.word, tokens: w.tokens, syllables, source: 'phonemes', playlist };
  });
}

module.exports = { buildPronunciation };
