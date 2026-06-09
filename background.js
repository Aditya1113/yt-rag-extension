// background.js — RAG pipeline using local Python server for transcripts

const SERVER_URL = 'http://127.0.0.1:5000';
const FETCH_TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second base delay
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

// Connection state
let serverStatus = {
  isConnected: false,
  lastCheck: null,
  lastError: null,
  consecutiveFailures: 0
};

let healthCheckTimer = null;
// Reconnection state
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 1000;
/**
 * Attempt to reconnect to server with exponential backoff
 */
async function attemptReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log('[Background] Max reconnection attempts reached');
    broadcastServerStatus('MAX_RECONNECT_ATTEMPTS', {
      error: 'Maximum reconnection attempts reached. Please start the server manually.',
      errorCode: 'MAX_RECONNECT_ATTEMPTS',
      recoveryAction: 'manualRetry',
      troubleshooting: [
        'Start the server: python server.py',
        'Check the terminal for any error messages',
        'Ensure all dependencies are installed: pip install flask flask-cors youtube-transcript-api',
        'Verify port 5000 is not in use by another application'
      ],
      serverUrl: SERVER_URL,
      isRetryable: false
    });
    return false;
  }
  
  reconnectAttempts++;
  const delay = RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1);
  
  console.log(`[Background] Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
  broadcastServerStatus('RECONNECTING', {
    attempt: reconnectAttempts,
    maxAttempts: MAX_RECONNECT_ATTEMPTS,
    nextRetryIn: delay,
    serverUrl: SERVER_URL,
    message: `Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
  });
  
  await new Promise(resolve => setTimeout(resolve, delay));
  
  const connected = await checkServerHealth();
  if (!connected && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    return attemptReconnect();
  }
  
  return connected;
}

/**
 * Custom error class for network-related errors
 */
class NetworkError extends Error {
  constructor(message, errorCode, details = {}) {
    super(message);
    this.name = 'NetworkError';
    this.isServerError = false;
    this.errorCode = errorCode;
    this.recoveryAction = details.recoveryAction || 'checkNetwork';
    this.isRetryable = details.isRetryable !== false;
    this.timestamp = Date.now();
    this.details = details;
  }
}

/**
 * Detect specific server unreachable scenarios from error
 */
function detectServerUnreachableType(error) {
  const errorMessage = error.message?.toLowerCase() || '';
  const errorName = error.name?.toLowerCase() || '';
  
  // Connection refused - server not running
  if (errorMessage.includes('failed to fetch') || 
      errorMessage.includes('connection refused') ||
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('net::err_connection_refused')) {
    return {
      errorCode: 'CONNECTION_REFUSED',
      message: 'Cannot connect to server. The server may not be running.',
      recoveryAction: 'showStartInstructions',
      troubleshooting: [
        'Start the server with: python server.py',
        'Ensure Python and required packages are installed',
        'Check if port 5000 is available'
      ]
    };
  }
  
  // Network unreachable
  if (errorMessage.includes('network') && errorMessage.includes('unreachable') ||
      errorMessage.includes('net::err_network_changed') ||
      errorMessage.includes('net::err_internet_disconnected')) {
    return {
      errorCode: 'NETWORK_DISCONNECTED',
      message: 'Network connection lost. Please check your internet connection.',
      recoveryAction: 'checkNetwork',
      troubleshooting: [
        'Check your internet connection',
        'Try refreshing the page',
        'Disable VPN if active'
      ]
    };
  }
  
  // DNS resolution failed
  if (errorMessage.includes('dns') || 
      errorMessage.includes('net::err_name_not_resolved') ||
      errorMessage.includes('getaddrinfo')) {
    return {
      errorCode: 'DNS_RESOLUTION_FAILED',
      message: 'Could not resolve server address.',
      recoveryAction: 'showDNSHelp',
      troubleshooting: [
        'Check if localhost/127.0.0.1 is accessible',
        'Try flushing DNS cache',
        'Check hosts file configuration'
      ]
    };
  }
  
  // Connection reset
  if (errorMessage.includes('connection reset') ||
      errorMessage.includes('econnreset') ||
      errorMessage.includes('net::err_connection_reset')) {
    return {
      errorCode: 'CONNECTION_RESET',
      message: 'Connection was reset. The server may have crashed.',
      recoveryAction: 'reconnect',
      troubleshooting: [
        'Restart the server: python server.py',
        'Check server logs for errors',
        'Ensure no firewall is blocking the connection'
      ]
    };
  }
  
  // Timeout
  if (error.name === 'AbortError' || 
      errorMessage.includes('timeout') ||
      errorMessage.includes('timed out') ||
      errorMessage.includes('net::err_timed_out')) {
    return {
      errorCode: 'SERVER_TIMEOUT',
      message: 'Server request timed out. The server may be overloaded or unresponsive.',
      recoveryAction: 'retry',
      troubleshooting: [
        'Wait a moment and try again',
        'Check if the server is processing a large request',
        'Restart the server if issue persists'
      ]
    };
  }
  
  // SSL/TLS errors
  if (errorMessage.includes('ssl') || 
      errorMessage.includes('certificate') ||
      errorMessage.includes('net::err_cert')) {
    return {
      errorCode: 'SSL_ERROR',
      message: 'SSL/TLS connection error.',
      recoveryAction: 'showSSLHelp',
      troubleshooting: [
        'The local server uses HTTP, not HTTPS',
        'Ensure you\'re connecting to http://127.0.0.1:5000'
      ]
    };
  }
  
  // CORS errors
  if (errorMessage.includes('cors') ||
      errorMessage.includes('cross-origin') ||
      errorMessage.includes('access-control-allow-origin')) {
    return {
      errorCode: 'CORS_ERROR',
      message: 'Cross-origin request blocked.',
      recoveryAction: 'showCORSHelp',
      troubleshooting: [
        'Ensure the server has CORS enabled',
        'Restart the server to apply CORS settings'
      ]
    };
  }
  
  // Generic server unreachable
  return {
    errorCode: 'SERVER_UNREACHABLE',
    message: 'Unable to reach the server.',
    recoveryAction: 'showStartInstructions',
    troubleshooting: [
      'Ensure the server is running: python server.py',
      'Check if port 5000 is available',
      'Look for error messages in the server terminal'
    ]
  };
}

