// popup.js

let currentVideoId = null;
let currentTabId   = null;
let currentTitle   = '';
let isIndexed      = false;
let isLoading      = false;
let apiKey         = '';

const videoLabel    = document.getElementById('videoLabel');
const videoIdDisplay= document.getElementById('videoIdDisplay');
const statusDot     = document.getElementById('statusDot');
const apiKeyInput   = document.getElementById('apiKeyInput');
const saveApiBtn    = document.getElementById('saveApiBtn');
const loadBtn       = document.getElementById('loadBtn');
const progressMsg   = document.getElementById('progressMsg');
const chatArea      = document.getElementById('chatArea');
const emptyState    = document.getElementById('emptyState');
const suggestions   = document.getElementById('suggestions');
const questionInput = document.getElementById('questionInput');
const sendBtn       = document.getElementById('sendBtn');

async function init() {
  const stored = await chrome.storage.local.get(['openaiApiKey']);
  if (stored.openaiApiKey) { apiKey = stored.openaiApiKey; apiKeyInput.value = '•'.repeat(20); }
  await detectVideo();
  chrome.runtime.sendMessage({ action: 'getStoreInfo' }, (info) => {
    if (info?.videoId && info.videoId === currentVideoId) markReady(info.title, info.chunkCount);
  });
}

async function detectVideo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('youtube.com/watch')) {
    videoLabel.textContent = 'Open a YouTube video tab';
    videoIdDisplay.textContent = 'No YouTube video detected';
    return;
  }
  try {
    const info = await chrome.tabs.sendMessage(tab.id, { action: 'getVideoInfo' });
    if (info?.videoId) {
      currentVideoId = info.videoId;
      currentTabId   = tab.id;
      currentTitle   = info.title;
      videoLabel.textContent = truncate(info.title, 40);
      videoIdDisplay.textContent = `Video ID: ${info.videoId}`;
      loadBtn.disabled = !apiKey;
    }
  } catch {
    videoLabel.textContent = 'Page still loading…';
    videoIdDisplay.textContent = 'Refresh and try again';
  }
}

function truncate(str, n) { return str.length > n ? str.slice(0, n) + '…' : str; }

saveApiBtn.addEventListener('click', async () => {
  const raw = apiKeyInput.value.trim();
  if (!raw || raw.startsWith('•')) return;
  apiKey = raw;
  await chrome.storage.local.set({ openaiApiKey: raw });
  apiKeyInput.value = '•'.repeat(20);
  saveApiBtn.textContent = '✓ Saved';
  setTimeout(() => { saveApiBtn.textContent = 'Save'; }, 2000);
  if (currentVideoId) loadBtn.disabled = false;
});

loadBtn.addEventListener('click', async () => {
  if (!currentVideoId || !apiKey || isLoading) return;
  isLoading = true;
  loadBtn.disabled = true;
  statusDot.className = 'status-dot loading';
  progressMsg.textContent = 'Starting…';

  const pollInterval = setInterval(async () => {
    const { indexProgress } = await chrome.storage.session.get(['indexProgress']);
    if (indexProgress) progressMsg.textContent = indexProgress;
  }, 500);

  chrome.runtime.sendMessage(
    { action: 'indexVideo', videoId: currentVideoId, title: currentTitle, apiKey },
    (response) => {
      clearInterval(pollInterval);
      isLoading = false;
      if (response.success) {
        markReady(currentTitle, response.chunkCount);
      } else {
        statusDot.className = 'status-dot';
        progressMsg.textContent = `Error: ${response.error}`;
        loadBtn.disabled = false;
      }
    }
  );
});

function markReady(title, chunkCount) {
  isIndexed = true;
  statusDot.className = 'status-dot ready';
  progressMsg.textContent = `✓ Indexed ${chunkCount} chunks`;
  loadBtn.textContent = 'RELOAD';
  loadBtn.disabled = false;
  questionInput.disabled = false;
  sendBtn.disabled = false;
  questionInput.focus();
  emptyState.querySelector('p').textContent = `Ready! Ask anything about "${truncate(title, 30)}"`;
  suggestions.style.display = 'flex';
}

function addMessage(role, content, isError = false) {
  if (emptyState?.parentNode === chatArea) emptyState.remove();
  const msg = document.createElement('div');
  msg.className = `message ${role}`;
  const sender = document.createElement('div');
  sender.className = 'sender';
  sender.textContent = role === 'user' ? 'YOU' : 'AI';
  const bubble = document.createElement('div');
  bubble.className = `bubble${isError ? ' error' : ''}`;
  bubble.textContent = content;
  msg.appendChild(sender);
  msg.appendChild(bubble);
  chatArea.appendChild(msg);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function addTypingIndicator() {
  const msg = document.createElement('div');
  msg.className = 'message ai';
  msg.id = 'typing';
  const sender = document.createElement('div');
  sender.className = 'sender';
  sender.textContent = 'AI';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  msg.appendChild(sender);
  msg.appendChild(bubble);
  chatArea.appendChild(msg);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function removeTypingIndicator() { document.getElementById('typing')?.remove(); }

async function sendQuestion(question) {
  if (!question.trim() || !isIndexed || isLoading) return;
  addMessage('user', question);
  addTypingIndicator();
  questionInput.value = '';
  questionInput.disabled = true;
  sendBtn.disabled = true;
  chrome.runtime.sendMessage({ action: 'askQuestion', question, apiKey }, (response) => {
    removeTypingIndicator();
    questionInput.disabled = false;
    sendBtn.disabled = false;
    questionInput.focus();
    if (response.success) addMessage('ai', response.answer);
    else addMessage('ai', `Error: ${response.error}`, true);
  });
}

sendBtn.addEventListener('click', () => sendQuestion(questionInput.value));
questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuestion(questionInput.value); }
});
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => { if (isIndexed) sendQuestion(chip.dataset.q); });
});

init();