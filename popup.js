if (!serverStatusBanner) return;
  
  serverStatusBanner.style.maxHeight = '200px';
  serverStatusBanner.style.opacity = '1';
  serverStatusBanner.style.padding = '8px 12px';
  
  // Set banner color based on status
  if (status === 'ERROR' || status === 'DISCONNECTED') {
    serverStatusBanner.style.background = 'var(--red-dim)';
    serverStatusBanner.style.borderColor = 'var(--red)';
    serverStatusBanner.style.color = 'var(--red)';
  } else if (status === 'RECONNECTING') {
    serverStatusBanner.style.background = 'var(--warning-dim)';
    serverStatusBanner.style.borderColor = 'var(--warning)';
    serverStatusBanner.style.color = 'var(--warning)';
  } else if (status === 'INSTRUCTIONS') {
    serverStatusBanner.style.background = 'var(--accent-dim)';
    serverStatusBanner.style.borderColor = 'var(--accent)';
    serverStatusBanner.style.color = 'var(--text)';
  }
  
  if (serverStatusText) {
    serverStatusText.innerHTML = message;
  }
  
  // Show/configure retry button based on recovery action
  if (retryServerBtn) {
    if (recovery) {
      retryServerBtn.style.display = 'inline-block';
      retryServerBtn.textContent = recovery.text || 'Retry';
      retryServerBtn.onclick = () => handleRecoveryAction(recovery.action, recovery.errorCode);
    } else if (status === 'RECONNECTING') {
      retryServerBtn.style.display = 'none';
    } else {
      retryServerBtn.style.display = 'inline-block';
      retryServerBtn.textContent = 'Retry';
      retryServerBtn.onclick = () => attemptManualReconnect();
    }
  }
}

// Replace the existing showServerBanner function body
// popup.js

let currentVideoId = null;
let currentTabId   = null;
let currentTitle   = '';
let isIndexed      = false;
let isLoading      = false;
let apiKey         = '';
let serverConnected = false;
let healthCheckRetryCount = 0;
const MAX_HEALTH_CHECK_RETRIES = 3;
const HEALTH_CHECK_RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

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
const serverStatusBanner = document.getElementById('serverStatusBanner');
const serverStatusText = document.getElementById('serverStatusText');
const retryServerBtn = document.getElementById('retryServerBtn');
const serverIndicator = document.getElementById('serverIndicator');
let lastServerInfo = null;
let reconnectInProgress = false;
let connectionStatusInterval = null;
let lastKnownServerStatus = null;

/**
 * Get recovery action based on error code
 */
function getRecoveryAction(errorCode) {
  const actions = {
    'CONNECTION_REFUSED': { text: 'Start Server', action: 'showStartInstructions', icon: '🚀' },
    'SERVER_UNREACHABLE': { text: 'Start Server', action: 'showStartInstructions', icon: '🚀' },
    'SERVER_TIMEOUT': { text: 'Retry', action: 'retry', icon: '🔄' },
    'SERVER_OVERLOADED': { text: 'Wait & Retry', action: 'waitAndRetry', icon: '⏳' },
    'SERVER_UNAVAILABLE': { text: 'Retry', action: 'retry', icon: '🔄' },
    'GATEWAY_ERROR': { text: 'Retry', action: 'retry', icon: '🔄' },
    'SERVER_ERROR': { text: 'Retry', action: 'retry', icon: '🔄' },
    'RATE_LIMITED': { text: 'Wait', action: 'waitAndRetry', icon: '⏳' },
    'NETWORK_DISCONNECTED': { text: 'Check Network', action: 'checkNetwork', icon: '📡' },
    'DNS_RESOLUTION_FAILED': { text: 'Troubleshoot', action: 'showDNSHelp', icon: '🔧' },
    'CONNECTION_RESET': { text: 'Reconnect', action: 'reconnect', icon: '🔌' },
    'CONNECTION_CLOSED': { text: 'Reconnect', action: 'reconnect', icon: '🔌' },
    'SSL_ERROR': { text: 'Help', action: 'showSSLHelp', icon: '🔒' },
    'CORS_ERROR': { text: 'Help', action: 'showCORSHelp', icon: '⚠️' },
    'MAX_RECONNECT_ATTEMPTS': { text: 'Manual Retry', action: 'manualRetry', icon: '🔄' },
    'UNKNOWN_ERROR': { text: 'Retry', action: 'retry', icon: '🔄' }
  };
  
  return actions[errorCode] || { text: 'Retry', action: 'retry', icon: '🔄' };
}

