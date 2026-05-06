'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });

const SCHEMAS = path.join(__dirname, '..', 'schemas');
const phonemeSchema   = JSON.parse(fs.readFileSync(path.join(SCHEMAS, 'phonemes.schema.json'), 'utf8'));
const recordingSchema = JSON.parse(fs.readFileSync(path.join(SCHEMAS, 'recordings.schema.json'), 'utf8'));

const validatePhonemes   = ajv.compile(phonemeSchema);
const validateRecordings = ajv.compile(recordingSchema);

function fmt(errors) {
  return (errors || []).map(e => `  ${e.instancePath || '/'} ${e.message}`).join('\n');
}

function assertValid(kind, data) {
  const fn = kind === 'phonemes' ? validatePhonemes : validateRecordings;
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

module.exports = { assertValid, assertConsistency };
