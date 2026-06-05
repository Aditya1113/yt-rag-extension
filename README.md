# YouTube RAG Chat — Chrome Extension

A Chrome extension that lets you chat with any YouTube video using AI. Ask it to summarise, explain, or answer any question about the video's content — powered by Retrieval-Augmented Generation (RAG).

![Demo](https://img.shields.io/badge/status-active-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## How It Works

The pipeline mirrors a LangChain RAG notebook, running entirely in the browser + a lightweight local server:

```
YouTube video
     │
     ▼
Local Python server (YouTubeTranscriptApi)
     │  fetches transcript
     ▼
Text chunking (1000 chars, 200 overlap)
     │
     ▼
OpenAI Embeddings (text-embedding-3-small)
     │  embeds each chunk
     ▼
In-memory vector store
     │  cosine similarity search (top 4 chunks)
     ▼
GPT-4o-mini
     │  answers grounded in transcript context
     ▼
Response in popup chat UI
```

---

## Features

- 🎬 Works on any YouTube video with captions
- 💬 Chat interface with typing indicators and message history
- ⚡ Quick-action chips: Summarise, Key topics, Takeaways, Chapters
- 🔒 API keys stored locally in Chrome — never sent anywhere except OpenAI
- 🧠 Answers strictly from the transcript — no hallucination outside the video

---

## Prerequisites

- Python 3.8+
- An [OpenAI API key](https://platform.openai.com/api-keys)
- Google Chrome

---

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/your-username/yt-rag-extension.git
cd yt-rag-extension
```

### 2. Install Python dependencies

```bash
pip install "youtube-transcript-api>=1.0.0" flask flask-cors
```

### 3. Start the local server

```bash
python server.py
```

You should see:
```
✓ Server running at http://localhost:5000
```

Keep this terminal open while using the extension.

### 4. Load the Chrome extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `yt-rag-extension` folder
5. The extension icon appears in your toolbar

---

## Usage

1. Open any YouTube video
2. Click the extension icon
3. Enter your **OpenAI API key** and click **Save**
4. Click **LOAD VIDEO** — the extension fetches and indexes the transcript
5. Once you see `✓ Indexed N chunks`, start asking questions!

### Example questions

- *Summarise this video in 3 bullet points*
- *What are the main topics discussed?*
- *What did they say about X?*
- *Are there any timestamps or chapters mentioned?*

---

## Project Structure

```
yt-rag-extension/
├── manifest.json       # Chrome extension config (Manifest V3)
├── background.js       # Service worker: RAG pipeline, OpenAI calls
├── content.js          # Injected on YouTube pages: extracts video ID + title
├── popup.html          # Chat UI markup
├── popup.js            # Chat UI logic
├── server.py           # Local Flask server: fetches YouTube transcripts
└── icons/              # Extension icons
```

### Architecture

| Component | Role |
|---|---|
| `content.js` | Reads video ID and title from the active YouTube tab |
| `popup.js` | Manages UI state, sends messages to background worker |
| `background.js` | Calls local server for transcript, chunks text, embeds with OpenAI, does cosine similarity retrieval, calls GPT-4o-mini |
| `server.py` | Thin Flask wrapper around `YouTubeTranscriptApi` — needed because YouTube blocks direct API calls from browser contexts |

---

## Why a Local Server?

YouTube actively blocks programmatic transcript requests made directly from browser extension contexts (CORS, IP detection, missing tokens). The local Python server acts as a trusted intermediary — `YouTubeTranscriptApi` handles all the complexity of fetching transcripts reliably.

> **Note:** YouTube occasionally rate-limits or blocks IPs temporarily. If you get a 403 error, try a different video or wait a few hours. Restarting your router (to get a fresh IP) also helps.

---

## RAG Pipeline Details

| Step | Implementation |
|---|---|
| Transcript fetch | `YouTubeTranscriptApi().fetch(video_id)` |
| Chunking | Fixed-size: 1000 chars, 200 char overlap |
| Embedding model | `text-embedding-3-small` |
| Vector store | In-memory cosine similarity (resets on extension reload) |
| Retrieval | Top-4 chunks by cosine similarity |
| Generation model | `gpt-4o-mini` (temperature 0.2) |
| Context window | Transcript chunks only — no external knowledge |

---

## Troubleshooting

**"Cannot reach local server"**
→ Make sure `python server.py` is running in a terminal.

**403 error on transcript fetch**
→ YouTube has temporarily blocked your IP. Try a different video, restart your router, or wait a few hours.

**"No video detected"**
→ Make sure you're on a `youtube.com/watch?v=...` page and the page has fully loaded.

**Extension not detecting the video**
→ Reload the YouTube tab, then reopen the extension popup.

---

## Cost Estimate

Using `text-embedding-3-small` + `gpt-4o-mini`:

| Action | Approx. cost |
|---|---|
| Index a 10-min video (~30 chunks) | ~$0.0005 |
| Index a 60-min video (~120 chunks) | ~$0.002 |
| Each question asked | ~$0.001 |

---

## Limitations

- Transcript is stored **in-memory** — reloading the extension requires re-indexing the video
- Only works on videos with captions/subtitles enabled
- YouTube may temporarily block transcript fetching from your IP

---

## License

MIT
