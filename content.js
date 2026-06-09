// content.js — runs on YouTube watch pages
// Extracts video ID and title, listens for messages from popup

/**
 * Custom error class for content script errors
 */
class ContentScriptError extends Error {
  constructor(message, errorCode = 'CONTENT_SCRIPT_ERROR', cause = null) {
    super(message);
    this.name = 'ContentScriptError';
    this.errorCode = errorCode;
    this.cause = cause;
  }
}

function getVideoInfo() {
  try {
    const url = window.location.href;
    const match = url.match(/[?&]v=([^&]+)/);
    const videoId = match ? match[1] : null;
    const title = document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim()
      || document.querySelector('h1.style-scope.ytd-watch-metadata')?.textContent?.trim()
      || document.title.replace(' - YouTube', '').trim()
      || 'Unknown Video';
    return { 
      videoId, 
      title, 
      url,
      success: true 
    };
  } catch (error) {
    console.error('[Content Script] Error getting video info:', error);
    return {
      videoId: null,
      title: 'Unknown Video',
      url: window.location.href,
      success: false,
      error: error.message,
      errorCode: 'VIDEO_INFO_EXTRACTION_FAILED'
    };
  }
}

/**
 * Check if the page is a valid YouTube video page
 */
function isValidVideoPage() {
  const url = window.location.href;
  return url.includes('youtube.com/watch') && url.includes('v=');
}

/**
 * Safely send message to background script with error handling
 */
/**
 * Server connection state tracked in content script
 */
let serverConnectionState = {
  isConnected: false,
  lastError: null,
  lastErrorCode: null,
  serverUrl: null,
  troubleshooting: [],
  recoveryAction: null,
  lastUpdate: null
};

/**
 * Show a notification toast on the YouTube page
 */