/**
 * Create a wrapped fetch with comprehensive error handling
 */
async function fetchWithErrorHandling(url, options = {}) {
  const { timeout = FETCH_TIMEOUT, retries = MAX_RETRIES } = options;
  let lastError = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...options.headers
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        const error = new Error(errorData.error || `HTTP ${response.status}`);
        error.statusCode = response.status;
        error.serverErrorCode = errorData.error_code;
        error.serverResponse = errorData;
        error.isServerError = true;
        throw error;
      }
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Detect if this is a server unreachable scenario
      const unreachableInfo = detectServerUnreachableType(error);
      
      // Create appropriate error type
      if (unreachableInfo.errorCode === 'CONNECTION_REFUSED' || 
          unreachableInfo.errorCode === 'SERVER_UNREACHABLE') {
        lastError = new ServerUnreachableError(
          unreachableInfo.message,
          unreachableInfo.errorCode,
          {
            recoveryAction: unreachableInfo.recoveryAction,
            troubleshooting: unreachableInfo.troubleshooting,
            serverUrl: url,
            originalError: error.message
          }
        );
      } else if (unreachableInfo.errorCode === 'NETWORK_DISCONNECTED' ||
                 unreachableInfo.errorCode === 'DNS_RESOLUTION_FAILED') {
        lastError = new NetworkError(
          unreachableInfo.message,
          unreachableInfo.errorCode,
          {
            recoveryAction: unreachableInfo.recoveryAction,
            troubleshooting: unreachableInfo.troubleshooting,
            isRetryable: false,
            originalError: error.message
          }
        );
      } else {
        lastError = error;
        lastError.errorCode = unreachableInfo.errorCode;
        lastError.recoveryAction = unreachableInfo.recoveryAction;
        lastError.troubleshooting = unreachableInfo.troubleshooting;
      }
      
      const categorized = categorizeNetworkError(lastError);
      
      if (!categorized.isRetryable) {
        throw lastError;
      }

/**
 * Create a wrapped fetch with comprehensive error handling
 */
async function fetchWithErrorHandling(url, options = {}) {
  const { timeout = FETCH_TIMEOUT, retries = MAX_RETRIES } = options;
  let lastError = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...options.headers
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        const error = new Error(errorData.error || `HTTP ${response.status}`);
        error.statusCode = response.status;
        error.serverErrorCode = errorData.error_code;
        error.serverResponse = errorData;
        throw error;
      }
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      
      const categorized = categorizeNetworkError(error);
      
      // Don't retry non-retryable errors
      if (!categorized.isRetryable) {
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt === retries) {
        throw error;
      }
      
      // Wait before retry with exponential backoff
      const retryDelay = RETRY_DELAY * Math.pow(2, attempt);
      console.log(`[Background] Fetch retry ${attempt + 1}/${retries} in ${retryDelay}ms`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  throw lastError;
}

