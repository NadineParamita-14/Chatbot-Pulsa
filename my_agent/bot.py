import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters, ContextTypes
from google import genai
from google.genai import types

sys.path.append(str(Path(__file__).resolve().parent))
from db_service import (
    get_agent_config,
    get_agent_telegram_token,
    is_agent_active,
    save_chat_history,
    get_last_10_history,
    get_all_rag_knowledge,
    get_or_create_user,
    get_products_json_string,
    create_new_order,
    is_user_in_manual_mode
)

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

# Token Telegram TIDAK lagi dibaca dari .env — diambil dari tabel
# agent_configs (kolom telegram_token) saat bot dijalankan, sehingga
# superadmin bisa menggantinya dari Admin Panel tanpa menyentuh kode.
GEMINI_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

client = genai.Client(api_key=GEMINI_KEY)
CURRENT_AGENT_ID = "pulsa_agent"

# Balasan bila agent dimatikan superadmin lewat Admin Panel (is_active=False)
OFFLINE_MESSAGE = (
    "Mohon maaf, layanan sedang offline saat ini. "
    "Silakan hubungi kami kembali nanti."
)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    get_or_create_user(
        telegram_id=str(user.id),
        full_name=user.full_name,
        username=user.username
    )

    welcome_text = (
        f"Halo {user.first_name}! Selamat datang di Toko Pulsa Otomatis.\n\n"
        "Saya bisa membantu Anda untuk:\n"
        "• Cek daftar harga & provider\n"
        "• Beli pulsa reguler / paket data\n"
        "• Pembuatan invoice pesanan & pembayaran\n\n"
        "Ketik kebutuhan Anda, misalnya: *'Mau beli pulsa Telkomsel 10rb'* atau *'Cek harga'*"
    )
    await update.message.reply_text(welcome_text, parse_mode="Markdown")

