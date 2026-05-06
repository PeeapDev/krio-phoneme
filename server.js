'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const crypto = require('crypto');
const { tokenize } = require('./src/tokenizer');
const { syllabifyTokens } = require('./src/syllables');
const { buildPronunciation } = require('./src/pronounce');
const { assertValid, assertConsistency } = require('./src/validate');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const AUDIO_DIR = path.join(ROOT, 'audio');
const PHONEMES_FILE = path.join(DATA_DIR, 'phonemes.json');
const RECORDINGS_FILE = path.join(DATA_DIR, 'recordings.json');

for (const d of [DATA_DIR, AUDIO_DIR]) {
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
  console.log('[validate] phonemes.json and recordings.json OK');
} catch (e) {
  console.error('[validate] FATAL:', e.message);
  process.exit(1);
}

// Strict file naming: phoneme_<key>.wav
function safeName(key) {
  // Hash non-ASCII keys (e.g. ɛ, ɔ) to keep filenames portable.
  if (/^[a-z]+$/.test(key)) return `phoneme_${key}.wav`;
  const hex = Buffer.from(key, 'utf8').toString('hex');
  return `phoneme_u_${hex}.wav`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AUDIO_DIR),
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

    // Optional client-supplied audio metadata.
    const meta = {
      file: path.basename(filePath),
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
    const p = path.join(AUDIO_DIR, file);
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

app.post('/api/pronounce', (req, res) => {
  const reg = loadRegistry();
  const rec = flattenRecordings(loadRecordings());
  res.json({ words: buildPronunciation(req.body.text || '', reg, rec) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Krio Phoneme system running on http://localhost:${PORT}`));