/**
 * Calculate exponential backoff delay
 */
function getBackoffDelay(attempt, baseDelay = RECONNECT_BASE_DELAY) {
  return Math.min(baseDelay * Math.pow(2, attempt), 30000); // Max 30 seconds
}

/**
 * Broadcast server status to all extension components
 */
function broadcastServerStatus(status, event = null) {
  const message = {
    action: 'serverStatusUpdate',
    status: status,
    event: event, // 'connected', 'disconnected', 'reconnected', 'error'
    timestamp: Date.now(),
    reconnectAttempts: reconnectAttempts,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS
  };
  
  // Send to popup if open
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup may not be open, ignore error
  });
  
  // Also send to all content scripts
  chrome.tabs.query({ url: 'https://www.youtube.com/*' }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Content script may not be ready, ignore error
      });
    });
  });
}

/**
 * Perform a health check on the backend server
 */
async function checkServerHealth(options = {}) {
  const { timeout = 5000, silent = false, retryOnFail = false } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(`${SERVER_URL}/ping`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const serverError = new Error(`Server returned ${response.status}: ${errorData.error || 'Unknown error'}`);
      serverError.statusCode = response.status;
      serverError.serverErrorCode = errorData.error_code;
      throw serverError;
    }
    
    const data = await response.json();
    
    if (data.pong) {
      const previouslyDisconnected = !serverStatus.isConnected;
      serverStatus = {
        isConnected: true,
        lastCheck: Date.now(),
        lastError: null,
        consecutiveFailures: 0,
        serverUptime: data.uptime || null,
        serverVersion: data.version || null
      };
      reconnectAttempts = 0;
      
      if (!silent) {
        broadcastServerStatus(serverStatus, previouslyDisconnected ? 'reconnected' : 'connected');
      }
      
      return { success: true, status: serverStatus };
    } else {
      throw new Error('Invalid ping response - missing pong field');
    }
  } catch (error) {
    clearTimeout(timeoutId);
    
    const categorizedError = categorizeNetworkError(error, true);
    const previousFailures = serverStatus.consecutiveFailures;
    
    serverStatus = {
      isConnected: false,
      lastCheck: Date.now(),
      lastError: {
        message: categorizedError.message,
        code: categorizedError.errorCode,
        recoveryAction: categorizedError.recoveryAction,
        details: categorizedError.details || null,
        originalError: error.message,
        statusCode: error.statusCode || null
      },
      consecutiveFailures: previousFailures + 1,
      serverUptime: null,
      serverVersion: null
    };
    
    // Log detailed error for debugging
    console.error('[Background] Server health check failed:', {
      errorCode: categorizedError.errorCode,
      message: categorizedError.message,
      consecutiveFailures: serverStatus.consecutiveFailures,
      originalError: error.message
    });
    
    if (!silent) {
      broadcastServerStatus(serverStatus);
    }
    
    return { 
      success: false, 
      error: categorizedError.message,
      errorCode: categorizedError.errorCode,
      recoveryAction: categorizedError.recoveryAction,
      status: serverStatus
    };
  }
}

/**
 * Attempt to reconnect to the server with exponential backoff
 */
async function attemptReconnect(options = {}) {
  const { resetAttempts = false, immediate = false } = options;
  
  if (resetAttempts) {
    reconnectAttempts = 0;
  }
  
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log('[Background] Max reconnect attempts reached');
    serverStatus.lastError = {
      message: 'Maximum reconnection attempts reached. Click "Manual Retry" to try again.',
      code: 'MAX_RECONNECT_ATTEMPTS',
      recoveryAction: 'manualRetry',
      details: {
        attemptsExhausted: true,
        suggestion: 'Check if server.py is running: python server.py'
      }
    };
    broadcastServerStatus(serverStatus, 'maxAttemptsReached');
    return { success: false, maxAttemptsReached: true, status: serverStatus };
  }
  
  reconnectAttempts++;
  const delay = immediate ? 0 : getBackoffDelay(reconnectAttempts - 1);
  
  console.log(`[Background] Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}${delay > 0 ? ` in ${delay}ms` : ' immediately'}`);
  
  // Broadcast reconnecting status with detailed info
  const reconnectingStatus = {
    ...serverStatus,
    isReconnecting: true,
    reconnectAttempt: reconnectAttempts,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
    nextRetryIn: delay,
    nextRetryAt: Date.now() + delay
  };
  broadcastServerStatus(reconnectingStatus, 'reconnecting');
  
  if (delay > 0) {
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  // Check if we're still supposed to be reconnecting (user might have cancelled)
  const result = await checkServerHealth({ silent: false });
  
  if (result.success) {
    console.log('[Background] Reconnection successful');
    return { success: true, status: serverStatus, attemptsUsed: reconnectAttempts };
  }
  
  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    // Schedule next attempt
    return attemptReconnect();
  }
  
  return { success: false, status: serverStatus, attemptsUsed: reconnectAttempts };
}

