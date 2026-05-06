'use strict';

// Centralized strict word validator.
// Single source of truth for ANY new lexicon entry (single-add or bulk).
// Pipeline (every step must pass):
//   1. Normalize        : trim + lowercase
//   2. Structure        : non-empty, no whitespace, no hyphen
//   3. Charset whitelist: ^[a-zɛɔ]+$ only
//   4. Tokenization     : longest-match against phoneme registry
//   5. Phoneme membership: every token must exist in registry
//   6. Audio coverage   : every phoneme must have a recording (toggle via opts.requireAudio)
//   7. Syllable shape   : (C){0,3} V (C){0,2} per syllable, exactly one vowel nucleus
//
// Returns { ok, normalized, phonemes, syllables, errors[] }.
// On failure, errors[] explains why; no partial state is leaked.

const { tokenize } = require('./tokenizer');
const { syllabifyTokens } = require('./syllables');

const ALLOWED_CHARS = /^[a-z\u025b\u0254]+$/; // a-z plus ɛ (U+025B) and ɔ (U+0254)
const MAX_ONSET = 3;  // accommodates clusters like "str" (strit)
const MAX_CODA  = 2;

function syllableShapeOk(syl, phonemeMap) {
  const types = syl.tokens.map(t => phonemeMap[t.token]?.type);
  const vowelIdx = types.reduce((a, t, i) => t === 'vowel' ? [...a, i] : a, []);
  if (vowelIdx.length !== 1) return false; // exactly one vowel nucleus per syllable
  const v = vowelIdx[0];
  const onset = v;
  const coda = types.length - v - 1;
  return onset <= MAX_ONSET && coda <= MAX_CODA;
}

function validateWord(input, registry, recordings, opts = {}) {
  const { requireAudio = true } = opts;
  const errors = [];

  // Step 1: normalize
  if (typeof input !== 'string') return { ok: false, errors: ['not a string'] };
  const normalized = input.trim().toLowerCase();

  // Step 2: structure
  if (!normalized) errors.push('empty');
  if (/\s/.test(normalized)) errors.push('contains whitespace (single word only)');
  if (/-/.test(normalized))  errors.push('contains hyphen (single word only)');

  // Step 3: charset whitelist
  if (errors.length === 0 && !ALLOWED_CHARS.test(normalized)) {
    errors.push('invalid characters (only a-z, ɛ, ɔ allowed)');
  }
  if (errors.length) return { ok: false, normalized, errors };

  // Step 4 + 5: tokenize and verify membership in registry
  const toks = tokenize(normalized, registry)[0]?.tokens || [];
  const unknown = toks.filter(t => !t.known).map(t => t.token);
  if (unknown.length) {
    return { ok: false, normalized, errors: [`unknown phoneme(s): ${unknown.join(', ')}`] };
  }
  const phonemes = toks.map(t => t.token);

  // Step 6: audio coverage gate
  if (requireAudio) {
    const missing = [...new Set(phonemes.filter(p => !recordings[p]))];
    if (missing.length) {
      return {
        ok: false, normalized, phonemes,
        errors: [`missing audio for phoneme(s): ${missing.join(', ')}`]
      };
    }
  }

  // Step 7: syllable shape
  const syllables = syllabifyTokens(toks, registry.phonemes);
  const badShapes = syllables
    .filter(s => !syllableShapeOk(s, registry.phonemes))
    .map(s => s.tokens.map(t => t.token).join(''));
  if (badShapes.length) {
    return {
      ok: false, normalized, phonemes, syllables,
      errors: [`invalid syllable shape: ${badShapes.join(', ')} (max onset=${MAX_ONSET}, max coda=${MAX_CODA})`]
    };
  }

  return { ok: true, normalized, phonemes, syllables, errors: [] };
}

module.exports = { validateWord };
