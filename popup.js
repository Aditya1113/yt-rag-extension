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
    'CONNECTION_REFUSED': { 
      text: 'Start Server', 
      action: 'showStartInstructions', 
      icon: '🚀',
      description: 'The server is not running',
      command: 'python server.py'
    },
    'SERVER_UNREACHABLE': { 
      text: 'Start Server', 
      action: 'showStartInstructions', 
      icon: '🚀',
      description: 'Cannot reach the server',
      command: 'python server.py'
    },
    'SERVER_TIMEOUT': { 
      text: 'Retry', 
      action: 'retry', 
      icon: '🔄',
      description: 'Server took too long to respond'
    },
    'SERVER_OVERLOADED': { 
      text: 'Wait & Retry', 
      action: 'waitAndRetry', 
      icon: '⏳',
      description: 'Server is processing too many requests',
      waitTime: 5000
    },
    'SERVER_UNAVAILABLE': { 
      text: 'Retry', 
      action: 'retry', 
      icon: '🔄',
      description: 'Server temporarily unavailable'
    },
    'GATEWAY_ERROR': { 
      text: 'Retry', 
      action: 'retry', 
      icon: '🔄',
      description: 'Gateway error occurred'
    },
    'SERVER_ERROR': { 
      text: 'Retry', 
      action: 'retry', 
      icon: '🔄',
      description: 'Internal server error'
    },
    'RATE_LIMITED': { 
      text: 'Wait', 
      action: 'waitAndRetry', 
      icon: '⏳',
      description: 'Too many requests',
      waitTime: 10000
    },
    'NETWORK_DISCONNECTED': { 
      text: 'Check Network', 
      action: 'checkNetwork', 
      icon: '📡',
      description: 'No internet connection'
    },
    'DNS_RESOLUTION_FAILED': { 
      text: 'Troubleshoot', 
      action: 'showDNSHelp', 
      icon: '🔧',
      description: 'DNS lookup failed'
    },
    'CONNECTION_RESET': { 
      text: 'Reconnect', 
      action: 'reconnect', 
      icon: '🔌',
      description: 'Connection was reset'
    },
    'CONNECTION_CLOSED': { 
      text: 'Reconnect', 
      action: 'reconnect', 
      icon: '🔌',
      description: 'Connection was closed'
    },
    'SSL_ERROR': { 
      text: 'Help', 
      action: 'showSSLHelp', 
      icon: '🔒',
      description: 'SSL/TLS error'
    },
    'CORS_ERROR': { 
      text: 'Help', 
      action: 'showCORSHelp', 
      icon: '⚠️',
      description: 'Cross-origin request blocked'
    },
    'MAX_RECONNECT_ATTEMPTS': { 
      text: 'Manual Retry', 
      action: 'manualRetry', 
      icon: '🔄',
      description: 'Auto-reconnect failed'
    },
    'UNKNOWN_ERROR': { 
      text: 'Retry', 
      action: 'retry', 
      icon: '🔄',
      description: 'An unknown error occurred'
    }
  };
  
  return actions[errorCode] || { text: 'Retry', action: 'retry', icon: '🔄', description: 'Error occurred' };
}

function handleRecoveryAction(action, errorCode, details = {}) {
  const recovery = getRecoveryAction(errorCode);
  
  switch (action) {
    case 'showStartInstructions':
      showServerStartInstructions(details);
      break;
    case 'retry':
    case 'reconnect':
    case 'manualRetry':
      attemptManualReconnect();
      break;
    case 'waitAndRetry':
      showWaitAndRetryUI(errorCode, recovery.waitTime || 3000);
      break;
    case 'checkNetwork':
      showNetworkTroubleshooting();
      break;
    case 'showDNSHelp':
      showDNSTroubleshooting();
      break;
    case 'showSSLHelp':
      showSSLTroubleshooting();
      break;
    case 'showCORSHelp':
      showCORSTroubleshooting();
      break;
    default:
      attemptManualReconnect();
  }
}

/**
 * Show wait and retry UI with countdown
 */
function showWaitAndRetryUI(errorCode, waitTimeMs = 5000) {
  const recovery = getRecoveryAction(errorCode);
  const waitTime = Math.ceil((waitTimeMs || 5000) / 1000);
  let countdown = waitTime;
  
  const updateBanner = () => {
    const progressPercent = ((waitTime - countdown) / waitTime) * 100;
    
    showServerBanner(
      'RECONNECTING',
      `<strong>⏳ ${recovery.description || 'Please wait...'}</strong><br>
      <span style="font-size: 10px;">
        Retrying in ${countdown} second${countdown !== 1 ? 's' : ''}...
      </span>
      <div style="margin-top: 6px; height: 3px; background: var(--surface2); border-radius: 2px; overflow: hidden;">
        <div style="height: 100%; width: ${progressPercent}%; background: var(--warning); transition: width 1s linear;"></div>
      </div>`,
      { text: 'Retry Now', action: 'manualRetry', icon: '🔄', errorCode }
    );
  };
  
  updateBanner();
  
  const interval = setInterval(() => {
    countdown--;
    if (countdown <= 0) {
      clearInterval(interval);
      attemptManualReconnect();
    } else {
      updateBanner();
    }
  }, 1000);
  
  // Store interval ID so it can be cancelled if user clicks retry
  window.currentWaitInterval = interval;
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
  showServerBanner(
    'INSTRUCTIONS',
    `<strong>📡 Network Connection Issue</strong><br>
    <span style="font-size: 10px; opacity: 0.9;">
      Unable to reach the server due to a network problem.
    </span>
    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); font-size: 10px;">
      <strong>Try these steps:</strong>
      <ul style="margin: 4px 0 0 0; padding-left: 16px; opacity: 0.8;">
        <li>Check your internet connection</li>
        <li>Disable VPN or proxy if active</li>
        <li>Try refreshing the page</li>
        <li>Check if other websites are accessible</li>
      </ul>
    </div>`,
    { text: 'Retry Connection', action: 'retry', icon: '🔄', errorCode: 'NETWORK_DISCONNECTED' }
  );
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

  chrome.runti
... [truncated to fit context window]

function showServerStartInstructions(details = {}) {
  const serverUrl = details.serverUrl || 'http://127.0.0.1:5000';
  const troubleshooting = details.troubleshooting || [
    'Ensure Python 3.7+ is installed',
    'Install dependencies: pip install flask flask-cors youtube-transcript-api',
    'Check if port 5000 is available'
  ];
  
  let troubleshootingHtml = '';
  if (troubleshooting.length > 0) {
    troubleshootingHtml = `
      <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); font-size: 10px;">
        <strong>Troubleshooting:</strong>
        <ul style="margin: 4px 0 0 0; padding-left: 16px; opacity: 0.8;">
          ${troubleshooting.map(tip => `<li>${tip}</li>`).join('')}
        </ul>
      </div>
    `;
  }
  
  showServerBanner(
    'INSTRUCTIONS',
    `<strong>🚀 Server Not Running</strong><br>
    <span style="font-size: 10px; opacity: 0.9;">
      The backend server is not reachable at <code style="background: var(--surface2); padding: 1px 4px; border-radius: 2px;">${serverUrl}</code><br><br>
      <strong>Start the server:</strong><br>
      <code style="background: var(--surface2); padding: 4px 8px; border-radius: 4px; margin-top: 4px; display: inline-block; font-size: 11px;">python server.py</code>
    </span>
    ${troubleshootingHtml}`,
    { text: 'Retry Connection', action: 'retry', icon: '🔄', errorCode: details.errorCode }
  );
}