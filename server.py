# server.py
# Run: python server.py
# Install: pip install "youtube-transcript-api>=1.0.0" flask flask-cors

from flask import Flask, jsonify, request
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
import traceback

app = Flask(__name__)
CORS(app)

@app.route('/transcript')
def get_transcript():
    video_id = request.args.get('video_id', '').strip()
    if not video_id:
        return jsonify({'error': 'Missing video_id'}), 400
    try:
        ytt = YouTubeTranscriptApi()
        try:
            fetched = ytt.fetch(video_id, languages=['en'])
        except NoTranscriptFound:
            fetched = ytt.fetch(video_id)
        transcript = " ".join(chunk.text for chunk in fetched)
        if not transcript.strip():
            return jsonify({'error': 'Transcript is empty'}), 404
        return jsonify({'transcript': transcript})
    except TranscriptsDisabled:
        return jsonify({'error': 'Transcripts are disabled for this video'}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    print("✓ Server running at http://localhost:5000\n")
    app.run(port=5000)