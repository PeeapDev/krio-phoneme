'use strict';

const grid = document.getElementById('phonemeGrid');
const analysis = document.getElementById('analysis');
const textInput = document.getElementById('textInput');

let recState = {}; // key -> { recorder, chunks, active }

// Audio quality gates and target format. Edit here to retune.
const TARGET_SAMPLE_RATE = 16000; // mono 16 kHz, 16-bit PCM (AI-friendly)
const QUALITY = {
  minDurationMs: 150,
  maxDurationMs: 4000,
  maxPeakDb: -1.0,    // reject clipping
  minRmsDb: -40.0,    // reject too-quiet
  silenceTrimDb: -45  // threshold for trimming leading/trailing silence
};

let phonemeList = [];

async function loadPhonemes() {
  const r = await fetch('/api/phonemes').then(r => r.json());
  phonemeList = r.phonemes;
  grid.innerHTML = '';
  for (const p of r.phonemes) {
    const card = document.createElement('div');
    card.className = 'card' + (p.isDigraph ? ' digraph' : '') + (p.audio ? ' has-audio' : '');
    card.innerHTML = `
      <div class="key">${p.key}${p.isDigraph ? ' <small class="muted">digraph</small>' : ''}</div>
      <div class="ipa">${p.ipa} · ${p.type}</div>
      ${p.example ? `<div class="ipa" style="font-style:italic">e.g. ${p.example}</div>` : ''}
      <div class="row">
        ${p.audio ? `<audio controls src="${p.audio}"></audio>` : `<small class="muted">no recording</small>`}
      </div>
      <div class="row" style="margin-top:6px">
        <button class="rec" data-key="${p.key}">● Record</button>
        <label class="upload-label">upload<input type="file" accept="audio/wav" hidden data-key="${p.key}" /></label>
        ${p.audio ? `<button class="del" data-key="${p.key}">Delete</button>` : ''}
      </div>
    `;
    grid.appendChild(card);
  }

  grid.querySelectorAll('button.rec').forEach(b => b.onclick = () => toggleRecord(b.dataset.key, b));
  grid.querySelectorAll('button.del').forEach(b => b.onclick = () => deleteRec(b.dataset.key));
  grid.querySelectorAll('input[type=file]').forEach(i => i.onchange = e => uploadFile(i.dataset.key, e.target.files[0]));

  const recCount = r.phonemes.filter(p => p.audio).length;
  document.getElementById('coverage').textContent = `Coverage: ${recCount} / ${r.phonemes.length}`;
}

// === Guided recording mode ===
const guided = {
  active: false, queue: [], idx: 0, recorder: null, stream: null, chunks: []
};

function setStatus(msg, cls) {
  const s = document.getElementById('gStatus');
  s.textContent = msg || '';
  s.className = 'guided-status' + (cls ? ' ' + cls : '');
}

function renderGuided() {
  const p = guided.queue[guided.idx];
  if (!p) return endGuided('Session complete!');
  document.getElementById('gKey').textContent = p.key;
  document.getElementById('gIpa').textContent = `${p.ipa} · ${p.type}${p.isDigraph ? ' · digraph' : ''}`;
  document.getElementById('gEx').textContent = p.example ? `Example: ${p.example}` : '';
  document.getElementById('gProg').textContent = `${guided.idx + 1} / ${guided.queue.length}`;
  document.getElementById('gRec').textContent = '● Record';
  document.getElementById('gRec').classList.remove('active');
  setStatus('Press Record, say the sound clearly, press Stop.');
}

async function startGuided() {
  // Queue: unrecorded first, then already-recorded (so user can re-record).
  const unrec = phonemeList.filter(p => !p.audio);
  const rec   = phonemeList.filter(p => p.audio);
  guided.queue = [...unrec, ...rec];
  guided.idx = 0;
  guided.active = true;
  document.getElementById('guidedPanel').hidden = false;
  document.getElementById('btnGuided').textContent = '▶ Resume Guided Session';
  renderGuided();
}

function endGuided(msg) {
  guided.active = false;
  if (guided.stream) guided.stream.getTracks().forEach(t => t.stop());
  document.getElementById('guidedPanel').hidden = true;
  loadPhonemes();
  if (msg) alert(msg);
}

