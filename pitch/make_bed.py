#!/usr/bin/env python3
"""Soft harmonic bed under the voiceover. No external audio assets."""

import json
import math
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CUES = json.loads((ROOT / "build" / "cues.json").read_text())
DURATION = float(CUES["duration"]) + 0.4
SR = 48000
N = int(DURATION * SR)

# Dm, Bb, F, C — slow, low, and out of the way of the voice.
CHORDS = [
    (0, (146.83, 174.61, 220.00, 293.66)),
    (12, (116.54, 174.61, 233.08, 349.23)),
    (24, (174.61, 220.00, 261.63, 349.23)),
    (36, (130.81, 164.81, 196.00, 261.63)),
]
CYCLE = 48


def chord_at(t):
    local = t % CYCLE
    current = CHORDS[0][1]
    for start, notes in CHORDS:
        if local >= start:
            current = notes
    return current


samples = bytearray()
low = 0.0
for i in range(N):
    t = i / SR
    fade = min(1.0, t / 1.4, max(0.0, (DURATION - t) / 2.2))
    breathe = 0.82 + 0.18 * math.sin(2 * math.pi * t / 9.0)
    acc = 0.0
    for index, freq in enumerate(chord_at(t)):
        acc += math.sin(2 * math.pi * freq * t) * (0.22 if index == 0 else 0.12)
        acc += math.sin(2 * math.pi * freq * 2 * t) * 0.03
    low = low * 0.985 + acc * 0.015
    sample = low * fade * breathe * 0.9
    value = max(-1.0, min(1.0, sample))
    packed = struct.pack("<h", int(value * 2800))
    samples.extend(packed)
    samples.extend(packed)

out = ROOT / "build" / "bed.wav"
with wave.open(str(out), "w") as handle:
    handle.setnchannels(2)
    handle.setsampwidth(2)
    handle.setframerate(SR)
    handle.writeframes(samples)
print(f"bed {DURATION:.2f}s -> {out}")