/**
 * Start periodic health checks
 */
function startHealthCheckTimer() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
  }
  
  healthCheckTimer = setInterval(async () => {
    await checkServerHealth({ silent: true });
    
    // If disconnected, try to reconnect
    if (!serverStatus.isConnected && serverStatus.consecutiveFailures >= 2) {
      attemptReconnect();
    }
  }, HEALTH_CHECK_INTERVAL);
}

/**
 * Stop periodic health checks
 */
function stopHealthCheckTimer() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

/**
 * Get detailed error information for display
 */
function getErrorDetails(error) {
  const errorCode = error.errorCode || 'UNKNOWN_ERROR';
  const isServerError = error.isServerError || false;
  
  const errorDetails = {
    CONNECTION_REFUSED: {
      title: 'Server Not Running',
      message: 'The backend server is not running.',
      instructions: [
        'Open a terminal in the extension directory',
        'Run: python server.py',
        'Wait for "Server running at http://localhost:5000"',
        'Click Retry to reconnect'
      ],
      recoveryAction: 'showStartInstructions'
    },
    SERVER_UNREACHABLE: {
      title: 'Server Unreachable',
      message: 'Cannot connect to the backend server.',
      instructions: [
        'Check if server.py is running',
        'Verify no firewall is blocking port 5000',
        'Try restarting the server'
      ],
      recoveryAction: 'showStartInstructions'
    },
    SERVER_TIMEOUT: {
      title: 'Request Timeout',
      message: 'The server took too long to respond.',
      instructions: [
        'The server may be processing a large request',
        'Check if the server is overloaded',
        'Try again in a few moments'
      ],
      recoveryAction: 'retry'
    },
    NETWORK_DISCONNECTED: {
      title: 'Network Disconnected',
      message: 'Your internet connection appears to be down.',
      instructions: [
        'Check your WiFi or ethernet connection',
        'Try opening another website',
        'Reconnect and try again'
      ],
      recoveryAction: 'checkNetwork'
    },
    DNS_RESOLUTION_FAILED: {
      title: 'DNS Error',
      message: 'Could not resolve the server address.',
      instructions: [
        'Check your network connection',
        'Try using 127.0.0.1 instead of localhost',
        'Flush your DNS cache'
      ],
      recoveryAction: 'showDNSHelp'
    },
    SERVER_OVERLOADED: {
      title: 'Server Busy',
      message: 'The server is currently overloaded.',
      instructions: [
        'Wait a few moments',
        'The server is processing other requests',
        'Try again shortly'
      ],
      recoveryAction: 'retry'
    },
    CONNECTION_RESET: {
      title: 'Connection Reset',
      message: 'The connection to the server was reset.',
      instructions: [
        'The server may have restarted',
        'Check if server.py is still running',
        'Try reconnecting'
      ],
      recoveryAction: 'reconnect'
    }
  };
  
  return errorDetails[errorCode] || {
    title: 'Connection Error',
    message: error.message || 'An unknown error occurred.',
    instructions: ['Try again', 'Check if the server is running'],
    recoveryAction: 'retry'
  };
}

// Initialize health check on startup
checkServerHealth({ silent: false }).then(() => {
  startHealthCheckTimer();
});

let vectorStore = {
  videoId: null,
  chunks: [],
  title: '',
};

// ─── Error Types ──────────────────────────────────────────────────────────────

class ServerUnreachableError extends Error {
  constructor(message = 'Cannot reach local server. Run: python server.py', cause = null) {
    super(message);
    this.name = 'ServerUnreachableError';
    this.isServerError = true;
    this.errorCode = 'SERVER_UNREACHABLE';
    this.cause = cause;
    this.recoveryAction = 'showStartInstructions';
  }
}