function showPageNotification(message, type = 'error', duration = 5000) {
  // Remove any existing notification
  const existing = document.getElementById('yt-rag-notification');
  if (existing) {
    existing.remove();
  }
  
  const notification = document.createElement('div');
  notification.id = 'yt-rag-notification';
  notification.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 20px;
    padding: 12px 16px;
    border-radius: 8px;
    font-family: 'Roboto', Arial, sans-serif;
    font-size: 13px;
    z-index: 9999;
    max-width: 320px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s ease;
    display: flex;
    align-items: center;
    gap: 8px;
  `;
  
  // Add animation keyframes if not already present
  if (!document.getElementById('yt-rag-notification-styles')) {
    const style = document.createElement('style');
    style.id = 'yt-rag-notification-styles';
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }
  
  // Set colors based on type
  switch (type) {
    case 'error':
      notification.style.background = '#1a1a2e';
      notification.style.border = '1px solid #ff2b4e';
      notification.style.color = '#ff2b4e';
      break;
    case 'warning':
      notification.style.background = '#1a1a2e';
      notification.style.border = '1px solid #ffb347';
      notification.style.color = '#ffb347';
      break;
    case 'success':
      notification.style.background = '#1a1a2e';
      notification.style.border = '1px solid #2dff8c';
      notification.style.color = '#2dff8c';
      break;
    case 'info':
    default:
      notification.style.background = '#1a1a2e';
      notification.style.border = '1px solid #7c5cff';
      notification.style.color = '#e8e8f0';
  }
  
  notification.innerHTML = message;
  
  // Add close button
  const closeBtn = document.createElement('span');
  closeBtn.innerHTML = '✕';
  closeBtn.style.cssText = `
    cursor: pointer;
    margin-left: auto;
    opacity: 0.7;
    font-size: 14px;
  `;
  closeBtn.onclick = () => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  };
  notification.appendChild(closeBtn);
  
  document.body.appendChild(notification);
  
  // Auto-remove after duration
  if (duration > 0) {
    setTimeout(() => {
      if (notification.parentNode) {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
      }
    }, duration);
  }
  
  return notification;
}

/**
 * Handle server status updates from background script
 */
function handleServerStatusUpdate(status, event) {
  const wasConnected = serverConnectionState.isConnected;
  serverConnectionState = {
    isConnected: status.isConnected,
    lastError: status.lastError,
    lastUpdate: Date.now()
  };
  
  // Show notification on significant state changes
  if (wasConnected && !status.isConnected && status.lastError) {
    const errorMessage = status.lastError.message || 'Server disconnected';
    showPageNotification(
      `<strong>⚠️ RAG Extension:</strong> ${errorMessage}`,
      'warning',
      8000
    );
  } else if (!wasConnected && status.isConnected && event === 'reconnected') {
    showPageNotification(
      '<strong>✅ RAG Extension:</strong> Reconnected to server',
      'success',
      3000
    );
  }
}

/**
 * Safely send message to background script with comprehensive error handling
 */
function safeSendMessage(message) {
  return new Promise((resolve) => {
    try {
      // Check if extension context is still valid
      if (!chrome.runtime?.id) {
        console.warn('[Content Script] Extension context invalidated');
        showPageNotification(
          '<strong>⚠️ RAG Extension:</strong> Extension was updated. Please refresh the page.',
          'warning',
          0 // Don't auto-dismiss
        );
        resolve({ 
          success: false, 
          error: 'Extension context invalidated. Please refresh the page.', 
          errorCode: 'EXTENSION_CONTEXT_INVALID',
          recoveryAction: 'refreshPage'
        });
        return;
      }
      
      // Check if we know the server is disconnected
      if (!serverConnectionState.isConnected && serverConnectionState.lastError) {
        // Still try to send, but warn that server might be down
        console.warn('[Content Script] Sending message while server appears disconnected');
      }
        return;
      }
      
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message || 'Unknown error';
          console.error('[Content Script] Message error:', errorMessage);
          
          // Categorize the error
          let errorCode = 'MESSAGE_SEND_FAILED';
          let userMessage = errorMessage;
          let recoveryAction = 'retry';
          
          if (errorMessage.includes('Extension context invalidated') ||
              errorMessage.includes('Extension not found')) {
            errorCode = 'EXTENSION_CONTEXT_INVALID';
            userMessage = 'Extension was updated. Please refresh the page.';
            recoveryAction = 'refreshPage';
            showPageNotification(
              `<strong>⚠️ RAG Extension:</strong> ${userMessage}`,
              'warning',
              0
            );
          } else if (errorMessage.includes('Could not establish connection') ||
                     errorMessage.includes('Receiving end does not exist')) {
            errorCode = 'BACKGROUND_UNAVAILABLE';
            userMessage = 'Extension background is not responding. Try reloading the extension.';
            recoveryAction = 'reloadExtension';
          } else if (errorMessage.includes('message port closed')) {
            errorCode = 'PORT_CLOSED';
            userMessage = 'Connection to extension was lost.';
            recoveryAction = 'retry';
          }
          
          resolve({ 
            success: false, 
            error: userMessage,
            errorCode: errorCode,
            recoveryAction: recoveryAction,
            originalError: errorMessage
          });
        } else if (response && response.error) {
          // Background script returned an error
          console.warn('[Content Script] Background returned error:', response.error);
          
          // Check if it's a server connection error
          if (response.errorCode === 'SERVER_UNREACHABLE' || 
              response.errorCode === 'CONNECTION_REFUSED') {
            serverConnectionState.isConnected = false;
            serverConnectionState.lastError = {
              message: response.error,
              code: response.errorCode
            };
          }
          
          resolve(response);
        } else {
          // Success - update connection state if this was a server-related message
          if (response && response.serverStatus) {
            serverConnectionState.isConnected = response.serverStatus.isConnected;
            serverConnectionState.lastError = response.serverStatus.lastError;
          }
          resolve(response || { success: true });
        }
      });
    } catch (error) {
      console.error('[Content Script] Exception sending message:', error);
      
      // Check for specific exception types
      let errorCode = 'MESSAGE_EXCEPTION';
      let userMessage = error.message;
      
      if (error.message.includes('Extension context invalidated')) {
        errorCode = 'EXTENSION_CONTEXT_INVALID';
        userMessage = 'Extension was updated. Please refresh the page.';
        showPageNotification(
          `<strong>⚠️ RAG Extension:</strong> ${userMessage}`,
          'warning',
          0
        );
      }
      
      resolve({ 
        success: false, 
        error: userMessage,
        errorCode: errorCode,
        originalError: error.message
      });
    }
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.action === 'getVideoInfo') {
      if (!isValidVideoPage()) {
        sendResponse({
          videoId: null,
          title: null,
          url: window.location.href,
          success: false,
          error: 'Not a valid YouTube video page',
          errorCode: 'INVALID_VIDEO_PAGE'
        });
        return true;
      }
      sendResponse(getVideoInfo());
    }
    
    if (request.action === 'ping') {
      // Simple ping to check if content script is loaded
      sendResponse({ pong: true, timestamp: Date.now(), success: true });
    }
    
    if (request.action === 'checkBackendStatus') {
      // Forward backend status check to background script
      safeSendMessage({ action: 'checkServerHealth' })
        .then(response => sendResponse(response))
        .catch(error => sendResponse({ 
          success: false, 
          error: error.message,
          errorCode: 'BACKEND_CHECK_FAILED'
        }));
      return true; // Keep channel open for async response
    }
  } catch (error) {
    console.error('[Content Script] Error handling message:', error);
    sendResponse({
      success: false,
      error: error.message,
      errorCode: 'MESSAGE_HANDLER_ERROR'
    });
  }
  
  return true;
});

// Notify background script that content script is ready
safeSendMessage({ action: 'contentScriptReady', url: window.location.href })
  .then(response => {
    if (!response.success && response.errorCode !== 'EXTENSION_CONTEXT_INVALID') {
      console.warn('[Content Script] Failed to notify background:', response.error);
    }
  });


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    switch (message.action) {
      case 'getVideoInfo':
        const info = getVideoInfo();
        // Include server connection state in response
        sendResponse({
          ...info,
          serverConnectionState: serverConnectionState
        });
        break;
        
      case 'serverStatusUpdate':
        // Handle server status updates from background
        handleServerStatusUpdate(message.status, message.event);
        sendResponse({ received: true });
        break;
        
      case 'showNotification':
        // Allow background/popup to show notifications on the page
        showPageNotification(
          message.message,
          message.type || 'info',
          message.duration || 5000
        );
        sendResponse({ shown: true });
        break;
        
      default:
        sendResponse({ error: 'Unknown action', errorCode: 'UNKNOWN_ACTION' });
    }
  } catch (error) {
    console.error('[Content Script] Error handling message:', error);
    sendResponse({ 
      error: error.message, 
      errorCode: 'MESSAGE_HANDLER_ERROR' 
    });
  }
  return false; // Synchronous response
});

/**
 * Listen for online/offline events to track network state
 */
window.addEventListener('online', () => {
  console.log('[Content Script] Network came online');
  showPageNotification(
    '<strong>📡 Network:</strong> Connection restored',
    'success',
    3000
  );
  // Notify background to retry connection
  safeSendMessage({ action: 'networkOnline' }).catch(() => {});
});

window.addEventListener('offline', () => {
  console.log('[Content Script] Network went offline');
  serverConnectionState.isConnected = false;
  serverConnectionState.lastError = {
    message: 'Network disconnected',
    code: 'NETWORK_DISCONNECTED'
  };
  showPageNotification(
    '<strong>📡 Network:</strong> Connection lost. RAG features unavailable.',
    'error',
    0 // Don't auto-dismiss
  );
});

/**
 * Initialize content script and check server status
 */
function initializeContentScript() {
  if (!isValidVideoPage()) {
    return;
  }
  
  console.log('[Content Script] Initialized on YouTube video page');
  
  // Request current server status from background
  safeSendMessage({ action: 'getServerStatus' })
    .then(response => {
      if (response && response.status) {
        serverConnectionState.isConnected = response.status.isConnected;
        serverConnectionState.lastError = response.status.lastError;
        serverConnectionState.lastUpdate = Date.now();
        
        // Show warning if server is not connected
        if (!response.status.isConnected && response.status.lastError) {
          console.warn('[Content Script] Server not connected:', response.status.lastError);
        }
      }
    })
    .catch(error => {
      console.warn('[Content Script] Could not get server status:', error);
    });
}

// Initialize when script loads
initializeContentScript();
});

function handleServerStatusUpdate(message) {
  const { status, details, recovery } = message;
  
  // Update connection state with full details
  serverConnectionState.isConnected = status === 'CONNECTED';
  serverConnectionState.lastError = details?.error || null;
  serverConnectionState.lastErrorCode = details?.errorCode || recovery?.errorCode || null;
  serverConnectionState.serverUrl = details?.serverUrl || null;
  serverConnectionState.troubleshooting = details?.troubleshooting || recovery?.troubleshooting || [];
  serverConnectionState.recoveryAction = details?.recoveryAction || recovery?.action || null;
  
  if (status === 'SERVER_UNREACHABLE' || status === 'DISCONNECTED' || status === 'ERROR') {
    // Build informative error message
    let errorMessage = getServerErrorMessage(details?.errorCode || recovery?.errorCode, details?.error);
    
    showPageNotification(
      errorMessage,
      'error',
      8000,
      {
        errorCode: serverConnectionState.lastErrorCode,
        troubleshooting: serverConnectionState.troubleshooting,
        recoveryAction: serverConnectionState.recoveryAction
      }
    );
  } else if (status === 'MAX_RECONNECT_ATTEMPTS') {
    showPageNotification(
      'Unable to connect to server after multiple attempts. Please start the server manually: python server.py',
      'error',
      0, // Don't auto-dismiss
      {
        errorCode: 'MAX_RECONNECT_ATTEMPTS',
        troubleshooting: details?.troubleshooting || [
          'Start the server: python server.py',
          'Check if port 5000 is available',
          'Ensure all dependencies are installed'
        ],
        recoveryAction: 'manualRetry',
        persistent: true
      }
    );
  } else if (status === 'RECONNECTING') {
    showPageNotification(
      `Reconnecting to server (attempt ${details?.attempt}/${details?.maxAttempts})...`,
      'warning',
      3000
    );
  } else if (status === 'CONNECTED' && serverConnectionState.lastError) {
    // Clear any persistent error notifications
    clearPersistentNotifications();
    showPageNotification(
      'Server connection restored',
      'success',
      3000
    );
  }
}

/**
 * Get user-friendly error message based on error code
 */
function getServerErrorMessage(errorCode, fallbackMessage) {
  const errorMessages = {
    'CONNECTION_REFUSED': 'Cannot connect to server. Please start the server with: python server.py',
    'SERVER_UNREACHABLE': 'Server is unreachable. Ensure the server is running on port 5000.',
    'SERVER_TIMEOUT': 'Server request timed out. The server may be overloaded.',
    'NETWORK_DISCONNECTED': 'Network connection lost. Please check your internet connection.',
    'DNS_RESOLUTION_FAILED': 'Could not resolve server address. Check your network settings.',
    'CONNECTION_RESET': 'Connection was reset. The server may have crashed. Try restarting it.',
    'SSL_ERROR': 'SSL connection error. The local server uses HTTP, not HTTPS.',
    'CORS_ERROR': 'Cross-origin request blocked. Restart the server to fix CORS settings.',
    'MAX_RECONNECT_ATTEMPTS': 'Maximum reconnection attempts reached. Please start the server manually.',
    'SERVER_OVERLOADED': 'Server is overloaded. Please wait and try again.',
    'RATE_LIMITED': 'Too many requests. Please wait before trying again.'
  };
  
  return errorMessages[errorCode] || fallbackMessage || 'Server connection error';
}

/**
 * Clear any persistent error notifications
 */
function clearPersistentNotifications() {
  const persistentNotifications = document.querySelectorAll('.yt-rag-notification[data-persistent="true"]');
  persistentNotifications.forEach(notification => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => notification.remove(), 300);
  });
}

function showPageNotification(message, type = 'info', duration = 5000, options = {}) {
  // Remove any existing non-persistent notification
  const existing = document.querySelector('.yt-rag-notification:not([data-persistent="true"])');
  if (existing) {
    existing.remove();
  }
  
  // If this is a persistent notification and one already exists, update it instead
  if (options.persistent) {
    const existingPersistent = document.querySelector('.yt-rag-notification[data-persistent="true"]');
    if (existingPersistent) {
      existingPersistent.remove();
    }
  }
  
  const notification = document.createElement('div');
  notification.className = 'yt-rag-notification';
  if (options.persistent) {
    notification.setAttribute('data-persistent', 'true');
  }
  
  const colors = {
    success: { bg: '#0d3320', border: '#2dff8c', text: '#2dff8c', icon: '✓' },
    error: { bg: '#3d1320', border: '#ff2b4e', text: '#ff2b4e', icon: '✕' },
    warning: { bg: '#3d2d13', border: '#ffb347', text: '#ffb347', icon: '⚠' },
    info: { bg: '#1a1a2e', border: '#7c5cff', text: '#7c5cff', icon: 'ℹ' }
  };
  
  const color = colors[type] || colors.info;
  
  notification.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    background: ${color.bg};
    border: 1px solid ${color.border};
    color: ${color.text};
    padding: 12px 16px;
    border-radius: 8px;
    font-family: 'Segoe UI', sans-serif;
    font-size: 13px;
    z-index: 10000;
    max-width: 400px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: slideIn 0.3s ease;
  `;
  
  // Build notification content
  let content = `<div style="display: flex; align-items: flex-start; gap: 10px;">`;
  content += `<span style="font-size: 16px;">${color.icon}</span>`;
  content += `<div style="flex: 1;">`;
  content += `<div style="margin-bottom: ${options.troubleshooting?.length ? '8px' : '0'};">${message}</div>`;
  
  // Add troubleshooting tips if provided
  if (options.troubleshooting && options.troubleshooting.length > 0) {
    content += `<div style="font-size: 11px; opacity: 0.8; margin-top: 8px; padding-top: 8px; border-top: 1px solid ${color.border}40;">`;
    content += `<div style="margin-bottom: 4px; font-weight: 600;">Troubleshooting:</div>`;
    content += `<ul style="margin: 0; padding-left: 16px;">`;
    options.troubleshooting.slice(0, 3).forEach(tip => {
      content += `<li style="margin: 2px 0;">${tip}</li>`;
    });
    content += `</ul></div>`;
  }
  
  content += `</div>`;
  
  // Add close button for persistent notifications
  if (options.persistent) {
    content += `<button class="yt-rag-notification-close" style="
      background: none;
      border: none;
      color: ${color.text};
      cursor: pointer;
      font-size: 18px;
      padding: 0;
      margin-left: 8px;
      opacity: 0.7;
      transition: opacity 0.2s;
    ">×</button>`;
  }
  
  content += `</div>`;
  
  notification.innerHTML = content;
  
  // Add animation keyframes if not already added
  if (!document.querySelector('#yt-rag-notification-styles')) {
    const style = document.createElement('style');
    style.id = 'yt-rag-notification-styles';
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      .yt-rag-notification-close:hover {
        opacity: 1 !important;
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(notification);
  
  // Add close button handler for persistent notifications
  if (options.persistent) {
    const closeBtn = notification.querySelector('.yt-rag-notification-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        notification.style.transition = 'all 0.3s ease';
        setTimeout(() => notification.remove(), 300);
      });
    }
  }
  
  if (duration > 0 && !options.persistent) {
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(100%)';
      notification.style.transition = 'all 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, duration);
  }
}

