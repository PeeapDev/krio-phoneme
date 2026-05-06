'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const crypto = require('crypto');
const { tokenize } = require('./src/tokenizer');
const { syllabifyTokens } = require('./src/syllables');
const { buildPronunciation } = require('./src/pronounce');
const { assertValid, assertConsistency, assertLexiconConsistency } = require('./src/validate');
const { validateWord } = require('./src/word-validator');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const AUDIO_DIR = path.join(ROOT, 'audio');
const PHONEMES_FILE = path.join(DATA_DIR, 'phonemes.json');
const RECORDINGS_FILE = path.join(DATA_DIR, 'recordings.json');
const LEXICON_FILE = path.join(DATA_DIR, 'lexicon.json');

for (const d of [DATA_DIR, AUDIO_DIR, path.join(AUDIO_DIR, 'vowels'), path.join(AUDIO_DIR, 'consonants')]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function loadRegistry() {
  const reg = readJson(PHONEMES_FILE);
  return assertValid('phonemes', reg);
}
function loadRecordings() {
  const rec = readJson(RECORDINGS_FILE);
  return assertValid('recordings', rec);
}
function saveRecordings(rec) {
  assertValid('recordings', rec);
  writeJson(RECORDINGS_FILE, rec);
}
function recFile(entry) {
  return typeof entry === 'string' ? entry : (entry && entry.file) || null;
}

// Validate everything on boot. Fail loudly if data is malformed.
try {
  const reg = loadRegistry();
  const rec = loadRecordings();
  assertConsistency(reg, rec);
  if (fs.existsSync(LEXICON_FILE)) {
    const lex = readJson(LEXICON_FILE);
    assertValid('lexicon', lex);
    assertLexiconConsistency(reg, lex);
    console.log(`[validate] phonemes/recordings/lexicon OK (${Object.keys(lex.words).length} words)`);
  } else {
    console.log('[validate] phonemes.json and recordings.json OK');
  }
} catch (e) {
  console.error('[validate] FATAL:', e.message);
  process.exit(1);
}

// Strict file naming: <vowels|consonants>/<key>.wav (ascii) or u_<hex>.wav (non-ascii)
function safeName(key) {
  if (/^[a-z]+$/.test(key)) return `${key}.wav`;
  const hex = Buffer.from(key, 'utf8').toString('hex');
  return `u_${hex}.wav`;
}
function bucketFor(key) {
  // Look up phoneme type at request time; falls back to consonants for safety.
  try {
    const reg = readJson(PHONEMES_FILE);
    return reg.phonemes[key]?.type === 'vowel' ? 'vowels' : 'consonants';
  } catch { return 'consonants'; }
}
function relativePathFor(key) {
  return `${bucketFor(key)}/${safeName(key)}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, path.join(AUDIO_DIR, bucketFor(req.params.key))),
    filename: (req, _file, cb) => cb(null, safeName(req.params.key))
  }),
  fileFilter: (_req, file, cb) => {
    const ok = /\.wav$/i.test(file.originalname) ||
               file.mimetype === 'audio/wav' ||
               file.mimetype === 'audio/wave' ||
               file.mimetype === 'audio/x-wav';
    cb(ok ? null : new Error('Only .wav files are accepted'), ok);
  }
});

const app = express();
app.use(express.json());
app.use('/audio', express.static(AUDIO_DIR));
app.use('/', express.static(path.join(ROOT, 'public')));

// Recordings need {key -> file} for the engine; flatten metadata entries.
function flattenRecordings(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec.recordings)) out[k] = recFile(v);
  return { speaker: rec.speaker, recordings: out };
}

app.get('/api/phonemes', (_req, res) => {
  const reg = loadRegistry();
  const rec = loadRecordings();
  const out = Object.entries(reg.phonemes).map(([key, meta]) => {
    const entry = rec.recordings[key];
    const file = recFile(entry);
    return {
      key,
      ipa: meta.ipa,
      type: meta.type,
      example: meta.example || null,
      isDigraph: (reg.digraphs || []).includes(key),
      audio: file ? `/audio/${file}` : null,
      meta: typeof entry === 'object' ? entry : null
    };
  });
  res.json({ speaker: rec.speaker, digraphs: reg.digraphs, phonemes: out });
});

app.post('/api/recordings/:key', upload.single('audio'), (req, res) => {
  try {
    const reg = loadRegistry();
    const key = req.params.key;
    if (!reg.phonemes[key]) return res.status(400).json({ error: 'unknown phoneme' });
    if (!req.file) return res.status(400).json({ error: 'no file' });

    const filePath = req.file.path;
    const buf = fs.readFileSync(filePath);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

    // File path is bucket/filename relative to audio root.
    const relPath = path.relative(AUDIO_DIR, filePath).replace(/\\/g, '/');

    // Optional client-supplied audio metadata.
    const meta = {
      file: relPath,
      speaker: (req.body && req.body.speaker) || 'speaker_01',
      recorded_at: new Date().toISOString(),
      sha256
    };
    const numFields = ['sample_rate', 'duration_ms', 'rms_db', 'peak_db'];
    for (const f of numFields) {
      if (req.body && req.body[f] != null && req.body[f] !== '') {
        const n = Number(req.body[f]);
        if (Number.isFinite(n)) meta[f] = n;
      }
    }
    if (meta.sample_rate) meta.sample_rate = Math.round(meta.sample_rate);

    const rec = loadRecordings();
    rec.recordings[key] = meta;
    saveRecordings(rec);
    res.json({ key, ...meta });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/recordings/:key', (req, res) => {
  const rec = loadRecordings();
  const entry = rec.recordings[req.params.key];
  const file = recFile(entry);
  if (file) {
    // file may be relative path "vowels/a.wav" or legacy "phoneme_a.wav"
    const p = path.isAbsolute(file) ? file : path.join(AUDIO_DIR, file);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    delete rec.recordings[req.params.key];
    saveRecordings(rec);
  }
  res.json({ ok: true });
});

app.post('/api/tokenize', (req, res) => {
  res.json({ words: tokenize(req.body.text || '', loadRegistry()) });
});

app.post('/api/syllabify', (req, res) => {
  const reg = loadRegistry();
  const words = tokenize(req.body.text || '', reg);
  res.json({
    words: words.map(w => ({
      word: w.word,
      syllables: syllabifyTokens(w.tokens, reg.phonemes)
    }))
  });
});

function loadLexicon() {
  if (!fs.existsSync(LEXICON_FILE)) return { version: 1, words: {} };
  const lex = readJson(LEXICON_FILE);
  return assertValid('lexicon', lex);
}
function saveLexicon(lex) {
  assertValid('lexicon', lex);
  const reg = loadRegistry();
  assertLexiconConsistency(reg, lex);
  writeJson(LEXICON_FILE, lex);
}

app.get('/api/lexicon', (_req, res) => {
  res.json(loadLexicon());
});

// Single-word add. Subject to the same strict pipeline as bulk.
app.post('/api/lexicon', (req, res) => {
  try {
    const reg = loadRegistry();
    const recs = flattenRecordings(loadRecordings());
    const v = validateWord(req.body.word || '', reg, recs);
    if (!v.ok) return res.status(400).json({ error: v.errors.join('; '), details: v });

    const lex = loadLexicon();
    if (lex.words[v.normalized]) {
      return res.status(409).json({ error: `"${v.normalized}" already exists; updates must be done by deleting then re-adding` });
    }
    const gloss = String(req.body.gloss || '').trim();
    lex.words[v.normalized] = gloss ? { phonemes: v.phonemes, gloss } : { phonemes: v.phonemes };
    saveLexicon(lex);
    res.json({ word: v.normalized, phonemes: v.phonemes, syllables: v.syllables, gloss: gloss || null });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Bulk import — strict, controlled ingestion pipeline.
// - Same validator as single-add (centralized)
// - NO OVERWRITE: existing words are SKIPPED, never updated in bulk
// - Invalid lines are rejected per-line; valid lines proceed
// - Returns full per-line report (status, phonemes, syllables, errors)
app.post('/api/lexicon/bulk', (req, res) => {
  try {
    const text = String(req.body.text || '');
    const dryRun = !!req.body.dryRun;
    const reg = loadRegistry();
    const recs = flattenRecordings(loadRecordings());
    const lex = loadLexicon();

    const results = [];
    const lines = text.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;

      // Parse "<word>" optionally followed by a separator and gloss.
      // Gloss is metadata only — does NOT participate in validation.
      const m = line.match(/^(\S+?)(?:\s*[=|\t]\s*(.*))?$/);
      if (!m) { results.push({ line, status: 'rejected', errors: ['unparseable line'] }); continue; }
      const wordRaw = m[1];
      const gloss = (m[2] || '').trim();

      const v = validateWord(wordRaw, reg, recs);
      if (!v.ok) {
        results.push({
          line, word: v.normalized || wordRaw, status: 'rejected',
          phonemes: v.phonemes || [], syllables: v.syllables || [], errors: v.errors
        });
        continue;
      }

      const sylStrings = v.syllables.map(s => s.tokens.map(t => t.token).join(''));

      if (lex.words[v.normalized]) {
        results.push({
          line, word: v.normalized, status: 'skipped',
          phonemes: v.phonemes, syllables: sylStrings,
          errors: ['already exists (bulk does not overwrite — delete to re-add)']
        });
        continue;
      }

      if (!dryRun) {
        lex.words[v.normalized] = gloss
          ? { phonemes: v.phonemes, gloss }
          : { phonemes: v.phonemes };
      }
      results.push({
        line, word: v.normalized, status: 'added',
        phonemes: v.phonemes, syllables: sylStrings, gloss: gloss || null
      });
    }

    if (!dryRun) saveLexicon(lex);

    const total    = results.length;
    const added    = results.filter(r => r.status === 'added').length;
    const skipped  = results.filter(r => r.status === 'skipped').length;
    const rejected = results.filter(r => r.status === 'rejected').length;
    res.json({ dryRun, total, added, skipped, rejected, results });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/lexicon/:word', (req, res) => {
  const lex = loadLexicon();
  delete lex.words[req.params.word];
  saveLexicon(lex);
  res.json({ ok: true });
});

app.post('/api/pronounce', (req, res) => {
  const reg = loadRegistry();
  const rec = flattenRecordings(loadRecordings());
  res.json({ words: buildPronunciation(req.body.text || '', reg, rec) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Krio Phoneme system running on http://localhost:${PORT}`));
