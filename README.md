# WaveBeats

I saw the following video: `https://youtube.com/shorts/bBGPBCWVl-M?si=1KIo1SMi5lNfNa4h`. Now, if you've seen it too, it seemed l ike a very concept to me. Imagine a graph or some sort of plain on which you can plot, draw lines and they can turn into music. Well, each sound has a wave already and so here's WaveBeats. Draw on a graph where x is time and y is pitch. Every line becomes a voice. It uses [Music-DSL](https://github.com/enginestein/Music-DSL.git) to produce sounds.

## Install

```bash
python3 -m pip install -r requirements.txt
```
Audio import (MP3, WAV, OGG, FLAC, M4A, Opus, AAC) also needs
[ffmpeg](https://ffmpeg.org/) on your `PATH`. MIDI, `.music`, and JSON imports
work without it.

## Run

```bash
python3 server.py
```

and it starts

## Basics

- Drag to draw. Hold **Shift** to draw over an existing line.
- Drag a line to move it. Click a layer to change its instrument or level.
- **Space** plays and stops.
- The toolbar controls tempo, key, scale, bars, snap, drums, and length.
- **Import** opens `.music`, MIDI, audio, or a saved `.json` project.
- **Export** saves WAV, `.music`, or project JSON.

Project saved in your browser automatically.
