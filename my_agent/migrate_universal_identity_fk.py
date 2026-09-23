"""
Migrasi Fase 2 identitas universal: chat_histories & orders beralih dari
telegram_id ke user_id (FK users.id).

Yang dilakukan (idempoten — aman dijalankan berulang):
  1. Buang kolom typo `is_manuak_mode` dari tabel users (peninggalan lama).
  2. chat_histories: tambah `user_id`, backfill via pemetaan telegram_id
     lama -> users.id, pasang NOT NULL + FK + index, lalu DROP kolom
     telegram_id.
  3. orders: sama seperti di atas, tetapi user_id tetap nullable (order
     lama/gateway boleh tanpa pemilik).

Riwayat/order lama TIDAK dihapus — dipindah pemiliknya ke users.id. Bila
ada telegram_id yatim tanpa baris user, baris user-nya dibuat otomatis
agar data tidak hilang.

Cara menjalankan (dari folder root proyek):
    set PYTHONIOENCODING=utf-8 && python my_agent/migrate_universal_identity_fk.py
"""

import sys
from pathlib import Path

from dotenv import load_dotenv

# Muat .env ROOT (berisi DATABASE_URL) SEBELUM import models — models.py
# hanya mencari my_agent/.env yang tidak ada di setup ini.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Agar `import models` menemukan modul di folder yang sama dengan skrip
sys.path.insert(0, str(Path(__file__).resolve().parent))

from models import migrate_universal_identity_fk  # noqa: E402

if __name__ == "__main__":
    migrate_universal_identity_fk()
