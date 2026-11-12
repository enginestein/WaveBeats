"""Turn canvas strokes into music-dsl scores and audio."""

from __future__ import annotations

import io
import math
import shutil
import subprocess
import sys
import tempfile
import warnings
import wave
from collections import OrderedDict
from pathlib import Path
from typing import Any

import numpy as np

# Use the sibling checkout when it is available.
MUSIC_LIB = Path(__file__).resolve().parent.parent / "music"
if str(MUSIC_LIB) not in sys.path:
    sys.path.insert(0, str(MUSIC_LIB))

from music import Song  # noqa: E402
from music._constants import CHANNELS, SAMPLE_RATE  # noqa: E402
from music._instruments import _INSTS  # noqa: E402
from music._midi import midi_to_song  # noqa: E402
from music._pitch import midi_to_name, pitch_to_midi  # noqa: E402
from music.models import _bpf, _compress, _hpf, _lpf  # noqa: E402
from music.parser import load as load_song  # noqa: E402

MAX_AMP = 32767


# Block-wise feedback comb. Same output as the library's scipy filter, but
# much faster on long buffers.
def _comb(signal: np.ndarray, delay: int, feedback: float) -> np.ndarray:
    signal = np.asarray(signal, dtype=np.float64)
    if delay <= 0 or len(signal) == 0:
        return signal.copy()
    y = np.empty_like(signal)
    d = min(delay, len(signal))
    y[:d] = signal[:d]
    if signal.ndim == 1:
        for start in range(d, len(signal), d):
            end = min(len(signal), start + d)
            y[start:end] = signal[start:end] + feedback * y[start - d:end - d]
    else:
        for start in range(d, len(signal), d):
            end = min(len(signal), start + d)
            y[start:end, :] = signal[start:end, :] + feedback * y[start - d:end - d, :]
    return y


def fast_reverb(signal: np.ndarray, mix: float = 0.0, decay: float = 0.4) -> np.ndarray:
    if mix <= 0:
        return signal
    wet = _comb(signal, int(0.04 * SAMPLE_RATE), decay)
    return signal * (1 - mix) + wet * mix


def fast_delay(signal: np.ndarray, mix: float = 0.0,
               time: float = 0.3, feedback: float = 0.3) -> np.ndarray:
    if mix <= 0:
        return signal
    d = int(time * SAMPLE_RATE)
    if d <= 0 or d >= len(signal):
        return signal
    wet = _comb(signal, d, feedback)
    peak = np.max(np.abs(wet))
    if peak > 1:
        wet = wet / (peak * 1.1)
    return signal * (1 - mix) + wet * mix

KEYS: list[tuple[str, int]] = [
    ("C", 0), ("Db", 1), ("D", 2), ("Eb", 3), ("E", 4), ("F", 5),
    ("F#", 6), ("G", 7), ("Ab", 8), ("A", 9), ("Bb", 10), ("B", 11),
]

SCALES: "OrderedDict[str, tuple[str, list[int]]]" = OrderedDict([
    ("major",            ("Major",            [0, 2, 4, 5, 7, 9, 11])),
    ("minor",            ("Natural Minor",    [0, 2, 3, 5, 7, 8, 10])),
    ("harmonic_minor",   ("Harmonic Minor",   [0, 2, 3, 5, 7, 8, 11])),
    ("dorian",           ("Dorian",           [0, 2, 3, 5, 7, 9, 10])),
    ("mixolydian",       ("Mixolydian",       [0, 2, 4, 5, 7, 9, 10])),
    ("pentatonic_major", ("Pentatonic Major", [0, 2, 4, 7, 9])),
    ("pentatonic_minor", ("Pentatonic Minor", [0, 3, 5, 7, 10])),
    ("blues",            ("Blues",            [0, 3, 5, 6, 7, 10])),
    ("chromatic",        ("Chromatic",        list(range(12)))),
])

# Instruments shown in the editor.
INSTRUMENT_GROUPS: list[tuple[str, list[tuple[str, str]]]] = [
    ("Analog", [
        ("sine", "Sine"), ("square", "Square"), ("saw", "Saw"),
        ("tri", "Triangle"), ("noise", "Noise"),
    ]),
    ("Keys", [
        ("piano", "Piano"), ("organ", "Organ"), ("harpsichord", "Harpsichord"),
        ("clavinet", "Clavinet"), ("celesta", "Celesta"),
    ]),
    ("Plucked", [
        ("guitar", "Guitar"), ("nylon", "Nylon Guitar"), ("harp", "Harp"),
        ("banjo", "Banjo"), ("sitar", "Sitar"), ("kalimba", "Kalimba"),
    ]),
    ("Sustained", [
        ("strings", "Strings"), ("pad", "Pad"), ("bass", "Bass"),
        ("choir", "Choir"),
    ]),
    ("Wind", [
        ("flute", "Flute"), ("brass", "Brass"), ("reed", "Reed / Sax"),
        ("accordion", "Accordion"),
    ]),
    ("Bells & Mallets", [
        ("bell", "Bell"), ("pluck", "Pluck"), ("marimba", "Marimba"),
        ("xylophone", "Xylophone"), ("vibraphone", "Vibraphone"),
        ("steel_drums", "Steel Drums"),
    ]),
]

AUTO_INSTRUMENTS = (
    (0.20, "bass"),
    (0.42, "nylon"),
    (0.62, "piano"),
    (0.80, "saw"),
    (1.01, "bell"),
)

