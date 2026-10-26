#!/usr/bin/env python3
"""
SkulApp Development Orchestrator
Starts: PostgreSQL + Redis (Docker) -> Migrations + Seed -> Backend (Go) -> Frontend (Vite)
"""

import os
import sys
import time
import socket
import shutil
import signal
import subprocess
import threading
import urllib.request
from pathlib import Path

# --- Terminal Styling ---
CLR_RESET = "\033[0m"
CLR_BOLD = "\033[1m"
CLR_RED = "\033[1;31m"
CLR_GREEN = "\033[1;32m"
CLR_YELLOW = "\033[1;33m"
CLR_BLUE = "\033[1;34m"
CLR_MAGENTA = "\033[1;35m"
CLR_CYAN = "\033[1;36m"


def log(tag, msg, color=CLR_BLUE):
    print(f"{color}{CLR_BOLD}[{tag}]{CLR_RESET} {msg}")


# --- Process Tracker for Graceful Cleanup ---
CHILD_PROCESSES = []
COMPOSE_FILE = None


def cleanup(signum=None, frame=None):
    print(f"\n{CLR_YELLOW}[!] Shutting down all services...{CLR_RESET}")
    for proc in CHILD_PROCESSES:
        if proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                proc.kill()
    if COMPOSE_FILE is not None:
        try:
            subprocess.run(
                ["docker", "compose", "-f", str(COMPOSE_FILE), "down"],
                capture_output=True,
            )
        except Exception:
            pass
    log("EXIT", "All services stopped.", CLR_GREEN)
    sys.exit(0)


signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)


# --- Network Port Diagnostics & Recovery ---
def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def free_port(port: int):
    if not is_port_in_use(port):
        return
    log("PORT-GUARD", f"Port {port} occupied. Clearing stale process...", CLR_YELLOW)
    try:
        if os.name == "nt":
            cmd = f'FOR /F "tokens=5" %P IN (\'netstat -a -n -o ^| findstr :{port}\') DO TaskKill.exe /F /PID %P'
            subprocess.run(cmd, shell=True, capture_output=True)
        else:
            cmd = f"lsof -ti:{port} | xargs kill -9"
            subprocess.run(cmd, shell=True, capture_output=True)
        time.sleep(1)
    except Exception as e:
        log("PORT-GUARD", f"Could not free port {port}: {e}", CLR_YELLOW)


# --- Stream Multiplexer ---
def pipe_stream(stream, prefix, color):
    for line in iter(stream.readline, b""):
        decoded = line.decode("utf-8", errors="replace").rstrip()
        if decoded:
            print(f"{color}{CLR_BOLD}[{prefix}]{CLR_RESET} {decoded}")
    stream.close()


