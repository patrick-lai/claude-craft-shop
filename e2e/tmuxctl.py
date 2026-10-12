#!/usr/bin/env python3
"""Drive a tmux pane like a person: wait for text, click on text, type, capture.

  tmuxctl.py wait  <session> <regex> [timeout_s]
  tmuxctl.py click <session> <text> [column_offset] [occurrence]
  tmuxctl.py type  <session> <text>          (types, then presses Enter)
  tmuxctl.py ask   <session> <text> [timeout_s]  (types, then waits for the turn
                                                to end, approving prompts)
  tmuxctl.py pick  <session> <option>        (moves an open Select's highlight
                                                to <option>, then picks it)
  tmuxctl.py idle  <session> [timeout_s]     (waits for no running turn,
                                                approving prompts)
  tmuxctl.py shot  <session> <out.ansi>      (capture with colors)

A click is an SGR mouse press and release at the first cell of <text> plus
<column_offset>, which the fullscreen layout reads as a pointer press.
"""
import re
import subprocess
import sys
import time

DONE = re.compile(r'for \d+[ms].* · done \d')


def capture(session: str, colors: bool = False) -> str:
    args = ['tmux', 'capture-pane', '-p', '-t', session] + (['-e'] if colors else [])
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def wait(session: str, pattern: str, timeout: float = 60) -> None:
    deadline = time.monotonic() + timeout
    regex = re.compile(pattern)
    while time.monotonic() < deadline:
        if regex.search(capture(session)):
            return
        time.sleep(0.5)
    sys.stderr.write(capture(session))
    sys.exit(f'timed out after {timeout}s waiting for /{pattern}/')


def click(session: str, text: str, offset: int = 0, occurrence: int = 1) -> None:
    seen = 0
    for row, line in enumerate(capture(session).splitlines(), start=1):
        start = line.find(text)
        while start != -1:
            seen += 1
            if seen == occurrence:
                column = start + offset + 1
                sequence = f'\x1b[<0;{column};{row}M\x1b[<0;{column};{row}m'
                subprocess.run(['tmux', 'send-keys', '-t', session, '-l', sequence], check=True)
                time.sleep(0.8)
                return
            start = line.find(text, start + 1)
    sys.exit(f'no "{text}" (occurrence {occurrence}) on screen')


def type_line(session: str, text: str) -> None:
    subprocess.run(['tmux', 'send-keys', '-t', session, '-l', text], check=True)
    time.sleep(0.4)
    subprocess.run(['tmux', 'send-keys', '-t', session, 'Enter'], check=True)
    time.sleep(0.8)


def approve(session: str, screen: str) -> None:
    if 'Do you want to proceed?' in screen:
        subprocess.run(['tmux', 'send-keys', '-t', session, '1'], check=True)
        time.sleep(1)


def ask(session: str, text: str, timeout: float = 120) -> None:
    type_line(session, text)
    head = text[:40]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        screen = capture(session)
        approve(session, screen)
        lines = screen.splitlines()
        asked = [index for index, line in enumerate(lines) if head in line]
        if asked and any(DONE.search(line) for line in lines[asked[-1]:]):
            time.sleep(1)
            return
        time.sleep(1)
    sys.stderr.write(capture(session))
    sys.exit(f'timed out after {timeout}s waiting for the turn to end')


def idle(session: str, timeout: float = 120) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        screen = capture(session)
        approve(session, screen)
        if 'esc to interrupt' not in screen:
            time.sleep(1)
            if 'esc to interrupt' not in capture(session):
                return
        time.sleep(1)
    sys.stderr.write(capture(session))
    sys.exit(f'timed out after {timeout}s waiting for the turn to end')


def pick(session: str, option: str) -> None:
    for _ in range(8):
        if any('\x1b[7m' in line and option in line for line in capture(session, colors=True).splitlines()):
            subprocess.run(['tmux', 'send-keys', '-t', session, 'Enter'], check=True)
            time.sleep(0.8)
            return
        subprocess.run(['tmux', 'send-keys', '-t', session, 'Down'], check=True)
        time.sleep(0.4)
    sys.exit(f'could not highlight "{option}"')


def main() -> None:
    command, session, *rest = sys.argv[1:]
    if command == 'wait':
        wait(session, rest[0], float(rest[1]) if len(rest) > 1 else 60)
    elif command == 'click':
        click(session, rest[0], int(rest[1]) if len(rest) > 1 else 0, int(rest[2]) if len(rest) > 2 else 1)
    elif command == 'type':
        type_line(session, rest[0])
    elif command == 'ask':
        ask(session, rest[0], float(rest[1]) if len(rest) > 1 else 120)
    elif command == 'pick':
        pick(session, rest[0])
    elif command == 'idle':
        idle(session, float(rest[0]) if rest else 120)
    elif command == 'shot':
        with open(rest[0], 'w') as out:
            out.write(capture(session, colors=True))
    else:
        sys.exit(f'unknown command {command}')


if __name__ == '__main__':
    main()
