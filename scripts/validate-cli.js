'use strict';

const fs = require('fs');
const path = require('path');
const { assertValid, assertConsistency } = require('../src/validate');

const ROOT = path.join(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'phonemes.json'), 'utf8'));
const rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'recordings.json'), 'utf8'));

try {
  assertValid('phonemes', reg);
  assertValid('recordings', rec);
  assertConsistency(reg, rec);
  console.log('OK: schemas valid, registry/recordings consistent.');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
