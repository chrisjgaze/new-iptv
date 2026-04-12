import os
import urllib.request
import json
import subprocess
import socket
import time
import sqlite3
import logging
import hashlib
import threading
import queue  # for queue.Empty in SSE
import re
import requests
from flask import Flask, request, render_template, jsonify
from flask import Response, stream_with_context
from flask_cors import CORS
from queue import Queue
from urllib.parse import urljoin, urlencode

TMDB_API_KEY = "6a6d458ed970b424b76aef33f073bd75"
HLS_BASE_DIR = "/var/www/html/hls"

app = Flask(__name__)
CORS(app)

event_queue = Queue()
LIVE_HLS_PROCESS = None
LIVE_HLS_STREAM_ID = None

logging.basicConfig(
    filename='logger.log',
    level=logging.INFO,  # Change to DEBUG for more verbosity
    format='%(asctime)s [%(levelname)s] %(message)s'
)


USERNAME = "6c82e7398a"
PASSWORD = "a2bfaf950817"
BASE_URL = "http://vpn.tsclean.cc"
PLAYER_API = f"{BASE_URL}/player_api.php?username={USERNAME}&password={PASSWORD}"

# MOVIE
MOVIE_API = PLAYER_API + "&action=get_vod_streams"

# LIVE
LIVE_API = PLAYER_API + "&action=get_live_streams"

# SERIES
SERIES_API = PLAYER_API + "&action=get_series"
SERIES_INFO_API = PLAYER_API + "&action=get_series_info&series_id="
SERIES_CATS = PLAYER_API + "&action=get_series_categories"
SERIES_STREAMS = PLAYER_API + "&action=get_series&category_id="

# CATEGORIES
VOD_CATS = PLAYER_API + "&action=get_vod_categories"
VOD_STREAMS = PLAYER_API + "&action=get_vod_streams&category_id="

HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
    "Connection": "keep-alive",
}

# VLC REMOTE CONTROL SETTINGS
VLC_HOST = "127.0.0.1"
VLC_PORT = 4212  # Ensure VLC is running with this port

# Cache config
CACHE_TTL_SECONDS = 3600  # 1 hour
CACHE_DIR = os.path.join("static", "cache")  # optional mirror for debugging
os.makedirs(CACHE_DIR, exist_ok=True)

# Language tag whitelist for category names
ALLOWED_LANG_TAGS = {"EN", "PH"}  # extend as needed
LANG_OK = re.compile(r'^(EN|PH)\b', re.I)   # allow EN/PH (case-insensitive), followed by a boundary
TWO_CAPS = re.compile(r'^[A-Z]{2}\b')       # starts with exactly two uppercase letters

CURRENT_MEDIA = {
    "type": None,   # "episode" or "movie"
    "id": None      # the episode_id or stream_id
}

# Path to your CEC listener script
CEC_SCRIPT_PATH = os.path.join(os.path.dirname(__file__), "cec_to_vlc.py")