class ServerTimeoutError extends Error {
  constructor(message = 'Server request timed out. Check if server.py is running.', timeoutMs = null) {
    super(message);
    this.name = 'ServerTimeoutError';
    this.isServerError = true;
    this.errorCode = 'SERVER_TIMEOUT';
    this.timeoutMs = timeoutMs;
    this.recoveryAction = 'retry';
  }
}

class ConnectionRefusedError extends Error {
  constructor(message = 'Connection refused. Start the server: python server.py') {
    super(message);
    this.name = 'ConnectionRefusedError';
    this.isServerError = true;
    this.errorCode = 'CONNECTION_REFUSED';
    this.recoveryAction = 'showStartInstructions';
  }
}

class DNSResolutionError extends Error {
  constructor(message = 'DNS resolution failed. Check your network connection.') {
    super(message);
    this.name = 'DNSResolutionError';
    this.isServerError = true;
    this.errorCode = 'DNS_RESOLUTION_FAILED';
    this.recoveryAction = 'showDNSHelp';
  }
}

class NetworkDisconnectedError extends Error {
  constructor(message = 'Network appears to be disconnected. Check your internet connection.') {
    super(message);
    this.name = 'NetworkDisconnectedError';
    this.isServerError = true;
    this.errorCode = 'NETWORK_DISCONNECTED';
    this.recoveryAction = 'checkNetwork';
  }
}

class ServerOverloadedError extends Error {
  constructor(message = 'Server is overloaded. Please try again in a moment.') {
    super(message);
    this.name = 'ServerOverloadedError';
    this.isServerError = true;
    this.errorCode = 'SERVER_OVERLOADED';
    this.recoveryAction = 'retry';
  }
}

class ConnectionResetError extends Error {
  constructor(message = 'Connection was reset. The server may have restarted.') {
    super(message);
    this.name = 'ConnectionResetError';
    this.isServerError = true;
    this.errorCode = 'CONNECTION_RESET';
    this.recoveryAction = 'reconnect';
  }
}
    this.errorCode = 'DNS_RESOLUTION_FAILED';
  }
}

class NetworkDisconnectedError extends Error {
  constructor(message = 'No internet connection. Check your network.') {
    super(message);
    this.name = 'NetworkDisconnectedError';
    this.isServerError = true;
    this.errorCode = 'NETWORK_DISCONNECTED';
  }
}

class SSLCertificateError extends Error {
  constructor(message = 'SSL certificate error. The server may have security issues.') {
    super(message);
    this.name = 'SSLCertificateError';
    this.isServerError = true;
    this.errorCode = 'SSL_CERTIFICATE_ERROR';
  }
}

class ServerOverloadedError extends Error {
  constructor(message = 'Server is overloaded. Please try again later.') {
    super(message);
    this.name = 'ServerOverloadedError';
    this.isServerError = true;
    this.errorCode = 'SERVER_OVERLOADED';
  }
}

class ServerHTTPError extends Error {
  constructor(statusCode, message) {
    super(message || `Server returned HTTP ${statusCode}`);
    this.name = 'ServerHTTPError';
    this.isServerError = true;
    this.errorCode = 'SERVER_HTTP_ERROR';
    this.statusCode = statusCode;
  }
}

class OpenAIError extends Error {
  constructor(message, errorCode = 'OPENAI_ERROR') {
    super(message);
    this.name = 'OpenAIError';
    this.isOpenAIError = true;
    this.errorCode = errorCode;
  }
}

// ─── Utility Functions ────────────────────────────────────────────────────────

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Categorizes a fetch error into a specific error type
 */
