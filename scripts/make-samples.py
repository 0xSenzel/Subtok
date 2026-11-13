#!/usr/bin/env python3
"""Synthesize the original sample clips in web/samples/ with ffmpeg. Run from the repository root."""
import subprocess
import sys

FFMPEG = '/opt/homebrew/bin/ffmpeg'
N = lambda name: {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[name[0]] + (1 if '#' in name else -1 if 'b' in name else 0) + 12 * (int(name[-1]) - 4) - 9
HZ = lambda name: round(440 * 2 ** (N(name) / 12), 2)

# id, bpm, bars (each four beats) as three-note chords, bass roots, wave brightness, kick and hat on or off
CLIPS = [
    ('sunrise', 96, [['C4', 'E4', 'G4'], ['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['G3', 'B3', 'D4']], ['C2', 'A1', 'F2', 'G1'], 1.0, True),
    ('night-drive', 118, [['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['C4', 'E4', 'G4'], ['G3', 'B3', 'D4']], ['A1', 'F1', 'C2', 'G1'], 2.2, True),
    ('slow-tide', 72, [['D4', 'F4', 'A4'], ['Bb3', 'D4', 'F4'], ['G3', 'Bb3', 'D4'], ['A3', 'C#4', 'E4']], ['D2', 'Bb1', 'G1', 'A1'], 0.5, False),
    ('city-lights', 132, [['E4', 'G#4', 'B4'], ['C#4', 'E4', 'G#4'], ['A3', 'C#4', 'E4'], ['B3', 'D#4', 'F#4']], ['E2', 'C#2', 'A1', 'B1'], 3.0, True),
]
LENGTH = 24


def pick(bar, values):
    out = str(values[-1])
    for i in range(len(values) - 2, -1, -1):
        out = f'if(lt({bar},{i + 1}),{values[i]},{out})'
    return out


def expression(bpm, chords, roots, bright, drums):
    beat = 60 / bpm
    bar_len = beat * 4
    bar = f'mod(floor(t/{bar_len:.5f}),{len(chords)})'
    bt = f'mod(t,{beat:.5f})'
    eighth = f'mod(t,{beat / 2:.5f})'
    step = f'mod(floor(t/{beat / 2:.5f}),4)'
    notes = [pick(bar, [HZ(c[i]) for c in chords]) for i in range(3)]
    root = pick(bar, [HZ(r) for r in roots])
    # Arpeggio walks up and back down the chord: 0 1 2 1.
    arp = pick(step, [f'({notes[0]})', f'({notes[1]})', f'({notes[2]})', f'({notes[1]})'])
    tone = lambda f, p=0: f'(sin(2*PI*({f})*t+{p})+{0.18 * bright:.2f}*sin(4*PI*({f})*t)+{0.08 * bright:.2f}*sin(6*PI*({f})*t))'
    parts = [
        f'0.10*({tone(notes[0])}+{tone(notes[1])}+{tone(notes[2])})*(0.7+0.3*sin(PI*mod(t,{bar_len:.5f})/{bar_len:.5f}))',
        f'0.30*{tone(root)}*exp(-3*{bt})',
        f'0.18*{tone(f"2*({arp})")}*exp(-9*{eighth})',
    ]
    if drums:
        parts.append(f'0.55*sin(2*PI*(48+90*exp(-30*{bt}))*{bt})*exp(-9*{bt})')
        parts.append(f'0.05*(random(0)*2-1)*exp(-60*mod(t+{beat / 2:.5f},{beat:.5f}))')
    fade = f'min(1,t/0.05)*min(1,({LENGTH}-t)/0.4)'
    return f'({"+".join(parts)})*{fade}'


def main():
    for clip, bpm, chords, roots, bright, drums in CLIPS:
        out = f'web/samples/{clip}.m4a'
        expr = expression(bpm, chords, roots, bright, drums)
        command = [FFMPEG, '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', f'aevalsrc=exprs={expr.replace(",", chr(92) + ",")}:s=44100:d={LENGTH}',
                   '-af', 'lowpass=f=6000,alimiter=limit=0.9', '-ac', '2', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out]
        subprocess.run(command, check=True)
        print(out)


if __name__ == '__main__':
    sys.exit(main())