def main():
    global COMPOSE_FILE
    root = Path(__file__).resolve().parent
    os.chdir(root)
    COMPOSE_FILE = root / "infrastructure" / "docker" / "docker-compose.yml"

    print(f"{CLR_BOLD}{CLR_CYAN}================================================================{CLR_RESET}")
    print(f"{CLR_BOLD}{CLR_CYAN}     SKULAPP DEVELOPMENT ORCHESTRATOR                          {CLR_RESET}")
    print(f"{CLR_BOLD}{CLR_CYAN}================================================================{CLR_RESET}")

    # 1. Prerequisites
    for tool in ["docker", "go", "node", "npm"]:
        if not shutil.which(tool):
            print(f"{CLR_RED}{CLR_BOLD}[FATAL]{CLR_RESET} Prerequisite '{tool}' missing from PATH.")
            cleanup()
            sys.exit(1)
        log("PREFLIGHT", f"Verified: {tool}", CLR_GREEN)

    # 2. Free required ports if orphaned
    for port in [5432, 6379, 8080, 5173]:
        free_port(port)

    # 3. Stop any stale compose services that could reclaim ports
    try:
        subprocess.run(
            ["docker", "compose", "-f", str(COMPOSE_FILE), "down"],
            capture_output=True,
        )
    except Exception:
        pass

    # 4. Verify Docker daemon
    try:
        subprocess.run(
            ["docker", "info"], check=True, capture_output=True
        )
        log("DOCKER", "Daemon active and responsive.", CLR_GREEN)
    except Exception:
        print(f"{CLR_RED}{CLR_BOLD}[FATAL]{CLR_RESET} Docker daemon is not running. Start Docker and retry.")
        cleanup()
        sys.exit(1)

    # 5. Ensure env files exist
    backend_env = root / "backend" / ".env"
    frontend_env = root / "frontend" / ".env"
    if not backend_env.exists():
        shutil.copy(root / "backend" / ".env.example", backend_env)
        log("ENV", "Created backend/.env from .env.example.", CLR_YELLOW)
    if not frontend_env.exists():
        shutil.copy(root / "frontend" / ".env.example", frontend_env)
        log("ENV", "Created frontend/.env from .env.example.", CLR_YELLOW)

    # 6. Boot PostgreSQL via compose (Redis may already be running on 6379)
    log("INFRA", "Starting PostgreSQL via Docker Compose...", CLR_BLUE)
    subprocess.run(
        ["docker", "compose", "-f", str(COMPOSE_FILE), "up", "-d", "postgres"],
        check=True,
    )

    # 7. Ensure Redis is available (use existing if already running)
    log("REDIS", "Checking Redis on localhost:6379...", CLR_BLUE)
    redis_available = False
    try:
        result = subprocess.run(
            ["redis-cli", "-h", "127.0.0.1", "-p", "6379", "PING"],
            capture_output=True, timeout=3,
        )
        if result.returncode == 0 and b"PONG" in result.stdout:
            redis_available = True
    except Exception:
        pass

    if not redis_available:
        log("REDIS", "External Redis not found. Starting Redis via Docker Compose...", CLR_YELLOW)
        try:
            subprocess.run(
                ["docker", "compose", "-f", str(COMPOSE_FILE), "up", "-d", "redis"],
                check=True,
            )
            redis_available = True
        except Exception:
            log("REDIS", "Could not start Docker Redis (port 6379 may be in use externally).", CLR_YELLOW)

    if redis_available:
        log("REDIS", "Redis available on localhost:6379.", CLR_GREEN)
    else:
        log("REDIS", "WARNING: Redis not available — rate limiting may fail.", CLR_YELLOW)

    # 8. Poll database readiness
    log("DB", "Waiting for PostgreSQL on localhost:5432 (timeout 30s)...", CLR_BLUE)
    db_ready = False
    for _ in range(30):
        result = subprocess.run(
            [
                "docker", "compose", "-f", str(COMPOSE_FILE), "exec", "-T",
                "postgres", "pg_isready", "-U", "school_admin", "-d", "school_system",
            ],
            capture_output=True,
        )
        if result.returncode == 0:
            db_ready = True
            break
        time.sleep(1)
    if not db_ready:
        print(f"{CLR_RED}{CLR_BOLD}[FATAL]{CLR_RESET} PostgreSQL did not become ready.")
        cleanup()
        sys.exit(1)
    log("DB", "PostgreSQL accepting connections on localhost:5432.", CLR_GREEN)

    # 8. Apply migrations with demo seed
    log("MIGRATION", "Applying migrations + demo seed data...", CLR_BLUE)
    migrate_env = {
        **os.environ,
        "DATABASE_URL": "postgres://school_admin:dev_secret_password@localhost:5432/school_system?sslmode=disable",
    }
    p_migrate = subprocess.Popen(
        ["go", "run", "./cmd/migrate", "-dir", "../migrations", "-seed"],
        cwd=str(root / "backend"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=migrate_env,
    )
    m_out, m_err = p_migrate.communicate()
    if m_out:
        for line in m_out.decode().splitlines():
            if line.strip():
                print(f"{CLR_BLUE}{CLR_BOLD}[MIGRATION]{CLR_RESET} {line}")
    if m_err:
        for line in m_err.decode().splitlines():
            if line.strip():
                print(f"{CLR_RED}{CLR_BOLD}[MIGRATION]{CLR_RESET} {line}")
    if p_migrate.returncode != 0:
        print(f"{CLR_RED}{CLR_BOLD}[FATAL]{CLR_RESET} Migration failed (exit {p_migrate.returncode}).")
        cleanup()
        sys.exit(1)
    log("MIGRATION", "Migrations and seed data applied.", CLR_GREEN)

    # 9. Start backend (air for hot-reload if installed, else go run)
    backend_dir = root / "backend"
    has_air = shutil.which("air") is not None
    backend_cmd = ["air"] if has_air else ["go", "run", "./cmd/api"]
    if has_air:
        log("BACKEND", "Active watcher: air (hot reload enabled)", CLR_MAGENTA)
    else:
        log("BACKEND", "Active runner: go run (install air for hot reload)", CLR_YELLOW)

    backend_env_dict = {
        **os.environ,
        "DATABASE_URL": "postgres://school_admin:dev_secret_password@localhost:5432/school_system?sslmode=disable",
        "REDIS_URL": "redis://localhost:6379",
        "PORT": "8080",
        "APP_ENV": "development",
        "JWT_SIGNING_KEY": "dev-signing-key-change-in-production-min-32-chars",
        "ENCRYPTION_KEY": "dev-encryption-key-32-chars-long",
    }

    p_backend = subprocess.Popen(
        backend_cmd,
        cwd=str(backend_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=backend_env_dict,
    )
    CHILD_PROCESSES.append(p_backend)
    threading.Thread(
        target=pipe_stream, args=(p_backend.stdout, "API-8080", CLR_MAGENTA), daemon=True
    ).start()
    threading.Thread(
        target=pipe_stream, args=(p_backend.stderr, "API-8080", CLR_RED), daemon=True
    ).start()

    # 10. Start frontend (Vite)
    frontend_dir = root / "frontend"
    p_frontend = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(frontend_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    CHILD_PROCESSES.append(p_frontend)
    threading.Thread(
        target=pipe_stream, args=(p_frontend.stdout, "VITE-5173", CLR_CYAN), daemon=True
    ).start()
    threading.Thread(
        target=pipe_stream, args=(p_frontend.stderr, "VITE-5173", CLR_RED), daemon=True
    ).start()

    # 11. Wait for API health
    log("READY", "Waiting for API at http://localhost:8080/healthz ...", CLR_BLUE)
    api_ready = False
    for _ in range(30):
        try:
            resp = urllib.request.urlopen("http://localhost:8080/healthz", timeout=2)
            if resp.status == 200:
                api_ready = True
                break
        except Exception:
            pass
        time.sleep(1)

    log("READY", "All services online.", CLR_GREEN)
    log("URLS", "Frontend: http://localhost:5173", CLR_GREEN)
    log("URLS", "API health: http://localhost:8080/healthz", CLR_GREEN)
    log("CREDS", "Demo login: admin@demo.test / DemoPass123!  (tenant: demo-school)", CLR_GREEN)
    log("CREDS", "See DEMO_LOGINS.txt for all credentials.", CLR_GREEN)

    # 12. Health loop — restart on child exit
    while True:
        time.sleep(0.5)
        if p_backend.poll() is not None:
            print(f"{CLR_RED}{CLR_BOLD}[FATAL]{CLR_RESET} Backend exited with code {p_backend.returncode}")
            cleanup()
            sys.exit(1)
        if p_frontend.poll() is not None:
            print(f"{CLR_RED}{CLR_BOLD}[FATAL]{CLR_RESET} Frontend exited with code {p_frontend.returncode}")
            cleanup()
            sys.exit(1)


if __name__ == "__main__":
    main()