async def reply(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    user_id = str(user.id)
    user_text = update.message.text

    # 1. Pastikan user tercatat di tabel users
    get_or_create_user(
        telegram_id=user_id,
        full_name=user.full_name,
        username=user.username
    )

    # 1.5 Human Takeover: saat admin mengambil alih percakapan (manual mode),
    # bot harus diam — pesan tidak diproses AI dan tidak dibalas otomatis.
    if is_user_in_manual_mode(user_id):
        return

    # 1.6 Status aktif agent: superadmin bisa mematikan bot dari Admin Panel
    # (agent_configs.is_active). Bila non-aktif, balas pesan sopan TANPA
    # memanggil Gemini. Dicek tiap pesan (bukan sekali saat startup) agar
    # perubahan toggle langsung berlaku tanpa restart bot.
    if not is_agent_active(CURRENT_AGENT_ID):
        await update.message.reply_text(OFFLINE_MESSAGE)
        return

    # 2. Ambil konfigurasi model dan prompt dari DB
    agent_config = get_agent_config(CURRENT_AGENT_ID)
    base_prompt = agent_config.system_prompt if agent_config else "Kamu asisten penjual pulsa otomatis."
    temperature = agent_config.temperature if agent_config else 0.3
    selected_model = getattr(agent_config, "model_name", "gemini-2.5-flash") or "gemini-2.5-flash"

    # 3. Ambil data produk dalam bentuk array string (JSON) dan knowledge FAQ
    products_array_json = get_products_json_string()
    rag_knowledge = get_all_rag_knowledge()

# 4. Susun instruksi
    full_system_instruction = f"""{base_prompt}

DAFTAR PRODUK RESMI (ARRAY DATA) TERKINI:
{products_array_json}

INFORMASI TAMBAHAN & PEMBAYARAN:
{rag_knowledge}

ATURAN WAJIB TERKAIT PRODUK:
1. Cocokkan pertanyaan pengguna HANYA dengan elemen array pada DAFTAR PRODUK RESMI di atas.
2. JIKA PRODUK TERSEDIA DI ARRAY:
   - Jelaskan nama produk, nominal harga resmi (Rp), sisa stok, dan deskripsinya secara ramah dan ringkas.
   - Jika 'stock' bernilai 0, beritahu bahwa produk tersebut ada di katalog tetapi saat ini STOK SEDANG HABIS.
3. JIKA PRODUK TIDAK TERDAFTAR DI ARRAY:
   - Tegaskan secara sopan bahwa produk/nominal/provider tersebut TIDAK TERSEDIA di toko saat ini.
   - DILARANG mengarang harga atau mengonfirmasi ketersediaan produk di luar array di atas.
4. JIKA PENGGUNA INGIN MEMESAN/MEMBELI:
   - Segera panggil tool `create_order_for_user` dengan mencantumkan nama produk dan jumlah (qty).
   - Setelah invoice terbuat, sampaikan rincian nomor invoice, total bayar, dan instruksi pembayarannya ke pengguna.
5. ATURAN STOK REAL-TIME (SANGAT PENTING):
   - WAJIB ABAIKAN sisa stok yang pernah kamu sebutkan di riwayat chat sebelumnya.
   - HANYA gunakan angka 'stock' yang tertera pada DAFTAR PRODUK RESMI (ARRAY DATA) TERKINI di atas untuk menjawab ketersediaan detik ini juga.
"""

    # 5. Susun riwayat chat
    past_chats = get_last_10_history(telegram_id=user_id, agent_id=CURRENT_AGENT_ID)
    history_contents = []
    for chat in past_chats:
        history_contents.append(types.Content(role="user", parts=[types.Part.from_text(text=chat.input)]))
        history_contents.append(types.Content(role="model", parts=[types.Part.from_text(text=chat.output)]))

    # 5.5 Wrapper tool pesanan: telegram_id diisi OTOMATIS dari pengirim
    # pesan — tidak diserahkan ke LLM agar tidak bisa diisi salah/palsu.
    def create_order_for_user(product_name: str, qty: int = 1, tax_rate: float = 0.0):
        """Buat pesanan baru untuk pengguna ini. Panggil dengan nama produk dan jumlah (qty).
        Nomor invoice, total bayar, dan status pembayaran dikembalikan otomatis."""
        return create_new_order(product_name, qty=qty, tax_rate=tax_rate, telegram_id=user_id)

    # 6. Panggil Gemini via chat session agar tool otomatis tereksekusi
    try:
        chat_session = client.chats.create(
            model=selected_model,
            config=types.GenerateContentConfig(
                system_instruction=full_system_instruction,
                temperature=temperature,
                tools=[create_order_for_user]
            ),
            history=history_contents
        )
        # Trik Injeksi: Selipkan data real-time tepat sebelum pesan user dikirim ke Gemini
        injected_prompt = (
            f"[SISTEM HIDDEN CONTEXT - STOK TERKINI: {products_array_json}]\n\n"
            f"Pertanyaan Pengguna: {user_text}"
        )
        response = chat_session.send_message(injected_prompt)
        bot_reply = response.text if response.text else "Pesanan berhasil dicatat ke sistem."
    except Exception as e:
        bot_reply = f"Maaf, terjadi kendala pada layanan: {e}"

    # 7. Simpan riwayat chat beserta model yang aktif
    save_chat_history(
        telegram_id=user_id,
        agent_id=CURRENT_AGENT_ID,
        model_name=selected_model,
        user_input=user_text,
        bot_output=bot_reply
    )

    await update.message.reply_text(bot_reply)

def main():
    # Token diambil dari database (agent_configs.telegram_token) sesuai
    # CURRENT_AGENT_ID. Bila belum diisi, hentikan bot dengan pesan jelas —
    # superadmin mengisinya lewat Admin Panel: Agent Config -> pilih agent.
    telegram_token = get_agent_telegram_token(CURRENT_AGENT_ID)
    if not telegram_token:
        print(f"[GAGAL] Token Telegram untuk agent '{CURRENT_AGENT_ID}' belum diisi di database.")
        print("        Isi lewat Admin Panel: menu Agent Config -> pilih agent -> kolom 'Telegram Token' -> Simpan.")
        sys.exit(1)

    print(f"Bot Pulsa Otomatis sedang aktif... (agent: {CURRENT_AGENT_ID}, Ctrl+C untuk stop)")
    app = ApplicationBuilder().token(telegram_token).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, reply))
    app.run_polling()

if __name__ == "__main__":
    main()