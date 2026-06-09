# server.py
# Run: python server.py
# Install: pip install "youtube-transcript-api>=1.0.0" flask flask-cors

from flask import Flask, jsonify, request, make_response
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
import traceback
import sys
import time

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "OPTIONS"], "allow_headers": ["Content-Type"]}})

# Track server start time for uptime calculation
SERVER_START_TIME = time.time()

def add_cors_headers(response):
    """Add CORS headers to response for cross-origin requests."""
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

def error_response(message, status_code, error_code=None):
    """Create a standardized error response with CORS headers."""
    response_data = {
        'error': message,
        'status': 'error',
        'error_code': error_code or f'ERROR_{status_code}',
        'timestamp': time.time()
    }
    response = make_response(jsonify(response_data), status_code)
    return add_cors_headers(response)

@app.errorhandler(Exception)
def handle_exception(e):
    """Global exception handler to ensure CORS headers on all errors."""
    traceback.print_exc()
    
    # Provide more specific error codes based on exception type
    error_code = 'INTERNAL_ERROR'
    status_code = 500
    message = str(e) or 'An unexpected error occurred'
    
    if isinstance(e, ConnectionError):
        error_code = 'CONNECTION_ERROR'
        message = 'A connection error occurred while processing the request'
    elif isinstance(e, TimeoutError):
        error_code = 'TIMEOUT_ERROR'
        message = 'The request timed out'
    elif isinstance(e, MemoryError):
        error_code = 'SERVER_OVERLOADED'
        status_code = 503
        message = 'Server is overloaded. Please try again later.'
    
    return error_response(
        message=message,
        status_code=status_code,
        error_code=error_code
    )

@app.errorhandler(404)
def handle_not_found(e):
    """Handle 404 errors with CORS headers."""
    return error_response(
        message='Endpoint not found',
        status_code=404,
        error_code='NOT_FOUND'
    )

@app.errorhandler(500)
def handle_internal_error(e):
    """Handle 500 errors with CORS headers."""
    return error_response(
        message='Internal server error',
        status_code=500,
        error_code='INTERNAL_ERROR'
    )
@app.errorhandler(503)
def handle_service_unavailable(e):
    """Handle 503 Service Unavailable errors with CORS headers."""
    return error_response(
        message='Service temporarily unavailable. Please try again later.',
        status_code=503,
        error_code='SERVER_UNAVAILABLE'
    )

@app.errorhandler(429)
def handle_rate_limit(e):
    """Handle 429 Too Many Requests errors with CORS headers."""
    return error_response(
        message='Too many requests. Please wait before trying again.',
        status_code=429,
        error_code='RATE_LIMITED'
    )
def handle_internal_error(e):
    """Handle 500 errors with CORS headers."""
    return error_response(
        message='Internal server error',
        status_code=500,
        error_code='INTERNAL_ERROR'
    )

@app.route('/transcript')
def get_transcript():
    video_id = request.args.get('video_id', '').strip()
    if not video_id:
        return error_response('Missing video_id', 400, 'MISSING_VIDEO_ID')
    try:
        ytt = YouTubeTranscriptApi()
        try:
            fetched = ytt.fetch(video_id, languages=['en'])
        except NoTranscriptFound:
            fetched = ytt.fetch(video_id)
        transcript = " ".join(chunk.text for chunk in fetched)
        if not transcript.strip():
            return error_response('Transcript is empty', 404, 'EMPTY_TRANSCRIPT')
        response = make_response(jsonify({
            'transcript': transcript,
            'status': 'ok',
            'video_id': video_id,
            'timestamp': time.time()
        }))
        return add_cors_headers(response)
    except TranscriptsDisabled:
        return error_response('Transcripts are disabled for this video', 404, 'TRANSCRIPTS_DISABLED')
    except NoTranscriptFound:
        return error_response('No transcript found for this video', 404, 'NO_TRANSCRIPT')
    except Exception as e:
        traceback.print_exc()
        return error_response(str(e), 500, 'TRANSCRIPT_FETCH_ERROR')

@app.route('/health')
def health():
    """Enhanced health endpoint with diagnostic information."""
    try:
        uptime_seconds = time.time() - SERVER_START_TIME
        
        # Check if youtube-transcript-api is available
        transcript_api_available = True
        transcript_api_version = 'unknown'
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            import youtube_transcript_api
            transcript_api_version = getattr(youtube_transcript_api, '__version__', 'unknown')
        except ImportError:
            transcript_api_available = False
        
        response = make_response(jsonify({
            'status': 'ok',
            'version': '1.0.0',
            'uptime_seconds': round(uptime_seconds, 2),
            'python_version': sys.version.split()[0],
            'timestamp': time.time(),
            'services': {
                'transcript_api': 'available' if transcript_api_available else 'unavailable',
                'transcript_api_version': transcript_api_version
            },
            'endpoints': {
                'health': '/health',
                'ping': '/ping',
                'transcript': '/transcript?video_id=<id>'
            }
        }))
        return add_cors_headers(response)
    except Exception as e:
        return error_response(f'Health check failed: {str(e)}', 500, 'HEALTH_CHECK_FAILED')

@app.route('/ping')
def ping():
    """Lightweight ping endpoint for quick connectivity checks."""
    try:
        response = make_response(jsonify({
            'pong': True,
            'timestamp': time.time(),
            'status': 'ok'
        }))
        return add_cors_headers(response)
    except Exception as e:
        return error_response(f'Ping failed: {str(e)}', 500, 'PING_FAILED')

# Handle OPTIONS requests for CORS preflight
@app.route('/<path:path>', methods=['OPTIONS'])
def handle_options(path):
    response = make_response()
    return add_cors_headers(response)

if __name__ == '__main__':
    print("✓ Server running at http://localhost:5000")
    print("  Health check: http://localhost:5000/health")
    print("  Quick ping:   http://localhost:5000/ping\n")
    app.run(port=5000, threaded=True)


@app.route('/health', methods=['GET', 'OPTIONS'])
def health_check():
    """Health check endpoint for monitoring server status."""
    if request.method == 'OPTIONS':
        response = make_response()
        return add_cors_headers(response)
    
    uptime = time.time() - SERVER_START_TIME
    
    # Check if required dependencies are available
    dependencies_status = {
        'youtube_transcript_api': True,
        'flask': True,
        'flask_cors': True
    }
    
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        dependencies_status['youtube_transcript_api'] = False
    
    all_deps_ok = all(dependencies_status.values())
    
    response_data = {
        'status': 'healthy' if all_deps_ok else 'degraded',
        'uptime_seconds': round(uptime, 2),
        'version': '1.0.0',
        'timestamp': time.time(),
        'server_url': 'http://127.0.0.1:5000',
        'endpoints': {
            'health': '/health',
            'transcript': '/transcript/<video_id>'
        },
        'dependencies': dependencies_status,
        'ready': all_deps_ok
    }
    
    response = jsonify(response_data)
    return add_cors_headers(response)