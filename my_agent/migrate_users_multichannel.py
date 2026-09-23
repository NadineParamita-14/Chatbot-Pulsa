"""
Migrasi aman skema `users` multi-channel (Telegram + WhatsApp via WAHA).

Yang dilakukan (idempoten — aman dijalankan berulang, data lama tidak
pernah dihapus):
  1. Tambah kolom `channel` (default 'telegram'), `platform_id`,
     `whatsapp_lid` bila belum ada.
  2. Backfill data lama: channel='telegram' dan platform_id=telegram_id.
  3. platform_id dipasang NOT NULL; telegram_id dilonggarkan jadi NULL-able
     (user WhatsApp tidak punya Telegram ID).
  4. Unique index untuk platform_id dan whatsapp_lid.

Catatan: init_db() di models.py memanggil migrasi yang sama saat aplikasi
start — skrip ini hanya untuk menjalankannya SECARA EKSPLISIT dari terminal.

Cara menjalankan (dari folder root proyek):
    set PYTHONIOENCODING=utf-8 && python my_agent/migrate_users_multichannel.py
"""

import sys
from pathlib import Path

from dotenv import load_dotenv

# Muat .env ROOT (berisi DATABASE_URL) SEBELUM import models — models.py
# hanya mencari my_agent/.env yang tidak ada di setup ini.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Agar `import models` menemukan modul di folder yang sama dengan skrip
sys.path.insert(0, str(Path(__file__).resolve().parent))

from models import migrate_users_multichannel  # noqa: E402

if __name__ == "__main__":
    migrate_users_multichannel()
