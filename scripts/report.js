'use strict';

// Coverage + integrity report. No external deps beyond ajv (via validate.js).
// Exits non-zero on any integrity failure (suitable for CI/pre-AI handoff).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assertValid, assertConsistency } = require('../src/validate');

const ROOT = path.join(__dirname, '..');
const AUDIO_DIR = path.join(ROOT, 'audio');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'phonemes.json'), 'utf8'));
const rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'recordings.json'), 'utf8'));

assertValid('phonemes', reg);
assertValid('recordings', rec);
assertConsistency(reg, rec);

const recFile = e => typeof e === 'string' ? e : (e && e.file) || null;
const recMeta = e => typeof e === 'object' && e ? e : {};

const allKeys = Object.keys(reg.phonemes);
const recorded = [];
const missing = [];
const integrity = [];
const sampleRates = new Set();
const durations = [];
let rmsTotal = 0, rmsCount = 0;

for (const key of allKeys) {
  const entry = rec.recordings[key];
  const file = recFile(entry);
  if (!file) { missing.push(key); continue; }

  const p = path.join(AUDIO_DIR, file);
  if (!fs.existsSync(p)) {
    integrity.push(`${key}: file missing on disk (${file})`);
    continue;
  }

  const buf = fs.readFileSync(p);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const meta = recMeta(entry);
  if (meta.sha256 && meta.sha256 !== sha) {
    integrity.push(`${key}: sha256 mismatch (manifest=${meta.sha256.slice(0,8)}… disk=${sha.slice(0,8)}…)`);
  }
  if (meta.sample_rate) sampleRates.add(meta.sample_rate);
  if (meta.duration_ms) durations.push(meta.duration_ms);
  if (typeof meta.rms_db === 'number' && isFinite(meta.rms_db)) { rmsTotal += meta.rms_db; rmsCount++; }
  recorded.push(key);
}

// Orphan files: WAVs on disk not referenced by manifest.
const referenced = new Set(allKeys.map(k => recFile(rec.recordings[k])).filter(Boolean));
const orphans = fs.existsSync(AUDIO_DIR)
  ? fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.wav') && !referenced.has(f))
  : [];

const pct = allKeys.length ? Math.round((recorded.length / allKeys.length) * 100) : 0;
const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

console.log('='.repeat(56));
console.log('Krio Phoneme · Dataset Report');
console.log('='.repeat(56));
console.log(`Speaker:        ${rec.speaker}`);
console.log(`Phonemes:       ${allKeys.length} (${reg.digraphs.length} digraphs)`);
console.log(`Recorded:       ${recorded.length} / ${allKeys.length}  (${pct}%)`);
console.log(`Missing:        ${missing.length}${missing.length ? '  -> ' + missing.join(', ') : ''}`);
console.log(`Sample rates:   ${[...sampleRates].join(', ') || 'n/a'}${sampleRates.size > 1 ? '  [WARN] inconsistent' : ''}`);
console.log(`Avg duration:   ${avg(durations)} ms`);
console.log(`Avg RMS:        ${rmsCount ? (rmsTotal / rmsCount).toFixed(1) + ' dB' : 'n/a'}`);
console.log(`Integrity:      ${integrity.length === 0 ? 'OK' : integrity.length + ' issue(s)'}`);
for (const i of integrity) console.log('   - ' + i);
console.log(`Orphan files:   ${orphans.length}${orphans.length ? '  -> ' + orphans.join(', ') : ''}`);
console.log('='.repeat(56));

if (integrity.length > 0) process.exit(2);
