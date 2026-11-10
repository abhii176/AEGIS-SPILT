#!/usr/bin/env python3
"""Synthesize the pitch voiceover and write cue timings for the film."""

import asyncio
import json
import subprocess
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
BUILD.mkdir(parents=True, exist_ok=True)

VOICE = "en-US-AndrewNeural"
RATE = "-2%"
LEAD = 0.65
GAP = 0.34
TAIL = 1.2

SCENES = [
    {
        "id": "hook",
        "sentences": [
            ("billions", "Every year, billions of dollars change hands in the freelance economy."),
            ("broken", "But the system is broken."),
            ("fear", "Freelancers live in fear of client ghosting and unpaid hours, while clients risk paying upfront for code that never arrives or breaks entirely."),
            ("platforms", "Existing platforms rely on slow, manual human approvals and clunky escrow banks."),
            ("built", "That's why we built Aegis-Split."),
        ],
    },
    {
        "id": "concept",
        "sentences": [
            ("who", "Aegis-Split is a revolutionary, AI-verified micro-escrow platform built specifically for developers, designers, and fast-moving tech clients."),
            ("bias", "We eliminate human bias and middleman delays by automating trust."),
            ("how", "How? By combining secure financial rails with autonomous AI verification."),
        ],
    },
    {
        "id": "flow",
        "sentences": [
            ("intro", "Here is how it works end-to-end."),
            ("vault-title", "Secure vaulting."),
            ("vault", "The client funds the milestone via the PayPal REST API, locking the money safely in escrow."),
            ("audit-title", "Automated AI auditing."),
            ("audit", "Instead of waiting for a manual client click, when the freelancer merges their code into GitHub, our backend fetches the raw git diff."),
            ("audit-model", "GPT-4o instantly audits the code against the milestone's acceptance criteria."),
            ("payout-title", "Instant payout."),
            ("payout", "If the code passes verification, the PayPal Payouts API instantly releases the funds directly to the freelancer's account."),
        ],
    },
    {
        "id": "safety",
        "sentences": [
            ("intro", "We didn't stop at automation."),
            ("policy", "Aegis-Split enforces strict KYC verification, mandatory in-platform communication to prevent off-platform scams, and clear penalty-protected early-exit contracts."),
            ("dispute", "If a dispute arises, our integrated Agora voice recordings and chat logs provide a transparent audit trail for our human review counselors to settle conflicts fairly."),
        ],
    },
    {
        "id": "close",
        "sentences": [
            ("transform", "Aegis-Split transforms freelance collaboration from a game of trust into a mathematically secure, AI-verified partnership."),
            ("cta", "Check out our open-source repository and live demo link below."),
            ("thanks", "Thank you!"),
        ],
    },
]

SHOT = {
    "vault-title": "fund",
    "vault": "fund",
    "audit-title": "work",
    "audit": "work",
    "audit-model": "work",
    "payout-title": "paid",
    "payout": "paid",
    "kyc": "verify",
    "chat": "chat",
    "exit": "exit",
    "dispute": "counselor",
}


def norm(text: str) -> str:
    cleaned = text.lower().replace("'", "").replace("’", "")
    return "".join(ch for ch in cleaned if ch.isalnum() or ch == "-")


def probe(path: Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        text=True,
    ).strip()
    return float(out)


async def synthesize(text: str, mp3_path: Path):
    last_error = None
    for attempt in range(5):
        communicate = edge_tts.Communicate(text, VOICE, rate=RATE, boundary="WordBoundary")
        words = []
        audio = bytearray()
        try:
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio.extend(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    start = chunk["offset"] / 10_000_000
                    end = (chunk["offset"] + chunk["duration"]) / 10_000_000
                    words.append({"text": chunk["text"], "start": start, "end": end})
        except Exception as error:  # noqa: BLE001 — retry transient edge-tts drops
            last_error = error
            await asyncio.sleep(1.5 * (attempt + 1))
            continue
        if audio and words:
            mp3_path.write_bytes(audio)
            return words
        last_error = RuntimeError("edge-tts returned no audio")
        await asyncio.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"voice synthesis failed for {mp3_path.name}") from last_error


def sentences_from_words(words, plan):
    """Edge TTS omits punctuation, so beats are anchored to the script instead."""
    anchors = [norm(sentence.split()[0]) for _, sentence in plan]
    starts = []
    cursor = 0
    for anchor in anchors:
        found = None
        for index in range(cursor, len(words)):
            if norm(words[index]["text"]) == anchor:
                found = index
                break
        if found is None:
            found = cursor
        starts.append(found)
        cursor = found + 1
    groups = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(words)
        groups.append(words[start:end] or [words[min(start, len(words) - 1)]])
    return groups


def caption_spans(sentence, group):
    """Pair the written sentence with the spoken words, splitting long lines."""
    if not group:
        return []
    pieces = [sentence]
    if len(sentence) > 92:
        split_at = sentence.find(", ", 40, 110)
        if split_at == -1:
            split_at = sentence.find(" while ")
        if split_at != -1:
            cut = split_at + 1 if sentence[split_at] == "," else split_at
            pieces = [sentence[:cut].strip(), sentence[cut:].strip()]
    counts = [max(1, len(piece.split())) for piece in pieces]
    total = sum(counts)
    cursor = 0
    spans = []
    for piece, count in zip(pieces, counts):
        take = max(1, round(len(group) * count / total))
        chunk = group[cursor:] if piece is pieces[-1] else group[cursor : cursor + take]
        cursor += take
        if not chunk:
            continue
        spans.append({"start": chunk[0]["start"], "end": chunk[-1]["end"], "text": piece})
    return spans


