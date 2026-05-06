'use strict';

// Deterministic syllable rules engine.
// Allowed patterns only: CV, CVC, VC, V.
// Greedy left-to-right, prefers CVC, then CV, then VC, then V.

function classify(token, phonemes) {
  const meta = phonemes[token];
  if (!meta) return '?';
  return meta.type === 'vowel' ? 'V' : 'C';
}

function syllabifyTokens(tokens, phonemes) {
  const types = tokens.map(t => classify(t.token, phonemes));
  const syllables = [];
  let i = 0;

  while (i < tokens.length) {
    const t0 = types[i];
    const t1 = types[i + 1];
    const t2 = types[i + 2];
    const t3 = types[i + 3];

    // CVC: only consume final C if no vowel follows it (else it onsets next syllable)
    if (t0 === 'C' && t1 === 'V' && t2 === 'C' && t3 !== 'V') {
      syllables.push({ pattern: 'CVC', tokens: tokens.slice(i, i + 3) });
      i += 3;
    } else if (t0 === 'C' && t1 === 'V') {
      syllables.push({ pattern: 'CV', tokens: tokens.slice(i, i + 2) });
      i += 2;
    } else if (t0 === 'V' && t1 === 'C' && t2 !== 'V') {
      syllables.push({ pattern: 'VC', tokens: tokens.slice(i, i + 2) });
      i += 2;
    } else if (t0 === 'V') {
      syllables.push({ pattern: 'V', tokens: tokens.slice(i, i + 1) });
      i += 1;
    } else {
      // Unknown or stray consonant: emit as-is, do not guess.
      syllables.push({ pattern: t0, tokens: tokens.slice(i, i + 1) });
      i += 1;
    }
  }
  return syllables;
}

module.exports = { syllabifyTokens, classify };
