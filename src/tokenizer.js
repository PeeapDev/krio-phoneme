'use strict';

// Deterministic, rule-based tokenizer.
// Rule: detect digraphs first (longest match), then single characters.
// No AI / no statistical segmentation.

function tokenizeWord(word, digraphs, phonemeKeys) {
  const tokens = [];
  const lower = word.toLowerCase();
  const sortedDigraphs = [...digraphs].sort((a, b) => b.length - a.length);
  const valid = new Set(phonemeKeys);

  let i = 0;
  while (i < lower.length) {
    let matched = null;

    for (const dg of sortedDigraphs) {
      if (lower.startsWith(dg, i)) { matched = dg; break; }
    }

    if (!matched) {
      const ch = lower[i];
      if (valid.has(ch)) {
        matched = ch;
      } else {
        tokens.push({ token: ch, known: false });
        i += 1;
        continue;
      }
    }

    tokens.push({ token: matched, known: true });
    i += matched.length;
  }
  return tokens;
}

function tokenize(text, registry) {
  const digraphs = registry.digraphs || [];
  const phonemeKeys = Object.keys(registry.phonemes || {});
  const words = String(text).split(/\s+/).filter(Boolean);
  return words.map(w => ({
    word: w,
    tokens: tokenizeWord(w, digraphs, phonemeKeys)
  }));
}

module.exports = { tokenize, tokenizeWord };