def split_policy(group):
    """Turn the long policy sentence into KYC, chat, and exit beats."""

    def find(*needles):
        for word in group:
            token = norm(word["text"])
            if any(needle in token for needle in needles):
                return word
        return None

    chat = find("communication", "inplatform", "mandatory")
    exit_word = find("penalty", "earlyexit", "contracts")
    cuts = [("kyc", group[0]["start"])]
    if chat and chat["start"] > group[0]["start"] + 0.4:
        cuts.append(("chat", chat["start"]))
    if exit_word and exit_word["start"] > cuts[-1][1] + 0.4:
        cuts.append(("exit", exit_word["start"]))
    return cuts


async def main():
    raw_dir = BUILD / "raw"
    raw_dir.mkdir(exist_ok=True)
    scene_payloads = []

    for scene in SCENES:
        text = " ".join(sentence for _, sentence in scene["sentences"])
        mp3 = raw_dir / f"{scene['id']}.mp3"
        words = await synthesize(text, mp3)
        wav = raw_dir / f"{scene['id']}.wav"
        subprocess.check_call(
            ["ffmpeg", "-y", "-i", str(mp3), "-ar", "48000", "-ac", "2", str(wav)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        groups = sentences_from_words(words, scene["sentences"])
        expected = len(scene["sentences"])
        if len(groups) != expected:
            print(f"WARNING {scene['id']}: expected {expected} sentences, got {len(groups)}")
            for index, group in enumerate(groups):
                print(" ", index, " ".join(word["text"] for word in group))
        scene_payloads.append(
            {
                "id": scene["id"],
                "wav": wav,
                "duration": probe(wav),
                "words": words,
                "groups": groups,
                "plan": scene["sentences"],
            }
        )
        await asyncio.sleep(0.6)

    silence = raw_dir / "gap.wav"
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=stereo",
            "-t",
            str(GAP),
            str(silence),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    lead = raw_dir / "lead.wav"
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=stereo",
            "-t",
            str(LEAD),
            str(lead),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    tail = raw_dir / "tail.wav"
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=stereo",
            "-t",
            str(TAIL),
            str(tail),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    concat_list = raw_dir / "concat.txt"
    lines = [f"file '{lead}'"]
    for index, payload in enumerate(scene_payloads):
        lines.append(f"file '{payload['wav']}'")
        if index != len(scene_payloads) - 1:
            lines.append(f"file '{silence}'")
    lines.append(f"file '{tail}'")
    concat_list.write_text("\n".join(lines) + "\n")
    voice = BUILD / "vo.wav"
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-c",
            "copy",
            str(voice),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    cursor = LEAD
    scenes = []
    beats = []
    captions = []
    words_out = []

    for index, payload in enumerate(scene_payloads):
        scene_start = 0 if index == 0 else cursor
        speech_start = cursor
        speech_end = cursor + payload["duration"]
        if index == len(scene_payloads) - 1:
            scene_end = speech_end + TAIL
        else:
            scene_end = speech_end + 0.04
        scenes.append(
            {
                "id": payload["id"],
                "start": round(scene_start, 3),
                "end": round(scene_end, 3),
            }
        )

        shifted = []
        for word in payload["words"]:
            item = {
                "scene": payload["id"],
                "text": word["text"],
                "start": round(word["start"] + speech_start, 3),
                "end": round(word["end"] + speech_start, 3),
            }
            shifted.append(item)
            words_out.append(item)

        groups = sentences_from_words(shifted, payload["plan"])
        for group_index, group in enumerate(groups):
            beat_id, sentence = payload["plan"][group_index]
            if beat_id == "policy":
                cuts = split_policy(group)
                policy_lines = [
                    "Aegis-Split enforces strict KYC verification,",
                    "mandatory in-platform communication to prevent off-platform scams,",
                    "and clear penalty-protected early-exit contracts.",
                ]
                for cut_index, (cut_id, cut_start) in enumerate(cuts):
                    cut_end = cuts[cut_index + 1][1] if cut_index + 1 < len(cuts) else group[-1]["end"]
                    beats.append(
                        {
                            "id": cut_id,
                            "scene": payload["id"],
                            "start": round(cut_start, 3),
                            "end": round(cut_end, 3),
                            "shot": SHOT.get(cut_id),
                        }
                    )
                    captions.append(
                        {
                            "scene": payload["id"],
                            "start": round(cut_start, 3),
                            "end": round(cut_end, 3),
                            "text": policy_lines[min(cut_index, len(policy_lines) - 1)],
                        }
                    )
                continue
            beats.append(
                {
                    "id": beat_id,
                    "scene": payload["id"],
                    "start": round(group[0]["start"], 3),
                    "end": round(group[-1]["end"], 3),
                    "shot": SHOT.get(beat_id),
                }
            )
            for caption in caption_spans(sentence, group):
                captions.append(
                    {
                        "scene": payload["id"],
                        "start": round(caption["start"], 3),
                        "end": round(caption["end"], 3),
                        "text": caption["text"],
                    }
                )

        cursor = speech_end + GAP

    duration = round(probe(voice), 3)
    cues = {
        "duration": duration,
        "voice": VOICE,
        "rate": RATE,
        "scenes": scenes,
        "beats": beats,
        "captions": captions,
        "words": words_out,
    }
    (BUILD / "cues.json").write_text(json.dumps(cues, indent=2))
    (BUILD / "cues.js").write_text("window.CUES = " + json.dumps(cues) + ";\n")
    print(f"duration {duration:.2f}s")
    for beat in beats:
        print(f"  {beat['scene']:8} {beat['id']:14} {beat['start']:6.2f}-{beat['end']:6.2f}  {beat['shot'] or ''}")


if __name__ == "__main__":
    asyncio.run(main())
