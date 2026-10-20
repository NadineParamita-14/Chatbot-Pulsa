# -*- coding: utf-8 -*-
"""
backup_db.py — Dump database PostgreSQL proyek ke file SQL.

Dibuat sebelum perubahan struktur tabel (Pivot Table) agar kondisi data
saat ini bisa dipulihkan bila migrasi bermasalah.

Cara pakai:
    python backup_db.py
    python backup_db.py --output nama_lain.sql          # nama file lain
    python backup_db.py --container nama_container      # override container Docker

Sumber koneksi dibaca otomatis dari DATABASE_URL di root .env.

Strategi eksekusi pg_dump:
    1. Bila `pg_dump` terpasang di PATH host      -> jalankan langsung.
    2. Bila tidak (kondisi saat ini: Windows tanpa
       instalasi PostgreSQL)                      -> `docker exec` ke container
       Postgres (default: pgvector_db) dan jalankan pg_dump di dalamnya,
       lalu tulis hasilnya ke file di root proyek.
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_CONTAINER = "pgvector_db"
DEFAULT_OUTPUT = "backup_sebelum_pivot.sql"


def parse_database_url(url: str) -> dict:
    """Pecah DATABASE_URL menjadi komponen koneksi pg_dump.

    Mendukung skema `postgresql://` maupun `postgresql+psycopg2://`.
    Password di-decode (bisa URL-encoded di .env) tapi TIDAK pernah
    di-print ke layar — dikirim lewat env PGPASSWORD.
    """
    if not url:
        raise ValueError("DATABASE_URL tidak ditemukan di root .env.")

    if "+psycopg2" in url:  # buang driver SQLAlchemy bila ada
        url = url.replace("+psycopg2", "")

    parsed = urlparse(url)
    dbname = parsed.path.lstrip("/")
    if not dbname:
        raise ValueError("DATABASE_URL tidak memuat nama database.")

    return {
        "host": parsed.hostname or "localhost",
        "port": str(parsed.port or 5432),
        "user": parsed.username or "postgres",
        "password": unquote(parsed.password or ""),
        "dbname": dbname,
    }


def run_host_pg_dump(conn: dict, output_path: Path) -> bool:
    """Jalankan pg_dump milik host (bila ada). Return True bila berhasil."""
    pg_dump = shutil.which("pg_dump")
    if pg_dump is None:
        return False

    env = os.environ.copy()
    env["PGPASSWORD"] = conn["password"]
    cmd = [
        pg_dump,
        f"--host={conn['host']}",
        f"--port={conn['port']}",
        f"--username={conn['user']}",
        "--no-owner",
        "--no-privileges",
        conn["dbname"],
    ]
    return _dump_to_file(cmd, env, output_path, f"pg_dump host ({pg_dump})")


def run_docker_pg_dump(conn: dict, output_path: Path, container: str) -> bool:
    """Jalankan pg_dump DI DALAM container Docker lalu ambil hasilnya."""
    env = os.environ.copy()
    env["PGPASSWORD"] = conn["password"]
    cmd = [
        "docker", "exec",
        "-e", f"PGPASSWORD={conn['password']}",
        container,
        "pg_dump",
        f"--host={conn['host']}",   # localhost dari sudut pandang container
        f"--port={conn['port']}",
        f"--username={conn['user']}",
        "--no-owner",
        "--no-privileges",
        conn["dbname"],
    ]
    return _dump_to_file(cmd, env, output_path, f"docker exec ({container})")


def _dump_to_file(cmd: list, env: dict, output_path: Path, label: str) -> bool:
    """Eksekusi perintah dump, tulis stdout ke file, laporkan hasil."""
    print(f"[INFO] Menjalankan {label} ...")
    try:
        with open(output_path, "w", encoding="utf-8", newline="\n") as f:
            result = subprocess.run(cmd, stdout=f, stderr=subprocess.PIPE, env=env)
    except FileNotFoundError as e:
        print(f"[SKIP] {label} tidak tersedia: {e}")
        return False

    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        print(f"[GAGAL] {label} keluar dengan kode {result.returncode}.")
        if stderr:
            print(f"       stderr: {stderr}")
        # Buang file setengah jadi agar tidak tertukar dengan backup valid
        output_path.unlink(missing_ok=True)
        return False

    return True


def verify_dump(output_path: Path) -> bool:
    """Sanity check sederhana: file ada, cukup besar, dan berupa dump pg."""
    if not output_path.exists():
        print("[GAGAL] File backup tidak ditemukan.")
        return False

    size_kb = output_path.stat().st_size / 1024
    head = output_path.read_text(encoding="utf-8", errors="replace")[:2000]

    if "PostgreSQL database dump" not in head:
        print("[GAGAL] File ada tetapi bukan dump pg_dump yang valid.")
        return False

    print(f"[OK] Backup valid -> {output_path}")
    print(f"     Ukuran file : {size_kb:,.1f} KB")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Backup database PostgreSQL proyek.")
    parser.add_argument("--output", default=DEFAULT_OUTPUT,
                        help=f"Nama file output (default: {DEFAULT_OUTPUT})")
    parser.add_argument("--container", default=os.getenv("POSTGRES_CONTAINER", DEFAULT_CONTAINER),
                        help=f"Nama container Docker Postgres (default: {DEFAULT_CONTAINER})")
    args = parser.parse_args()

    # Muat root .env SEBELUM membaca DATABASE_URL
    load_dotenv(BASE_DIR / ".env")
    conn = parse_database_url(os.getenv("DATABASE_URL", ""))
    output_path = BASE_DIR / args.output

    print(f"[INFO] Database  : {conn['dbname']}")
    print(f"[INFO] Server    : {conn['host']}:{conn['port']} (user: {conn['user']})")
    print(f"[INFO] Output    : {output_path}")

    # Strategi 1: pg_dump host; strategi 2: di dalam container Docker
    if run_host_pg_dump(conn, output_path):
        pass
    elif run_docker_pg_dump(conn, output_path, args.container):
        pass
    else:
        print()
        print("[GAGAL] pg_dump tidak bisa dijalankan di host maupun container Docker.")
        print("        Jalankan container Postgres dulu (docker start pgvector_db)")
        print("        atau instal PostgreSQL client, lalu ulangi: python backup_db.py")
        return 1

    return 0 if verify_dump(output_path) else 1


if __name__ == "__main__":
    # Windows console sering cp1252 — paksa UTF-8 agar emoji/simbol aman
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