SIXTEENTHS = [i * 0.25 for i in range(16)]
EIGHTHS = [i * 0.5 for i in range(8)]
OFFBEATS = [i + 0.5 for i in range(4)]
SWING = [0.0, 0.66, 1.0, 1.66, 2.0, 2.66, 3.0, 3.66]

DRUM_LABELS = OrderedDict([
    ("none", "No beat"),
    ("four", "Four on the floor"),
    ("house", "House"),
    ("techno", "Techno"),
    ("rock", "Rock"),
    ("break", "Breakbeat"),
    ("boombap", "Boom bap"),
    ("funk", "Funk"),
    ("shuffle", "Shuffle"),
    ("dnb", "Drum & bass"),
    ("reggaeton", "Reggaeton"),
    ("afrobeat", "Afrobeat"),
    ("half", "Half-time"),
    ("trap", "Trap"),
])

DRUM_PATTERNS: dict[str, dict[str, list[float]]] = {
    "four": {
        "kick": [0.0, 1.0, 2.0, 3.0],
        "snare": [1.0, 3.0],
        "hihat": EIGHTHS,
    },
    "house": {
        "kick": [0.0, 1.0, 2.0, 3.0],
        "clap": [1.0, 3.0],
        "hihat": SIXTEENTHS,
        "hihat_open": OFFBEATS,
    },
    "techno": {
        "kick": [0.0, 1.0, 2.0, 3.0],
        "clap": [1.0, 3.0],
        "hihat": SIXTEENTHS,
        "hihat_open": OFFBEATS,
        "ride": [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75],
    },
    "rock": {
        "kick": [0.0, 2.5],
        "snare": [1.0, 3.0],
        "hihat": EIGHTHS,
    },
    "break": {
        "kick": [0.0, 0.75, 2.5],
        "snare": [1.0, 3.0],
        "hihat": EIGHTHS,
        "hihat_open": [1.5, 3.5],
    },
    "boombap": {
        "kick": [0.0, 0.75, 2.5],
        "snare": [1.0, 3.0],
        "hihat": EIGHTHS,
        "rimshot": [2.75],
    },
    "funk": {
        "kick": [0.0, 0.75, 1.75, 2.5],
        "snare": [1.0, 3.0],
        "hihat": SIXTEENTHS,
        "clap": [3.75],
    },
    "shuffle": {
        "kick": [0.0, 2.5],
        "snare": [1.0, 3.0],
        "hihat": SWING,
        "hihat_open": [1.33, 3.33],
    },
    "dnb": {
        "kick": [0.0, 1.75, 2.75],
        "snare": [1.0, 3.0],
        "hihat": SIXTEENTHS,
        "ride": [0.5, 1.5, 2.5, 3.5],
    },
    "reggaeton": {
        "kick": [0.0, 2.0],
        "snare": [1.0, 3.0],
        "hihat": SIXTEENTHS,
        "cowbell": [0.75, 1.75, 2.75, 3.75],
    },
    "afrobeat": {
        "kick": [0.0, 1.5, 2.5],
        "snare": [1.0, 3.0],
        "clap": [0.75, 2.75],
        "hihat": EIGHTHS,
        "cowbell": [1.25, 3.25],
    },
    "half": {
        "kick": [0.0, 2.0],
        "snare": [2.0],
        "hihat": EIGHTHS,
        "hihat_open": OFFBEATS,
    },
    "trap": {
        "kick": [0.0, 1.5, 2.5],
        "snare": [1.0, 3.0],
        "hihat": SIXTEENTHS,
        "hihat_open": OFFBEATS,
    },
}

# volume, pan, duration, velocity
DRUM_MIX: dict[str, tuple[float, float, float, float]] = {
    "kick": (0.58, 0.0, 0.5, 0.95),
    "snare": (0.34, 0.0, 0.5, 0.82),
    "clap": (0.28, 0.06, 0.4, 0.78),
    "rimshot": (0.18, -0.1, 0.2, 0.65),
    "tom": (0.30, 0.16, 0.4, 0.80),
    "hihat": (0.16, 0.22, 0.18, 0.46),
    "hihat_open": (0.14, 0.25, 0.45, 0.40),
    "ride": (0.13, -0.2, 0.5, 0.42),
    "cowbell": (0.12, 0.3, 0.3, 0.55),
    "tambourine": (0.10, 0.28, 0.2, 0.45),
    "maracas": (0.09, -0.25, 0.15, 0.40),
}
DRUM_ORDER = tuple(DRUM_MIX)


def _num(value: Any, lo: float, hi: float, default: float) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(n):
        return default
    return max(lo, min(hi, n))