function categorizeNetworkError(error, isServerCall = false) {
  const errorMessage = error.message || '';
  const errorString = error.toString().toLowerCase();
  
  // Timeout errors
  if (error.name === 'AbortError' || error instanceof ServerTimeoutError) {
    return new ServerTimeoutError('Request timed out. The server may be unresponsive or overloaded.');
  }
  
  // Connection refused errors - server not running
  if (errorMessage.includes('net::ERR_CONNECTION_REFUSED') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ERR_CONNECTION_REFUSED') ||
      errorMessage.includes('Failed to fetch')) {
    return new ConnectionRefusedError('Connection refused. Make sure server.py is running: python server.py');
  }
  
  // Network disconnected
  if (errorMessage.includes('net::ERR_INTERNET_DISCONNECTED') ||
      errorMessage.includes('net::ERR_NETWORK_CHANGED') ||
      errorMessage.includes('ERR_NETWORK_IO_SUSPENDED') ||
      errorMessage.includes('NetworkError')) {
    return new NetworkDisconnectedError('Network appears to be disconnected. Check your internet connection.');
  }
  
  // DNS resolution failures
  if (errorMessage.includes('net::ERR_NAME_NOT_RESOLVED') ||
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('getaddrinfo')) {
    return new DNSResolutionError('DNS resolution failed. Check your network connection.');
  }
  
  // Connection reset
  if (errorMessage.includes('net::ERR_CONNECTION_RESET') ||
      errorMessage.includes('ECONNRESET') ||
      errorMessage.includes('ERR_CONNECTION_CLOSED')) {
    return new ConnectionResetError('Connection was reset. The server may have restarted.');
  }
  
  // Server overloaded (503, 429)
  if (errorMessage.includes('503') || errorMessage.includes('429') ||
      errorMessage.includes('Service Unavailable') ||
      errorMessage.includes('Too Many Requests')) {
    return new ServerOverloadedError('Server is overloaded. Please try again in a moment.');
  }

/**
 * Broadcast server status to all extension components
 */
function broadcastServerStatus(status) {
  serverStatus = { ...serverStatus, ...status, lastCheck: Date.now() };
  
  // Send to popup if open
  chrome.runtime.sendMessage({
    action: 'serverStatusUpdate',
    status: serverStatus,
    details: status.lastError ? getErrorDetails(status.lastError) : null
  }).catch(() => {
    // Popup might not be open, ignore error
  });
}
  const errorMessage = error.message || '';
  const errorString = error.toString().toLowerCase();
  
  // Timeout errors
  if (error.name === 'AbortError' || error instanceof ServerTimeoutError) {
    return new ServerTimeoutError('Request timed out. The server may be unresponsive or overloaded.');
  }
  
  // Connection refused errors - server not running
  if (errorMessage.includes('net::ERR_CONNECTION_REFUSED') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ERR_CONNECTION_REFUSED')) {
    return new ConnectionRefusedError('Connection refused. Make sure server.py is running: python server.py');
  }
  
  // Connection reset - server crashed or closed connection
  if (errorMessage.includes('net::ERR_CONNECTION_RESET') ||
      errorMessage.includes('ECONNRESET') ||
      errorMessage.includes('ERR_CONNECTION_RESET')) {
    return new ServerUnreachableError('Connection was reset. The server may have crashed. Restart with: python server.py', 'CONNECTION_RESET');
  }
  
  // Connection closed prematurely
  if (errorMessage.includes('net::ERR_CONNECTION_CLOSED') ||
      errorMessage.includes('ERR_CONNECTION_CLOSED')) {
    return new ServerUnreachableError('Connection closed unexpectedly. The server may be restarting.', 'CONNECTION_CLOSED');
  }
  
  // DNS resolution failures
  if (errorMessage.includes('net::ERR_NAME_NOT_RESOLVED') ||
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('ERR_NAME_NOT_RESOLVED') ||
      errorMessage.includes('getaddrinfo')) {
    return new DNSResolutionError('Cannot resolve server address. Check if localhost is configured correctly.');
  }
  
  // No internet connection
  if (errorMessage.includes('net::ERR_INTERNET_DISCONNECTED') ||
      errorMessage.includes('ERR_INTERNET_DISCONNECTED') ||
      errorString.includes('offline')) {
    return new NetworkDisconnectedError('No internet connection. Please check your network.');
  }
  
  // Network changed (e.g., WiFi switched)
  if (errorMessage.includes('net::ERR_NETWORK_CHANGED') ||
      errorMessage.includes('ERR_NETWORK_CHANGED')) {
    return new ServerUnreachableError('Network changed. Please retry the request.', 'NETWORK_CHANGED');
  }
  
  // SSL/TLS errors
  if (errorMessage.includes('net::ERR_CERT') ||
      errorMessage.includes('ERR_SSL') ||
      errorMessage.includes('SSL') ||
      errorMessage.includes('certificate')) {
    return new SSLCertificateError('SSL certificate error. Try using http://localhost:5000 instead of https.');
  }
  
  // Connection timed out (different from request timeout)
  if (errorMessage.includes('net::ERR_CONNECTION_TIMED_OUT') ||
      errorMessage.includes('ETIMEDOUT') ||
      errorMessage.includes('ERR_CONNECTION_TIMED_OUT')) {
    return new ServerTimeoutError('Connection timed out. The server may be unreachable or blocked by firewall.');
  }
  
  // Address unreachable
  if (errorMessage.includes('net::ERR_ADDRESS_UNREACHABLE') ||
      errorMessage.includes('EHOSTUNREACH') ||
      errorMessage.includes('ERR_ADDRESS_UNREACHABLE')) {
    return new ServerUnreachableError('Server address is unreachable. Check if the server is running on the correct port.', 'ADDRESS_UNREACHABLE');
  }
  
  // Too many connections / server overloaded
  if (errorMessage.includes('net::ERR_INSUFFICIENT_RESOURCES') ||
      errorMessage.includes('EMFILE') ||
      errorMessage.includes('ENFILE')) {
    return new ServerOverloadedError('Too many connections. The server may be overloaded.');
  }
  
  // Generic network errors
  if (errorMessage.includes('Failed to fetch') ||
      errorMessage.includes('NetworkError') ||
      errorMessage.includes('fetch failed') ||
      errorString.includes('network')) {
    if (isServerCall) {
      return new ServerUnreachableError('Network error. Check your connection and ensure server.py is running on port 5000.', 'NETWORK_ERROR');
    }
    return error;
  }
  
  // Connection reset
  if (errorMessage.includes('net::ERR_CONNECTION_RESET') ||
      errorMessage.includes('ECONNRESET')) {
    return new ServerUnreachableError('Connection was reset. The server may have crashed.');
  }
  
  // Default for server calls
  if (isServerCall) {
    return new ServerUnreachableError();
  }
  
  return error;
}