function handleRecoveryAction(action, errorCode) {
  // Disable retry button during action
  if (retryServerBtn) {
    retryServerBtn.disabled = true;
    retryServerBtn.textContent = 'Working...';
  }
  
  switch (action) {
    case 'showStartInstructions':
      showStartServerInstructions();
      if (retryServerBtn) {
        retryServerBtn.disabled = false;
        retryServerBtn.textContent = 'Retry Connection';
      }
      break;
    case 'retry':
case 'manualRetry':
      attemptManualReconnect();
      break;
    case 'waitAndRetry':
      showWaitAndRetryUI(errorCode);
      break;

    case 'checkNetwork':
      showNetworkTroubleshooting();
      if (retryServerBtn) {
        retryServerBtn.disabled = false;
        retryServerBtn.textContent = 'Retry';
      }
      break;
    case 'reconnect':
      attemptManualReconnect();
      break;
    case 'showDNSHelp':
      showDNSTroubleshooting();
      if (retryServerBtn) {
        retryServerBtn.disabled = false;
        retryServerBtn.textContent = 'Retry';
      }
      break;
    case 'showSSLHelp':
      showSSLTroubleshooting();
      if (retryServerBtn) {
        retryServerBtn.disabled = false;
        retryServerBtn.textContent = 'Retry';
      }
      break;
    case 'showCORSHelp':
      showCORSTroubleshooting();
      if (retryServerBtn) {
        retryServerBtn.disabled = false;
        retryServerBtn.textContent = 'Retry';
      }
      break;
    default:
      attemptManualReconnect();
  }
}

/**
 * Show wait and retry UI with countdown
 */
function showWaitAndRetryUI(errorCode) {
  const waitTime = errorCode === 'RATE_LIMITED' ? 30 : 5;
  let remaining = waitTime;
  
  const updateCountdown = () => {
    if (serverStatusText) {
      serverStatusText.innerHTML = `⏳ Waiting ${remaining}s before retry...`;
    }
    if (retryServerBtn) {
      retryServerBtn.textContent = `Retry in ${remaining}s`;
      retryServerBtn.disabled = true;
    }
  };
  
  updateCountdown();
  
  const countdownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      attemptManualReconnect();
    } else {
      updateCountdown();
    }
  }, 1000);
}

/**
 * Show DNS troubleshooting help
 */
function showDNSTroubleshooting() {
  showServerBanner(
    'INSTRUCTIONS',
    `<strong>🔧 DNS Resolution Failed</strong><br><br>
    The server hostname could not be resolved.<br><br>
    <strong>Try these steps:</strong><br>
    1. Check your internet connection<br>
    2. Try flushing DNS cache<br>
    3. Restart your router<br>
    4. Try using 127.0.0.1 instead of localhost`,
    { text: 'Retry', action: 'retry' }
  );
}

/**
 * Show SSL troubleshooting help
 */
function showSSLTroubleshooting() {
  showServerBanner(
    'INSTRUCTIONS',
    `<strong>🔒 SSL/TLS Error</strong><br><br>
    There was a certificate or SSL error.<br><br>
    <strong>Note:</strong> The local server uses HTTP (not HTTPS).<br>
    Make sure you're connecting to:<br>
    <code>http://127.0.0.1:5000</code>`,
    { text: 'Retry', action: 'retry' }
  );
}

/**
 * Show CORS troubleshooting help
 */
function showCORSTroubleshooting() {
  showServerBanner(
    'INSTRUCTIONS',
    `<strong>⚠️ CORS Error</strong><br><br>
    Cross-origin request was blocked.<br><br>
    <strong>Make sure:</strong><br>
    1. You're running the correct server.py<br>
    2. Flask-CORS is installed: <code>pip install flask-cors</code><br>
    3. Restart the server after installing`,
    { text: 'Retry', action: 'retry' }
  );
}
    case 'manualRetry':
      attemptManualReconnect();
      break;
    case 'waitAndRetry':
      showWaitAndRetryUI(errorCode);
      break;

/**
 * Handle recovery actions based on error type
 */
function handleRecoveryAction(action, errorCode) {
  switch (action) {
    case 'showStartInstructions':
      showStartServerInstructions();
      break;
    case 'retry':
    case 'manualRetry':
      attemptManualReconnect();
      break;
    case 'reconnect':
      attemptManualReconnect();
      break;
    case 'checkNetwork':
      showNetworkTroubleshooting();
      break;
    case 'showDNSHelp':
      showDNSTroubleshooting();
      break;
    default:
      attemptManualReconnect();
  }
}