def _int(value: Any, lo: int, hi: int, default: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def build_rows(key_name: str, scale_name: str,
               low_octave: int = 2, octaves: int = 3) -> list[dict]:
    """Scale rows from bottom to top."""
    pc = dict(KEYS).get(key_name, 0)
    scale = SCALES.get(scale_name, SCALES["minor"])[1]
    flat = ("b" in key_name) or (
        scale_name in ("minor", "harmonic_minor", "blues", "pentatonic_minor")
        and key_name not in ("F#", "C#", "G#", "D#", "A#")
    )
    low = (low_octave + 1) * 12 + pc
    high = low + octaves * 12
    rows = []
    for midi in range(low, high + 1):
        if (midi - pc) % 12 in scale:
            rows.append({
                "midi": midi,
                "name": midi_to_name(midi, flat=flat),
                "root": (midi - pc) % 12 == 0,
                "octave": midi // 12 - 1,
            })
    if not rows:  # chromatic safety net
        rows = [{"midi": m, "name": midi_to_name(m, flat=flat),
                 "root": (m - pc) % 12 == 0, "octave": m // 12 - 1}
                for m in range(low, high + 1)]
    return rows


def _auto_instrument(y: float) -> str:
    for ceiling, inst in AUTO_INSTRUMENTS:
        if y < ceiling:
            return inst
    return "piano"


def _sanitize_points(raw: Any, total_beats: float) -> list[dict]:
    pts = []
    if not isinstance(raw, list):
        return pts
    for item in raw[:4000]:
        if isinstance(item, dict):
            x, y, p = item.get("x"), item.get("y"), item.get("p", 0.5)
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            x, y = item[0], item[1]
            p = item[2] if len(item) > 2 else 0.5
        else:
            continue
        try:
            xf = float(x)
            yf = float(y)
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(xf) and math.isfinite(yf)):
            continue
        pts.append({
            "x": max(0.0, min(total_beats, xf)),
            "y": max(0.0, min(1.0, yf)),
            "p": _num(p, 0.0, 1.0, 0.5),
        })
    pts.sort(key=lambda q: q["x"])
    # Merge points with the same x.
    out: list[dict] = []
    for pt in pts:
        if out and abs(pt["x"] - out[-1]["x"]) < 1e-6:
            out[-1]["y"] = (out[-1]["y"] + pt["y"]) * 0.5
            out[-1]["p"] = (out[-1]["p"] + pt["p"]) * 0.5
        else:
            out.append(pt)
    return out


def _sanitize_spans(raw: Any, total_beats: float) -> list[tuple[float, float]]:
    """Clamp and sort [start, end] regions in beats."""
    spans: list[tuple[float, float]] = []
    if not isinstance(raw, list):
        return spans
    for item in raw[:8000]:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        try:
            start = float(item[0])
            end = float(item[1])
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(start) and math.isfinite(end)):
            continue
        start = max(0.0, min(total_beats, start))
        end = max(0.0, min(total_beats, end))
        if end - start > 1e-6:
            spans.append((start, end))
    spans.sort()
    return spans


def _interp_y(points: list[dict], x: float) -> float | None:
    """Linear interpolation of y at x, or None outside the stroke."""
    if not points:
        return None
    if x < points[0]["x"] - 1e-9 or x > points[-1]["x"] + 1e-9:
        return None
    lo, hi = 0, len(points) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if points[mid]["x"] < x:
            lo = mid + 1
        else:
            hi = mid
    right = points[lo]
    if abs(right["x"] - x) < 1e-9:
        return right["y"]
    left = points[lo - 1]
    span = right["x"] - left["x"]
    if span <= 1e-12:
        return (left["y"] + right["y"]) * 0.5
    t = (x - left["x"]) / span
    return left["y"] + (right["y"] - left["y"]) * t


def _pressure_at(points: list[dict], x: float) -> float:
    if not points:
        return 0.5
    nearest = min(points, key=lambda q: abs(q["x"] - x))
    return nearest.get("p", 0.5)


def _stroke_speed(points: list[dict], x: float, dt: float) -> float:
    a = _interp_y(points, max(points[0]["x"], x - dt))
    b = _interp_y(points, min(points[-1]["x"], x + dt))
    if a is None or b is None:
        return 0.0
    return abs(b - a) / max(dt * 2.0, 1e-6)


