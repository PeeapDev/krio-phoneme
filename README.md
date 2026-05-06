# Krio Phoneme & Pronunciation System — Phase 1

Controlled, rule-based pronunciation infrastructure for Krio. **No AI. No database. No cloud.**
Single speaker. File-based storage. Designed as clean data infrastructure for future AI use.

## Scope (Phase 1)

- Phoneme registry (`data/phonemes.json`)
- Audio recording system (one `.wav` per phoneme, single speaker)
- Rule-based tokenizer (digraphs first, then single chars)
- Deterministic syllable engine (CV, CVC, VC, V)
- Pronunciation engine: text → tokens → phoneme lookup → audio playback

## Non-Goals

No AI models, no students, no OCR, no databases, no cloud, no ML.

## Run

```
npm install
npm start
```

Open http://localhost:3000

## Storage Layout

```
/data/phonemes.json     # registry (keys + IPA + type + digraph list)
/data/recordings.json   # manifest: phoneme key -> wav filename
/audio/*.wav            # one file per phoneme: phoneme_<key>.wav
```

For non-ASCII phoneme keys (`ɛ`, `ɔ`), the filename uses a hex-encoded suffix to stay portable: `phoneme_u_<hex>.wav`.

## API

- `GET  /api/phonemes` — registry + recording status
- `POST /api/recordings/:key` — multipart `audio` field, `.wav` only
- `DELETE /api/recordings/:key`
- `POST /api/tokenize` — `{text}` → tokens per word
- `POST /api/syllabify` — `{text}` → syllables per word
- `POST /api/pronounce` — `{text}` → tokens + syllables + audio playlist

## Audio Recording Rules

- Single speaker only (configured in `data/recordings.json`).
- Clean environment, mono.
- One recording per phoneme. Re-recording overwrites.
- Strict naming: `phoneme_<key>.wav`.

## Success Criteria

1. All phonemes recorded consistently by one speaker.
2. Words break into deterministic syllables (CV / CVC / VC / V).
3. Input text is pronounced by sequential phoneme playback.
4. Data on disk is clean, structured, and reusable for future AI phases.