/**
 * Show instructions for starting the server
 */
function showStartServerInstructions() {
  showServerBanner(
    'INSTRUCTIONS',
    `<strong>🚀 Server Not Running</strong><br><br>
    <strong>Step 1:</strong> Open a terminal in the extension folder<br><br>
    <strong>Step 2:</strong> Install dependencies (first time only):<br>
    <code style="background: var(--surface2); padding: 4px 8px; border-radius: 4px; display: inline-block; margin: 4px 0; font-size: 11px;">pip install flask flask-cors "youtube-transcript-api>=1.0.0"</code><br><br>
    <strong>Step 3:</strong> Start the server:<br>
    <code style="background: var(--surface2); padding: 4px 8px; border-radius: 4px; display: inline-block; margin: 4px 0; font-size: 11px;">python server.py</code><br><br>
    <span style="color: var(--text-dim); font-size: 10px;">Server should show: "Running on http://127.0.0.1:5000"</span>`,
    { text: 'Retry Connection', action: 'retry' }
  );
}

/**
 * Show network troubleshooting tips
 */
function showNetworkTroubleshooting() {
  const isOffline = !navigator.onLine;
  
  if (isOffline) {
    showServerBanner(
      'ERROR',
      `<strong>📡 No Internet Connection</strong><br><br>
      Your device appears to be offline.<br><br>
      <strong>Please check:</strong><br>
      • WiFi or ethernet is connected<br>
      • Airplane mode is off<br>
      • Router is working properly<br><br>
      <span style="color: var(--text-dim); font-size: 10px;">The extension will auto-retry when connection is restored.</span>`,
      { text: 'Retry', action: 'retry' }
    );
  } else {
    showServerBanner(
      'INSTRUCTIONS',
      `<strong>📡 Network Issue Detected</strong><br><br>
      Your internet is connected but the server is unreachable.<br><br>
      <strong>Please check:</strong><br>
      • The Python server is running<br>
      • No firewall is blocking port 5000<br>
      • Antivirus isn't blocking localhost<br>
      • Try: <code>curl http://127.0.0.1:5000/ping</code>`,
      { text: 'Retry', action: 'retry' }
    );
  }
}

/**
 * Show DNS troubleshooting tips
 */
function showDNSTroubleshooting() {
  showTemporaryNotification('Try using 127.0.0.1 instead of localhost, or flush DNS cache', 'warning');
}

/**
 * Show temporary notification
 */
function showTemporaryNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `temp-notification temp-notification-${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Trigger animation
  requestAnimationFrame(() => {
    notification.classList.add('visible');
  });
  
  setTimeout(() => {
    notification.classList.remove('visible');
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

/**
 * Update retry progress in banner
 */
function updateRetryProgress(attempt, maxAttempts, nextDelay) {
  const progressText = document.getElementById('retryProgressText');
  if (progressText) {
    progressText.textContent = `Retrying... (${attempt}/${maxAttempts})`;
    progressText.style.display = 'block';
  }
}

/**
 * Handle recovery action button click
 */
async function handleRecoveryAction(action) {
  switch (action) {
    case 'retry':
      healthCheckRetryCount = 0;
      await checkServerConnectionWithRetry();
      break;
    case 'reconnect':
      await attemptManualReconnect();
      break;
    case 'showStartInstructions':
      showStartServerInstructions();
      break;
    case 'showDNSHelp':
      showDNSHelp();
      break;
    case 'checkNetwork':
      showNetworkHelp();
      break;
  }
}

/**
 * Attempt manual reconnection with UI feedback
 */
async function attemptManualReconnect() {
  showServerBanner('RECONNECTING', '🔄 Attempting to reconnect...');
  
  if (retryServerBtn) {
    retryServerBtn.disabled = true;
    retryServerBtn.textContent = 'Connecting...';
  }
  
  try {
    // First, reset the reconnection state in background
    await chrome.runtime.sendMessage({ action: 'resetReconnection' }).catch(() => {});
    
    const response = await chrome.runtime.sendMessage({ 
      action: 'checkServerHealth',
      options: { timeout: 8000 }
    });
    
    if (response?.success) {
      hideServerBanner();
      serverConnected = true;
      updateConnectionStatus(true);
      showTemporarySuccess('✅ Connected to server!');
    } else {
      const errorCode = response?.status?.lastError?.code || 'UNKNOWN_ERROR';
      const errorMessage = response?.status?.lastError?.message || 'Connection failed';
      const errorDetails = response?.status?.lastError?.details;
      const recovery = getRecoveryAction(errorCode);
      
      let displayMessage = `❌ ${errorMessage}`;
      if (errorDetails?.suggestion) {
        displayMessage += `<br><span style="color: var(--text-dim); font-size: 10px;">${errorDetails.suggestion}</span>`;
      }
      
      showServerBanner('ERROR', displayMessage, recovery);
      serverConnected = false;
      updateConnectionStatus(false);
    }
  } catch (error) {
    console.error('[Popup] Manual reconnect error:', error);
    showServerBanner(
      'ERROR', 
      `❌ Extension error: ${error.message}<br><span style="color: var(--text-dim); font-size: 10px;">Try reloading the extension</span>`, 
      { text: 'Retry', action: 'retry' }
    );
    serverConnected = false;
    updateConnectionStatus(false);
  } finally {
    if (retryServerBtn) {
      retryServerBtn.disabled = false;
    }
  }
}

/**
 * Show a temporary success message
 */
function showTemporarySuccess(message) {
  if (serverStatusBanner && serverStatusText) {
    serverStatusBanner.style.maxHeight = '60px';
    serverStatusBanner.style.opacity = '1';
    serverStatusBanner.style.padding = '8px 12px';
    serverStatusBanner.style.background = 'rgba(45, 255, 140, 0.12)';
    serverStatusBanner.style.borderColor = 'var(--success)';
    serverStatusBanner.style.color = 'var(--success)';
    serverStatusText.innerHTML = message;
    
    if (retryServerBtn) {
      retryServerBtn.style.display = 'none';
    }
    
    setTimeout(() => {
      hideServerBanner();
    }, 2000);
  }
}

/**
 * Send message to background script with timeout
 */
function sendMessageWithTimeout(message, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Message timeout - extension may need to be reloaded'));
    }, timeout);
    
    try {
      chrome.runtime.sendMessage(message, (response) => {
        clearTimeout(timeoutId);
        
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response || { success: false, error: 'No response received' });
        }
      });
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}

/**
 * Enable chat features when server is connected
 */
function enableChatFeatures() {
  if (questionInput) questionInput.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
  if (loadBtn) loadBtn.disabled = false;
}

/**
 * Disable chat features when server is disconnected
 */
function disableChatFeatures() {
  if (questionInput) {
    questionInput.disabled = true;
    questionInput.placeholder = 'Server disconnected...';
  }
  if (sendBtn) sendBtn.disabled = true;
}

/**
 * Check server status and update UI
 */
async function checkAndUpdateServerStatus() {
  try {
    const response = await sendMessageWithTimeout({ action: 'getServerStatus' }, 5000);
    
    if (response.success && response.status) {
      lastKnownServerStatus = response.status;
      serverConnected = response.status.isConnected;
      
      if (serverConnected) {
        updateServerStatus('connected');
        hideServerBanner();
        enableChatFeatures();
      } else {
        updateServerStatus('disconnected');
        disableChatFeatures();
        
        if (response.status.lastError) {
          const recovery = getRecoveryAction(response.status.lastError.code);
          showServerBanner(
            response.status.lastError.message || 'Server disconnected',
            'ERROR',
            recovery
          );
        }
      }
    }
  } catch (error) {
    console.warn('Failed to check server status:', error);
  }
}

/**
 * Listen for server status updates from background script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'serverStatusUpdate') {
    handleServerStatusUpdate(message.status, message.event, message);
  }
  return false;
});

/**
 * Handle server status updates from background script
 */
function handleServerStatusUpdate(status, event, fullMessage) {
  if (!status) return;
  
  serverConnected = status.isConnected;
  updateConnectionStatus(status.isConnected);
  
  if (status.isConnected) {
    if (event === 'reconnected') {
      showTemporarySuccess('✅ Reconnected to server!');
    } else {
      hideServerBanner();
    }
  } else if (status.isReconnecting) {
    const attempt = status.reconnectAttempt || 1;
    const max = status.maxReconnectAttempts || 5;
    const nextRetry = status.nextRetryIn ? Math.ceil(status.nextRetryIn / 1000) : '?';
    
    showServerBanner(
      'RECONNECTING',
      `🔄 Reconnecting... (attempt ${attempt}/${max})<br><span style="color: var(--text-dim); font-size: 10px;">Next retry in ${nextRetry}s</span>`
    );
  } else if (status.lastError) {
    const errorCode = status.lastError.code || 'UNKNOWN_ERROR';
    const errorMessage = status.lastError.message || 'Connection failed';
    const recovery = getRecoveryAction(errorCode);
    
    let displayMessage = `❌ ${errorMessage}`;
    if (status.consecutiveFailures > 1) {
      displayMessage += `<br><span style="color: var(--text-dim); font-size: 10px;">Failed ${status.consecutiveFailures} times</span>`;
    }
    
    showServerBanner('ERROR', displayMessage, recovery);
  }
}); else {
      serverConnected = false;
      updateServerStatus('disconnected');
      const errorCode = response.lastError?.errorCode || 'SERVER_UNREACHABLE';
      showServerBanner(
        `Reconnection failed after ${response.attempts} attempts`,
        errorCode,
        getRecoveryAction(errorCode)
      );
    }
  } catch (error) {
    serverConnected = false;
    updateServerStatus('disconnected');
    showServerBanner('Reconnection failed', 'EXTENSION_ERROR', { text: 'Retry', action: 'retry' });
  } finally {
    reconnectInProgress = false;
  }
}

/**
 * Show instructions for starting the server
 */
function showStartServerInstructions() {
  const modal = document.createElement('div');
  modal.className = 'help-modal';
  modal.innerHTML = `
    <div class="help-modal-content">
      <h3>Start the Server</h3>
      <p>Open a terminal and run:</p>
      <code>python server.py</code>
      <p class="help-note">Make sure you have the required packages installed:</p>
      <code>pip install flask flask-cors youtube-transcript-api</code>
      <button class="help-modal-close">Got it</button>
    </div>
  `;
  document.body.appendChild(modal);
  
  modal.querySelector('.help-modal-close').addEventListener('click', () => {
    modal.remove();
    checkServerConnectionWithRetry();
  });
}

/**
 * Show DNS troubleshooting help
 */
function showDNSHelp() {
  const modal = document.createElement('div');
  modal.className = 'help-modal';
  modal.innerHTML = `
    <div class="help-modal-content">
      <h3>DNS Resolution Issue</h3>
      <p>The extension cannot resolve 'localhost'. Try these steps:</p>
      <ol>
        <li>Check your hosts file includes: <code>127.0.0.1 localhost</code></li>
        <li>Try accessing <a href="http://127.0.0.1:5000/health" target="_blank">http://127.0.0.1:5000/health</a> directly</li>
        <li>Restart your network adapter</li>
      </ol>
      <button class="help-modal-close">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
  
  modal.querySelector('.help-modal-close').addEventListener('click', () => modal.remove());
}