async function guidedToggle() {
  const btn = document.getElementById('gRec');
  const p = guided.queue[guided.idx];
  if (!p) return;

  // Stop case
  if (guided.recorder && guided.recorder.state === 'recording') {
    guided.recorder.stop();
    btn.textContent = '● Record';
    btn.classList.remove('active');
    return;
  }

  // Start case
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true } });
  } catch (e) { setStatus('Mic denied: ' + e.message, 'err'); return; }
  guided.stream = stream;
  guided.chunks = [];
  const r = new MediaRecorder(stream);
  guided.recorder = r;
  r.ondataavailable = ev => guided.chunks.push(ev.data);
  r.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(guided.chunks, { type: r.mimeType || 'audio/webm' });
    setStatus('Encoding…');
    try {
      const { blob: wav, meta } = await blobToWav(blob);
      const gate = checkQuality(meta);
      if (!gate.ok) {
        setStatus('Rejected: ' + gate.reasons.join('; '), 'err');
        return;
      }
      await uploadBlob(p.key, wav, meta);
      setStatus(`Saved (${meta.duration_ms}ms · RMS ${meta.rms_db}dB · peak ${meta.peak_db}dB)`, 'ok');
      // Auto-advance after short delay.
      setTimeout(() => {
        guided.idx++;
        if (guided.idx >= guided.queue.length) return endGuided('Session complete!');
        // Refresh phonemeList state for the just-saved item.
        const saved = phonemeList.find(x => x.key === p.key);
        if (saved) saved.audio = '/saved';
        renderGuided();
      }, 700);
    } catch (e) {
      setStatus('Encode failed: ' + e.message, 'err');
    }
  };
  r.start();
  btn.textContent = '■ Stop';
  btn.classList.add('active');
  setStatus('Recording…');
}

document.getElementById('btnGuided').onclick = startGuided;
document.getElementById('gRec').onclick = guidedToggle;
document.getElementById('gSkip').onclick = () => {
  guided.idx++;
  if (guided.idx >= guided.queue.length) return endGuided('Session complete!');
  renderGuided();
};
document.getElementById('gStop').onclick = () => endGuided();

async function toggleRecord(key, btn) {
  const s = recState[key];
  if (s && s.active) {
    s.recorder.stop();
    btn.classList.remove('active');
    btn.textContent = '● Record';
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true } });
  } catch (e) {
    alert('Microphone access denied: ' + e.message); return;
  }
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = ev => chunks.push(ev.data);
  recorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    try {
      const { blob: wav, meta } = await blobToWav(blob);
      const gate = checkQuality(meta);
      if (!gate.ok) {
        alert(`Recording rejected:\n- ${gate.reasons.join('\n- ')}\n\nPlease re-record.`);
        recState[key] = null;
        return;
      }
      await uploadBlob(key, wav, meta);
    } catch (e) {
      alert('Encoding failed: ' + e.message);
    }
    recState[key] = null;
  };
  recorder.start();
  recState[key] = { recorder, chunks, active: true };
  btn.classList.add('active');
  btn.textContent = '■ Stop';
}

async function uploadFile(key, file) {
  if (!file) return;
  // Re-encode uploaded files through the same pipeline (target SR, mono, trimmed).
  const wav = await blobToWav(file);
  await uploadBlob(key, wav.blob, wav.meta);
}

async function uploadBlob(key, blob, meta) {
  const fd = new FormData();
  fd.append('audio', blob, 'phoneme.wav');
  if (meta) {
    fd.append('sample_rate', String(meta.sample_rate));
    fd.append('duration_ms', String(meta.duration_ms));
    fd.append('rms_db', String(meta.rms_db));
    fd.append('peak_db', String(meta.peak_db));
  }
  const r = await fetch('/api/recordings/' + encodeURIComponent(key), { method: 'POST', body: fd });
  if (!r.ok) { alert('Upload failed'); return; }
  loadPhonemes();
}

async function deleteRec(key) {
  await fetch('/api/recordings/' + encodeURIComponent(key), { method: 'DELETE' });
  loadPhonemes();
}

// Decode -> mix to mono -> resample (offline) to TARGET_SAMPLE_RATE -> trim silence
// -> compute quality metrics -> encode 16-bit PCM WAV.
async function blobToWav(blob) {
  const buf = await blob.arrayBuffer();
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const audio = await ac.decodeAudioData(buf.slice(0));

  // Offline resample to target SR, mono.
  const targetLen = Math.ceil(audio.duration * TARGET_SAMPLE_RATE);
  const off = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, targetLen, TARGET_SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  let pcm = rendered.getChannelData(0).slice(0); // mono Float32

  // Trim leading/trailing silence (10 ms windows below silenceTrimDb).
  pcm = trimSilence(pcm, TARGET_SAMPLE_RATE, QUALITY.silenceTrimDb);

  // Quality metrics on the trimmed signal.
  const meta = computeMeta(pcm, TARGET_SAMPLE_RATE);

  return { blob: encodeWav(pcm, TARGET_SAMPLE_RATE), meta };
}

