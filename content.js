// content.js — runs on YouTube watch pages
// Extracts video ID and title, listens for messages from popup

function getVideoInfo() {
  const url = window.location.href;
  const match = url.match(/[?&]v=([^&]+)/);
  const videoId = match ? match[1] : null;
  const title = document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim()
    || document.title.replace(' - YouTube', '').trim()
    || 'Unknown Video';
  return { videoId, title, url };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getVideoInfo') {
    sendResponse(getVideoInfo());
  }
  return true;
});
