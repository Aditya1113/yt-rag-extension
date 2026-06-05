// background.js — RAG pipeline using local Python server for transcripts

const SERVER_URL = 'http://127.0.0.1:5000';

let vectorStore = {
  videoId: null,
  chunks: [],
  title: '',
};

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function chunkText(text, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

// ─── Transcript via local Python server ───────────────────────────────────────

async function fetchTranscript(videoId) {
  let res, text;
  try {
    res = await fetch(`${SERVER_URL}/transcript?video_id=${videoId}`);
  } catch {
    throw new Error('Cannot reach local server. Run: python server.py');
  }
  try {
    text = await res.text();
    if (!text || !text.trim()) throw new Error('empty');
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
    return data.transcript;
  } catch (e) {
    if (e.message === 'empty') throw new Error(`Server returned empty response (HTTP ${res.status}). Check terminal for errors.`);
    if (e.message.includes('JSON')) throw new Error(`Server returned non-JSON: ${(text||'').slice(0, 200)}`);
    throw e;
  }
}

// ─── OpenAI helpers ───────────────────────────────────────────────────────────

async function safeFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!text || !text.trim()) throw new Error(`Empty response (HTTP ${res.status})`);
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Non-JSON response: ${text.slice(0, 200)}`); }
  return { res, data };
}

async function getEmbedding(text, apiKey) {
  const { res, data } = await safeFetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  });
  if (!res.ok) throw new Error(data.error?.message || 'Embedding error');
  return data.data[0].embedding;
}

async function getBatchEmbeddings(texts, apiKey) {
  const { res, data } = await safeFetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!res.ok) throw new Error(data.error?.message || 'Embedding error');
  return data.data.map(d => d.embedding);
}

async function getChatCompletion(messages, apiKey) {
  const { res, data } = await safeFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.2, messages }),
  });
  if (!res.ok) throw new Error(data.error?.message || 'Chat error');
  return data.choices[0].message.content;
}

// ─── RAG pipeline ─────────────────────────────────────────────────────────────

async function indexVideo(videoId, title, apiKey, sendProgress) {
  sendProgress('Fetching transcript…');
  const transcript = await fetchTranscript(videoId);

  sendProgress('Splitting into chunks…');
  const texts = chunkText(transcript, 1000, 200);

  sendProgress(`Embedding ${texts.length} chunks…`);
  const embeddings = await getBatchEmbeddings(texts, apiKey);

  vectorStore = {
    videoId, title,
    chunks: texts.map((text, i) => ({ text, embedding: embeddings[i] })),
  };

  sendProgress('Ready!');
  return texts.length;
}

async function answerQuestion(question, apiKey) {
  const qEmbedding = await getEmbedding(question, apiKey);
  const scored = vectorStore.chunks
    .map(chunk => ({ text: chunk.text, score: cosineSimilarity(qEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const context = scored.map(s => s.text).join('\n\n');
  const systemPrompt = `You are a helpful assistant answering questions about a YouTube video titled "${vectorStore.title}". Answer ONLY from the transcript context. If insufficient, say so honestly.`;

  return getChatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Transcript context:\n\n${context}\n\nQuestion: ${question}` },
  ], apiKey);
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'indexVideo') {
    const { videoId, title, apiKey } = request;
    const sendProgress = (msg) => chrome.storage.session.set({ indexProgress: msg });
    indexVideo(videoId, title, apiKey, sendProgress)
      .then(chunkCount => sendResponse({ success: true, chunkCount }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'askQuestion') {
    const { question, apiKey } = request;
    if (!vectorStore.videoId) {
      sendResponse({ success: false, error: 'No video indexed yet.' });
      return true;
    }
    answerQuestion(question, apiKey)
      .then(answer => sendResponse({ success: true, answer }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'getStoreInfo') {
    sendResponse({ videoId: vectorStore.videoId, title: vectorStore.title, chunkCount: vectorStore.chunks.length });
    return true;
  }
});