/**
 * Show network troubleshooting help
 */
function showNetworkHelp() {
  const modal = document.createElement('div');
  modal.className = 'help-modal';
  modal.innerHTML = `
    <div class="help-modal-content">
      <h3>Network Connection Issue</h3>
      <p>Please check your internet connection:</p>
      <ol>
        <li>Verify you're connected to the internet</li>
        <li>Try opening a website in your browser</li>
        <li>Check if a VPN or firewall is blocking local connections</li>
      </ol>
      <button class="help-modal-close">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
  
  modal.querySelector('.help-modal-close').addEventListener('click', () => modal.remove());
}

async function init() {
  const stored = await chrome.storage.local.get(['openaiApiKey']);
  if (stored.openaiApiKey) { apiKey = stored.openaiApiKey; apiKeyInput.value = '•'.repeat(20); }
  
  // Check server health on init with retry logic
  await checkServerConnectionWithRetry();
  
  // Listen for server status updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'serverStatusUpdate') {
      handleServerStatusUpdate(message.status, message.details);
    }
  });
  
  await detectVideo();
  chrome.runtime.sendMessage({ action: 'getStoreInfo' }, (info) => {
    if (info?.videoId && info.videoId === currentVideoId) markReady(info.title, info.chunkCount);
  });
}

/**
 * Handle server status updates from background script
 */
function handleServerStatusUpdate(status, details = null) {
  const wasConnected = serverConnected;
  
  if (status.isConnected && !wasConnected) {
    // Server came back online
    serverConnected = true;
    healthCheckRetryCount = 0;
    updateServerStatus('connected');
    hideServerBanner();
    updateLoadButtonState();
    
    // Show brief success notification
    showTemporaryNotification('Server connected', 'success');
    
    // Log server info if available
    if (status.serverInfo) {
      console.log('[Server Info]', status.serverInfo);
    }
  } else if (!status.isConnected && serverConnected) {
    // Server went offline
    serverConnected = false;
    updateServerStatus('disconnected');
    showServerBanner(status.lastError || 'Server connection lost');
    updateLoadButtonState();
  }
}

/**
 * Check server connection with exponential backoff retry
 */
async function checkServerConnectionWithRetry(options = {}) {
  const { maxRetries = MAX_HEALTH_CHECK_RETRIES, showProgress = true } = options;
  
  const result = await checkServerConnection();
  
  if (!result.success && healthCheckRetryCount < maxRetries) {
    const delay = HEALTH_CHECK_RETRY_DELAYS[healthCheckRetryCount] || 4000;
    healthCheckRetryCount++;
    
    if (showProgress) {
      updateRetryProgress(healthCheckRetryCount, maxRetries, delay);
    }
    
    await new Promise(resolve => setTimeout(resolve, delay));
    return checkServerConnectionWithRetry({ maxRetries, showProgress });
  }
  
  if (!result.success && healthCheckRetryCount >= maxRetries) {
    showServerBanner(
      'Could not connect after multiple attempts',
      result.errorCode || 'SERVER_UNREACHABLE',
      getRecoveryAction(result.errorCode)
    );
  }
  
  return result;
}

async function checkServerConnection() {
  try {
    updateServerStatus('checking');
    
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject({ error: 'Connection check timed out', errorCode: 'POPUP_TIMEOUT' });
      }, 8000); // Increased timeout for slower connections
      
      chrome.runtime.sendMessage({ action: 'checkHealth' }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject({ error: chrome.runtime.lastError.message, errorCode: 'EXTENSION_ERROR' });
        } else if (!response) {
          reject({ error: 'No response from background', errorCode: 'NO_RESPONSE' });
        } else {
          resolve(response);
        }
      });
    });
    
    if (response.success) {
      serverConnected = true;
      healthCheckRetryCount = 0;
      updateServerStatus('connected');
      hideServerBanner();
      
      // Store server info for diagnostics
      if (response.info) {
        lastServerInfo = response.info;
      }
      
      return { success: true, info: response.info };
    } else {
      serverConnected = false;
      updateServerStatus('disconnected');
      const errorCode = response.errorCode || 'SERVER_UNREACHABLE';
      showServerBanner(response.error, errorCode, getRecoveryAction(errorCode));
      return { success: false, error: response.error, errorCode };
    }
  } catch (error) {
    serverConnected = false;
    updateServerStatus('disconnected');
    const errorCode = error.errorCode || 'UNKNOWN';
    showServerBanner(error.error || error.message, errorCode, getRecoveryAction(errorCode));
    return { success: false, error: error.error || error.message, errorCode };
  }
}

/**
 * Get user-friendly error message based on error code
 */
function getErrorMessage(error, errorCode) {
  switch (errorCode) {
    case 'CONNECTION_REFUSED':
      return 'Server not running. Start with: python server.py';
    case 'SERVER_TIMEOUT':
      return 'Server is not responding. It may be overloaded or crashed.';
    case 'SERVER_UNREACHABLE':
      return 'Cannot reach server. Check your network connection.';
    case 'SERVER_HTTP_ERROR':
      return error || 'Server returned an error. Check the terminal for details.';
    case 'INVALID_RESPONSE':
      return 'Server returned an invalid response. It may need to be restarted.';
    case 'EXTENSION_ERROR':
      return 'Extension error. Try reloading the extension.';
    case 'NO_RESPONSE':
      return 'No response from extension. Try reloading the page.';
    case 'POPUP_TIMEOUT':
      return 'Connection check timed out. Server may be unresponsive.';
    case 'DNS_RESOLUTION_FAILED':
      return 'Cannot resolve localhost. Check your hosts file configuration.';
    case 'NETWORK_DISCONNECTED':
      return 'No internet connection. Please check your network.';
    case 'SSL_CERTIFICATE_ERROR':
      return 'SSL error. The server should use http://, not https://.';
    case 'SERVER_OVERLOADED':
      return 'Server is overloaded. Wait a moment and try again.';
    case 'CONNECTION_RESET':
      return 'Connection reset. The server may have crashed. Restart it.';
    case 'CONNECTION_CLOSED':
      return 'Connection closed. The server may be restarting.';
    case 'NETWORK_CHANGED':
      return 'Network changed. Please retry your request.';
    case 'ADDRESS_UNREACHABLE':
      return 'Server address unreachable. Check if port 5000 is correct.';
    case 'RECONNECTING':
      return 'Attempting to reconnect to server...';
    default:
      return error || 'Server not available';
  }
}

function updateServerStatus(status) {
  if (serverIndicator) {
    serverIndicator.className = `server-indicator ${status}`;
    
    const statusTitles = {
      'connected': 'Server connected',
      'disconnected': 'Server disconnected - Click to retry',
      'checking': 'Checking server connection...',
      'reconnecting': 'Attempting to reconnect...'
    };
    
    serverIndicator.title = statusTitles[status] || 'Unknown status';
    
    // Add click handler for disconnected state
    if (status === 'disconnected' && !serverIndicator.hasClickHandler) {
      serverIndicator.style.cursor = 'pointer';
      serverIndicator.addEventListener('click', () => {
        if (!serverConnected && !reconnectInProgress) {
          healthCheckRetryCount = 0;
          checkServerConnectionWithRetry();
        }
      });
      serverIndicator.hasClickHandler = true;
    }
  }
}

function showServerBanner(message) {
  if (!serverStatusBanner) return;
  
  serverStatusText.textContent = message;
  serverStatusBanner.classList.add('visible');
}

function hideServerBanner() {
  if (!serverStatusBanner) return;
  
  serverStatusBanner.classList.remove('visible');
}

function updateLoadButtonState() {
  // Load button should be disabled if:
  // - No video detected
  // - No API key
  // - Server not connected
  // - Currently loading
  loadBtn.disabled = !currentVideoId || !apiKey || !serverConnected || isLoading;
  
  if (!serverConnected && currentVideoId && apiKey) {
    loadBtn.title = 'Server not connected';
  } else if (!apiKey) {
    loadBtn.title = 'Enter API key first';
  } else if (!currentVideoId) {
    loadBtn.title = 'Open a YouTube video';
  } else {
    loadBtn.title = '';
  }
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
      updateLoadButtonState();
    }
  } catch (error) {
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
  updateLoadButtonState();
});

// Retry server connection button
if (retryServerBtn) {
  retryServerBtn.addEventListener('click', async () => {
    retryServerBtn.disabled = true;
    retryServerBtn.textContent = 'Checking…';
    healthCheckRetryCount = 0; // Reset retry count for manual retry
    await checkServerConnection();
    retryServerBtn.disabled = false;
    retryServerBtn.textContent = 'Retry';
  });
}

loadBtn.addEventListener('click', async () => {
  if (!currentVideoId || !apiKey || isLoading) return;
  
  // Re-check server connection before loading
  if (!serverConnected) {
    await checkServerConnection();
    if (!serverConnected) {
      showServerError('Server not available. Please start the server and try again.');
      return;
    }
  }
  
  isLoading = true;
  loadBtn.disabled = true;
  statusDot.className = 'status-dot loading';
  progressMsg.textContent = 'Starting…';
  progressMsg.classList.remove('error', 'server-error');

  const pollInterval = setInterval(async () => {
    const { indexProgress } = await chrome.storage.session.get(['indexProgress']);
    if (indexProgress) progressMsg.textContent = indexProgress;
  }, 500);

  chrome.runtime.sendMessage(
    { action: 'indexVideo', videoId: currentVideoId, title: currentTitle, apiKey },
    (response) => {
      clearInterval(pollInterval);
      isLoading = false;
      
      if (chrome.runtime.lastError) {
        handleIndexError({
          success: false,
          error: 'Extension error: ' + chrome.runtime.lastError.message,
          isServerError: false
        });
        return;
      }
      
      if (response && response.success) {
        markReady(currentTitle, response.chunkCount);
      } else {
        handleIndexError(response || { error: 'Unknown error occurred' });
      }
    }
  );
});

function handleIndexError(response) {
  statusDot.className = 'status-dot';
  loadBtn.disabled = false;
  
  if (response.isServerError) {
    // Server-related error
    serverConnected = false;
    updateServerStatus('disconnected');
    showServerBanner(response.error);
    showServerError(response.error);
  } else if (response.isOpenAIError) {
    // OpenAI-related error
    showError(response.error, 'openai');
  } else {
    // Generic error
    showError(response.error);
  }
  
  updateLoadButtonState();
}

function showServerError(message) {
  progressMsg.textContent = `🔌 ${message}`;
  progressMsg.classList.add('error', 'server-error');
}

function showError(message, type = 'generic') {
  progressMsg.classList.remove('server-error');
  progressMsg.classList.add('error');
  
  if (type === 'openai') {
    progressMsg.textContent = `🤖 ${message}`;
  } else {
    progressMsg.textContent = `Error: ${message}`;
  }
}

function markReady(title, chunkCount) {
  isIndexed = true;
  statusDot.className = 'status-dot ready';
  progressMsg.textContent = `✓ Indexed ${chunkCount} chunks`;
  progressMsg.classList.remove('error', 'server-error');
  loadBtn.textContent = 'RELOAD';
  loadBtn.disabled = false;
  questionInput.disabled = false;
  sendBtn.disabled = false;
  questionInput.focus();
  emptyState.querySelector('p').textContent = `Ready! Ask anything about "${truncate(title, 30)}"`;
  suggestions.style.display = 'flex';
}

function addMessage(role, content, isError = false, errorType = null) {
  if (emptyState?.parentNode === chatArea) emptyState.remove();
  const msg = document.createElement('div');
  msg.className = `message ${role}`;
  const sender = document.createElement('div');
  sender.className = 'sender';
  sender.textContent = role === 'user' ? 'YOU' : 'AI';
  const bubble = document.createElement('div');
  bubble.className = `bubble${isError ? ' error' : ''}`;
  
  if (isError && errorType === 'server') {
    bubble.classList.add('server-error');
    bubble.innerHTML = `<span class="error-icon">🔌</span> ${escapeHtml(content)}`;
  } else if (isError && errorType === 'openai') {
    bubble.innerHTML = `<span class="error-icon">🤖</span> ${escapeHtml(content)}`;
  } else {
    bubble.textContent = content;
  }
  
  msg.appendChild(sender);
  msg.appendChild(bubble);
  chatArea.appendChild(msg);
  chatArea.scrollTop = chatArea.scrollHeight;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Handle suggestion chips
if (suggestions) {
  suggestions.addEventListener('click', (e) => {
    if (e.target.classList.contains('chip') && !questionInput.disabled) {
      const question = e.target.dataset.q;
      if (question) {
        questionInput.value = question;
        sendQuestion();
      }
    }
  });
}

// Handle send button and enter key
if (sendBtn) {
  sendBtn.addEventListener('click', sendQuestion);
}

if (questionInput) {
  questionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuestion();
    }
  });
}

async function sendQuestion() {
  const question = questionInput.value.trim();
  if (!question || !isIndexed || questionInput.disabled) return;
  
  // Disable input while processing
  questionInput.disabled = true;
  sendBtn.disabled = true;
  questionInput.value = '';
  
  // Add user message
  addMessage('user', question);
  
  // Add typing indicator
  const typingMsg = document.createElement('div');
  typingMsg.className = 'message ai';
  typingMsg.innerHTML = `
    <div class="sender">AI</div>
    <div class="bubble">
      <div class="typing">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  chatArea.appendChild(typingMsg);
  chatArea.scrollTop = chatArea.scrollHeight;
  
  try {
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, error: 'Request timed out', errorCode: 'TIMEOUT' });
      }, 60000); // 60 second timeout for chat
      
      chrome.runtime.sendMessage(
        { action: 'askQuestion', question, apiKey },
        (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            resolve({ 
              success: false, 
              error: 'Extension error: ' + chrome.runtime.lastError.message 
            });
          } else {
            resolve(response || { success: false, error: 'No response received' });
          }
        }
      );
    });
    
    // Remove typing indicator
    typingMsg.remove();
    
    if (response.success) {
      addMessage('ai', response.answer);
    } else {
      // Determine error type for styling
      let errorType = 'generic';
      if (response.isServerError) {
        errorType = 'server';
        // Update server status if it's a server error
        serverConnected = false;
        updateServerStatus('disconnected');
        showServerBanner(response.error);
      } else if (response.isOpenAIError) {
        errorType = 'openai';
      }
      addMessage('ai', response.error, true, errorType);
    }
  } catch (error) {
    // Remove typing indicator
    typingMsg.remove();
    addMessage('ai', 'An unexpected error occurred: ' + error.message, true);
  }
  
  // Re-enable input
  questionInput.disabled = false;
  sendBtn.disabled = false;
  questionInput.focus();
  updateLoadButtonState();
}

// Initialize
init();


function showServerBanner(error, errorCode, recoveryAction = null) {
  if (serverStatusBanner && serverStatusText) {
    const message = getErrorMessage(error, errorCode);
    serverStatusText.textContent = message;
    serverStatusBanner.classList.add('visible');
    
    // Update retry button based on recovery action
    if (retryServerBtn) {
      if (recoveryAction) {
        retryServerBtn.textContent = recoveryAction.text;
        retryServerBtn.onclick = () => handleRecoveryAction(recoveryAction.action);
        retryServerBtn.style.display = 'block';
      } else {
        retryServerBtn.textContent = 'Retry';
        retryServerBtn.onclick = () => {
          healthCheckRetryCount = 0;
          c
... [truncated to fit context window]