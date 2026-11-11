#!/usr/bin/env python3
"""Compatibility entry point for the local development launcher.

Historically this file contained its own Docker/Postgres orchestration. That
version could kill whatever was listening on 5432/6379, raced stale Compose
services, and checked the wrong health endpoint. The canonical launcher is now
``launch_all.sh``; this wrapper keeps ``python3 dev.py`` working for anyone with
the old command in their shell history.
"""

import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
launcher = root / "launch_all.sh"
os.execv(str(launcher), [str(launcher), *sys.argv[1:]])
