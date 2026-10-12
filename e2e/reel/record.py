#!/usr/bin/env python3
"""Records a tmux pane as it changes: one colored capture per change, named
by the milliseconds since the start, until <dir>/stop exists.

  record.py <session> <dir> [interval_s]
"""
import os
import subprocess
import sys
import time


def main() -> None:
    session, folder = sys.argv[1], sys.argv[2]
    interval = float(sys.argv[3]) if len(sys.argv) > 3 else 0.2
    os.makedirs(folder, exist_ok=True)
    start = time.monotonic()
    last = None
    while not os.path.exists(os.path.join(folder, 'stop')):
        shot = subprocess.run(['tmux', 'capture-pane', '-e', '-p', '-t', session], capture_output=True, text=True)
        if shot.returncode == 0 and shot.stdout != last:
            last = shot.stdout
            with open(os.path.join(folder, f'{int((time.monotonic() - start) * 1000):07d}.ansi'), 'w') as out:
                out.write(shot.stdout)
        time.sleep(interval)
    with open(os.path.join(folder, f'{int((time.monotonic() - start) * 1000):07d}.end'), 'w') as out:
        out.write('')


if __name__ == '__main__':
    main()
