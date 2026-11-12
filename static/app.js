(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = (v, n = 4) => Math.round(v * 10 ** n) / 10 ** n;
  const SAVE_KEY = "wavebeats.project.v1";

  const KEYS = [
    ["C", 0], ["Db", 1], ["D", 2], ["Eb", 3], ["E", 4], ["F", 5],
    ["F#", 6], ["G", 7], ["Ab", 8], ["A", 9], ["Bb", 10], ["B", 11],
  ];
  const KEY_PC = Object.fromEntries(KEYS);

  const SCALES = {
    major:            { label: "Major",            intervals: [0, 2, 4, 5, 7, 9, 11] },
    minor:            { label: "Natural Minor",    intervals: [0, 2, 3, 5, 7, 8, 10] },
    harmonic_minor:   { label: "Harmonic Minor",   intervals: [0, 2, 3, 5, 7, 8, 11] },
    dorian:           { label: "Dorian",           intervals: [0, 2, 3, 5, 7, 9, 10] },
    mixolydian:       { label: "Mixolydian",       intervals: [0, 2, 4, 5, 7, 9, 10] },
    pentatonic_major: { label: "Pentatonic Major", intervals: [0, 2, 4, 7, 9] },
    pentatonic_minor: { label: "Pentatonic Minor", intervals: [0, 3, 5, 7, 10] },
    blues:            { label: "Blues",            intervals: [0, 3, 5, 6, 7, 10] },
    chromatic:        { label: "Chromatic",        intervals: Array.from({ length: 12 }, (_, i) => i) },
  };

  const INSTRUMENT_GROUPS = [
    ["Analog", [
      ["sine", "Sine"], ["square", "Square"], ["saw", "Saw"],
      ["tri", "Triangle"], ["noise", "Noise"],
    ]],
    ["Keys", [
      ["piano", "Piano"], ["organ", "Organ"], ["harpsichord", "Harpsichord"],
      ["clavinet", "Clavinet"], ["celesta", "Celesta"],
    ]],
    ["Plucked", [
      ["guitar", "Guitar"], ["nylon", "Nylon Guitar"], ["harp", "Harp"],
      ["banjo", "Banjo"], ["sitar", "Sitar"], ["kalimba", "Kalimba"],
    ]],
    ["Sustained", [
      ["strings", "Strings"], ["pad", "Pad"], ["bass", "Bass"], ["choir", "Choir"],
    ]],
    ["Wind", [
      ["flute", "Flute"], ["brass", "Brass"], ["reed", "Reed / Sax"],
      ["accordion", "Accordion"],
    ]],
    ["Bells & Mallets", [
      ["bell", "Bell"], ["pluck", "Pluck"], ["marimba", "Marimba"],
      ["xylophone", "Xylophone"], ["vibraphone", "Vibraphone"],
      ["steel_drums", "Steel Drums"],
    ]],
  ];

  const INSTRUMENT_LABELS = Object.fromEntries(
    INSTRUMENT_GROUPS.flatMap(([, items]) => items)
  );
  INSTRUMENT_LABELS.auto = "Auto (by pitch)";

  const DRUMS = [
    ["none", "No beat"], ["four", "Four on the floor"], ["house", "House"],
    ["techno", "Techno"], ["rock", "Rock"], ["break", "Breakbeat"],
    ["boombap", "Boom bap"], ["funk", "Funk"], ["shuffle", "Shuffle"],
    ["dnb", "Drum & bass"], ["reggaeton", "Reggaeton"], ["afrobeat", "Afrobeat"],
    ["half", "Half-time"], ["trap", "Trap"],
  ];

  const PALETTE = [
    "#c4462e", "#285f86", "#68723a", "#7a4768",
    "#a8752a", "#2d6f66", "#201e1a", "#8c3a52",
  ];
  const NOTE_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const NOTE_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

  const DEFAULT_SETTINGS = {
    tempo: 96, key: "C", scale: "minor", bars: 4, beatsPerBar: 4,
    snap: 0.5, drums: "four", humanize: true, loop: false,
    masterReverb: 0.18, masterDelay: 0.12, masterVol: 0.9,
    newInstrument: "auto", lowOctave: 2, octaves: 3,
    duration: 10,
  };

  const GENERATOR_DEFAULTS = {
    voices: 3, density: 0.55, motion: "melodic",
    register: "mixed", bass: "walk", complexity: 0.5,
    play: false, auto: false, autoInterval: 8,
  };

  const REGISTER_BANDS = {
    low: [0.02, 0.30], mid: [0.28, 0.68],
    high: [0.62, 0.98], full: [0.04, 0.96], mixed: [0.02, 0.98],
  };
  const MOTION_INSTRUMENTS = {
    melodic: ["saw", "piano", "flute", "pluck", "vibraphone", "kalimba", "nylon"],
    arpeggio: ["pluck", "harp", "marimba", "bell", "clavinet"],
    steps: ["clavinet", "organ", "square", "piano"],
    scatter: ["bell", "celesta", "kalimba", "pluck"],
    wave: ["sine", "pad", "strings", "choir", "flute"],
    "random-walk": ["pluck", "bell", "clavinet", "saw"],
    chords: ["pad", "strings", "choir", "bell"],
    ostinato: ["pluck", "marimba", "clavinet", "piano"],
    drone: ["pad", "strings", "choir"],
  };
  const BASS_INSTRUMENTS = ["bass", "bass", "saw", "tri"];
  const BASS_STYLES = ["off", "pulse", "walk", "octave", "arp", "acid", "sub"];
  const SMOOTH_MOTIONS = new Set(["wave", "drone"]);
  const MOTION_LABELS = {
    melodic: "Melody", arpeggio: "Arp", steps: "Steps",
    scatter: "Scatter", wave: "Wave",
    "random-walk": "Random walk", chords: "Chords",
    ostinato: "Ostinato", drone: "Drone",
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    generator: { ...GENERATOR_DEFAULTS },
    strokes: [],
    selectedId: null,
    revision: 0,
    spec: null,
    specRev: -1,
    playing: false,
    playheadBeat: 0,
    rendering: false,
    booted: false,
  };

  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");
  const stage = $("stage");

  let layout = { w: 0, h: 0, left: 58, right: 18, top: 20, bottom: 76, plotW: 0, plotH: 0 };
  let drawing = null;       // { stroke }
  let dragging = null;      // { stroke, startX, startY, origin, moved }
  let hoverPoint = null;    // { px, py }
  let seq = 1;
  let history = [];
  let future = [];
  let audioEl = null;
  let rafId = 0;
  let analyzeTimer = 0;
  let audioTimer = 0;
  let saveTimer = 0;
  let toastTimer = 0;
  let analyzeAbort = null;
  let audioJob = null;
  let genAutoTimer = 0;
  let audioPending = 0;
  const audioCache = { rev: -1, blob: null, url: null };
  const totalBeats = () =>
    Math.max(1, state.settings.bars * state.settings.beatsPerBar);

  function fmtTime(sec) {
    sec = Math.max(0, sec || 0);
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  const mathFuncCache = new Map();

function parseMathFunc(expr) {
  const fns = ["sin", "cos", "tan", "sqrt", "log", "exp", "abs", "pow", "floor"];
  let safe = String(expr).replace(/\^/g, "**").replace(/\bpi\b/gi, "Math.PI");
  for (const f of fns) safe = safe.replace(new RegExp(`\\b${f}\\b`, "g"), `Math.${f}`);
  // After removing the allowed Math.* names, only numbers/operators/x may remain
  const rest = safe.replace(/Math\.(PI|sin|cos|tan|sqrt|log|exp|abs|pow|floor)/g, "");
  if (/[^0-9x+\-*/%().,\s]/.test(rest)) return null;
  try {
    return new Function("x", `"use strict"; return (${safe});`);
  } catch {
    return null;
  }
}   // <-- this closing brace was missing

function plotMathFunction(expr, minX, maxX, samples = 200) {
  const fn = parseMathFunc(expr);
  if (!fn || !(maxX > minX)) return null;
  const total = totalBeats();
  const raw = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    let v;
    try { v = Number(fn(minX + (maxX - minX) * u)); } catch { return null; }
    if (Number.isFinite(v)) raw.push({ x: u * total, v });
  }
  if (raw.length < 2) return null;
  const lo = Math.min(...raw.map((r) => r.v));
  const hi = Math.max(...raw.map((r) => r.v));
  const span = hi - lo || 1;
  return raw.map((r) => ({ x: r.x, y: 0.05 + 0.9 * ((r.v - lo) / span), p: 0.5 }));
}
  function computeRowsForImport() {
    const s = state.settings;
    const pc = KEY_PC[s.key] ?? 0;
    const scale = SCALES[s.scale] || SCALES.minor;
    const key = s.key || "C";
    const flat = key.includes("b") ||
      (["minor", "harmonic_minor", "blues", "pentatonic_minor"].includes(s.scale) &&
        !["F#", "C#", "G#", "D#", "A#"].includes(key));
    const lowOctave = Number.isFinite(s.lowOctave) ? s.lowOctave : 2;
    const octaves = Number.isFinite(s.octaves) ? s.octaves : 3;
    const low = (lowOctave + 1) * 12 + pc;
    const high = low + octaves * 12;
    const rows = [];
    for (let midi = low; midi <= high; midi++) {
      if (scale.intervals.includes(((midi - pc) % 12 + 12) % 12)) {
        rows.push({
          midi,
          name: midiToName(midi, flat),
          root: (midi - pc) % 12 === 0,
          octave: Math.floor(midi / 12) - 1,
        });
      }
    }
    if (!rows.length) {
      for (let midi = low; midi <= high; midi++) {
        rows.push({ midi, name: midiToName(midi, flat), root: false, octave: Math.floor(midi / 12) - 1 });
      }
    }
    return rows;
  }

  function midiToName(midi, flat = false) {
    const names = flat ? NOTE_FLAT : NOTE_SHARP;
    const pc = ((midi % 12) + 12) % 12;
    return names[pc] + (Math.floor(midi / 12) - 1);
  }

  function computeRows() {
    const s = state.settings;
    const pc = KEY_PC[s.key] ?? 0;
    const scale = SCALES[s.scale] || SCALES.minor;
    const key = s.key || "C";
    const flat = key.includes("b") ||
      (["minor", "harmonic_minor", "blues", "pentatonic_minor"].includes(s.scale) &&
        !["F#", "C#", "G#", "D#", "A#"].includes(key));
    const lowOctave = Number.isFinite(s.lowOctave) ? s.lowOctave : 2;
    const octaves = Number.isFinite(s.octaves) ? s.octaves : 3;
    const low = (lowOctave + 1) * 12 + pc;
    const high = low + octaves * 12;
    const rows = [];
    for (let midi = low; midi <= high; midi++) {
      if (scale.intervals.includes(((midi - pc) % 12 + 12) % 12)) {
        rows.push({
          midi,
          name: midiToName(midi, flat),
          root: (midi - pc) % 12 === 0,
          octave: Math.floor(midi / 12) - 1,
        });
      }
    }
    if (!rows.length) {
      for (let midi = low; midi <= high; midi++) {
        rows.push({ midi, name: midiToName(midi, flat), root: false, octave: Math.floor(midi / 12) - 1 });
      }
    }
    return rows;
  }

  const selectedStroke = () => state.strokes.find((s) => s.id === state.selectedId) || null;
  const hasContent = () =>
    state.strokes.some((s) => s.points && s.points.length) || state.settings.drums !== "none";

  function showToast(message, isError = false) {
    const el = $("toast");
    el.textContent = message;
    el.classList.toggle("error", isError);
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => { el.hidden = true; }, 220);
    }, 3400);
  }
  function buildPayload() {
    return {
      settings: {
        tempo: state.settings.tempo,
        key: state.settings.key,
        scale: state.settings.scale,
        bars: state.settings.bars,
        beatsPerBar: state.settings.beatsPerBar,
        snap: state.settings.snap,
        drums: state.settings.drums,
        humanize: state.settings.humanize,
        masterReverb: state.settings.masterReverb,
        masterDelay: state.settings.masterDelay,
        masterVol: state.settings.masterVol,
        lowOctave: state.settings.lowOctave,
        octaves: state.settings.octaves,
      },
      strokes: state.strokes.map((s) => ({
        id: s.id,
        name: s.name || "",
        color: s.color,
        instrument: s.instrument || "auto",
        volume: s.volume,
        pan: s.pan,
        reverb: s.reverb,
        delay: s.delay,
        mute: !!s.mute,
        points: s.points.map((p) => [round(p.x, 4), round(p.y, 4), round(p.p ?? 0.5, 3)]),
        spans: Array.isArray(s.spans)
          ? s.spans.map(([a, b]) => [round(a, 4), round(b, 4)])
          : undefined,
      })),
    };
  }
  function populateInstrumentSelect(select, includeAuto) {
    if (!select) return;
    const previous = select.value;
    select.innerHTML = "";
    if (includeAuto) {
      const opt = document.createElement("option");
      opt.value = "auto";
      opt.textContent = "Auto (by pitch)";
      select.appendChild(opt);
    }
    for (const [group, items] of INSTRUMENT_GROUPS) {
      const og = document.createElement("optgroup");
      og.label = group;
      for (const [value, label] of items) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        og.appendChild(opt);
      }
      select.appendChild(og);
    }
    if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  }

  function populateDrumsSelect() {
    const select = $("drums");
    const previous = select.value;
    select.innerHTML = "";
    for (const [value, label] of DRUMS) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    }
    if (DRUMS.some(([value]) => value === previous)) select.value = previous;
  }

  function populateStaticSelects() {
    const keySel = $("key");
    keySel.innerHTML = "";
    for (const [name] of KEYS) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      keySel.appendChild(opt);
    }
    const scaleSel = $("scale");
    scaleSel.innerHTML = "";
    for (const [value, data] of Object.entries(SCALES)) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = data.label;
      scaleSel.appendChild(opt);
    }
    populateDrumsSelect();
    populateInstrumentSelect($("newInstrument"), true);
    populateInstrumentSelect($("selInstrument"), true);
  }

  async function fetchMeta() {
    try {
      const res = await fetch("/api/meta", { cache: "no-store" });
      if (!res.ok) return;
      const meta = await res.json();
      if (Array.isArray(meta.drums) && meta.drums.length) {
        DRUMS.length = 0;
        for (const drum of meta.drums) DRUMS.push([drum.value, drum.label]);
        populateDrumsSelect();
        $("drums").value = state.settings.drums;
      }
      if (Array.isArray(meta.instruments) && meta.instruments.length) {
        const groups = new Map();
        for (const item of meta.instruments) {
          const group = item.group || "Other";
          if (!groups.has(group)) groups.set(group, []);
          groups.get(group).push([item.value, item.label]);
        }
        INSTRUMENT_GROUPS.length = 0;
        for (const entry of groups.entries()) INSTRUMENT_GROUPS.push(entry);
        for (const [, items] of INSTRUMENT_GROUPS) {
          for (const [value, label] of items) INSTRUMENT_LABELS[value] = label;
        }
        populateInstrumentSelect($("newInstrument"), true);
        populateInstrumentSelect($("selInstrument"), true);
        $("newInstrument").value = state.settings.newInstrument || "auto";
        const sel = selectedStroke();
        if (sel) $("selInstrument").value = sel.instrument || "auto";
      }
    } catch {
      /* keep the built-in lists offline */
    }
  }
  function syncSettingsUI() {
    const s = state.settings;
    $("tempo").value = s.tempo;
    $("key").value = s.key;
    $("scale").value = s.scale;
    $("bars").value = String(s.bars);
    $("snap").value = String(s.snap);
    $("drums").value = s.drums;
    $("newInstrument").value = s.newInstrument || "auto";
    $("masterReverb").value = s.masterReverb;
    $("masterDelay").value = s.masterDelay;
    $("masterVol").value = s.masterVol;
    $("humanize").checked = !!s.humanize;
    $("loop").checked = !!s.loop;
    const actualSec = s.bars * s.beatsPerBar * 60 / s.tempo;
    $("length").value = String(Math.max(1, Math.round(actualSec)));
    $("lengthVal").textContent = fmtTime(actualSec);
  }

  function updateMasterLabels() {
    const s = state.settings;
    $("reverbVal").textContent = `${Math.round(s.masterReverb * 100)}%`;
    $("delayVal").textContent = `${Math.round(s.masterDelay * 100)}%`;
    $("volVal").textContent = `${Math.round(s.masterVol * 100)}%`;
  }

  function readSettingsFromUI() {
    const s = state.settings;
    s.tempo = clamp(Number($("tempo").value) || 96, 40, 220);
    s.key = $("key").value;
    s.scale = $("scale").value;
    s.bars = clamp(Math.round(Number($("bars").value) || 4), 1, 128);
    s.duration = s.bars * s.beatsPerBar * 60 / s.tempo;
    s.snap = Number($("snap").value) || 0.5;
    s.drums = $("drums").value;
    s.masterReverb = Number($("masterReverb").value);
    s.masterDelay = Number($("masterDelay").value);
    s.masterVol = Number($("masterVol").value);
    s.humanize = $("humanize").checked;
    s.loop = $("loop").checked;
    s.newInstrument = $("newInstrument").value;
    updateMasterLabels();
    syncSettingsUI();
    resizeCanvas();
  }

  function syncGeneratorUI() {
    const g = state.generator;
    $("genVoices").value = g.voices;
    $("genVoicesVal").textContent = String(g.voices);
    $("genDensity").value = g.density;
    $("genDensityVal").textContent = `${Math.round(g.density * 100)}%`;
    $("genMotion").value = g.motion;
    $("genRegister").value = g.register;
    $("genBass").value = g.bass;
    $("genComplexity").value = g.complexity;
    $("genComplexityVal").textContent = `${Math.round(g.complexity * 100)}%`;
    $("genAuto").checked = !!g.auto;
    $("genAutoInterval").value = g.autoInterval;
    $("genAutoIntervalVal").textContent = `${g.autoInterval}s`;
    $("genPlay").checked = !!g.play;
  }

  function readGeneratorFromUI() {
    const g = state.generator;
    g.voices = clamp(Math.round(Number($("genVoices").value) || 3), 1, 8);
    g.density = clamp(Number($("genDensity").value) || 0.55, 0.15, 1);
    g.motion = $("genMotion").value;
    g.register = $("genRegister").value;
    g.bass = $("genBass").value;
    g.complexity = clamp(Number($("genComplexity").value) || 0.5, 0, 1);
    g.auto = $("genAuto").checked;
    g.autoInterval = clamp(Math.round(Number($("genAutoInterval").value) || 8), 3, 30);
    g.play = $("genPlay").checked;
    syncGeneratorUI();
  }
  const snapshot = () => JSON.stringify(state.strokes);

  function pushHistory() {
    history.push(snapshot());
    if (history.length > 60) history.shift();
    future = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    $("undo").disabled = history.length === 0;
    $("redo").disabled = future.length === 0;
  }

  function undo() {
    if (!history.length) return;
    future.push(snapshot());
    state.strokes = JSON.parse(history.pop());
    if (!state.strokes.some((s) => s.id === state.selectedId)) state.selectedId = null;
    renderLayers();
    markDirty();
    updateHistoryButtons();
  }

  function redo() {
    if (!future.length) return;
    history.push(snapshot());
    state.strokes = JSON.parse(future.pop());
    if (!state.strokes.some((s) => s.id === state.selectedId)) state.selectedId = null;
    renderLayers();
    markDirty();
    updateHistoryButtons();
  }
  function markDirty({ redraw = true } = {}) {
    if (state.playing) stopPlayback(true);
    state.revision += 1;
    updateEmptyHint();
    updateTransportBase();
    updateRenderLabel();
    scheduleAnalyze();
    scheduleAudio();
    scheduleSave();
    if (redraw) draw();
  }

  function scheduleAnalyze(delay = 420) {
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(analyzeNow, delay);
  }

  function scheduleAudio(delay = 1250) {
    clearTimeout(audioTimer);
    audioTimer = setTimeout(() => {
      if (!hasContent()) return;
      renderAudioNow();
    }, delay);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveLocal, 550);
  }

  async function analyzeNow() {
    const rev = state.revision;
    if (analyzeAbort) analyzeAbort.abort();
    analyzeAbort = new AbortController();
    const payload = buildPayload();
    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: analyzeAbort.signal,
      });
      const data = await res.json();
      if (rev !== state.revision) return;
      state.spec = data;
      state.specRev = rev;
      updateTransportBase();
      updateRenderLabel();
      draw();
    } catch (err) {
      if (err.name !== "AbortError") {
        console.warn("compose failed", err);
      }
    }
  }

  async function requestAudio(rev) {
    if (audioJob && audioJob.rev === rev) return audioJob.promise;
    const payload = buildPayload();
    const promise = (async () => {
      audioPending += 1;
      setRendering(true);
      try {
        const res = await fetch("/api/audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const ct = res.headers.get("content-type") || "";
          let message = "Could not render audio.";
          if (ct.includes("json")) {
            const data = await res.json().catch(() => null);
            message = data?.error || message;
          }
          throw new Error(message);
        }
        return await res.blob();
      } finally {
        audioPending = Math.max(0, audioPending - 1);
        if (!audioPending) setRendering(false);
      }
    })();
    audioJob = { rev, promise };
    const clear = () => {
      if (audioJob && audioJob.promise === promise) audioJob = null;
    };
    promise.then(clear, clear);
    return promise;
  }

  async function getAudioBlob(rev) {
    if (audioCache.rev === rev && audioCache.blob) return audioCache.blob;
    return requestAudio(rev);
  }

  async function ensureAudio() {
    const rev = state.revision;
    const blob = await getAudioBlob(rev);
    if (rev !== state.revision) throw new Error("The drawing changed while rendering.");
    if (audioCache.url) URL.revokeObjectURL(audioCache.url);
    audioCache.rev = rev;
    audioCache.blob = blob;
    audioCache.url = URL.createObjectURL(blob);
    updateRenderLabel();
    return audioCache.url;
  }

  async function renderAudioNow() {
    const rev = state.revision;
    try {
      const blob = await getAudioBlob(rev);
      if (rev !== state.revision) return;
      if (audioCache.url) URL.revokeObjectURL(audioCache.url);
      audioCache.rev = rev;
      audioCache.blob = blob;
      audioCache.url = URL.createObjectURL(blob);
      updateRenderLabel();
    } catch (err) {
      if (rev === state.revision) console.warn("audio pre-render failed", err);
    }
  }

  function setRendering(value) {
    state.rendering = value;
    const pill = $("statusPill");
    pill.hidden = !value;
    updateRenderLabel();
  }

  function updateRenderLabel() {
    const el = $("renderLabel");
    el.classList.remove("ok", "busy");
    if (state.rendering) {
      el.textContent = "rendering…";
      el.classList.add("busy");
    } else if (state.playing) {
      el.textContent = "playing";
      el.classList.add("ok");
    } else if (audioCache.rev === state.revision && audioCache.blob) {
      el.textContent = "audio ready";
      el.classList.add("ok");
    } else if (state.spec && state.spec.ok) {
      el.textContent = "ready to render";
    } else {
      el.textContent = "ready";
    }
  }
  function durationSeconds() {
    if (state.spec && state.specRev === state.revision && state.spec.duration) {
      return state.spec.duration;
    }
    return totalBeats() * 60 / Math.max(40, state.settings.tempo);
  }

  function updateTransportBase() {
    const dur = durationSeconds();
    const frac = state.playing ? clamp(state.playheadBeat / totalBeats(), 0, 1) : 0;
    $("transportFill").style.width = `${frac * 100}%`;
    $("timeLabel").textContent = `${fmtTime(frac * dur)} / ${fmtTime(dur)}`;
    const count = state.spec && state.specRev === state.revision
      ? state.spec.noteCount || 0
      : 0;
    $("noteLabel").textContent = `${count} note${count === 1 ? "" : "s"}`;
  }

  function updateEmptyHint() {
    $("emptyHint").classList.toggle("hidden", state.strokes.length > 0);
  }

  function setPlayButton(playing, busy) {
    const btn = $("play");
    btn.classList.toggle("is-playing", !!playing);
    btn.classList.toggle("busy", !!busy);
    btn.querySelector(".play-label").textContent = playing ? "Stop" : (busy ? "Rendering" : "Play");
  }

  async function togglePlay() {
    if (state.playing) {
      stopPlayback(true);
      return;
    }
    if (!hasContent()) {
      showToast("Draw a line on the canvas first — x is time, y is pitch.", true);
      return;
    }
    const rev = state.revision;
    setPlayButton(false, true);
    try {
      const url = await ensureAudio();
      if (rev !== state.revision) {
        setPlayButton(false, false);
        return;
      }
      const audio = getAudioEl();
      audio.src = url;
      audio.loop = !!state.settings.loop;
      audio.currentTime = 0;
      await audio.play();
      state.playing = true;
      state.playheadBeat = 0;
      setPlayButton(true, false);
      updateRenderLabel();
      updateTransportBase();
      resetAutoRegen();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
    } catch (err) {
      setPlayButton(false, false);
      showToast(err.message || "Playback failed.", true);
    }
  }

  function getAudioEl() {
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.preload = "auto";
      audioEl.addEventListener("ended", () => {
        if (!state.settings.loop) stopPlayback(true);
      });
    }
    return audioEl;
  }

  function stopPlayback(reset) {
    if (audioEl) {
      try { audioEl.pause(); } catch { /* noop */ }
      if (reset) {
        try { audioEl.currentTime = 0; } catch { /* noop */ }
      }
    }
    cancelAnimationFrame(rafId);
    stopAutoRegen();
    state.playing = false;
    if (reset) state.playheadBeat = 0;
    setPlayButton(false, false);
    updateRenderLabel();
    updateTransportBase();
    draw();
  }

  function tick() {
    if (!state.playing || !audioEl) return;
    const dur = durationSeconds();
    const beat = clamp((audioEl.currentTime / Math.max(0.001, dur)) * totalBeats(), 0, totalBeats());
    state.playheadBeat = beat;
    $("transportFill").style.width = `${(beat / totalBeats()) * 100}%`;
    $("timeLabel").textContent = `${fmtTime(audioEl.currentTime)} / ${fmtTime(dur)}`;
    draw();
    if (audioEl.ended) {
      stopPlayback(true);
      return;
    }
    rafId = requestAnimationFrame(tick);
  }
  function resizeCanvas() {
    const stageRect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(stageRect.width));
    const h = Math.max(1, Math.round(stageRect.height));
    // Allow horizontal scrolling for long songs.
    const contentW = Math.max(w, Math.ceil(totalBeats() * 50));
    canvas.style.width = contentW + "px";
    canvas.style.height = h + "px";
    canvas.width = Math.round(contentW * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout = {
      w: contentW, h,
      left: w < 560 ? 44 : 58,
      right: 18,
      top: 20,
      bottom: 76,
      plotW: Math.max(1, contentW - (w < 560 ? 44 : 58) - 18),
      plotH: Math.max(1, h - 20 - 76),
    };
    draw();
  }

  const plotX = (beat) => layout.left + (beat / totalBeats()) * layout.plotW;
  const plotY = (y) => layout.top + (1 - y) * layout.plotH;
  const rowY = (rowIndex, rowCount) =>
    layout.top + (1 - rowIndex / Math.max(1, rowCount - 1)) * layout.plotH;

  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const x = clamp((px - layout.left) / layout.plotW, 0, 1) * totalBeats();
    const y = clamp(1 - (py - layout.top) / layout.plotH, 0, 1);
    const pressure = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
    return { px, py, x, y, p: pressure };
  }

  const insidePlot = (px, py) =>
    px >= layout.left && px <= layout.left + layout.plotW &&
    py >= layout.top && py <= layout.top + layout.plotH;

  function tracePath(path, points) {
    if (!points.length) return;
    const first = points[0];
    let fx = plotX(first.x);
    let fy = plotY(first.y);
    path.moveTo(fx, fy);
    if (points.length === 1) return;
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const ax = plotX(a.x), ay = plotY(a.y);
      const bx = plotX(b.x), by = plotY(b.y);
      path.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
      fx = bx; fy = by;
    }
    const last = points[points.length - 1];
    path.lineTo(plotX(last.x), plotY(last.y));
  }

  function drawGrid(rows) {
    const { left, top, plotW, plotH, w, h } = layout;
    const total = totalBeats();
    const bpb = state.settings.beatsPerBar;

    ctx.fillStyle = "#efe8da";
    ctx.fillRect(0, 0, left, h);
    ctx.strokeStyle = "rgba(32, 30, 26, 0.38)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left + 0.5, top);
    ctx.lineTo(left + 0.5, top + plotH);
    ctx.stroke();

    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i < rows.length; i++) {
      const y = rowY(i, rows.length);
      const root = rows[i].root;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotW, y);
      ctx.strokeStyle = root ? "rgba(196, 70, 46, 0.26)" : "rgba(32, 30, 26, 0.09)";
      ctx.lineWidth = root ? 1.2 : 1;
      ctx.stroke();
      ctx.fillStyle = root ? "#a53d29" : "rgba(75, 70, 61, 0.74)";
      ctx.fillText(rows[i].name, left - 9, y + 0.5);
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    for (let beat = 0; beat <= total + 1e-6; beat += 1) {
      const x = plotX(beat);
      const isBar = Math.abs(beat % bpb) < 1e-6;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + plotH);
      ctx.strokeStyle = isBar ? "rgba(32, 30, 26, 0.36)" : "rgba(32, 30, 26, 0.10)";
      ctx.lineWidth = isBar ? 1.3 : 1;
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(75, 70, 61, 0.7)";
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textBaseline = "middle";
    for (let beat = 0; beat <= total + 1e-6; beat += bpb) {
      const x = plotX(beat);
      ctx.fillText(String(Math.floor(beat / bpb) + 1), x + 5, top + plotH + 19);
    }
    ctx.fillStyle = "rgba(75, 70, 61, 0.5)";
    ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = "right";
    ctx.fillText("bar", left - 9, h - 14);
  }

  function drawStrokes() {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of state.strokes) {
      if (!stroke.points || !stroke.points.length) continue;
      const selected = stroke.id === state.selectedId;
      const path = new Path2D();
      tracePath(path, stroke.points);
      ctx.globalAlpha = stroke.mute ? 0.16 : 1;
      ctx.strokeStyle = stroke.color;

      if (selected && stroke.points.length > 1) {
        ctx.globalAlpha = stroke.mute ? 0.08 : 0.20;
        ctx.lineWidth = 7;
        ctx.stroke(path);
        ctx.globalAlpha = stroke.mute ? 0.16 : 1;
      }

      ctx.lineWidth = selected ? 2.7 : 1.9;
      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        ctx.fillStyle = stroke.color;
        ctx.fillRect(plotX(p.x) - 3, plotY(p.y) - 3, 6, 6);
      } else {
        ctx.stroke(path);
      }

      if (selected) {
        for (const p of [stroke.points[0], stroke.points[stroke.points.length - 1]]) {
          const x = plotX(p.x);
          const y = plotY(p.y);
          ctx.fillStyle = "#faf7ef";
          ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
          ctx.strokeStyle = stroke.color;
          ctx.lineWidth = 1.4;
          ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
        }
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawNoteOverlay(rows) {
    if (!state.spec || state.specRev !== state.revision) return;
    if (!Array.isArray(state.spec.tracks)) return;
    const rowsCount = rows.length;
    const beatNow = state.playheadBeat;
    ctx.save();
    ctx.lineCap = "butt";
    for (const track of state.spec.tracks) {
      if (!track || !Array.isArray(track.notes) || !track.notes.length) continue;
      const color = track.color || "#201e1a";
      for (const note of track.notes) {
        if (note.row == null) continue;
        const x = plotX(note.beat);
        const y = rowY(note.row, rowsCount);
        const active = state.playing && beatNow >= note.beat - 0.001 &&
          beatNow < note.beat + note.dur - 0.001;
        const x2 = plotX(Math.min(totalBeats(), note.beat + note.dur));

        if (x2 - x > 3) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x2, y);
          ctx.strokeStyle = color;
          ctx.globalAlpha = active ? 0.45 : 0.18;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        const r = active ? 4.2 : 1.7 + note.velocity * 1.9;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = color;
        ctx.globalAlpha = active ? 1 : 0.82;
        ctx.fill();

        if (active) {
          ctx.beginPath();
          ctx.arc(x, y, r + 2.6, 0, TAU);
          ctx.strokeStyle = "#faf7ef";
          ctx.lineWidth = 1.3;
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawPlayhead() {
    if (!state.playing && state.playheadBeat <= 0.001) return;
    const x = plotX(clamp(state.playheadBeat, 0, totalBeats()));
    const { top, plotH } = layout;
    ctx.save();
    ctx.strokeStyle = "#c4462e";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + plotH);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - 4.5, top);
    ctx.lineTo(x + 4.5, top);
    ctx.lineTo(x, top + 7);
    ctx.closePath();
    ctx.fillStyle = "#c4462e";
    ctx.fill();
    ctx.restore();
  }

  function drawCursorGuide(rows) {
    if (!hoverPoint || drawing || dragging) return;
    const { px, py } = hoverPoint;
    if (!insidePlot(px, py)) return;
    const { left, top, plotW, plotH } = layout;

    ctx.save();
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = "rgba(32, 30, 26, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, py);
    ctx.lineTo(left + plotW, py);
    ctx.moveTo(px, top);
    ctx.lineTo(px, top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    const yNorm = clamp(1 - (py - top) / plotH, 0, 1);
    const row = clamp(Math.round(yNorm * (rows.length - 1)), 0, rows.length - 1);
    const beat = clamp((px - left) / plotW, 0, 1) * totalBeats();
    const bar = (beat / state.settings.beatsPerBar + 1).toFixed(2);
    const label = `${rows[row].name} · ${bar}`;
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const tw = ctx.measureText(label).width;
    let lx = px + 10;
    let ly = py - 22;
    if (lx + tw + 14 > left + plotW) lx = px - tw - 20;
    if (ly < top + 4) ly = py + 12;
    ctx.fillStyle = "#faf7ef";
    ctx.strokeStyle = "#201e1a";
    ctx.lineWidth = 1;
    ctx.fillRect(lx, ly, tw + 12, 18);
    ctx.strokeRect(lx + 0.5, ly + 0.5, tw + 11, 17);
    ctx.fillStyle = "#201e1a";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, lx + 6, ly + 9);
    ctx.restore();
  }

  function drawLiveStroke() {
    if (!drawing || !drawing.stroke.points.length) return;
    const s = drawing.stroke;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const path = new Path2D();
    tracePath(path, s.points);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.5;
    if (s.points.length === 1) {
      const p = s.points[0];
      ctx.fillStyle = s.color;
      ctx.fillRect(plotX(p.x) - 3, plotY(p.y) - 3, 6, 6);
    } else {
      ctx.stroke(path);
    }
    ctx.restore();
  }

  function draw() {
    if (!layout.w || !layout.h) return;
    const rows = computeRows();
    const { w, h } = layout;

    ctx.fillStyle = "#faf7ef";
    ctx.fillRect(0, 0, w, h);
    drawGrid(rows);
    drawStrokes();
    drawNoteOverlay(rows);
    drawPlayhead();
    drawCursorGuide(rows);
    drawLiveStroke();
  }
  function segmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
    const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function hitTest(px, py) {
    let best = null;
    let bestDist = 13;
    for (const s of state.strokes) {
      const pts = s.points;
      if (!pts || !pts.length) continue;
      if (pts.length === 1) {
        const d = Math.hypot(px - plotX(pts[0].x), py - plotY(pts[0].y));
        if (d < bestDist) { bestDist = d; best = s; }
        continue;
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const d = segmentDistance(
          px, py,
          plotX(pts[i].x), plotY(pts[i].y),
          plotX(pts[i + 1].x), plotY(pts[i + 1].y),
        );
        if (d < bestDist) { bestDist = d; best = s; }
      }
    }
    return best;
  }
  function createStroke(pt) {
    const id = `s${Date.now().toString(36)}${seq++}`;
    const color = PALETTE[(state.strokes.length + 1) % PALETTE.length];
    return {
      id,
      name: `Voice ${state.strokes.length + 1}`,
      color,
      instrument: state.settings.newInstrument || "auto",
      volume: 0.55,
      pan: 0,
      reverb: 0.12,
      delay: 0,
      mute: false,
      points: [{ x: pt.x, y: pt.y, p: pt.p }],
    };
  }

  function select(id) {
    state.selectedId = id;
    renderLayers();
    draw();
  }

  function deleteSelected() {
    const s = selectedStroke();
    if (!s) return;
    pushHistory();
    state.strokes = state.strokes.filter((x) => x.id !== s.id);
    state.selectedId = null;
    renderLayers();
    markDirty();
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const pt = pointFromEvent(e);
    if (!insidePlot(pt.px, pt.py)) return;
    e.preventDefault();
    if (state.playing) stopPlayback(true);

    const hit = !e.shiftKey ? hitTest(pt.px, pt.py) : null;
    if (hit) {
      state.selectedId = hit.id;
      renderLayers();
      dragging = {
        stroke: hit,
        startX: pt.x,
        startY: pt.y,
        origin: hit.points.map((p) => ({ x: p.x, y: p.y, p: p.p ?? 0.5 })),
        originSpans: Array.isArray(hit.spans)
          ? hit.spans.map(([a, b]) => [a, b])
          : null,
        moved: false,
      };
      canvas.classList.add("grabbing");
      try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
    } else {
      pushHistory();
      const stroke = createStroke(pt);
      state.strokes.push(stroke);
      state.selectedId = stroke.id;
      drawing = { stroke };
      renderLayers();
      draw();
      try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const pt = pointFromEvent(e);
    hoverPoint = { px: pt.px, py: pt.py };

    if (drawing) {
      const pts = drawing.stroke.points;
      const last = pts[pts.length - 1];
      const dxPx = (pt.x - last.x) / totalBeats() * layout.plotW;
      const dyPx = (pt.y - last.y) * layout.plotH;
      if (Math.hypot(dxPx, dyPx) >= 2.2) {
        pts.push({ x: pt.x, y: pt.y, p: pt.p });
        draw();
      }
      return;
    }

    if (dragging) {
      const dx = pt.x - dragging.startX;
      const dy = pt.y - dragging.startY;
      if (!dragging.moved && Math.hypot(
        dx / totalBeats() * layout.plotW,
        dy * layout.plotH,
      ) > 3) {
        pushHistory();
        dragging.moved = true;
      }
      if (dragging.moved) {
        const origin = dragging.origin;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of origin) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        const cdx = clamp(dx, -minX, totalBeats() - maxX);
        const cdy = clamp(dy, -minY, 1 - maxY);
        dragging.stroke.points = origin.map((p) => ({
          x: p.x + cdx, y: p.y + cdy, p: p.p,
        }));
        if (dragging.originSpans) {
          dragging.stroke.spans = dragging.originSpans.map(([a, b]) => [a + cdx, b + cdx]);
        }
        draw();
      }
      return;
    }

    const over = insidePlot(pt.px, pt.py) ? hitTest(pt.px, pt.py) : null;
    canvas.classList.toggle("over-stroke", !!over);
    draw();
  });

  function finishPointer(e) {
    if (drawing) {
      const s = drawing.stroke;
      if (!s.points.length) {
        state.strokes = state.strokes.filter((x) => x.id !== s.id);
      } else if (s.points.length === 1) {
        // A click becomes a one-step note.
        const p = s.points[0];
        const step = Math.max(0.125, Math.min(1, state.settings.snap));
        let start = clamp(p.x, 0, Math.max(0, totalBeats() - step));
        s.points = [
          { x: start, y: p.y, p: p.p },
          { x: start + step, y: p.y, p: p.p },
        ];
      }
      drawing = null;
      state.selectedId = s.id;
      renderLayers();
      markDirty();
    } else if (dragging) {
      const moved = dragging.moved;
      dragging = null;
      canvas.classList.remove("grabbing");
      if (moved) markDirty();
      else draw();
    }
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }

  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", (e) => {
    if (drawing) {
      drawing = null;
      renderLayers();
      markDirty();
    }
    if (dragging) {
      dragging = null;
      canvas.classList.remove("grabbing");
    }
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    draw();
  });
  canvas.addEventListener("pointerleave", () => {
    if (!drawing && !dragging) {
      hoverPoint = null;
      canvas.classList.remove("over-stroke");
      draw();
    }
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  function instLabel(value) {
    if (!value) return "auto";
    return INSTRUMENT_LABELS[value] || value;
  }

  function renderLayers() {
    const list = $("layerList");
    list.innerHTML = "";
    $("layerCount").textContent = String(state.strokes.length);

    if (!state.strokes.length) {
      const empty = document.createElement("div");
      empty.className = "empty-layers";
      empty.textContent = "Your drawn voices appear here.";
      list.appendChild(empty);
    } else {
      for (const s of state.strokes) {
        const row = document.createElement("div");
        row.className = "layer" + (s.id === state.selectedId ? " selected" : "") + (s.mute ? " muted" : "");
        row.dataset.id = s.id;
        row.title = "Click to select · drag on the canvas to move";

        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.color = s.color;
        row.appendChild(swatch);

        const main = document.createElement("div");
        main.className = "layer-main";
        const name = document.createElement("span");
        name.className = "layer-name";
        name.textContent = s.name || "Untitled";
        const inst = document.createElement("span");
        inst.className = "layer-inst";
        inst.textContent = instLabel(s.instrument);
        main.append(name, inst);
        row.appendChild(main);

        const mute = document.createElement("button");
        mute.className = "mute-btn";
        mute.title = s.mute ? "Unmute" : "Mute";
        mute.innerHTML = s.mute
          ? '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="m16 9 5 6m0-6-5 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
          : '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
        mute.addEventListener("click", (ev) => {
          ev.stopPropagation();
          s.mute = !s.mute;
          renderLayers();
          markDirty();
        });
        row.appendChild(mute);

        row.addEventListener("click", () => select(s.id));
        list.appendChild(row);
      }
    }

    updateSelectedPanel();
    updateEmptyHint();
  }

  function updateSelectedPanel() {
    const s = selectedStroke();
    const panel = $("selectionPanel");
    panel.hidden = !s;
    if (!s) return;

    if (document.activeElement !== $("selName")) $("selName").value = s.name || "";
    $("selInstrument").value = s.instrument || "auto";
    $("selVolume").value = s.volume;
    $("selPan").value = s.pan;
    $("selReverb").value = s.reverb;
    $("selMute").checked = !!s.mute;
    $("selVolVal").textContent = `${Math.round(s.volume * 100)}%`;
    $("selPanVal").textContent = panLabel(s.pan);
    $("selRevVal").textContent = `${Math.round(s.reverb * 100)}%`;
  }

  function panLabel(v) {
    if (Math.abs(v) < 0.02) return "C";
    return v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`;
  }
  $("selName").addEventListener("input", (e) => {
    const s = selectedStroke();
    if (!s) return;
    s.name = e.target.value;
    const row = document.querySelector(`.layer[data-id="${cssEscape(s.id)}"] .layer-name`);
    if (row) row.textContent = s.name || "Untitled";
    scheduleSave();
  });
  $("selName").addEventListener("change", () => {
    if (selectedStroke()) markDirty();
  });

  $("selInstrument").addEventListener("change", (e) => {
    const s = selectedStroke();
    if (!s) return;
    s.instrument = e.target.value;
    renderLayers();
    markDirty();
  });

  $("selVolume").addEventListener("input", (e) => {
    const s = selectedStroke();
    if (!s) return;
    s.volume = Number(e.target.value);
    $("selVolVal").textContent = `${Math.round(s.volume * 100)}%`;
    markDirty();
  });

  $("selPan").addEventListener("input", (e) => {
    const s = selectedStroke();
    if (!s) return;
    s.pan = Number(e.target.value);
    $("selPanVal").textContent = panLabel(s.pan);
    markDirty();
  });

  $("selReverb").addEventListener("input", (e) => {
    const s = selectedStroke();
    if (!s) return;
    s.reverb = Number(e.target.value);
    $("selRevVal").textContent = `${Math.round(s.reverb * 100)}%`;
    markDirty();
  });

  $("selMute").addEventListener("change", (e) => {
    const s = selectedStroke();
    if (!s) return;
    s.mute = e.target.checked;
    renderLayers();
    markDirty();
  });

  $("deleteStroke").addEventListener("click", deleteSelected);

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
  $("tempo").addEventListener("change", () => {
    readSettingsFromUI();
    markDirty();
  });
  $("key").addEventListener("change", () => { readSettingsFromUI(); markDirty(); });
  $("scale").addEventListener("change", () => { readSettingsFromUI(); markDirty(); });
  $("bars").addEventListener("change", () => { readSettingsFromUI(); markDirty(); });
  $("snap").addEventListener("change", () => { readSettingsFromUI(); markDirty(); });
  $("drums").addEventListener("change", () => { readSettingsFromUI(); markDirty(); });
  $("length").addEventListener("change", () => {
    const s = state.settings;
    const targetLen = clamp(Number($("length").value) || 10, 1, 600);
    const bars = clamp(Math.ceil(targetLen * s.tempo / 60 / (s.beatsPerBar || 4)), 1, 128);
    $("bars").value = String(bars);
    readSettingsFromUI();
    markDirty();
  });
  $("newInstrument").addEventListener("change", () => { readSettingsFromUI(); });

  $("masterReverb").addEventListener("input", () => { readSettingsFromUI(); markDirty(); });
  $("masterDelay").addEventListener("input", () => { readSettingsFromUI(); markDirty(); });
  $("masterVol").addEventListener("input", () => { readSettingsFromUI(); markDirty(); });
  $("humanize").addEventListener("change", () => { readSettingsFromUI(); markDirty(); });
  $("loop").addEventListener("change", () => {
    readSettingsFromUI();
    if (audioEl) audioEl.loop = !!state.settings.loop;
    scheduleSave();
  });
  for (const id of ["genVoices", "genDensity"]) {
    $(id).addEventListener("input", () => { readGeneratorFromUI(); scheduleSave(); });
  }
  for (const id of ["genMotion", "genRegister", "genBass", "genPlay", "genAuto"]) {
    $(id).addEventListener("change", () => { readGeneratorFromUI(); scheduleSave(); resetAutoRegen(); });
  }
  for (const id of ["genComplexity", "genAutoInterval"]) {
    $(id).addEventListener("input", () => { readGeneratorFromUI(); scheduleSave(); });
  }
  $("generate").addEventListener("click", generateSketch);
  $("play").addEventListener("click", togglePlay);
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);

  $("clear").addEventListener("click", () => {
    if (!state.strokes.length) return;
    pushHistory();
    state.strokes = [];
    state.selectedId = null;
    renderLayers();
    markDirty();
    showToast("Canvas cleared. Draw something new.");
  });
  const exportBtn = $("exportBtn");
  const exportMenu = $("exportMenu");

  function setMenu(open) {
    exportMenu.hidden = !open;
    exportBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setMenu(exportMenu.hidden);
  });
  document.addEventListener("click", () => setMenu(false));
  exportMenu.addEventListener("click", (e) => e.stopPropagation());

  exportMenu.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-export]");
    if (!btn) return;
    const action = btn.dataset.export;
    setMenu(false);
    if (action === "wav") await exportWav();
    else if (action === "music") await exportMusic();
    else if (action === "project") exportProject();
    else if (action === "load" || action === "import") $("fileInput").click();
    else if (action === "demo") loadDemo();
    else if (action === "plot") {
      $("mathFunc").focus();
      $("mathFunc").scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });

  async function exportWav() {
    if (!hasContent()) { showToast("Nothing to export yet — draw a line first.", true); return; }
    try {
      const rev = state.revision;
      const blob = await getAudioBlob(rev);
      downloadBlob(blob, "wavebeats.wav");
      showToast("WAV exported.");
    } catch (err) {
      showToast(err.message || "Could not export WAV.", true);
    }
  }

  async function exportMusic() {
    if (!hasContent()) { showToast("Nothing to export yet — draw a line first.", true); return; }
    try {
      const res = await fetch("/api/export/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Could not export the score.");
      }
      const text = await res.text();
      downloadBlob(new Blob([text], { type: "text/plain" }), "wavebeats.music");
      showToast("Score exported — open it with the music CLI.");
    } catch (err) {
      showToast(err.message || "Could not export the score.", true);
    }
  }

  function exportProject() {
    const data = {
      app: "WaveBeats",
      version: 1,
      savedAt: new Date().toISOString(),
      settings: state.settings,
      generator: state.generator,
      strokes: state.strokes,
    };
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      "wavebeats-project.json",
    );
    showToast("Project JSON exported.");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function sanitizeSettings(raw) {
    const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === "object" ? raw : {}) };
    s.tempo = clamp(Number(s.tempo) || 96, 40, 220);
    if (!(s.key in KEY_PC)) s.key = "C";
    if (!SCALES[s.scale]) s.scale = "minor";
    s.bars = clamp(Math.round(Number(s.bars) || 4), 1, 128);
    s.beatsPerBar = clamp(Math.round(Number(s.beatsPerBar) || 4), 1, 12);
    s.duration = s.bars * s.beatsPerBar * 60 / s.tempo;
    s.snap = [0.0625, 0.125, 0.25, 0.5, 1].includes(Number(s.snap)) ? Number(s.snap) : 0.5;
    if (!DRUMS.some(([value]) => value === s.drums)) s.drums = "none";
    s.masterReverb = clamp(Number(s.masterReverb ?? 0.18), 0, 1);
    s.masterDelay = clamp(Number(s.masterDelay ?? 0.12), 0, 1);
    s.masterVol = clamp(Number(s.masterVol ?? 0.9), 0.1, 1);
    s.humanize = s.humanize !== false;
    s.loop = !!s.loop;
    if (!INSTRUMENT_LABELS[s.newInstrument]) s.newInstrument = "auto";
    s.lowOctave = clamp(Math.round(Number(s.lowOctave ?? 2)), 0, 5);
    s.octaves = clamp(Math.round(Number(s.octaves ?? 3)), 1, 5);
    return s;
  }

  function sanitizeGenerator(raw) {
    const g = { ...GENERATOR_DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
    g.voices = clamp(Math.round(Number(g.voices) || 3), 1, 8);
    g.density = clamp(Number(g.density) || 0.55, 0.15, 1);
    if (!MOTION_INSTRUMENTS[g.motion]) g.motion = "melodic";
    if (!REGISTER_BANDS[g.register]) g.register = "mixed";
    if (!BASS_STYLES.includes(g.bass)) g.bass = "walk";
    g.complexity = clamp(Number(g.complexity ?? 0.5), 0, 1);
    g.auto = !!g.auto;
    g.autoInterval = clamp(Math.round(Number(g.autoInterval ?? 8)), 3, 30);
    g.play = !!g.play;
    return g;
  }

  function normalizeStroke(raw, index) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.points)) return null;
    const points = raw.points
      .map((p) => {
        if (Array.isArray(p)) return { x: Number(p[0]), y: Number(p[1]), p: Number(p[2] ?? 0.5) };
        if (p && typeof p === "object") return { x: Number(p.x), y: Number(p.y), p: Number(p.p ?? 0.5) };
        return null;
      })
      .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => ({ x: clamp(p.x, 0, 10_000), y: clamp(p.y, 0, 1), p: clamp(p.p, 0, 1) }))
      .sort((a, b) => a.x - b.x);
    if (!points.length) return null;
    const spans = Array.isArray(raw.spans)
      ? raw.spans
          .map((span) => (Array.isArray(span)
            ? [Number(span[0]), Number(span[1])]
            : null))
          .filter((span) => span && Number.isFinite(span[0]) && Number.isFinite(span[1]))
          .map(([a, b]) => [clamp(Math.min(a, b), 0, 10_000), clamp(Math.max(a, b), 0, 10_000)])
          .filter(([a, b]) => b - a > 1e-6)
          .sort((a, b) => a[0] - b[0])
      : undefined;
    return {
      id: String(raw.id || `s${Date.now().toString(36)}${index}`),
      name: String(raw.name || `Voice ${index + 1}`).slice(0, 40),
      color: String(raw.color || PALETTE[index % PALETTE.length]),
      instrument: String(raw.instrument || "auto"),
      volume: clamp(Number(raw.volume ?? 0.55), 0, 1),
      pan: clamp(Number(raw.pan ?? 0), -1, 1),
      reverb: clamp(Number(raw.reverb ?? 0.12), 0, 1),
      delay: clamp(Number(raw.delay ?? 0), 0, 1),
      mute: !!raw.mute,
      points,
      ...(spans && spans.length ? { spans } : {}),
    };
  }

  function applyProject(raw) {
    if (!raw || typeof raw !== "object") throw new Error("bad project");
    const settings = sanitizeSettings(raw.settings);
    const strokes = Array.isArray(raw.strokes)
      ? raw.strokes.map(normalizeStroke).filter(Boolean)
      : [];
    if (state.playing) stopPlayback(true);
    state.settings = settings;
    state.generator = sanitizeGenerator(raw.generator);
    state.strokes = strokes;
    state.selectedId = null;
    history = [];
    future = [];
    updateHistoryButtons();
    syncSettingsUI();
    syncGeneratorUI();
    renderLayers();
    markDirty();
    resizeCanvas();
    saveLocal();
  }
  function saveLocal() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        app: "WaveBeats", version: 1,
        settings: state.settings,
        generator: state.generator,
        strokes: state.strokes,
      }));
    } catch { /* storage can be full or blocked */ }
  }

  function loadLocal() {
    try {
      const text = localStorage.getItem(SAVE_KEY);
      if (!text) return null;
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  function sample(fn, count, xFrom, xTo, pressure = () => 0.5) {
    const pts = [];
    for (let i = 0; i <= count; i++) {
      const u = i / count;
      const x = xFrom + (xTo - xFrom) * u;
      pts.push({ x, y: clamp(fn(u), 0, 1), p: pressure(u) });
    }
    return pts;
  }

  function demoStrokes() {
    const total = 16;
    return [
      {
        id: "demo-bass", name: "Bass", color: PALETTE[0], instrument: "bass",
        volume: 0.62, pan: 0, reverb: 0.05, delay: 0, mute: false,
        points: sample(
          (u) => 0.035 + 0.09 * (0.5 + 0.5 * Math.sin(u * Math.PI * 4 - 1.15)),
          64, 0, total,
        ),
      },
      {
        id: "demo-pad", name: "Pad", color: PALETTE[1], instrument: "strings",
        volume: 0.28, pan: -0.18, reverb: 0.38, delay: 0.06, mute: false,
        points: sample(
          (u) => 0.42 + 0.075 * Math.sin(u * Math.PI * 3 + 0.4),
          56, 0, total,
        ),
      },
      {
        id: "demo-lead", name: "Lead", color: PALETTE[2], instrument: "saw",
        volume: 0.23, pan: 0.08, reverb: 0.24, delay: 0.09, mute: false,
        points: sample(
          (u) => 0.64 + 0.085 * Math.sin(u * Math.PI * 6 - 0.65) +
            0.022 * Math.sin(u * Math.PI * 26),
          150, 0, total,
        ),
      },
      {
        id: "demo-sparkle", name: "Sparkle", color: PALETTE[3], instrument: "bell",
        volume: 0.16, pan: 0.32, reverb: 0.34, delay: 0.16, mute: false,
        points: sample(
          (u) => 0.86 + 0.045 * Math.sin(u * Math.PI * 20),
          90, total * 0.25, total * 0.75,
        ),
      },
    ];
  }

  function loadDemo() {
    if (state.playing) stopPlayback(true);
    pushHistory();
    state.settings = { ...DEFAULT_SETTINGS };
    state.strokes = demoStrokes();
    state.selectedId = null;
    syncSettingsUI();
    renderLayers();
    markDirty();
    resizeCanvas();
    showToast("Demo loaded — press Space or Play.");
  }
  const choose = (list) => list[Math.floor(Math.random() * list.length)];
  const randomInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

  function rowBounds(register, rowCount) {
    const [lo, hi] = REGISTER_BANDS[register] || REGISTER_BANDS.full;
    const a = Math.round(lo * (rowCount - 1));
    const b = Math.round(hi * (rowCount - 1));
    return { lo: Math.min(a, b), hi: Math.max(a, b) };
  }

  function holdLength(density, grid) {
    const choices = density > 0.7 ? [1, 1, 1, 2]
      : density > 0.4 ? [1, 1, 2, 2, 3]
        : [2, 3, 4];
    return grid * choose(choices);
  }

  function buildPlan(motion, bounds, total, density, grid) {
    if (motion === "wave") return wavePlan(bounds, total, density, grid);

    const plan = [];
    let x = 0;
    let row = randomInt(bounds.lo, bounds.hi);
    let root = row;
    let degree = 0;
    const shape = choose([[0, 2, 4, 7, 12], [0, 3, 5, 8, 12], [0, 4, 7, 11, 14]]);
    const chord = [0, 4, 7, 10];
    let ostinatoPhase = 0;
    const ostPattern = [0, 0, 3, 0, 5, 0, 7, 0];

    while (x < total - 1e-6) {
      let hold = holdLength(density, grid);
      if (motion === "arpeggio") {
        row = clamp(root + shape[degree % shape.length], bounds.lo, bounds.hi);
        degree += 1;
        hold = grid * choose([1, 1, 2]);
        if (degree % shape.length === 0) {
          root = clamp(root + choose([-2, -1, 1, 2]), bounds.lo, bounds.hi);
        }
      } else if (motion === "steps") {
        row = clamp(row + choose([-7, -5, -3, -2, 2, 3, 5, 7]), bounds.lo, bounds.hi);
      } else if (motion === "scatter") {
        row = randomInt(bounds.lo, bounds.hi);
        hold = grid * choose([1, 1, 2]);
      } else if (motion === "random-walk") {
        row = clamp(row + choose([-3, -2, -1, -1, 0, 0, 1, 1, 2, 3]), bounds.lo, bounds.hi);
        if (Math.random() < 0.1) row = randomInt(bounds.lo, bounds.hi);
      } else if (motion === "chords") {
        row = clamp(root + chord[degree % chord.length], bounds.lo, bounds.hi);
        degree += 1;
        hold = grid;
        if (degree % chord.length === 0) {
          root = clamp(root + choose([-5, -4, -2, 2, 4, 5]), bounds.lo, bounds.hi);
        }
      } else if (motion === "ostinato") {
        row = clamp(root + ostPattern[ostinatoPhase % ostPattern.length], bounds.lo, bounds.hi);
        ostinatoPhase += 1;
        hold = grid;
        if (ostinatoPhase % ostPattern.length === 0) {
          root = clamp(root + choose([-3, -2, 2, 3, 5]), bounds.lo, bounds.hi);
        }
      } else if (motion === "drone") {
        hold = grid * choose([4, 4, 6, 8]);
        if (Math.random() < 0.15) {
          root = clamp(root + choose([-2, -1, 1, 2]), bounds.lo, bounds.hi);
        }
        row = root;
      } else {
        row = clamp(row + choose([-3, -2, -1, -1, 0, 1, 1, 2, 3]), bounds.lo, bounds.hi);
        if (Math.random() < 0.08) row = randomInt(bounds.lo, bounds.hi);
      }
      plan.push({ x, row, hold: Math.min(hold, total - x) });
      x += hold;
    }
    return plan;
  }

  function wavePlan(bounds, total, density, grid) {
    const span = bounds.hi - bounds.lo;
    const mid = (bounds.lo + bounds.hi) / 2;
    const amplitude = span * (0.18 + density * 0.3);
    const frequency = choose([1.5, 2, 2.5, 3]);
    const phase = Math.random() * TAU;
    const count = Math.max(4, Math.round(total / grid));
    const plan = [];
    for (let i = 0; i < count; i++) {
      const x = Math.min(total, i * grid);
      const drift = Math.sin((i / count) * TAU * frequency + phase) * amplitude;
      const wobble = (Math.random() - 0.5) * 2;
      plan.push({
        x,
        row: clamp(Math.round(mid + drift + wobble), bounds.lo, bounds.hi),
        hold: grid,
      });
    }
    return plan;
  }

  function bassPlan(style, bounds, total, grid) {
    const span = Math.max(2, bounds.hi - bounds.lo);
    const root = randomInt(bounds.lo, Math.min(bounds.hi, bounds.lo + Math.ceil(span * 0.45)));
    const plan = [];
    let x = 0;
    let index = 0;
    while (x < total - 1e-6) {
      let row = root;
      let hold = grid * 2;
      if (style === "walk") {
        row = clamp(root + choose([0, 2, 4, 5, 7, -2]), bounds.lo, bounds.hi);
        hold = grid * 2;
      } else if (style === "octave") {
        row = clamp(index % 2 ? root + 7 : root, bounds.lo, bounds.hi);
        hold = grid;
      } else if (style === "arp") {
        row = clamp(root + [0, 2, 4, 7][index % 4], bounds.lo, bounds.hi);
        hold = grid;
      } else if (style === "acid") {
        row = clamp(root + choose([0, 1, 2, 3, 5, 7, 10, 12]), bounds.lo, bounds.hi);
        hold = grid * choose([1, 1, 2]);
      } else if (style === "sub") {
        hold = grid * 4;
      }
      plan.push({ x, row, hold: Math.min(hold, total - x) });
      x += hold;
      index += 1;
    }
    return plan;
  }

  function planToPoints(plan, total, rows, smooth) {
    const lastRow = Math.max(1, rows.length - 1);
    const points = [];
    for (const note of plan) {
      const y = clamp(note.row / lastRow, 0, 1);
      const x = clamp(note.x, 0, total);
      if (smooth) {
        points.push({ x, y, p: 0.55 });
      } else {
        const end = clamp(x + note.hold * 0.8, 0, total);
        points.push({ x, y, p: 0.55 });
        if (end > x + 0.001) points.push({ x: end, y, p: 0.45 });
      }
    }
    const last = points[points.length - 1];
    if (last && last.x < total - 1e-6) points.push({ x: total, y: last.y, p: 0.5 });
    return points.filter((p, i, all) => i === 0 || p.x > all[i - 1].x + 0.001);
  }

  function generatedStroke({ name, color, instrument, points, register }) {
    const low = register === "low";
    const high = register === "high";
    return {
      id: `g${Date.now().toString(36)}${seq++}`,
      name,
      color,
      instrument,
      volume: low ? 0.52 : high ? 0.24 : 0.36,
      pan: low ? 0 : round((Math.random() - 0.5) * 0.5, 2),
      reverb: high ? 0.3 : register === "mid" ? 0.18 : 0.06,
      delay: high ? 0.12 : 0,
      mute: false,
      points,
    };
  }

  function generateSketch() {
    readGeneratorFromUI();
    const g = state.generator;
    const rows = computeRows();
    const total = totalBeats();
    const grid = Math.max(0.25, Number(state.settings.snap) || 0.5);
    const count = clamp(Math.round(g.voices), 1, 8);
    const baseRegisters = g.register === "mixed" || g.register === "full"
      ? ["low", "mid", "high"]
      : [g.register];
    const strokes = [];

    for (let i = 0; i < count; i++) {
      const register = baseRegisters[Math.floor(Math.random() * baseRegisters.length)];
      const voiceDensity = clamp(g.density * (0.65 + Math.random() * 0.7), 0.15, 1);
      const bounds = rowBounds(register, rows.length);
      const plan = buildPlan(g.motion, bounds, total, voiceDensity, grid);
      const points = planToPoints(plan, total, rows, SMOOTH_MOTIONS.has(g.motion));
      if (points.length < 2) continue;
      strokes.push(generatedStroke({
        name: `${MOTION_LABELS[g.motion] || "Line"} ${i + 1}`,
        color: PALETTE[(i * 3 + 1) % PALETTE.length],
        instrument: choose(MOTION_INSTRUMENTS[g.motion] || MOTION_INSTRUMENTS.melodic),
        points,
        register,
      }));
    }

    if (g.bass !== "off") {
      const low = rowBounds("low", rows.length);
      const bassBounds = { lo: low.lo, hi: Math.min(low.hi, low.lo + 5) };
      const plan = bassPlan(g.bass, bassBounds, total, grid);
      const points = planToPoints(plan, total, rows, false);
      if (points.length >= 2) {
        strokes.push(generatedStroke({
          name: "Bassline",
          color: PALETTE[1],
          instrument: choose(BASS_INSTRUMENTS),
          points,
          register: "low",
        }));
      }
    }

    if (!strokes.length) {
      showToast("Could not build a sketch. Raise the density.", true);
      return;
    }

    if (state.playing) stopPlayback(true);
    pushHistory();
    state.strokes = strokes;
    state.selectedId = null;
    renderLayers();
    markDirty();
    showToast(`${strokes.length} lines generated.`);
    if (g.play) togglePlay();
    resetAutoRegen();
  }

  function resetAutoRegen() {
    stopAutoRegen();
    if (state.generator.auto && state.playing) startAutoRegen();
  }

  function startAutoRegen() {
    const g = state.generator;
    if (!g.auto || !state.playing) return;
    stopAutoRegen();
    genAutoTimer = setInterval(() => {
      if (state.playing) generateSketch();
    }, g.autoInterval * 1000);
  }

  function stopAutoRegen() {
    if (genAutoTimer) {
      clearInterval(genAutoTimer);
      genAutoTimer = 0;
    }
  }
  window.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "select" || tag === "textarea";
    if (typing) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      exportProject();
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "g" || e.key === "G") {
      e.preventDefault();
      generateSketch();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedStroke()) {
        e.preventDefault();
        deleteSelected();
      }
    } else if (e.key === "Escape") {
      select(null);
    }
  });
  async function boot() {
    populateStaticSelects();
    syncSettingsUI();

    const local = loadLocal();
    if (local && Array.isArray(local.strokes)) {
      state.settings = sanitizeSettings(local.settings);
      state.generator = sanitizeGenerator(local.generator);
      state.strokes = local.strokes.map(normalizeStroke).filter(Boolean);
      syncSettingsUI();
    } else {
      state.settings = { ...DEFAULT_SETTINGS };
      state.generator = { ...GENERATOR_DEFAULTS };
      state.strokes = demoStrokes();
      syncSettingsUI();
    }
    syncGeneratorUI();

    renderLayers();
    updateHistoryButtons();
    updateEmptyHint();
    updateTransportBase();
    state.booted = true;

    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(canvas);
    resizeCanvas();

    scheduleAnalyze(60);
    setTimeout(() => { if (hasContent()) renderAudioNow(); }, 1100);

    fetchMeta();
  }
  $("plotBtn").addEventListener("click", () => {
    const expr = $("mathFunc").value.trim() || "sin(x)";
    const minX = Number($("mathMinX").value) || 0;
    const maxX = Number($("mathMaxX").value) || totalBeats();
    const bars = Number($("mathBars").value) || 4;
    const points = plotMathFunction(expr, minX, maxX);
    if (!points) {
      showToast("Could not plot that function — try a different expression.", true);
      return;
    }
    const total = totalBeats();
    const bpb = state.settings.beatsPerBar || 4;
    const normalized = points.map(p => ({
      x: clamp(p.x, 0, total),
      y: clamp(p.y, 0, 1),
    }));
    pushHistory();
    const stroke = {
      id: `p${Date.now().toString(36)}`,
      name: `Plot: ${expr}`,
      color: PALETTE[0],
      instrument: "sine",
      volume: 0.5,
      pan: 0,
      reverb: 0.12,
      delay: 0,
      mute: false,
      points: normalized,
    };
    state.strokes = [stroke, ...state.strokes];
    state.selectedId = stroke.id;
    renderLayers();
    markDirty();
    showToast(`Plotted ${normalized.length} points from ${expr}`);
  });
  const FILE_KINDS = {
    ".music": "song", ".mws": "song", ".mid": "song", ".midi": "song",
    ".mp3": "song", ".wav": "song", ".ogg": "song", ".flac": "song",
    ".m4a": "song", ".opus": "song", ".aac": "song",
    ".json": "project",
  };

  $("importBtn").addEventListener("click", () => {
    $("fileInput").click();
  });

  $("fileInput").addEventListener("change", async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    // Reset immediately so picking the same file again still fires.
    e.target.value = "";
    const match = file.name.match(/\.[^.]+$/);
    const kind = FILE_KINDS[(match ? match[0] : "").toLowerCase()];
    if (kind === "project") await loadProjectFile(file);
    else if (kind === "song") await importSongFile(file);
    else showToast(`Unsupported file type: ${file.name}`, true);
  });

  async function loadProjectFile(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== "object"
          || (!Array.isArray(data.strokes) && !data.settings)) {
        throw new Error("bad project");
      }
      applyProject(data);
      showToast(`Loaded ${file.name}.`);
    } catch {
      showToast("That file is not a valid WaveBeats project.", true);
    }
  }

  async function importSongFile(file) {
    showToast(`Importing ${file.name}…`);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok === false) {
        throw new Error(data?.error || "Could not import that file.");
      }
      applyImportedSong(data, file.name);
    } catch (err) {
      showToast(err.message || "Could not import that file.", true);
    }
  }

  function rowForMidi(midi, rows) {
    if (!rows || !rows.length) return 0.5;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const d = Math.abs(rows[i].midi - midi);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return rows.length < 2 ? 0.5 : best / (rows.length - 1);
  }

  function fitRegister(notes) {
    const midis = notes
      .map((n) => Number(n.midi))
      .filter((m) => Number.isFinite(m));
    if (!midis.length) return null;
    const minMidi = Math.min(...midis);
    const maxMidi = Math.max(...midis);
    const lowOctave = clamp(Math.floor((minMidi - 1) / 12) - 1, 0, 5);
    const low = (lowOctave + 1) * 12;
    const octaves = clamp(Math.ceil((maxMidi + 1 - low) / 12), 1, 5);
    return { lowOctave, octaves };
  }

  function applyImportedSong(data, filename) {
    const sourceTracks = (Array.isArray(data.tracks) ? data.tracks : [])
      .map((track) => ({
        ...track,
        notes: (Array.isArray(track.notes) ? track.notes : [])
          .map((n) => ({
            start: Number(n.start),
            dur: Number(n.dur),
            midi: Number(n.midi),
            velocity: clamp(Number(n.velocity ?? 0.7), 0.05, 1),
          }))
          .filter((n) => Number.isFinite(n.start) && Number.isFinite(n.dur)
            && Number.isFinite(n.midi) && n.dur > 1e-4)
          .sort((a, b) => a.start - b.start),
      }))
      .filter((track) => track.notes.length)
      .slice(0, 16);

    if (!sourceTracks.length) {
      showToast("No playable notes were found in that file.", true);
      return;
    }

    const allNotes = sourceTracks.flatMap((t) => t.notes);
    const bpb = clamp(Math.round(Number(data.beatsPerBar) || 4), 1, 12);
    const sourceBeats = Math.max(
      Number(data.totalBeats) || 0,
      ...allNotes.map((n) => n.start + n.dur),
    );
    const maxBars = 128;
    const timeScale = sourceBeats > maxBars * bpb
      ? (maxBars * bpb) / sourceBeats
      : 1;
    const bars = clamp(Math.ceil((sourceBeats * timeScale) / bpb), 1, maxBars);
    const sourceTempo = clamp(Number(data.tempo) || 96, 40, 220);
    const tempo = clamp(Math.round(sourceTempo * timeScale), 40, 220);
    const shortest = Math.min(...allNotes.map((n) => n.dur * timeScale));
    const importSnap = shortest < 0.25 ? 0.125 : shortest < 0.5 ? 0.25 : 0.5;
    const register = fitRegister(allNotes) || {};

    pushHistory();
    state.settings = sanitizeSettings({
      ...state.settings,
      tempo,
      bars,
      beatsPerBar: bpb,
      snap: importSnap,
      scale: "chromatic",
      ...register,
    });
    syncSettingsUI();

    const rows = computeRowsForImport();
    const total = totalBeats();
    const baseName = filename.replace(/\.[^.]+$/, "").slice(0, 22);
    const strokes = [];
    let noteCount = 0;

    sourceTracks.forEach((track, ti) => {
      const notes = track.notes
        .map((n) => ({
          start: clamp(n.start * timeScale, 0, total),
          dur: Math.max(0.02, n.dur * timeScale),
          midi: n.midi,
          velocity: n.velocity,
        }))
        .filter((n) => n.start < total - 1e-6);
      if (!notes.length) return;

      // Thin out very dense tracks.
      const stride = Math.max(1, Math.ceil(notes.length / 600));
      const points = [];
      const spans = [];
      for (let i = 0; i < notes.length; i += stride) {
        const n = notes[i];
        const start = n.start;
        // Keep a gap so adjacent notes do not share an x.
        const end = Math.min(total, n.start + n.dur - 1e-4);
        if (end - start <= 1e-6) continue;
        const y = rowForMidi(n.midi, rows);
        points.push({ x: start, y, p: n.velocity });
        points.push({ x: end, y, p: n.velocity });
        spans.push([start, end]);
        noteCount += 1;
      }
      if (!points.length) return;

      const instrument = INSTRUMENT_LABELS[track.instrument]
        ? track.instrument
        : "piano";
      strokes.push({
        id: `imp${Date.now().toString(36)}${ti}${Math.random().toString(36).slice(2, 6)}`,
        name: (baseName ? `${baseName} · ${track.name || instrument}` : (track.name || instrument)).slice(0, 40),
        color: PALETTE[(state.strokes.length + ti) % PALETTE.length],
        instrument,
        volume: clamp(Number(track.volume ?? 0.55), 0, 1),
        pan: clamp(Number(track.pan ?? 0), -1, 1),
        reverb: clamp(Number(track.reverb ?? 0.12), 0, 1),
        delay: clamp(Number(track.delay ?? 0), 0, 1),
        mute: false,
        points,
        spans,
      });
    });

    if (!strokes.length) {
      showToast("No playable notes were found in that file.", true);
      return;
    }

    state.strokes = strokes.concat(state.strokes);
    state.selectedId = strokes[0].id;
    future = [];
    updateHistoryButtons();
    renderLayers();
    resizeCanvas();
    markDirty();
    saveLocal();

    const warnings = (Array.isArray(data.warnings) ? data.warnings : []).filter(Boolean);
    let message = `Imported ${noteCount} notes in ${strokes.length} voice(s) from ${filename}`;
    if (warnings.length) message += ` — ${warnings[0]}`;
    showToast(message.slice(0, 240));
  }


  boot();
})();