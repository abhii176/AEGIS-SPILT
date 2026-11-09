#!/usr/bin/env python3
"""Synthesize the pitch voiceover and write a frame-accurate timeline."""

import asyncio
import json
import subprocess
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[1]
AUDIO = ROOT / "public" / "audio"
TIMELINE = ROOT / "src" / "timeline.json"
VOICE = "en-US-AndrewNeural"
RATE = "+0%"
# Extra picture hold after a line, so the visual can land before the next sentence.
HOLDS = {
    "hook-broken": 0.32,
    "hook-built": 0.42,
    "concept-how": 0.28,
    "flow-overview": 0.2,
    "flow-payout": 0.36,
    "safety-dispute": 0.3,
    "close-thanks": 0.55,
}

# Spoken text can differ slightly from the on-screen caption so names land clearly.
CUES = [
    {
        "id": "hook-economy",
        "scene": "hook",
        "visual": "economy",
        "caption": "Every year, billions of dollars change hands in the freelance economy.",
        "text": "Every year, billions of dollars change hands in the freelance economy.",
    },
    {
        "id": "hook-broken",
        "scene": "hook",
        "visual": "broken",
        "caption": "But the system is broken.",
        "text": "But the system is broken.",
    },
    {
        "id": "hook-sides",
        "scene": "hook",
        "visual": "sides",
        "caption": "Freelancers live in fear of client ghosting and unpaid hours, while clients risk paying upfront for code that never arrives or breaks entirely.",
        "text": "Freelancers live in fear of client ghosting and unpaid hours, while clients risk paying upfront for code that never arrives or breaks entirely.",
    },
    {
        "id": "hook-platforms",
        "scene": "hook",
        "visual": "platforms",
        "caption": "Existing platforms rely on slow, manual human approvals and clunky escrow banks.",
        "text": "Existing platforms rely on slow, manual human approvals and clunky escrow banks.",
    },
    {
        "id": "hook-built",
        "scene": "hook",
        "visual": "built",
        "caption": "That's why we built Aegis-Split.",
        "text": "That's why we built Aegis-Split.",
    },
    {
        "id": "concept-platform",
        "scene": "concept",
        "visual": "platform",
        "caption": "Aegis-Split is a revolutionary, AI-verified micro-escrow platform built specifically for developers, designers, and fast-moving tech clients.",
        "text": "Aegis-Split is a revolutionary, A.I.-verified micro-escrow platform built specifically for developers, designers, and fast-moving tech clients.",
    },
    {
        "id": "concept-trust",
        "scene": "concept",
        "visual": "trust",
        "caption": "We eliminate human bias and middleman delays by automating trust.",
        "text": "We eliminate human bias and middleman delays by automating trust.",
    },
    {
        "id": "concept-how",
        "scene": "concept",
        "visual": "how",
        "caption": "How? By combining secure financial rails with autonomous AI verification.",
        "text": "How? By combining secure financial rails with autonomous A.I. verification.",
    },
    {
        "id": "flow-overview",
        "scene": "workflow",
        "visual": "overview",
        "caption": "Here is how it works, end to end.",
        "text": "Here is how it works, end to end.",
    },
    {
        "id": "flow-vault",
        "scene": "workflow",
        "visual": "vault",
        "caption": "Secure vaulting. The client funds the milestone via the PayPal REST API, locking the money safely in escrow.",
        "text": "Secure vaulting. The client funds the milestone via the PayPal REST A.P.I., locking the money safely in escrow.",
    },
    {
        "id": "flow-audit",
        "scene": "workflow",
        "visual": "audit",
        "caption": "Automated AI auditing. Instead of waiting for a manual client click, when the freelancer merges their code into GitHub, our backend fetches the raw git diff.",
        "text": "Automated A.I. auditing. Instead of waiting for a manual client click, when the freelancer merges their code into GitHub, our backend fetches the raw git diff.",
    },
    {
        "id": "flow-model",
        "scene": "workflow",
        "visual": "model",
        "caption": "GPT-4o instantly audits the code against the milestone's acceptance criteria.",
        "text": "G.P.T. 4o instantly audits the code against the milestone's acceptance criteria.",
    },
    {
        "id": "flow-payout",
        "scene": "workflow",
        "visual": "payout",
        "caption": "Instant payout. If the code passes verification, the PayPal Payouts API instantly releases the funds directly to the freelancer's account.",
        "text": "Instant payout. If the code passes verification, the PayPal Payouts A.P.I. instantly releases the funds directly to the freelancer's account.",
    },
    {
        "id": "safety-more",
        "scene": "safety",
        "visual": "more",
        "caption": "We didn't stop at automation.",
        "text": "We didn't stop at automation.",
    },
    {
        "id": "safety-gates",
        "scene": "safety",
        "visual": "gates",
        "caption": "Aegis-Split enforces strict KYC verification, mandatory in-platform communication to prevent off-platform scams, and clear penalty-protected early-exit contracts.",
        "text": "Aegis-Split enforces strict K.Y.C. verification, mandatory in-platform communication to prevent off-platform scams, and clear penalty-protected early-exit contracts.",
    },
    {
        "id": "safety-dispute",
        "scene": "safety",
        "visual": "dispute",
        "caption": "If a dispute arises, our integrated Agora voice recordings and chat logs provide a transparent audit trail for our human review counselors to settle conflicts fairly.",
        "text": "If a dispute arises, our integrated Agora voice recordings and chat logs provide a transparent audit trail for our human review counselors to settle conflicts fairly.",
    },
    {
        "id": "close-transform",
        "scene": "close",
        "visual": "transform",
        "caption": "Aegis-Split transforms freelance collaboration from a game of trust into a mathematically secure, AI-verified partnership.",
        "text": "Aegis-Split transforms freelance collaboration from a game of trust into a mathematically secure, A.I.-verified partnership.",
    },
    {
        "id": "close-cta",
        "scene": "close",
        "visual": "cta",
        "caption": "Check out our open-source repository and live demo link below.",
        "text": "Check out our open-source repository and live demo link below.",
    },
    {
        "id": "close-thanks",
        "scene": "close",
        "visual": "thanks",
        "caption": "Thank you.",
        "text": "Thank you.",
    },
]


