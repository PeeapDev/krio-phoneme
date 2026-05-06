'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });

const SCHEMAS = path.join(__dirname, '..', 'schemas');
const phonemeSchema   = JSON.parse(fs.readFileSync(path.join(SCHEMAS, 'phonemes.schema.json'), 'utf8'));
const recordingSchema = JSON.parse(fs.readFileSync(path.join(SCHEMAS, 'recordings.schema.json'), 'utf8'));
const lexiconSchema   = JSON.parse(fs.readFileSync(path.join(SCHEMAS, 'lexicon.schema.json'), 'utf8'));
const wordRecSchema   = JSON.parse(fs.readFileSync(path.join(SCHEMAS, 'word-recordings.schema.json'), 'utf8'));

const validators = {
  phonemes:        ajv.compile(phonemeSchema),
  recordings:      ajv.compile(recordingSchema),
  lexicon:         ajv.compile(lexiconSchema),
  'word-recordings': ajv.compile(wordRecSchema)
};

function fmt(errors) {
  return (errors || []).map(e => `  ${e.instancePath || '/'} ${e.message}`).join('\n');
}

function assertValid(kind, data) {
  const fn = validators[kind];
  if (!fn) throw new Error(`unknown schema kind: ${kind}`);
  if (!fn(data)) {
    const err = new Error(`Invalid ${kind}.json:\n${fmt(fn.errors)}`);
    err.validation = fn.errors;
    throw err;
  }
  return data;
}

// Cross-file invariants beyond JSON Schema reach.
function assertConsistency(phonemes, recordings) {
  const keys = new Set(Object.keys(phonemes.phonemes));
  for (const k of Object.keys(recordings.recordings)) {
    if (!keys.has(k)) throw new Error(`recordings.json references unknown phoneme key: "${k}"`);
  }
  for (const dg of phonemes.digraphs) {
    if (!keys.has(dg)) throw new Error(`digraph "${dg}" missing from phonemes map`);
  }
}

function assertLexiconConsistency(phonemes, lexicon) {
  const keys = new Set(Object.keys(phonemes.phonemes));
  const errs = [];
  for (const [word, entry] of Object.entries(lexicon.words)) {
    for (const p of entry.phonemes) {
      if (!keys.has(p)) errs.push(`word "${word}" uses unknown phoneme "${p}"`);
    }
  }
  if (errs.length) throw new Error('lexicon.json invalid:\n  - ' + errs.join('\n  - '));
}

module.exports = { assertValid, assertConsistency, assertLexiconConsistency };