# --------------------------
# Background services
# --------------------------
def start_cec_listener():
    try:
        subprocess.Popen(["python", CEC_SCRIPT_PATH], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        logging.info("CEC listener started!")
        print("📡 CEC listener started!")
    except Exception as e:
        logging.error(f"❌ Error starting CEC listener: {e}")
        print(f"❌ Error starting CEC listener: {e}")

start_cec_listener()

def start_clvc():
    cmd_vlc = ["vlc", "--aout=alsa", "--gain=5.0", "--network-caching=60000", "--fullscreen", "--extraintf", "rc", "--rc-host", "127.0.0.1:4212", "--audio-filter=equalizer", "--equalizer-preamp=8.0", "--audio-language=en", "&"]
    try:
        subprocess.Popen(cmd_vlc, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        logging.info("📡 VLC service started!")
        print("📡 VLC service started!")
    except Exception as e:
        logging.error(f"❌ Error starting VLC service: {e}")
        print(f"❌ Error starting VLC service: {e}")

start_clvc()

def send_vlc_command(command):
    """Send a command to VLC via RC interface."""
    try:
        logging.info(f"VLC Sending {command}")
        with socket.create_connection((VLC_HOST, VLC_PORT), timeout=2) as vlc_socket:
            vlc_socket.sendall(command.encode("utf-8") + b"\n")
            response = vlc_socket.recv(4096).decode("utf-8")
            return response.strip()
    except Exception as e:
        logging.error(f"VLC Error {e}")
        return f"Error sending command to VLC: {e}"

def send_vlc_command2(command):
    """Send a command to VLC and read the response properly."""
    try:
        print(f"VLC Sending {command}")
        with socket.create_connection((VLC_HOST, VLC_PORT), timeout=2) as vlc_socket:
            vlc_socket.sendall(command.encode("utf-8") + b"\n")
            response = ""
            while True:
                data = vlc_socket.recv(1024).decode("utf-8")
                if not data:
                    break
                response += data
            return "Success"
    except Exception as e:
        print(f"Error sending command to VLC: {e}")
        return "Success"

# --------------------------
# SQLite init
# --------------------------
def init_db():
    conn = sqlite3.connect("database.db")
    conn.execute("PRAGMA journal_mode=WAL;")
    c = conn.cursor()

    # Better concurrency
    c.execute("PRAGMA journal_mode=WAL;")

    # watched_episodes
    c.execute('''
        CREATE TABLE IF NOT EXISTS watched_episodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            episode_id TEXT NOT NULL UNIQUE,
            elapsed_time INTEGER,
            watched_pct INTEGER,
            watched_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS recent_media (
            recent_key TEXT PRIMARY KEY,
            media_type TEXT NOT NULL,
            media_id TEXT NOT NULL,
            episode_id TEXT,
            tmdb_id TEXT,
            title TEXT,
            subtitle TEXT,
            overview TEXT,
            poster_url TEXT,
            backdrop_url TEXT,
            container_extension TEXT,
            elapsed_time INTEGER,
            watched_pct INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # JSON cache
    c.execute('''
        CREATE TABLE IF NOT EXISTS http_cache (
            key TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            value TEXT NOT NULL,
            fetched_at INTEGER NOT NULL
        )
    ''')
    
    # favourite categories
    c.execute('''
        CREATE TABLE IF NOT EXISTS favourite_categories (
            category_id TEXT PRIMARY KEY
        )
    ''')

    conn.commit()
    conn.close()

def get_watched_info():
    conn = sqlite3.connect("database.db")
    conn.execute("PRAGMA journal_mode=WAL;")
    c = conn.cursor()
    c.execute("SELECT episode_id, watched_pct, elapsed_time FROM watched_episodes")
    rows = c.fetchall()
    conn.close()
    return {row[0]: {"watched_pct": row[1], "elapsed_time": row[2]} for row in rows}

def upsert_watched_progress(episode_id, watched_pct, elapsed_time):
    if not episode_id:
        return
    conn = sqlite3.connect("database.db")
    conn.execute("PRAGMA journal_mode=WAL;")
    c = conn.cursor()
    c.execute(
        """
        INSERT INTO watched_episodes (episode_id, watched_pct, elapsed_time)
        VALUES (?, ?, ?)
        ON CONFLICT(episode_id) DO UPDATE SET
            watched_pct = excluded.watched_pct,
            elapsed_time = excluded.elapsed_time,
            watched_at = CURRENT_TIMESTAMP
        """,
        (str(episode_id), watched_pct, elapsed_time)
    )
    conn.commit()
    conn.close()

def upsert_recent_media(entry):
    media_type = (entry.get("media_type") or "").strip().lower()
    media_id = str(entry.get("media_id") or "").strip()
    if media_type not in {"movie", "series"} or not media_id:
        return

    recent_key = f"{media_type}:{media_id}"
    conn = sqlite3.connect("database.db")
    conn.execute("PRAGMA journal_mode=WAL;")
    c = conn.cursor()
    c.execute(
        """
        INSERT INTO recent_media (
            recent_key,
            media_type,
            media_id,
            episode_id,
            tmdb_id,
            title,
            subtitle,
            overview,
            poster_url,
            backdrop_url,
            container_extension,
            elapsed_time,
            watched_pct,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(recent_key) DO UPDATE SET
            episode_id = excluded.episode_id,
            tmdb_id = excluded.tmdb_id,
            title = excluded.title,
            subtitle = excluded.subtitle,
            overview = excluded.overview,
            poster_url = excluded.poster_url,
            backdrop_url = excluded.backdrop_url,
            container_extension = excluded.container_extension,
            elapsed_time = excluded.elapsed_time,
            watched_pct = excluded.watched_pct,
            updated_at = CURRENT_TIMESTAMP
        """,
        (
            recent_key,
            media_type,
            media_id,
            str(entry.get("episode_id") or "") or None,
            str(entry.get("tmdb_id") or "") or None,
            entry.get("title"),
            entry.get("subtitle"),
            entry.get("overview"),
            entry.get("poster_url"),
            entry.get("backdrop_url"),
            entry.get("container_extension"),
            entry.get("elapsed_time"),
            entry.get("watched_pct")
        )
    )
    conn.commit()
    conn.close()

def get_recent_media(limit=50):
    conn = sqlite3.connect("database.db")
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute(
        """
        SELECT
            recent_key,
            media_type,
            media_id,
            episode_id,
            tmdb_id,
            title,
            subtitle,
            overview,
            poster_url,
            backdrop_url,
            container_extension,
            elapsed_time,
            watched_pct,
            updated_at
        FROM recent_media
        ORDER BY datetime(updated_at) DESC
        LIMIT ?
        """,
        (int(limit),)
    )
    rows = [dict(row) for row in c.fetchall()]
    conn.close()
    return rows

def delete_recent_media(recent_key):
    if not recent_key:
        return False
    conn = sqlite3.connect("database.db")
    conn.execute("PRAGMA journal_mode=WAL;")
    c = conn.cursor()
    c.execute("DELETE FROM recent_media WHERE recent_key = ?", (str(recent_key),))
    deleted = c.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

# --------------------------
# Cache helpers
# --------------------------
def _cache_key(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()

def _cache_get(url: str):
    key = _cache_key(url)
    conn = sqlite3.connect("database.db")
    conn.execute("PRAGMA journal_mode=WAL;")
    c = conn.cursor()
    c.execute("SELECT value, fetched_at FROM http_cache WHERE key = ?", (key,))
    row = c.fetchone()
    conn.close()
    if not row:
        return None, None
    value, fetched_at = row
    return value, int(fetched_at)

def _cache_set(url: str, json_text: str):
    key = _cache_key(url)
    now = int(time.time())
    conn = sqlite3.connect("database.db")
    conn.execute("PRAGMA journal_mode=WAL;")
    c = conn.cursor()
    c.execute("""
        INSERT INTO http_cache (key, url, value, fetched_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, fetched_at=excluded.fetched_at, url=excluded.url
    """, (key, url, json_text, now))
    conn.commit()
    conn.close()

    # Optional disk mirror
    fname = os.path.join(CACHE_DIR, f"{key}.json")
    try:
        with open(fname, "w", encoding="utf-8") as f:
            f.write(json_text)
    except Exception as e:
        logging.warning(f"Failed to write cache mirror {fname}: {e}")

def _fetch_json(url: str, timeout=10):
    req = urllib.request.Request(url, headers=HTTP_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read().decode()

def get_json_cached(url: str, ttl_seconds: int = CACHE_TTL_SECONDS, default=None, allow_stale_on_error=True):
    """
    Returns parsed JSON. Uses cache if fresh; otherwise refreshes.
    On network error, serves stale cache if available.
    """
    if default is None:
        default = []  # sensible default since most endpoints return lists

    cached_text, fetched_at = _cache_get(url)
    now = int(time.time())
    fresh = fetched_at is not None and (now - fetched_at) <= ttl_seconds

    if fresh and cached_text.strip() not in ("[]", ""):
        try:
            #print(f'fresh and cached_text, returning')
            return json.loads(cached_text)
        except Exception:
            pass  # fall through to refetch

    try:
        new_text = _fetch_json(url)
        _cache_set(url, new_text)
        return json.loads(new_text)
    except Exception as e:
        logging.warning(f"[CACHE] Refresh failed for {url}: {e}")
        if allow_stale_on_error and cached_text:
            try:
                return json.loads(cached_text)
            except Exception:
                pass
        return default

# --------------------------
# Language tag filter
# --------------------------
def is_allowed_category_name(name: str) -> bool:
    """
    Keep categories that either:
      - start with a language tag and the tag is in ALLOWED_LANG_TAGS (e.g., |EN|, |PH|)
      - OR have no leading tag at all (no leading '|')
    """
    if "FOR ADULTS" in name:
        return True
    if not isinstance(name, str):
        return False
    s = name.strip()
    if not s:
        return False

    # Match a leading tag like |EN|, |PH| (case-insensitive, optional spaces)
    m = re.match(r'^\|\s*([A-Za-z]{2,3})\s*\|', s)
    if not m:
        # no leading tag -> allowed
        return True

    tag = m.group(1).upper()
    return tag in ALLOWED_LANG_TAGS

# --------------------------
# Redirect URL grabber
# --------------------------
def _resolve_redirect(url: str, timeout: int = 15) -> str:
    """
    Follow redirects and return the final URL without downloading the media.
    Uses GET with stream=True because many panels don't support HEAD.
    """
    with requests.Session() as s:
        # If your server sets cookies on first hop, Session preserves them
        resp = s.get(url, allow_redirects=True, stream=True, timeout=timeout,
                     headers={"User-Agent": "VLC/3.0.21 LibVLC/3.0.21"})
        resp.raise_for_status()
        final_url = str(resp.url)
        logging.warning(final_url)
        resp.close()
        return final_url

def get_favourites():
    conn = sqlite3.connect("database.db")
    conn.execute("PRAGMA journal_mode=WAL;")
    c = conn.cursor()
    c.execute("SELECT category_id FROM favourite_categories")
    favs = {row[0] for row in c.fetchall()}
    conn.close()
    return favs

def set_favourite(cat_id, fav=True):
    conn = sqlite3.connect("database.db")
    conn.execute("PRAGMA journal_mode=WAL;")
    c = conn.cursor()
    if fav:
        c.execute("INSERT OR IGNORE INTO favourite_categories (category_id) VALUES (?)", (cat_id,))
    else:
        c.execute("DELETE FROM favourite_categories WHERE category_id=?", (cat_id,))
    conn.commit()
    conn.close()
    
# --------------------------
# Data classes (wired to cache)
# --------------------------
class MovieData:
    @staticmethod
    def search_movies(query):
        try:
            data = get_json_cached(MOVIE_API, ttl_seconds=CACHE_TTL_SECONDS, default=[])
            q = (query or "").lower()
            return [
                item for item in data
                if isinstance(item, dict) and item.get("name") and q in item["name"].lower()
            ]
        except Exception as e:
            logging.error(f"[ERROR] search_movies failed: {e}")
            return []

class LiveData:
    @staticmethod
    def search_channels(query):
        try:
            data = get_json_cached(LIVE_API, ttl_seconds=CACHE_TTL_SECONDS, default=[])
            q = (query or "").lower()
            return [
                item for item in data
                if isinstance(item, dict) and item.get("name") and q in item["name"].lower()
            ]
        except Exception as e:
            logging.error(f"[ERROR] search_channels failed: {e}")
            return []

class SeriesData:
    @staticmethod
    def search_series(query):
        try:
            data = get_json_cached(SERIES_API, ttl_seconds=CACHE_TTL_SECONDS, default=[])
            q = (query or "").lower()

            results = []
            for item in data:
                if not isinstance(item, dict):
                    continue
                name = item.get("name")
                if not name:
                    continue
                if q not in name.lower():
                    continue

                # Accept if name starts with EN/PH OR does NOT start with two capitals
                if LANG_OK.match(name) or not TWO_CAPS.match(name):
                    results.append(item)

            return results
        except Exception as e:
            logging.error(f"[ERROR] search_series failed: {e}")
            return []

    @staticmethod
    def get_series_info(series_id):
        url = SERIES_INFO_API + str(series_id)
        try:
            result = get_json_cached(url, ttl_seconds=CACHE_TTL_SECONDS, default={})
            return result
        except Exception as e:
            logging.error(f"[ERROR] get_series_info failed: {e}")
            return {}

class CategoryData:
    @staticmethod
    def get_categories():
        try:
            cats = get_json_cached(VOD_CATS, ttl_seconds=CACHE_TTL_SECONDS, default=[])
            filtered = []
            logging.info(f"Get Categories for movie")
            for item in cats:
                name = item.get("category_name")
                if is_allowed_category_name(name):
                    filtered.append(item)
            return filtered
        except Exception as e:
            logging.error(f"[ERROR] get_categories failed: {e}")
            return []

    @staticmethod
    def get_movies_in_category(cat_id):
        try:
            url = VOD_STREAMS + str(cat_id)
            logging.info(f"Get movies in category {cat_id}")
            return get_json_cached(url, ttl_seconds=CACHE_TTL_SECONDS, default=[])
        except Exception as e:
            logging.error(f"[ERROR] get_movies_in_category failed: {e}")
            return []
    
    
    @staticmethod
    def get_series_categories():
        try:
            cats = get_json_cached(SERIES_CATS, ttl_seconds=CACHE_TTL_SECONDS, default=[])
            filtered = []
            logging.info("Get Categories for series")
            for item in cats:
                name = item.get("category_name")
                if is_allowed_category_name(name):
                    filtered.append(item)
            return filtered
        except Exception as e:
            logging.error(f"[ERROR] get_series_categories failed: {e}")
            return []
    
    
    @staticmethod
    def get_series_in_category(cat_id):
        try:
            url = SERIES_STREAMS + str(cat_id)
            logging.info(f"Get series in category {cat_id}")
            return get_json_cached(url, ttl_seconds=CACHE_TTL_SECONDS, default=[])
        except Exception as e:
            logging.error(f"[ERROR] get_series_in_category failed: {e}")
            return []
# --- Downloads ---
DOWNLOAD_DIR = os.path.join("static", "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

def _safe_filename(name: str) -> str:
    # keep it simple; remove nasty chars
    return re.sub(r'[^a-zA-Z0-9_.-]+', '_', name).strip('_')

def _download_file(final_url: str, dest_path: str, timeout: int = 60) -> None:
    """Stream download to disk."""
    with requests.Session() as s:
        with s.get(final_url, stream=True, timeout=timeout,
                   headers={"User-Agent": "VLC/3.0.21 LibVLC/3.0.21"}) as r:
            r.raise_for_status()
            tmp_path = dest_path + ".part"
            with open(tmp_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        f.write(chunk)
            os.replace(tmp_path, dest_path)

def _download_then_play(original_url: str, local_path: str):
    """Resolve -> download -> play locally via VLC RC."""
    try:
        final_url = _resolve_redirect(original_url)
        _download_file(final_url, local_path)
        # Quote path for RC in case of spaces
        send_vlc_command("clear")
        send_vlc_command(f'add "{os.path.abspath(local_path)}"')
    except Exception as e:
        logging.error(f"[DL&PLAY] Failed: {e}", exc_info=True)

def run_ffmpeg_transcode(url, playlist_file=None, segment_file_pattern=None, live=False):
    """
    This function runs the ffmpeg command in a separate thread.
    """
    logging.info("run ffmpeg")
    playlist_file = playlist_file or os.path.join(HLS_BASE_DIR, "stream.m3u8")
    segment_file_pattern = segment_file_pattern or os.path.join(HLS_BASE_DIR, "segment%03d.ts")

    # This is your command, broken into a list for security
    command = [
        'ffmpeg',
        '-y',
        '-i', url,
        '-c:v', 'copy',
        '-c:a', 'aac', '-ac', '2',
        '-sn',
        '-f', 'hls',
        '-hls_time', '4',
        '-hls_segment_filename', segment_file_pattern,
    ]

    if live:
        command.extend([
            '-hls_list_size', '6',
            '-hls_flags', 'delete_segments+append_list+independent_segments'
        ])
    else:
        command.extend([
            '-hls_playlist_type', 'vod'
        ])

    command.append(playlist_file)

    print(f"Starting transcode for: {url} cmd {command}")
    
    try:
        # Run the command.
        # We capture output for logging/debugging.
        # 'check=True' will raise an exception if ffmpeg fails.
        result = subprocess.run(command, check=True, 
                                capture_output=True, text=True)
        print(f"Successfully finished transcode for url '{url}'.")
        print(f"FFmpeg stdout: {result.stdout}")
        
    except subprocess.CalledProcessError as e:
        # Log the error if ffmpeg fails
        print(f"ERROR: FFmpeg failed for jurlob '{url}'.")
        print(f"Return code: {e.returncode}")
        print(f"FFmpeg stderr: {e.stderr}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

def start_live_hls_stream(stream_id, container_ext="ts"):
    global LIVE_HLS_PROCESS, LIVE_HLS_STREAM_ID
    if not stream_id:
        raise ValueError("Missing stream_id")

    ext = (container_ext or "ts").lstrip(".")
    original_url = f"{BASE_URL}/live/{USERNAME}/{PASSWORD}/{stream_id}.{ext}"
    playlist_name = f"live_{stream_id}.m3u8"
    segment_pattern = f"live_{stream_id}_%03d.ts"
    playlist_file = os.path.join(HLS_BASE_DIR, playlist_name)
    segment_file_pattern = os.path.join(HLS_BASE_DIR, segment_pattern)
    playlist_url = f"http://192.168.1.46/hls/{playlist_name}"

    if LIVE_HLS_PROCESS and LIVE_HLS_PROCESS.poll() is None:
        if LIVE_HLS_STREAM_ID != str(stream_id):
            try:
                LIVE_HLS_PROCESS.terminate()
                LIVE_HLS_PROCESS.wait(timeout=3)
            except Exception:
                try:
                    LIVE_HLS_PROCESS.kill()
                except Exception:
                    pass

    if LIVE_HLS_PROCESS and LIVE_HLS_PROCESS.poll() is None and LIVE_HLS_STREAM_ID == str(stream_id):
        return {
            "stream_url": original_url,
            "playlist_url": playlist_url
        }

    for filename in os.listdir(HLS_BASE_DIR):
        if filename.startswith(f"live_{stream_id}"):
            try:
                os.remove(os.path.join(HLS_BASE_DIR, filename))
            except Exception:
                pass

    command = [
        'ffmpeg',
        '-y',
        '-i', original_url,
        '-c:v', 'copy',
        '-c:a', 'aac', '-ac', '2',
        '-sn',
        '-f', 'hls',
        '-hls_time', '4',
        '-hls_list_size', '6',
        '-hls_flags', 'delete_segments+append_list+independent_segments',
        '-hls_segment_filename', segment_file_pattern,
        playlist_file
    ]
    logging.info(f"Starting live HLS for stream_id={stream_id}")
    LIVE_HLS_PROCESS = subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    LIVE_HLS_STREAM_ID = str(stream_id)

    for _ in range(30):
        if os.path.exists(playlist_file) and os.path.getsize(playlist_file) > 0:
            break
        time.sleep(0.25)

    return {
        "stream_url": original_url,
        "playlist_url": playlist_url
    }

# ------------------------------------------------------------------------------
# ROUTES
# ------------------------------------------------------------------------------
@app.route("/", methods=["GET", "POST"])
def index():
    tab = request.args.get("tab", "movies")
    active_tab = tab
    movie_results = []
    series_results = []

    if request.method == "POST":
        movie_query = request.form.get("movie_query", "").strip()
        series_query = request.form.get("series_query", "").strip()

        if movie_query:
            active_tab = "movies"
            movie_results = MovieData.search_movies(movie_query)
        elif series_query:
            active_tab = "series"
            series_results = SeriesData.search_series(series_query)

    return render_template(
        "index.html",
        active_tab=active_tab,
        movie_results=movie_results,
        series_results=series_results
    )

@app.route("/api/search", methods=["GET"])
def api_search():
    query = request.args.get("query", "").strip()
    media_type = request.args.get("type", "all").strip().lower()

    if not query:
        return jsonify({
            "query": "",
            "movies": [],
            "series": [],
            "channels": [],
            "results": []
        })

    movies = MovieData.search_movies(query) if media_type in {"all", "movie", "movies"} else []
    series = SeriesData.search_series(query) if media_type in {"all", "series"} else []
    channels = LiveData.search_channels(query) if media_type in {"all", "live", "channel", "channels"} else []

    results = []
    for item in movies:
        if isinstance(item, dict):
            result = dict(item)
            result["media_type"] = "movie"
            results.append(result)

    for item in series:
        if isinstance(item, dict):
            result = dict(item)
            result["media_type"] = "series"
            results.append(result)

    for item in channels:
        if isinstance(item, dict):
            result = dict(item)
            result["media_type"] = "channel"
            results.append(result)

    return jsonify({
        "query": query,
        "movies": movies,
        "series": series,
        "channels": channels,
        "results": results
    })

@app.route("/get_categories", methods=["GET"])
def get_categories():
    cats = CategoryData.get_categories()
    favs = get_favourites()
    logging.info(favs)
    for cat in cats:
        cat["is_favourite"] = cat["category_id"] in favs
    cats.sort(key=lambda c: (not c["is_favourite"], c["category_name"].lower()))
    return jsonify(cats)

@app.route("/get_series_categories", methods=["GET"])
def get_series_categories():
    cats = CategoryData.get_series_categories()
    cats.sort(key=lambda c: c.get("category_name", "").lower())
    return jsonify(cats)

@app.route("/category/<int:cat_id>")
def category_movies(cat_id):
    logging.info(f"Category route called with id={repr(cat_id)}")
    movies = CategoryData.get_movies_in_category(cat_id)
    return render_template(
        "category_movies.html",
        cat_id=cat_id,
        items=movies,
        content_type="movie"
    )

@app.route("/category/<int:cat_id>/movies", methods=["GET"])
def api_category_movies(cat_id):
    movies = CategoryData.get_movies_in_category(cat_id)
    return jsonify(movies)

@app.route("/series-category/<int:cat_id>")
def category_series(cat_id):
    series = CategoryData.get_series_in_category(cat_id)
    return render_template(
        "category_movies.html",
        cat_id=cat_id,
        items=series,
        content_type="series"
    )

@app.route("/series-category/<int:cat_id>/series", methods=["GET"])
def api_category_series(cat_id):
    series = CategoryData.get_series_in_category(cat_id)
    return jsonify(series)

# -- Start HLS Stream --
@app.route("/hls_stream", methods=["POST"])
def hls_stream():
    logging.info(f"Call hls_stream {request}")
    stream_url = "http://vpn.tsclean.cc:80/series/6c82e7398a/a2bfaf950817/1892268.mp4"#request.form.get("stream_url")
    logging.info(f"Stream {stream_url}")
    thread = threading.Thread(
        target=run_ffmpeg_transcode,
        args=(stream_url,)
    )
    logging.info("Start HLS Thread")
    thread.start() # Start the thread and return immediately

    # Return an "Accepted" response to the client
    # We also give the client the exact URL to play.
    playlist_url = f"http://192.168.1.46/hls/stream.m3u8"
    
    # HTTP 202 "Accepted" is the perfect status code for this.
    logging.info("Return json 202")
    return jsonify({
        "message": "Transcode started.",
        "url": stream_url,
        "playlist_url": playlist_url
    }), 202

@app.route("/api/live/hls", methods=["POST"])
def api_live_hls():
    data = request.get_json(silent=True) or {}
    stream_id = data.get("stream_id")
    container_ext = data.get("container_extension") or "ts"
    if not stream_id:
        return jsonify({"error": "Missing stream_id"}), 400
    try:
        payload = start_live_hls_stream(stream_id, container_ext)
        return jsonify({
            "status": "success",
            **payload
        })
    except Exception as e:
        logging.error(f"[ERROR] api_live_hls failed: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

# -- MOVIE PLAY/INFO ENDPOINTS --
@app.route("/send_to_tv", methods=["POST"])
def send_to_tv1():
    stream_id = request.form.get("stream_id")
    container_ext = request.form.get("container_extension")

    if not stream_id or not container_ext:
        return jsonify({"error": "Missing stream_id or container_extension"}), 400

    stream_url = f"{BASE_URL}/movie/{USERNAME}/{PASSWORD}/{stream_id}.{container_ext}"
    return jsonify({"stream_url": stream_url})

@app.route("/api/send_to_tv", methods=["POST"])
def send_to_tv():
    data = request.get_json()
    if not data or 'season' not in data or 'episodes' not in data:
        return jsonify({"status": "error", "error": "Invalid data"}), 400
    
    for episode in data.get("episodes", []):
        info = episode.get("info", {})

        # Remove unwanted keys
        for key in ("audio", "video"):
            info.pop(key, None)

        # Rename air_date to release_date if it exists
        if "air_date" in info:
            info["release_date"] = info.pop("air_date")

        # Add default plot if missing
        if "plot" not in info:
            info["plot"] = "Plot unavailable"

        episode["info"] = info  # ensure the updated info is saved back
  
    filename = "series_data.json"
    filepath = os.path.join("static", "tvdata", filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)

    event_queue.put(data)
    return jsonify({
        "status": "success",
        "url": f"/static/tvdata/{filename}"
    })

@app.route("/api/categories/favourite", methods=["POST"])
def toggle_favourite():
    logging.info("Set favourite")
    cat_id = request.form.get("category_id")
    action = request.form.get("action")
    if not cat_id or action not in ["add", "remove"]:
        return jsonify({"error": "Invalid request"}), 400
    set_favourite(cat_id, fav=(action == "add"))
    return jsonify({"ok": True})


@app.route('/watched-episodes')
def get_watched_episodes():
    logging.info("Get watched status")
    return get_watched_info()

@app.route("/api/recently-watched", methods=["GET"])
def api_recently_watched():
    limit = request.args.get("limit", 50)
    try:
        limit = max(1, min(int(limit), 200))
    except Exception:
        limit = 50
    return jsonify({
        "results": get_recent_media(limit)
    })

@app.route("/api/recently-watched/delete", methods=["POST"])
def api_delete_recently_watched():
    data = request.get_json(silent=True) or {}
    recent_key = data.get("recent_key")
    if not recent_key:
        return jsonify({"status": "error", "message": "Missing recent_key"}), 400
    deleted = delete_recent_media(recent_key)
    return jsonify({
        "status": "success" if deleted else "not_found",
        "deleted": deleted
    })

@app.route('/season-updates')
def stream():
    client_ip = request.remote_addr
    logging.info(f"New SSE connection initiated from {client_ip}")
    def event_stream():
        logging.info("SSE event_stream started")
        while True:
            try:
                data = event_queue.get(timeout=15)
                logging.debug(f"Got data from event_queue: {data}")
                logging.info(f"[SSE] Sending data: {data}")
                yield f"data: {json.dumps(data)}\n\n"
            except queue.Empty:
                yield ":\n\n"  # heartbeat
            except GeneratorExit:
                logging.info(f"SSE client from {client_ip} disconnected (GeneratorExit)")
                break
            except Exception as e:
                logging.error(f"[SSE ERROR] {e}", exc_info=True)
                break

    return Response(stream_with_context(event_stream()), mimetype='text/event-stream')

@app.route("/play_on_tv", methods=["POST"])
def play_on_tv():
    stream_id = request.form.get("stream_id")
    container_ext = request.form.get("container_extension") or request.form.get("container_ext")
    if not stream_id or not container_ext:
        return jsonify({"error": "Missing stream_id or container_extension"}), 400

    base = BASE_URL.rstrip("/")
    original_url = f"{base}/movie/{USERNAME}/{PASSWORD}/{stream_id}.{container_ext}"
    logging.warning(f"Send {original_url}")

    try:
        redirect_url = _resolve_redirect(original_url)
        logging.warning(f"redirect {redirect_url}")
    except requests.HTTPError as e:
        return jsonify({
            "error": f"Upstream returned an error {e.response.status_code}",
            "status_code": e.response.status_code,
            "original_url": original_url
        }), 502
    except requests.RequestException as e:
        return jsonify({
            "error": "Network error while resolving redirect",
            "details": str(e),
            "original_url": original_url
        }), 504

    # Clear VLC and play the resolved URL
    #client.add(original_url)
    #client.play()
    send_vlc_command("clear")
    vlc_resp = send_vlc_command(f"add {original_url}")


    return jsonify({
        "status": "success",
        "original_url": original_url,
        "redirect_url": original_url, # before redirect
        "vlc_response": vlc_resp #before vlc_resp
    })

# -- SERIES PLAY/INFO ENDPOINTS --
@app.route("/api/series/<int:series_id>", methods=["GET"])
def api_series_info(series_id):
    data = SeriesData.get_series_info(series_id)
    return jsonify({
        "series_id": series_id,
        "info": data.get("info", {}),
        "episodes": data.get("episodes", {}),
        "backdrop_path": data.get("backdrop_path", []),
        "watched_info": get_watched_info()
    })

@app.route("/episodes/<int:series_id>")
def episodes(series_id):
    data = SeriesData.get_series_info(series_id)
    episodes = data.get("episodes", {})
    info = data.get("info", {})
    series_name = info.get("name", f"Series {series_id}")
    back_drop = data.get("backdrop_path", {})
    logging.info(back_drop)

    watched_info = get_watched_info()
    return render_template(
        "episodes.html",
        series_id=series_id,
        series_name=series_name,
        backdrop=back_drop,
        episodes=episodes,
        watched_info=watched_info
    )

@app.route("/play_episode_on_tv", methods=["POST"])
def play_episode_on_tv():
    episode_id = request.form.get("episode_id")
    container_ext = request.form.get("container_extension")
    CURRENT_MEDIA["type"] = "episode"
    CURRENT_MEDIA["id"] = str(episode_id)
    seek_time = int(request.form.get("seek_time", 0))  # default to 0 if missing
    if seek_time > 0:
        seek_time = (int(seek_time) / 1000)

    if not episode_id or not container_ext:
        return jsonify({"error": "Missing episode_id or container_extension"}), 400

    original_url = f"{BASE_URL}/series/{USERNAME}/{PASSWORD}/{episode_id}.{container_ext}"
    logging.warning(f"Send {original_url}")

    try:
        redirect_url = _resolve_redirect(original_url)
        logging.warning(f"redirect {redirect_url}")
    except requests.HTTPError as e:
        return jsonify({
            "error": "Upstream returned an error",
            "status_code": e.response.status_code,
            "original_url": original_url
        }), 502
    except requests.RequestException as e:
        return jsonify({
            "error": "Network error while resolving redirect",
            "details": str(e),
            "original_url": original_url
        }), 504
        
    if not redirect_url:
        return jsonify({"error": "Missing stream_url"}), 400

    response = send_vlc_command("clear")
    response = send_vlc_command(f"add {redirect_url}")
    #client.add(original_url)
    time.sleep(2)
    #client.play()
    if seek_time > 0:
        send_vlc_command(f"seek {seek_time}")

    return jsonify({
        "status": "success",
        "stream_url": original_url, #before redirect_url
        "vlc_response": response # before response
    })

@app.route("/mark_watched", methods=["POST"])
def mark_watched():
    logging.info("Mark as watched")
    episode_id = request.form.get("episode_id")
    if not episode_id:
        logging.warning("Attempted to mark watched with missing episode_id.")
        return jsonify({"status": "error", "message": "Missing episode_id"}), 400

    elapsed_time = request.form.get("elapsed_time")
    watched_pct = request.form.get("watched_pct")

    try:
        upsert_watched_progress(episode_id, watched_pct, elapsed_time)
        logging.info(
            f"Episode marked as watched: {episode_id}, elapsed_time: {elapsed_time}, watched_pct: {watched_pct}"
        )
    except Exception as e:
        logging.error(f"Database error when marking watched: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({"status": "success"})

@app.route("/download_and_play_movie", methods=["POST"])
def download_and_play_movie():
    stream_id = request.form.get("stream_id")
    container_ext = request.form.get("container_extension") or request.form.get("container_ext")
    movie_name = request.form.get("name")  # optional; use if you have it

    if not stream_id or not container_ext:
        return jsonify({"error": "Missing stream_id or container_extension"}), 400

    base = BASE_URL.rstrip("/")
    original_url = f"{base}/movie/{USERNAME}/{PASSWORD}/{stream_id}.{container_ext}"

    # Choose filename
    base_name = _safe_filename(movie_name) if movie_name else f"{stream_id}"
    filename = f"{base_name}.{container_ext}"
    local_path = os.path.join(DOWNLOAD_DIR, filename)

    # If already downloaded, just play it
    if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
        send_vlc_command("clear")
        vlc_resp = send_vlc_command(f'add "{os.path.abspath(local_path)}"')
        return jsonify({
            "status": "played_existing",
            "file": f"/{local_path}",
            "vlc_response": vlc_resp
        })

    # Kick off background worker
    threading.Thread(target=_download_then_play, args=(original_url, local_path), daemon=True).start()

    return jsonify({
        "status": "downloading",
        "message": "Download started. It will play locally when complete.",
        "original_url": original_url,
        "file": f"/{local_path}"
    })

# ----------------------------------------------
# VLC STATUS ROUTE (API)
# ----------------------------------------------
@app.route("/vlc_status")
def get_vlc_status():
    logging.info("status")
    return jsonify(vlc_status())

# Route to handle VLC commands
@app.route('/vlc_command', methods=['POST'])
def vlc_command():
    logging.info('sendddd')
    data = request.get_json()
    command = data.get('command')
    logging.info(f"Sending {command}")
    if not command:
        return jsonify({'error': 'No command provided'}), 400

    # Send command as you do today
    response = send_vlc_command2(command)
    
    if 'episode' in command:
        logging.info(f"Received command {command}")
        parts = command.split()
        if len(parts) == 2:
            CURRENT_MEDIA["type"] = parts[0]   # "episode"
            CURRENT_MEDIA["id"] = int(parts[1])  # convert "1234" to integer
        logging.info(f"Updated Media {CURRENT_MEDIA}")

        
    # If pausing or stopping, record progress (only if we know what's playing)
    if command in {'pause', 'stop'}:# and CURRENT_MEDIA["type"] == "episode" and CURRENT_MEDIA["id"]:
        try:
            logging.info(f"Update watched status for {CURRENT_MEDIA}")
            s = vlc_status()  # {'elapsed':sec, 'total':sec, ...}
            if isinstance(s, dict) and "elapsed" in s and "total" in s and s["total"]:
                pct = min(int((s["elapsed"] / s["total"]) * 100), 100)
                elapsed_ms = int(s["elapsed"] * 1000)
                upsert_watched_progress(CURRENT_MEDIA["id"], pct, elapsed_ms)
        except Exception as e:
            app.logger.warning(f"Failed to auto-save watch progress: {e}")

    return jsonify({'message': response})

def updateWatched():
    try:
        logging.info(f"Update watched status for {CURRENT_MEDIA}")
        s = vlc_status()  # {'elapsed':sec, 'total':sec, ...}
        if isinstance(s, dict) and "elapsed" in s and "total" in s and s["total"]:
            pct = min(int((s["elapsed"] / s["total"]) * 100), 100)
            elapsed_ms = int(s["elapsed"] * 1000)
            upsert_watched_progress(CURRENT_MEDIA["id"], pct, elapsed_ms)
    except Exception as e:
        app.logger.warning(f"Failed to auto-save watch progress: {e}")

# Add route to update watched data
@app.route("/update_watch_progress", methods=["POST"])
def update_watch_progress():
    logging.info("update watch progress")
    data = request.get_json()
    episode_id = data.get("episode_id")
    elapsed = data.get("elapsed_time")
    duration = data.get("total_duration")
    media_type = (data.get("media_type") or "").strip().lower()
    media_id = data.get("media_id")

    if not episode_id or elapsed is None or duration is None or duration == 0:
        return jsonify({"status": "error", "message": "Invalid data"}), 400

    pct = int((elapsed / duration) * 100)
    pct = min(pct, 100)
    elapsed = elapsed * 1000

    upsert_watched_progress(episode_id, pct, elapsed)
    if media_type in {"movie", "series"} and media_id:
        upsert_recent_media({
            "media_type": media_type,
            "media_id": str(media_id),
            "episode_id": str(episode_id),
            "tmdb_id": data.get("tmdb_id"),
            "title": data.get("title"),
            "subtitle": data.get("subtitle"),
            "overview": data.get("overview"),
            "poster_url": data.get("poster_url"),
            "backdrop_url": data.get("backdrop_url"),
            "container_extension": data.get("container_extension"),
            "elapsed_time": elapsed,
            "watched_pct": pct
        })
    logging.info("Commit watch status to db")

    logging.info(f"Updated watch progress: {episode_id} - {pct}% at {elapsed}s")
    return jsonify({"status": "success"})

@app.route('/get_plot/<tmdb_id>')
def get_plot(tmdb_id):
    # Build a stable full URL so our existing http_cache can key it reliably
    base = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
    qs = urlencode({"api_key": TMDB_API_KEY, "language": "en-US"})
    full_url = f"{base}?{qs}"

    # Cache for ~30 days; falls back to stale if TMDB is down (per get_json_cached behavior)
    THIRTY_DAYS = 60 * 60 * 24 * 30
    try:
        data = get_json_cached(full_url, ttl_seconds=THIRTY_DAYS, default={})
    except Exception:
        data = {}

    return jsonify({
        "title": data.get("title"),
        "overview": data.get("overview")
    })

    
# ----------------------------------------------
# VLC STATUS FUNCTION
# ----------------------------------------------
def vlc_status():
    try:
        logging.info("VLC status - update last watched")
        #updateWatched()
        #update_watch_progress()
        logging.info("Get VLC Status")
        state, elapsed, total, p_title = None, None, None, None

        vlc_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        vlc_socket.settimeout(2)
        vlc_socket.connect((VLC_HOST, VLC_PORT))

        vlc_socket.sendall(b"status\n")
        time.sleep(0.1)
        response = vlc_socket.recv(4096).decode("utf-8")

        vlc_socket.sendall(b"get_time\n")
        time.sleep(0.1)
        s_elapsed = vlc_socket.recv(4096).decode("utf-8")

        vlc_socket.sendall(b"get_length\n")
        time.sleep(0.1)
        s_total = vlc_socket.recv(4096).decode("utf-8")
        logging.info(f"elapsed= {s_elapsed}")
        logging.info(f"total= {s_total}")
        elapsed = int(''.join(filter(str.isdigit, s_elapsed)))
        total = int(''.join(filter(str.isdigit, s_total)))

        for line in response.split("\n"):
            if "state" in line:
                state = line.split(":")[-1].strip()
                if state == "unknown":
                    state = None
            elif "new input" in line:
                p_title = line.replace("new input: ", "")

        remaining = total - elapsed if total and elapsed else None

        return {
            "playing": p_title,
            "state": state or "stopped",
            "elapsed": elapsed,
            "total": total,
            "remaining": remaining
        }
    except Exception as e:
        logging.error(f"Failed to connect to VLC: {e}")
        return {"error": f"Failed to connect to VLC: {e}"}

# ----------------------------------------------
# Cache admin endpoints (optional)
# ----------------------------------------------
@app.route("/cache/clear", methods=["POST"])
def cache_clear():
    conn = sqlite3.connect("database.db")
    conn.execute("PRAGMA journal_mode=WAL;")
    c = conn.cursor()
    c.execute("DELETE FROM http_cache")
    conn.commit()
    conn.close()
    try:
        for fn in os.listdir(CACHE_DIR):
            if fn.endswith(".json"):
                os.remove(os.path.join(CACHE_DIR, fn))
    except Exception as e:
        logging.warning(f"Cache mirror cleanup failed: {e}")
    return jsonify({"status": "ok", "message": "cache cleared"})

@app.route("/cache/refresh", methods=["POST"])
def cache_refresh():
    targets = [
        MOVIE_API,
        SERIES_API,
        VOD_CATS,
        # add hot categories/series if you like
    ]
    refreshed = []
    for url in targets:
        try:
            txt = _fetch_json(url)
            _cache_set(url, txt)
            refreshed.append(url)
        except Exception as e:
            logging.warning(f"Failed to refresh {url}: {e}")
    return jsonify({"status": "ok", "refreshed": refreshed})

# ----------------------------------------------
# Background refresher (hourly)
# ----------------------------------------------
def _background_refresher():
    while True:
        try:
            for url in [MOVIE_API, SERIES_API, VOD_CATS]:
                try:
                    txt = _fetch_json(url)
                    _cache_set(url, txt)
                    logging.info(f"[REFRESHER] Updated cache for {url}")
                except Exception as e:
                    logging.warning(f"[REFRESHER] {url} failed: {e}")
        finally:
            time.sleep(CACHE_TTL_SECONDS)  # ~1 hour

# ------------------------------------------------------------------------------
# RUN
# ------------------------------------------------------------------------------
if __name__ == "__main__":
    logging.info("Starting app")
    init_db()

    # Avoid starting the refresher twice when debug reloader is on
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not app.debug:
        t = threading.Thread(target=_background_refresher, daemon=True)
        t.start()

    logging.info("Application startup complete.")
    app.run(host="0.0.0.0", port=5000, debug=True)