def duration_seconds(path: Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ],
        text=True,
    )
    return float(out.strip())


async def synth(cue: dict) -> None:
    dest = AUDIO / f"{cue['id']}.mp3"
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            communicate = edge_tts.Communicate(cue["text"], VOICE, rate=RATE)
            await communicate.save(str(dest))
            print(f"{cue['id']} {duration_seconds(dest):.2f}s", flush=True)
            return
        except Exception as exc:  # noqa: BLE001 — retry transient TTS disconnects
            last_error = exc
            await asyncio.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"TTS failed for {cue['id']}") from last_error


async def main() -> None:
    AUDIO.mkdir(parents=True, exist_ok=True)
    for cue in CUES:
        await synth(cue)

    intra = 0.32
    scene_gap = 0.68
    cursor = 0.5
    timeline = []
    previous_scene = None
    for cue in CUES:
        if previous_scene is not None:
            cursor += scene_gap if cue["scene"] != previous_scene else intra
        length = duration_seconds(AUDIO / f"{cue['id']}.mp3")
        timeline.append(
            {
                "id": cue["id"],
                "scene": cue["scene"],
                "visual": cue["visual"],
                "caption": cue["caption"],
                "file": f"{cue['id']}.mp3",
                "start": round(cursor, 3),
                "duration": round(length, 3),
            }
        )
        cursor += length + HOLDS.get(cue["id"], 0)
        previous_scene = cue["scene"]

    payload = {
        "fps": 30,
        "voice": VOICE,
        "rate": RATE,
        "duration": round(cursor + 1.05, 3),
        "cues": timeline,
    }
    TIMELINE.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"TOTAL {payload['duration']:.2f}s  cues={len(timeline)}")


if __name__ == "__main__":
    asyncio.run(main())