function trimSilence(pcm, sr, thresholdDb) {
  const win = Math.max(1, Math.floor(sr * 0.01));
  const thresh = Math.pow(10, thresholdDb / 20);
  const isLoud = (start) => {
    const end = Math.min(pcm.length, start + win);
    let sum = 0;
    for (let i = start; i < end; i++) sum += pcm[i] * pcm[i];
    return Math.sqrt(sum / (end - start)) > thresh;
  };
  let s = 0, e = pcm.length;
  while (s < pcm.length && !isLoud(s)) s += win;
  while (e > s && !isLoud(Math.max(0, e - win))) e -= win;
  return pcm.subarray(s, e);
}

function computeMeta(pcm, sr) {
  let peak = 0, sumSq = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > peak) peak = a;
    sumSq += pcm[i] * pcm[i];
  }
  const rms = pcm.length ? Math.sqrt(sumSq / pcm.length) : 0;
  const toDb = v => v > 0 ? 20 * Math.log10(v) : -Infinity;
  return {
    sample_rate: sr,
    duration_ms: Math.round((pcm.length / sr) * 1000),
    peak_db: +toDb(peak).toFixed(2),
    rms_db: +toDb(rms).toFixed(2)
  };
}

function checkQuality(m) {
  const reasons = [];
  if (m.duration_ms < QUALITY.minDurationMs) reasons.push(`too short (${m.duration_ms}ms < ${QUALITY.minDurationMs}ms)`);
  if (m.duration_ms > QUALITY.maxDurationMs) reasons.push(`too long (${m.duration_ms}ms > ${QUALITY.maxDurationMs}ms)`);
  if (m.peak_db > QUALITY.maxPeakDb)         reasons.push(`clipping/too loud (peak ${m.peak_db}dB > ${QUALITY.maxPeakDb}dB)`);
  if (m.rms_db < QUALITY.minRmsDb)           reasons.push(`too quiet (RMS ${m.rms_db}dB < ${QUALITY.minRmsDb}dB)`);
  return { ok: reasons.length === 0, reasons };
}

function encodeWav(pcm, sr) {
  const len = pcm.length;
  const out = new ArrayBuffer(44 + len * 2);
  const dv = new DataView(out);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + len * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, len * 2, true);
  let p = 44;
  for (let i = 0; i < len; i++) {
    let s = Math.max(-1, Math.min(1, pcm[i]));
    dv.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true); p += 2;
  }
  return new Blob([out], { type: 'audio/wav' });
}

document.getElementById('btnAnalyze').onclick = async () => {
  const text = textInput.value.trim();
  if (!text) return;
  const [tok, syl] = await Promise.all([
    fetch('/api/tokenize', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({text}) }).then(r=>r.json()),
    fetch('/api/syllabify', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({text}) }).then(r=>r.json())
  ]);
  analysis.innerHTML = tok.words.map((w, i) => `
    <div class="word-block">
      <h3>${w.word}</h3>
      <div><small class="muted">tokens:</small> ${w.tokens.map(t => `<span class="tok ${t.known?'':'missing'}">${t.token}</span>`).join('')}</div>
      <div style="margin-top:6px"><small class="muted">syllables:</small> ${syl.words[i].syllables.map(s => `<span class="syl">${s.tokens.map(t=>t.token).join('')} <small>(${s.pattern})</small></span>`).join('')}</div>
    </div>
  `).join('');
};

document.getElementById('btnPronounce').onclick = async () => {
  const text = textInput.value.trim();
  if (!text) return;
  const r = await fetch('/api/pronounce', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({text}) }).then(r=>r.json());
  analysis.innerHTML = r.words.map(w => `
    <div class="word-block">
      <h3>${w.word}</h3>
      <div>${w.playlist.map(p => `<span class="tok ${p.missing?'missing':''}">${p.token}</span>`).join('')}</div>
      <div style="margin-top:6px"><small class="muted">syllables:</small> ${w.syllables.map(s => `<span class="syl">${s.tokens.map(t=>t.token).join('')}</span>`).join('')}</div>
    </div>
  `).join('');

  // Sequential audio playback.
  const playlist = r.words.flatMap(w => w.playlist);
  for (const item of playlist) {
    if (!item.audio) continue;
    await new Promise(res => {
      const a = new Audio(item.audio);
      a.onended = res; a.onerror = res;
      a.play().catch(res);
    });
  }
};

loadPhonemes();
