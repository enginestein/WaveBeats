#!/usr/bin/env python3
"""Local Flask server. Run with: python3 server.py"""

from __future__ import annotations

import argparse
import hashlib
import json
import threading
import webbrowser
from collections import OrderedDict
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

import composer

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"

app = Flask(__name__, static_folder=str(STATIC), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024
app.config["JSON_SORT_KEYS"] = False

_CACHE_LIMIT = 16
_compose_cache: "OrderedDict[str, dict]" = OrderedDict()
_audio_cache: "OrderedDict[str, bytes]" = OrderedDict()
_cache_lock = threading.Lock()


def _key(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _remember(cache: OrderedDict, key: str, value):
    with _cache_lock:
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > _CACHE_LIMIT:
            cache.popitem(last=False)


def _lookup(cache: OrderedDict, key: str):
    with _cache_lock:
        if key in cache:
            cache.move_to_end(key)
            return cache[key]
    return None


def _payload() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _json_error(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


@app.after_request
def _no_store(resp: Response) -> Response:
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/api/health")
def health():
    return jsonify({
        "ok": True,
        "musicLibrary": str(composer.MUSIC_LIB),
        "libraryFound": composer.MUSIC_LIB.is_dir(),
        "instruments": len(composer._INSTS),
    })


@app.get("/api/meta")
def meta():
    return jsonify(composer.meta())


@app.post("/api/import")
def api_import():
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return _json_error("Choose a file to import.", 400)
    try:
        data = upload.read()
        spec = composer.import_song(upload.filename, data)
    except ValueError as exc:
        return _json_error(str(exc), 400)
    except Exception as exc:  # noqa: BLE001 - surface a readable error
        return _json_error(f"Import error: {exc}", 500)
    return jsonify(spec)


@app.post("/api/compose")
def api_compose():
    payload = _payload()
    key = _key(payload)
    cached = _lookup(_compose_cache, key)
    if cached is not None:
        return jsonify(cached)
    try:
        spec = composer.compose(payload)
    except Exception as exc:  # noqa: BLE001 - surface a readable error
        return _json_error(f"Composer error: {exc}", 500)
    _remember(_compose_cache, key, spec)
    return jsonify(spec)


def _audio(payload: dict) -> bytes:
    key = _key(payload)
    cached = _lookup(_audio_cache, key)
    if cached is not None:
        return cached
    data = composer.render_wav(payload)
    _remember(_audio_cache, key, data)
    return data


@app.post("/api/audio")
def api_audio():
    payload = _payload()
    try:
        data = _audio(payload)
    except ValueError as exc:
        return _json_error(str(exc), 400)
    except Exception as exc:  # noqa: BLE001
        return _json_error(f"Render error: {exc}", 500)
    return Response(data, mimetype="audio/wav",
                    headers={"Content-Length": str(len(data))})


@app.post("/api/export/music")
def export_music():
    payload = _payload()
    try:
        text = composer.music_text(payload)
    except ValueError as exc:
        return _json_error(str(exc), 400)
    except Exception as exc:  # noqa: BLE001
        return _json_error(f"Composer error: {exc}", 500)
    return Response(
        text,
        mimetype="text/plain; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="wavebeats.music"'},
    )


@app.post("/api/export/wav")
def export_wav():
    payload = _payload()
    try:
        data = _audio(payload)
    except ValueError as exc:
        return _json_error(str(exc), 400)
    except Exception as exc:  # noqa: BLE001
        return _json_error(f"Render error: {exc}", 500)
    return Response(
        data,
        mimetype="audio/wav",
        headers={
            "Content-Disposition": 'attachment; filename="wavebeats.wav"',
            "Content-Length": str(len(data)),
        },
    )


def main():
    parser = argparse.ArgumentParser(description="WaveBeats — draw music")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7860)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if not composer.MUSIC_LIB.is_dir():
        print(f"! music-dsl library not found at {composer.MUSIC_LIB}")
        print("  Expected it next to WaveBeats as ../music")
    else:
        print(f"· music engine: {composer.MUSIC_LIB}")

    url = f"http://{args.host}:{args.port}/"
    print(f"· WaveBeats running at {url}")
    if not args.no_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    app.run(host=args.host, port=args.port, threaded=True, debug=False)


if __name__ == "__main__":
    main()