// ─── Fetch with Timeout ───────────────────────────────────────────────────────

async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new ServerTimeoutError();
    }
    throw error;
  }
}

// ─── Retry Logic with Exponential Backoff ─────────────────────────────────────

async function fetchWithRetry(url, options = {}, maxRetries = MAX_RETRIES, isServerCall = false) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options);
      
      // Reset consecutive failures on success
      if (isServerCall) {
        serverStatus.consecutiveFailures = 0;
      }
      
      return response;
    } catch (error) {
      lastError = categorizeNetworkError(error, isServerCall);
      
      // Don't retry on timeout errors for server calls - fail fast
      if (lastError instanceof ServerTimeoutError) {
        if (isServerCall) {
          serverStatus.consecutiveFailures++;
        }
        throw lastError;
      }
      
      // Don't retry on connection refused - server is definitely not running
      if (lastError instanceof ConnectionRefusedError) {
        if (isServerCall) {
          serverStatus.consecutiveFailures++;
        }
        throw lastError;
      }
      
      // If this is the last attempt, throw the error
      if (attempt === maxRetries - 1) {
        if (isServerCall) {
          serverStatus.consecutiveFailures++;
        }
        break;
      }
      
      // Exponential backoff: 1s, 2s, 4s...
      const delay = RETRY_DELAY * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
  
  // Transform generic fetch errors to more specific ones
  if (isServerCall && !(lastError instanceof ServerUnreachableError) && 
      !(lastError instanceof ConnectionRefusedError) && 
      !(lastError instanceof ServerTimeoutError)) {
    throw new ServerUnreachableError();
  }
  throw lastError;
}

// ─── Health Check ─────────────────────────────────────────────────────────────

async function checkServerHealth() {
  try {
    const response = await fetchWithTimeout(`${SERVER_URL}/health`, {}, 5000);
    
    if (response.ok) {
      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        serverStatus = {
          isConnected: false,
          lastCheck: Date.now(),
          lastError: 'Server returned invalid JSON response',
          consecutiveFailures: serverStatus.consecutiveFailures + 1
        };
        return { connected: false, error: 'Server returned invalid response', errorCode: 'INVALID_RESPONSE' };
      }
      
      serverStatus = {
        isConnected: data.status === 'ok',
        lastCheck: Date.now(),
        lastError: null,
        consecutiveFailures: 0
      };
      return { connected: true, status: 'ok' };
    } else {
      const errorMsg = `Server returned HTTP ${response.status}`;
      serverStatus = {
        isConnected: false,
        lastCheck: Date.now(),
        lastError: errorMsg,
        consecutiveFailures: serverStatus.consecutiveFailures + 1
      };
      return { 
        connected: false, 
        error: errorMsg, 
        errorCode: 'SERVER_HTTP_ERROR',
        statusCode: response.status 
      };
    }
  } catch (error) {
    const categorizedError = categorizeNetworkError(error, true);
    let errorMessage = 'Cannot reach local server';
    let errorCode = 'SERVER_UNREACHABLE';
    
    if (categorizedError instanceof ServerTimeoutError) {
      errorMessage = 'Server health check timed out. The server may be overloaded.';
      errorCode = 'SERVER_TIMEOUT';
    } else if (categorizedError instanceof ConnectionRefusedError) {
      errorMessage = 'Server not running. Start with: python server.py';
      errorCode = 'CONNECTION_REFUSED';
    } else if (categorizedError instanceof ServerUnreachableError) {
      errorMessage = categorizedError.message;
      errorCode = categorizedError.errorCode;
    }
    
    serverStatus = {
      isConnected: false,
      lastCheck: Date.now(),
      lastError: errorMessage,
      consecutiveFailures: serverStatus.consecutiveFailures + 1
    };
    
    return { connected: false, error: errorMessage, errorCode };
  }
}

