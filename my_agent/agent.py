import os
import sys
import datetime
import requests
from pathlib import Path
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from google.adk.agents.llm_agent import Agent

# Tambahkan path folder agar bisa membaca db_service
sys.path.append(str(Path(__file__).resolve().parent))
from db_service import get_agent_config

# Muat environment variable
load_dotenv()

# ==========================================
# Tool 1: Cuaca
# ==========================================
def get_weather(city: str) -> dict:
    """Retrieves the current weather report for a specified city."""
    if city.lower() == "new york":
        return {
            "status": "success",
            "report": "The weather in New York is sunny with a temperature of 25 degrees Celsius.",
        }
    return {
        "status": "error",
        "error_message": f"Weather information for '{city}' is not available.",
    }

# ==========================================
# Tool 2: Waktu
# ==========================================
def get_current_time(city: str) -> dict:
    """Returns the current time in a specified city."""
    if city.lower() == "new york":
        tz_identifier = "America/New_York"
    elif city.lower() in ["jakarta", "indonesia"]:
        tz_identifier = "Asia/Jakarta"
    else:
        return {
            "status": "error",
            "error_message": f"Sorry, I don't have timezone information for {city}.",
        }

    tz = ZoneInfo(tz_identifier)
    now = datetime.datetime.now(tz)
    report = f'The current time in {city} is {now.strftime("%Y-%m-%d %H:%M:%S %Z%z")}'
    return {"status": "success", "report": report}

# ==========================================
# Tool 3: Kopi (SampleAPIs)
# ==========================================
def get_hot_coffee_list(query: str = "") -> dict:
    """Fetches a list of hot coffees and their descriptions or ingredients."""
    url = "https://api.sampleapis.com/coffee/hot"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()

        if query:
            q = query.lower()
            filtered_data = [
                item for item in data
                if q in item.get("title", "").lower()
                or any(q in ing.lower() for ing in item.get("ingredients", []))
                or q in item.get("description", "").lower()
            ]
            return {
                "status": "success",
                "total": len(filtered_data),
                "results": filtered_data
            }

        return {
            "status": "success",
            "total": len(data),
            "results": data
        }
    except requests.RequestException as e:
        return {
            "status": "error",
            "message": f"Failed to fetch coffee data: {str(e)}"
        }

# ==========================================
# Aturan tag gambar (multimodal 2-arah)
# ==========================================
# LLM "memesan" gambar dengan tag [GAMBAR: x] di akhir jawaban;
# pengirim file aslinya dilakukan di luar model (webhook Flask utk
# jalur webhook / logika polling utk bot.py). Sinkron dengan
# IMAGE_RULES di app.py.
IMAGE_RULES = """
ATURAN MUTLAK TENTANG GAMBAR (INSTRUKSI TERTINGGI):
Abaikan ketiadaan data promo di database-mu. Kamu memiliki akses langsung ke gambar promo lokal. 
1. JIKA PENGGUNA BERTANYA PROMO/DISKON: KAMU WAJIB membalas dengan kalimat "Tentu, ini dia promo spesial dari kami!" lalu KAMU WAJIB menuliskan tag [GAMBAR: promo_pulsa.jpg] di bagian paling akhir. JANGAN PERNAH mengatakan kamu tidak memiliki informasi diskon.
2. JIKA PENGGUNA BERTANYA DAFTAR HARGA/PRICELIST: KAMU WAJIB membalas "Berikut adalah daftar harga kami:" dan tambahkan tag [GAMBAR: daftar_harga.jpg] di akhir teks.
Selalu ketik tag tersebut persis seperti contoh.
"""

# ==========================================
# Dynamic Agent Factory
# ==========================================
def create_agent(agent_id: str = "pulsa_agent") -> Agent:
    """
    Membuat instance Agent dengan model Gemini dan instruksi
    yang diambil secara realtime dari tabel agent_configs di database.
    """
    config = get_agent_config(agent_id)

    # Ambil nilai kolom model_name dari relasi database
    selected_model = getattr(config, "model_name", "gemini-2.5-flash") if config else "gemini-2.5-flash"

    # Ambil instruksi dari database
    if config and config.system_prompt:
        instruction_text = config.system_prompt
    else:
        instruction_text = (
            "Kamu adalah asisten virtual penjual pulsa otomatis yang ramah dan cepat. "
            "Bantu pelanggan mengecek harga dan transaksi pulsa."
        )

    # Injeksi aturan tag gambar agar LLM bisa "memesan" gambar lokal
    instruction_text = f"{instruction_text}\n{IMAGE_RULES}"

    print(f"-> Agent '{agent_id}' menggunakan model: {selected_model}")

    return Agent(
        model=selected_model,
        name=agent_id,
        description="Assistant dynamically configured from database.",
        instruction=instruction_text,
        tools=[get_weather, get_current_time, get_hot_coffee_list],
    )

# Gunakan fungsi ini jika pemanggil butuh instance yang selalu membaca konfigurasi terbaru
def get_current_agent(agent_id: str = "pulsa_agent") -> Agent:
    return create_agent(agent_id)

# Objek default
root_agent = create_agent("pulsa_agent")