async function safeSendMessage(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    
    // Check if response indicates server unreachable
    if (response && response.success === false) {
      if (response.errorCode === 'SERVER_UNREACHABLE' || 
          response.errorCode === 'CONNECTION_REFUSED' ||
          response.errorCode === 'NETWORK_DISCONNECTED') {
        // Update local connection state
        serverConnectionState.isConnected = false;
        serverConnectionState.lastError = response.error;
        serverConnectionState.lastErrorCode = response.errorCode;
        
        // Show notification if not already showing
        const errorMessage = getServerErrorMessage(response.errorCode, response.error);
        showPageNotification(
          errorMessage,
          'error',
          6000,
          {
            errorCode: response.errorCode,
            troubleshooting: response.troubleshooting || [],
            recoveryAction: response.recoveryAction
          }
        );
      }
    }
    
    return response;
  } catch (error) {
    // Handle cases where background script is not available
    if (error.message?.includes('Receiving end does not exist') ||
        error.message?.includes('Extension context invalidated')) {
      console.warn('[Content Script] Background script unavailable:', error.message);
      
      showPageNotification(
        'Extension background script is not available. Try reloading the extension.',
        'error',
        5000,
        {
          errorCode: 'EXTENSION_UNAVAILABLE',
          troubleshooting: [
            'Reload the extension from chrome://extensions',
            'Refresh this page',
            'Restart Chrome if the issue persists'
          ]
        }
      );
      
      return { 
        success: false, 
        error: 'Extension background script is not available. Try reloading the extension.',
        errorCode: 'EXTENSION_UNAVAILABLE'
      };
    }
    throw error;
  }
}