def stroke_to_events(stroke: dict, rows: list[dict], total_beats: float,
                     snap: float, default_inst: str = "auto") -> tuple[list[dict], str]:
    points = stroke.get("points") or []
    nrows = len(rows)
    if not points or nrows == 0:
        return [], default_inst

    spans = _sanitize_spans(stroke.get("spans"), total_beats)

    x0, x1 = points[0]["x"], points[-1]["x"]
    if spans:
        x0 = max(x0, spans[0][0])
        x1 = min(x1, spans[-1][1])
    if x1 - x0 < 1e-6:
        x1 = min(total_beats, x0 + snap)

    start = max(0.0, math.floor(x0 / snap + 1e-9) * snap)
    end = min(total_beats, math.ceil(x1 / snap - 1e-9) * snap)
    if end <= start:
        end = min(total_beats, start + snap)
    if end <= start:
        return [], default_inst
    first_slot = int(round(start / snap))
    last_slot = int(round(end / snap))
    slots = list(range(first_slot, last_slot))
    if spans:
        slots = [
            slot for slot in slots
            if any(
                slot * snap < span_end - 1e-9 and (slot + 1) * snap > span_start + 1e-9
                for span_start, span_end in spans
            )
        ]

    sampled: list[dict] = []
    pressures: list[float] = []
    speeds: list[float] = []
    for slot in slots:
        t0 = slot * snap
        t1 = t0 + snap
        vals = []
        for k in range(1, 6):
            t = t0 + snap * (k / 6.0)
            y = _interp_y(points, t)
            if y is not None:
                vals.append(y)
        if not vals:
            y = _interp_y(points, (t0 + t1) * 0.5)
            if y is None:
                continue
            vals.append(y)
        vals.sort()
        y = vals[len(vals) // 2]
        row = int(round(y * (nrows - 1)))
        row = max(0, min(nrows - 1, row))
        p = _pressure_at(points, (t0 + t1) * 0.5)
        s = _stroke_speed(points, (t0 + t1) * 0.5, snap * 0.5)
        pressures.append(p)
        speeds.append(s)
        sampled.append({"slot": slot, "row": row, "p": p, "speed": s})

    if not sampled:
        return [], default_inst

    p_range = max(pressures) - min(pressures) if pressures else 0.0
    speed_ceiling = max(0.02, np.percentile(speeds, 90)) if speeds else 1.0

    events: list[dict] = []
    cur = None
    for item in sampled:
        if cur is not None and item["row"] == cur["row"] and item["slot"] == cur["end_slot"]:
            cur["end_slot"] = item["slot"] + 1
            continue
        if cur is not None:
            events.append(cur)
        if p_range > 0.06:
            vel = 0.40 + 0.55 * item["p"]
        else:
            vel = 0.52 + 0.38 * min(1.0, item["speed"] / speed_ceiling)
        vel = max(0.22, min(1.0, vel))
        cur = {
            "start_slot": item["slot"],
            "end_slot": item["slot"] + 1,
            "row": item["row"],
            "velocity": vel,
        }
    if cur is not None:
        events.append(cur)

    notes = []
    for ev in events:
        dur = (ev["end_slot"] - ev["start_slot"]) * snap
        if dur <= 0:
            continue
        notes.append({
            "start": ev["start_slot"] * snap,
            "dur": dur,
            "row": ev["row"],
            "midi": rows[ev["row"]]["midi"],
            "pitch": rows[ev["row"]]["name"],
            "velocity": round(ev["velocity"], 3),
        })

    instrument = (stroke.get("instrument") or default_inst or "auto").strip()
    if instrument in ("", "auto", "Auto"):
        avg_y = sum(q["y"] for q in points) / len(points)
        instrument = _auto_instrument(avg_y)
    if instrument not in _INSTS:
        instrument = "piano"
    return notes, instrument


def _events_to_spec_notes(events: list[dict], total_beats: float) -> list[dict]:
    """Fill the gaps with rests so the mono track stays in sync."""
    events = sorted(events, key=lambda e: (e["start"], e["dur"]))
    out = []
    t = 0.0
    for ev in events:
        if ev["start"] > t + 1e-9:
            out.append({"rest": True, "start": t, "dur": ev["start"] - t})
            t = ev["start"]
        if ev["start"] < t - 1e-9:
            continue
        dur = ev["dur"]
        out.append({
            "rest": False,
            "start": ev["start"],
            "dur": dur,
            "pitch": ev["pitch"],
            "midi": ev["midi"],
            "row": ev.get("row"),
            "velocity": ev.get("velocity", 0.7),
            "staccato": ev.get("staccato", False),
            "legato": ev.get("legato", False),
        })
        t += dur
    if t < total_beats - 1e-9:
        out.append({"rest": True, "start": t, "dur": total_beats - t})
    return out


def _track_notes_to_dsl(notes: list[dict]) -> list[str]:
    """Serialise spec notes into .music DSL body lines."""
    tokens = []
    for n in notes:
        dur = f"_{n['dur']:.4f}"
        if n.get("rest"):
            tokens.append(f"R {dur}")
            continue
        art = " ." if n.get("staccato") else ""
        tokens.append(f"{n['pitch']}{art} {dur} @{n['velocity']:.3f}")
    lines = []
    chunk = []
    for tok in tokens:
        chunk.append(tok)
        if len(chunk) >= 6:
            lines.append("  ".join(chunk))
            chunk = []
    if chunk:
        lines.append("  ".join(chunk))
    return lines


def _safe_name(name: str, fallback: str) -> str:
    cleaned = " ".join(str(name or "").split())
    cleaned = cleaned.replace("--", "-").replace(":", " ")
    return cleaned[:40] or fallback


def _build_drums(style: str, total_beats: float, beats_per_bar: int) -> list[dict]:
    pattern = DRUM_PATTERNS.get(style)
    if not pattern:
        return []
    bars = max(1, int(math.ceil(total_beats / beats_per_bar - 1e-9)))
    tracks = []
    for inst in DRUM_ORDER:
        offsets = pattern.get(inst)
        if not offsets:
            continue
        volume, pan, length, velocity = DRUM_MIX[inst]
        events = []
        for bar in range(bars):
            for offset in offsets:
                beat = bar * beats_per_bar + offset
                if beat >= total_beats - 1e-9:
                    continue
                events.append({
                    "start": beat,
                    "dur": min(length, total_beats - beat),
                    "pitch": "C2",
                    "midi": 36,
                    "velocity": velocity,
                })
        if not events:
            continue
        tracks.append({
            "name": inst.replace("_", " ").title(),
            "instrument": inst,
            "volume": volume,
            "pan": pan,
            "reverb": 0.04,
            "delay": 0.0,
            "kind": "drums",
            "events": events,
            "notes": _events_to_spec_notes(events, total_beats),
        })
    return tracks


def compose(payload: dict | None) -> dict:
    payload = payload if isinstance(payload, dict) else {}
    settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
    raw_strokes = payload.get("strokes") if isinstance(payload.get("strokes"), list) else []

    tempo = _num(settings.get("tempo"), 35.0, 240.0, 96.0)
    beats_per_bar = _int(settings.get("beatsPerBar"), 1, 12, 4)
    bars = _int(settings.get("bars"), 1, 128, 4)
    key_name = str(settings.get("key", "C"))
    if key_name not in dict(KEYS):
        key_name = "C"
    scale_name = str(settings.get("scale", "minor"))
    if scale_name not in SCALES:
        scale_name = "minor"
    snap = _num(settings.get("snap"), 0.0625, 2.0, 0.5)
    if snap not in (0.0625, 0.125, 0.25, 0.5, 1.0, 2.0):
        snap = 0.5
    low_octave = _int(settings.get("lowOctave"), 0, 5, 2)
    octaves = _int(settings.get("octaves"), 1, 5, 3)
    drums_style = str(settings.get("drums", "none"))
    if drums_style not in DRUM_PATTERNS:
        drums_style = "none"
    humanize = bool(settings.get("humanize", True))
    master_reverb = _num(settings.get("masterReverb"), 0.0, 1.0, 0.16)
    master_delay = _num(settings.get("masterDelay"), 0.0, 1.0, 0.10)
    master_vol = _num(settings.get("masterVol"), 0.1, 1.0, 0.9)

    total_beats = float(bars * beats_per_bar)
    rows = build_rows(key_name, scale_name, low_octave, octaves)

    tracks: list[dict] = []
    warnings: list[str] = []
    used_names: dict[str, int] = {}

    for idx, raw in enumerate(raw_strokes[:32]):
        if not isinstance(raw, dict):
            continue
        sid = str(raw.get("id") or f"stroke-{idx + 1}")
        if raw.get("mute"):
            # Muted layers stay in the list.
            tracks.append({
                "id": sid, "name": _safe_name(raw.get("name"), f"Layer {idx + 1}"),
                "instrument": raw.get("instrument") or "auto", "color": raw.get("color", "#285f86"),
                "volume": _num(raw.get("volume"), 0.0, 1.0, 0.55),
                "pan": _num(raw.get("pan"), -1.0, 1.0, 0.0),
                "reverb": _num(raw.get("reverb"), 0.0, 1.0, 0.12),
                "delay": _num(raw.get("delay"), 0.0, 1.0, 0.0),
                "mute": True, "kind": "stroke", "notes": [],
            })
            continue
        points = _sanitize_points(raw.get("points"), total_beats)
        if len(points) < 1:
            warnings.append(f"Layer {idx + 1} has no drawable points.")
            continue
        events, instrument = stroke_to_events(
            {
                **raw,
                "points": points,
                "spans": _sanitize_spans(raw.get("spans"), total_beats),
            },
            rows,
            total_beats,
            snap,
        )

        # Short notes sound better as plucks.
        for ev in events:
            ev["staccato"] = bool(ev["dur"] <= snap + 1e-9 and snap <= 0.25
                                  and instrument not in ("pad", "strings", "bass"))
            ev["legato"] = False

        notes = _events_to_spec_notes(events, total_beats)
        if not any(not n.get("rest") for n in notes):
            warnings.append(f"{_safe_name(raw.get('name'), f'Layer {idx + 1}')} is silent at this snap.")
        volume = _num(raw.get("volume"), 0.0, 1.0, 0.55)
        if instrument in ("bass",):
            volume = min(volume, 0.62)
        elif instrument in ("pad", "strings", "choir"):
            volume = min(volume, 0.45)
        name = _safe_name(raw.get("name"), f"{instrument.title()} {idx + 1}")
        used_names[name] = used_names.get(name, 0) + 1
        if used_names[name] > 1:
            name = f"{name} {used_names[name]}"

        tracks.append({
            "id": sid,
            "name": name,
            "instrument": instrument,
            "color": raw.get("color", "#285f86"),
            "volume": round(volume, 3),
            "pan": round(_num(raw.get("pan"), -1.0, 1.0, 0.0), 3),
            "reverb": round(_num(raw.get("reverb"), 0.0, 1.0, 0.12), 3),
            "delay": round(_num(raw.get("delay"), 0.0, 1.0, 0.0), 3),
            "mute": False,
            "kind": "stroke",
            "events": events,
            "notes": notes,
        })

    drum_tracks = _build_drums(drums_style, total_beats, beats_per_bar)
    tracks.extend(drum_tracks)

    if not any(t["notes"] and any(not n.get("rest") for n in t["notes"]) for t in tracks):
        return {
            "ok": False,
            "error": "Nothing to play yet — draw a line on the canvas first.",
            "rows": rows,
            "tracks": tracks,
            "warnings": warnings,
            "tempo": tempo,
            "totalBeats": total_beats,
            "duration": total_beats * 60.0 / tempo,
            "beatsPerBar": beats_per_bar,
            "bars": bars,
            "snap": snap,
            "key": key_name,
            "scale": scale_name,
            "music": "",
        }
    dsl = [
        f"tempo: {tempo:g}",
        "name: WaveBeats sketch",
        "key: none",
        f"time: {beats_per_bar}/4",
        (f"master: vol {master_vol:.3f} comp 0.5 3.0 "
         f"reverb {master_reverb:.3f} delay {master_delay:.3f}"),
        "",
    ]
    for tr in tracks:
        if tr.get("mute") or not tr["notes"]:
            continue
        dsl.append(f"-- {tr['name']}: {tr['instrument']} {tr['volume']:.3f} {tr['pan']:.3f} --")
        if tr.get("reverb"):
            dsl.append(f"reverb:{tr['reverb']:.3f}")
        if tr.get("delay"):
            dsl.append(f"delay:{tr['delay']:.3f}")
        if humanize and tr.get("kind") != "drums":
            dsl.append("humanize:timing:0.012 vel:0.05")
        body = _track_notes_to_dsl(tr["notes"])
        dsl.extend(body)
        dsl.append("")
    if not any(not t.get("mute") and t.get("notes") for t in tracks):
        dsl.append("R _1.000")
    music_text = "\n".join(dsl).strip() + "\n"
    public_tracks = []
    for tr in tracks:
        if tr.get("kind") == "drums":
            continue
        pub_notes = []
        for n in tr["notes"]:
            if n.get("rest"):
                continue
            pub_notes.append({
                "beat": round(n["start"], 4),
                "dur": round(n["dur"], 4),
                "pitch": n["pitch"],
                "midi": n["midi"],
                "row": n.get("row"),
                "velocity": n.get("velocity", 0.7),
            })
        public_tracks.append({
            "id": tr["id"], "name": tr["name"], "instrument": tr["instrument"],
            "color": tr["color"], "volume": tr["volume"], "pan": tr["pan"],
            "reverb": tr["reverb"], "delay": tr["delay"], "mute": tr["mute"],
            "notes": pub_notes,
        })

    note_count = sum(len(t["notes"]) for t in public_tracks)
    return {
        "ok": True,
        "rows": rows,
        "tracks": public_tracks,
        "drumTracks": [{"name": t["name"], "instrument": t["instrument"]}
                       for t in drum_tracks],
        "warnings": warnings,
        "tempo": tempo,
        "totalBeats": total_beats,
        "duration": total_beats * 60.0 / tempo,
        "beatsPerBar": beats_per_bar,
        "bars": bars,
        "snap": snap,
        "key": key_name,
        "scale": scale_name,
        "noteCount": note_count,
        "music": music_text,
    }


def build_song(payload: dict | None) -> tuple[Song, dict]:
    spec = compose(payload)
    if not spec.get("ok"):
        raise ValueError(spec.get("error") or "Nothing to play.")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        song = load_song(spec["music"])
    for w in caught:
        msg = str(w.message)
        if msg and msg not in spec["warnings"]:
            spec["warnings"].append(msg)
    return song, spec


def render_song(song: Song, extra: float = 0.6) -> np.ndarray:
    """Mix with fast per-voice reverbs and delays."""
    total = song.total_beats()
    if total == 0:
        raise ValueError("empty song")
    ns = int(total * song.beat_secs * SAMPLE_RATE) + int(extra * SAMPLE_RATE)
    mix = np.zeros((ns, CHANNELS), dtype=np.float64)
    rendered = []

    for tr in song.tracks:
        if tr.mute:
            continue
        stem = song._render_track(tr, ns)
        if tr.filter_type in ("lp", "hp", "bp"):
            for ch in range(CHANNELS):
                if tr.filter_type == "lp":
                    stem[:, ch] = _lpf(stem[:, ch], tr.filter_freq)
                elif tr.filter_type == "hp":
                    stem[:, ch] = _hpf(stem[:, ch], tr.filter_freq)
                else:
                    stem[:, ch] = _bpf(stem[:, ch], tr.filter_freq, tr.filter_q)
        if tr.dist_amount > 0:
            gain = 1 + tr.dist_amount * 10
            stem = np.tanh(stem * gain) / np.tanh(gain) if gain > 0 else stem
        if tr.rev > 0:
            stem = fast_reverb(stem, tr.rev)
        if tr.delay > 0:
            stem = fast_delay(stem, tr.delay)
        rendered.append((tr, stem))

    # sidechain ducking
    duck_cache: dict[str, np.ndarray | None] = {}
    for tr, stem in rendered:
        if tr.sidechain_src and tr.sidechain_amt > 0:
            key = tr.sidechain_src
            if key not in duck_cache:
                src = next((t for t in song.tracks if t.name == key and not t.mute), None)
                duck_cache[key] = song._duck_envelope(src, ns) if src is not None else None
            env = duck_cache[key]
            if env is not None:
                amt = min(0.9, max(0.0, tr.sidechain_amt))
                stem = stem * (1.0 - (1.0 - env[:, None]) * (amt / 0.9))
        mix += stem

    if song.master_comp:
        mix = _compress(mix, *song.master_comp)
    peak = np.max(np.abs(mix))
    if peak > 1.0:
        mix = mix / peak * 0.95
    if song.master_vol != 1.0:
        mix = mix * song.master_vol
    if song.rev > 0:
        mix = fast_reverb(mix, song.rev)
    if song.delay > 0:
        mix = fast_delay(mix, song.delay)
    return mix


def render_wav(payload: dict | None, extra: float = 0.6) -> bytes:
    song, _ = build_song(payload)
    mix = render_song(song, extra=extra)
    pcm = np.clip(mix * MAX_AMP * 0.95, -32768, 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def music_text(payload: dict | None) -> str:
    spec = compose(payload)
    if not spec.get("ok"):
        raise ValueError(spec.get("error") or "Nothing to play.")
    return spec["music"]


_PALETTE_INSTRUMENTS = {
    value for _group, items in INSTRUMENT_GROUPS for value, _label in items
}
_INSTRUMENT_ALIASES = {
    "sawtooth": "saw",
    "sax": "reed",
    "triangle": "tri",
    "organ_": "organ",
}
_DRUM_INSTRUMENTS = {
    "kick", "snare", "clap", "rimshot", "tom", "hihat", "hihat_open",
    "ride", "cowbell", "tambourine", "maracas", "cymbal",
}
MAX_IMPORT_TRACKS = 16
MAX_IMPORT_NOTES = 3000


def _import_instrument(name: str) -> str:
    inst = _INSTRUMENT_ALIASES.get(str(name or "").lower(), str(name or "").lower())
    return inst if inst in _PALETTE_INSTRUMENTS else "piano"


def _note_events_from_track(track) -> list[dict]:
    """Convert a Track into absolute start/dur events."""
    events: list[dict] = []
    t = 0.0
    prev_group = 0
    pending = 0.0
    for note in track.notes:
        pitch = str(note.pitch)
        if pitch.startswith("$"):
            continue
        if note.rest:
            if prev_group != 0:
                t += pending
                pending = 0.0
            if note.group == 0 or note.group != prev_group:
                t += note.duration
            prev_group = note.group
            continue
        midi = pitch_to_midi(pitch)
        if note.group != 0 and note.group == prev_group:
            if midi is not None:
                events.append({
                    "start": t, "dur": note.duration, "midi": midi,
                    "velocity": note.velocity,
                })
            continue
        if prev_group != 0:
            t += pending
            pending = 0.0
        if midi is not None:
            events.append({
                "start": t, "dur": note.duration, "midi": midi,
                "velocity": note.velocity,
            })
        if note.group == 0:
            t += note.duration
        else:
            pending = note.duration
        prev_group = note.group
    return events


def _split_into_voices(events: list[dict]) -> list[list[dict]]:
    """Split overlapping events into monophonic voices."""
    voices: list[list[dict]] = []
    for ev in sorted(events, key=lambda e: (e["start"], e["dur"])):
        for voice in voices:
            last = voice[-1]
            if last["start"] + last["dur"] <= ev["start"] + 1e-9:
                voice.append(ev)
                break
        else:
            voices.append([ev])
    return voices


def _song_to_import(song: Song, kind: str, warnings: list[str]) -> dict:
    tracks: list[dict] = []
    skipped_drums = 0
    for tr in song.tracks:
        if not tr.notes:
            continue
        if str(tr.inst) in _DRUM_INSTRUMENTS:
            skipped_drums += 1
            continue
        events = _note_events_from_track(tr)
        if not events:
            continue
        instrument = _import_instrument(tr.inst)
        voices = _split_into_voices(events)
        for vi, voice in enumerate(voices):
            if len(tracks) >= MAX_IMPORT_TRACKS:
                break
            notes = []
            for ev in voice[:MAX_IMPORT_NOTES]:
                if ev["dur"] <= 1e-4:
                    continue
                notes.append({
                    "start": round(max(0.0, ev["start"]), 4),
                    "dur": round(ev["dur"], 4),
                    "midi": int(ev["midi"]),
                    "velocity": round(max(0.05, min(1.0, ev["velocity"])), 3),
                })
            if not notes:
                continue
            name = str(tr.name or instrument)
            if vi:
                name = f"{name} {vi + 1}"
            tracks.append({
                "name": name[:40],
                "instrument": instrument,
                "volume": round(max(0.05, min(1.0, tr.vol)), 3),
                "pan": round(max(-1.0, min(1.0, tr.pan)), 3),
                "reverb": round(max(0.0, min(1.0, tr.rev)), 3),
                "delay": round(max(0.0, min(1.0, tr.delay)), 3),
                "notes": notes,
            })
        if len(tracks) >= MAX_IMPORT_TRACKS:
            break
    if skipped_drums:
        warnings.append(f"Skipped {skipped_drums} percussion track(s) — use the Beat menu instead.")
    if not tracks:
        raise ValueError("No playable notes were found in that file.")
    total_beats = max(
        (n["start"] + n["dur"] for t in tracks for n in t["notes"]),
        default=float(song.total_beats() or 0.0),
    )
    return {
        "ok": True,
        "kind": kind,
        "tempo": round(float(song.tempo or 120.0), 3),
        "beatsPerBar": int(song.beats_per_bar or 4),
        "totalBeats": round(total_beats, 4),
        "tracks": tracks,
        "warnings": warnings,
    }


def _decode_audio(data: bytes, filename: str) -> np.ndarray:
    if not shutil.which("ffmpeg"):
        raise ValueError(
            "Audio import needs ffmpeg on your PATH. Install ffmpeg and try again."
        )
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "8000",
        "-f", "s16le", "pipe:1",
    ]
    try:
        proc = subprocess.run(
            cmd, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=120, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError(f"Could not decode {filename}: {exc}") from exc
    if proc.returncode != 0 or not proc.stdout:
        detail = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        raise ValueError(
            f"Could not decode {filename}."
            + (f" {detail[-1]}" if detail else "")
        )
    return np.frombuffer(proc.stdout, dtype="<i2").astype(np.float64) / 32768.0


def _audio_to_track(samples: np.ndarray, sr: int = 8000) -> dict:
    """Pick out the strongest monophonic melody in an audio buffer."""
    if len(samples) < sr // 4:
        raise ValueError("That audio file is too short to import.")
    samples = samples - float(np.mean(samples))
    peak = float(np.max(np.abs(samples)))
    if peak <= 1e-6:
        raise ValueError("That audio file is silent.")

    frame = 1024
    hop = 320
    min_lag = max(2, int(sr / 1000.0))
    max_lag = min(frame - 2, int(sr / 55.0))
    if len(samples) < frame:
        samples = np.pad(samples, (0, frame - len(samples)))

    frames: list[tuple[float, int | None, float]] = []
    window = np.hanning(frame)
    for offset in range(0, len(samples) - frame, hop):
        seg = samples[offset:offset + frame]
        rms = float(np.sqrt(np.mean(seg * seg)))
        t = offset / sr
        if rms < 0.006:
            frames.append((t, None, 0.0))
            continue
        seg = (seg - np.mean(seg)) * window
        corr = np.correlate(seg, seg, mode="full")[frame - 1:]
        if corr[0] <= 1e-9:
            frames.append((t, None, 0.0))
            continue
        corr = corr / corr[0]
        lags = corr[min_lag:max_lag]
        if len(lags) < 3:
            frames.append((t, None, 0.0))
            continue
        best = int(np.argmax(lags)) + min_lag
        clarity = float(corr[best])
        # prefer the first strong peak so harmonics don't win
        for lag in range(min_lag + 1, best):
            if corr[lag] >= clarity * 0.92 and corr[lag] > 0.3:
                if corr[lag] >= corr[lag - 1] and corr[lag] >= corr[lag + 1]:
                    best = lag
                    clarity = float(corr[lag])
                    break
        if clarity < 0.32:
            frames.append((t, None, 0.0))
            continue
        freq = sr / best
        if freq < 55 or freq > 1000:
            frames.append((t, None, 0.0))
            continue
        midi = int(round(69 + 12 * math.log2(freq / 440.0)))
        midi = max(21, min(108, midi))
        frames.append((t, midi, min(1.0, max(0.2, rms / 0.12))))

    raw_notes: list[dict] = []
    current = None
    for t, midi, vel in frames:
        if midi is None:
            if current is not None and t - (current["start"] + current["dur"]) > 0.14:
                raw_notes.append(current)
                current = None
            continue
        if current is not None and midi == current["midi"] and t - (current["start"] + current["dur"]) <= 0.14:
            current["dur"] = t + hop / sr - current["start"]
            current["velocity"] = max(current["velocity"], vel)
            continue
        if current is not None:
            raw_notes.append(current)
        current = {"start": t, "dur": hop / sr, "midi": midi, "velocity": vel}
    if current is not None:
        raw_notes.append(current)

    tempo = 120.0
    beat_scale = tempo / 60.0
    notes = []
    for n in raw_notes:
        if n["dur"] < 0.05:
            continue
        notes.append({
            "start": round(n["start"] * beat_scale, 4),
            "dur": round(n["dur"] * beat_scale, 4),
            "midi": n["midi"],
            "velocity": round(n["velocity"], 3),
        })
        if len(notes) >= MAX_IMPORT_NOTES:
            break
    if not notes:
        raise ValueError(
            "Could not find a clear melody in that audio file. "
            "Try a track with vocals or a solo instrument."
        )
    duration = len(samples) / sr
    return {
        "name": "Audio melody",
        "instrument": "piano",
        "volume": 0.55,
        "pan": 0.0,
        "reverb": 0.12,
        "delay": 0.0,
        "notes": notes,
        "duration": duration,
        "tempo": tempo,
    }


def import_song(filename: str, data: bytes) -> dict:
    """Parse a .music, MIDI, or audio file into note events."""
    if not data:
        raise ValueError("That file is empty.")
    suffix = Path(filename or "").suffix.lower()
    notes_warnings: list[str] = []

    if suffix in (".music", ".mws", ".txt"):
        text = data.decode("utf-8", "replace")
        try:
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                song = load_song(text)
            for item in caught:
                message = str(item.message)
                if message:
                    notes_warnings.append(message)
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"Could not parse .music file: {exc}") from exc
        return _song_to_import(song, "music", notes_warnings)

    if suffix in (".mid", ".midi"):
        tmp_name = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mid") as tmp:
                tmp.write(data)
                tmp_name = tmp.name
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                song = midi_to_song(tmp_name)
            for item in caught:
                message = str(item.message)
                if message:
                    notes_warnings.append(message)
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"Could not parse MIDI file: {exc}") from exc
        finally:
            if tmp_name and Path(tmp_name).exists():
                Path(tmp_name).unlink()
        return _song_to_import(song, "midi", notes_warnings)

    if suffix in (".mp3", ".wav", ".ogg", ".flac", ".m4a", ".opus", ".aac"):
        samples = _decode_audio(data, filename)
        track = _audio_to_track(samples)
        total_beats = max(
            (n["start"] + n["dur"] for n in track["notes"]),
            default=track["duration"] * track["tempo"] / 60.0,
        )
        return {
            "ok": True,
            "kind": "audio",
            "tempo": track["tempo"],
            "beatsPerBar": 4,
            "totalBeats": round(total_beats, 4),
            "tracks": [{
                "name": track["name"],
                "instrument": track["instrument"],
                "volume": track["volume"],
                "pan": track["pan"],
                "reverb": track["reverb"],
                "delay": track["delay"],
                "notes": track["notes"],
            }],
            "warnings": notes_warnings,
        }

    raise ValueError(f"Unsupported file type: {Path(filename).suffix or filename}")


def meta() -> dict:
    return {
        "keys": [{"value": k, "label": k} for k, _ in KEYS],
        "scales": [{"value": v, "label": label} for v, (label, _) in SCALES.items()],
        "instruments": [{"value": v, "label": label, "group": group}
                        for group, items in INSTRUMENT_GROUPS for v, label in items],
        "drums": [
            {"value": value, "label": label}
            for value, label in DRUM_LABELS.items()
        ],
        "defaults": {
            "tempo": 96, "key": "C", "scale": "minor", "bars": 4,
            "beatsPerBar": 4, "snap": 0.5, "drums": "four", "humanize": True,
            "masterReverb": 0.18, "masterDelay": 0.12, "masterVol": 0.9,
            "lowOctave": 2, "octaves": 3,
        },
    }