/**
 * Start periodic health checks
 */
function startPeriodicHealthCheck() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
  }
  
  healthCheckTimer = setInterval(async () => {
    await checkServerHealth();
    // Broadcast status update to any listening popups
    chrome.runtime.sendMessage({ 
      action: 'serverStatusUpdate', 
      status: serverStatus 
    }).catch(() => {
      // Ignore errors if no listeners
    });
  }, HEALTH_CHECK_INTERVAL);
}

/**
 * Stop periodic health checks
 */
function stopPeriodicHealthCheck() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

// Start health checks when background script loads
startPeriodicHealthCheck();

// ─── Transcript via local Python server ───────────────────────────────────────

async function fetchTranscript(videoId) {
  let res, text;
  
  try {
    res = await fetchWithRetry(
      `${SERVER_URL}/transcript?video_id=${videoId}`,
      {},
      2, // Only 2 retries for transcript fetch
      true // This is a server call
    );
  } catch (error) {
    // Update server status on failure
    serverStatus = {
      isConnected: false,
      lastCheck: Date.now(),
      lastError: error.message,
      consecutiveFailures: serverStatus.consecutiveFailures + 1
    };
    
    if (error instanceof ServerTimeoutError) {
      throw new ServerTimeoutError('Transcript fetch timed out. The video may have a very long transcript, or the server is unresponsive.');
    }
    if (error instanceof ConnectionRefusedError || error instanceof ServerUnreachableError) {
      throw error;
    }
    throw new ServerUnreachableError();
  }
  
  // Server is reachable if we got here
  serverStatus.isConnected = true;
  serverStatus.lastCheck = Date.now();
  serverStatus.consecutiveFailures = 0;
  
  try {
    text = await res.text();
    if (!text || !text.trim()) {
      throw new ServerHTTPError(res.status, `Server returned empty response (HTTP ${res.status}). Check terminal for errors.`);
    }
    
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      throw new ServerHTTPError(res.status, `Server returned non-JSON response: ${text.slice(0, 100)}...`);
    }
    
    if (!res.ok) {
      const errorMsg = data.error || `Server error (HTTP ${res.status})`;
      throw new ServerHTTPError(res.status, errorMsg);
    }
    
    if (!data.transcript) {
      throw new Error('Server response missing transcript data');
    }
    
    return data.transcript;
  } catch (e) {
    if (e instanceof ServerHTTPError) {
      throw e;
    }
    throw new Error(e.message);
  }
}

// ─── OpenAI helpers ───────────────────────────────────────────────────────────

async function safeFetch(url, options = {}) {
  let res, text;
  
  try {
    res = await fetchWithTimeout(url, options, 30000); // 30s timeout for OpenAI
  } catch (error) {
    if (error instanceof ServerTimeoutError) {
      throw new OpenAIError('OpenAI request timed out. Please try again.', 'OPENAI_TIMEOUT');
    }
    if (error.message?.includes('Failed to fetch')) {
      throw new OpenAIError('Cannot reach OpenAI API. Check your internet connection.', 'OPENAI_NETWORK_ERROR');
    }
    throw new OpenAIError(`Network error: ${error.message}`, 'OPENAI_NETWORK_ERROR');
  }
  
  try {
    text = await res.text();
  } catch (error) {
    throw new OpenAIError('Failed to read response from OpenAI.', 'OPENAI_READ_ERROR');
  }
  
  if (!text || !text.trim()) {
    throw new OpenAIError(`Empty response from OpenAI (HTTP ${res.status})`, 'OPENAI_EMPTY_RESPONSE');
  }
  
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new OpenAIError(`Non-JSON response from OpenAI: ${text.slice(0, 200)}`, 'OPENAI_INVALID_RESPONSE');
  }
  
  return { res, data };
}

async function getEmbedding(text, apiKey) {
  try {
    const { res, data } = await safeFetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
    });
    

... [truncated to fit context window]