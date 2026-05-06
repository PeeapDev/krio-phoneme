'use strict';

const fs = require('fs');
const path = require('path');
const { assertValid, assertConsistency, assertLexiconConsistency } = require('../src/validate');

const ROOT = path.join(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'phonemes.json'), 'utf8'));
const rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'recordings.json'), 'utf8'));
const lexPath = path.join(ROOT, 'data', 'lexicon.json');

try {
  assertValid('phonemes', reg);
  assertValid('recordings', rec);
  assertConsistency(reg, rec);
  if (fs.existsSync(lexPath)) {
    const lex = JSON.parse(fs.readFileSync(lexPath, 'utf8'));
    assertValid('lexicon', lex);
    assertLexiconConsistency(reg, lex);
    console.log(`OK: schemas valid; ${Object.keys(lex.words).length} lexicon entries consistent.`);
  } else {
    console.log('OK: schemas valid (no lexicon yet).');
  }
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
