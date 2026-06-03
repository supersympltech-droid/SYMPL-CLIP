/**
 * SymplClip Transcribe Function
 * Netlify serverless function — runs on Netlify's servers
 * Browser sends audio blob → this function → OpenAI → word timestamps back to browser
 * The OPENAI_API_KEY environment variable is never exposed to the browser
 */

exports.handler = async function(event, context) {

  /* ── Only allow POST ── */
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  /* ── Check API key is available ── */
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'API key not configured on server' })
    };
  }

  try {
    /* ── Parse incoming request ── */
    let body;
    try {
      body = JSON.parse(event.body);
    } catch(e) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON body' })
      };
    }

    const { audioBase64, mimeType, language } = body;

    if (!audioBase64) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No audio data provided' })
      };
    }

    /* ── Convert base64 audio to buffer ── */
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const audioMime   = mimeType || 'audio/webm';

    /* ── Determine file extension from mime type ── */
    const extMap = {
      'audio/webm':  'webm',
      'audio/mp4':   'mp4',
      'audio/mpeg':  'mp3',
      'audio/wav':   'wav',
      'audio/ogg':   'ogg',
      'video/mp4':   'mp4',
      'video/webm':  'webm',
    };
    const ext = extMap[audioMime] || 'webm';
    const filename = 'audio.' + ext;

    /* ── Build multipart form for OpenAI ── */
    /* Using native fetch (available in Node 18+ which Netlify uses) */
    const boundary = '----SymplClipBoundary' + Date.now();

    /* Build multipart body manually — no external dependencies needed */
    const parts = [];

    /* file field */
    parts.push(
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n' +
      'Content-Type: ' + audioMime + '\r\n\r\n'
    );

    /* model field */
    const modelPart =
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="model"\r\n\r\n' +
      'whisper-1\r\n';

    /* response_format field — verbose_json gives word timestamps */
    const formatPart =
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="response_format"\r\n\r\n' +
      'verbose_json\r\n';

    /* timestamp_granularities — request word-level timing */
    const granPart =
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\n' +
      'word\r\n';

    /* language field (optional, improves accuracy) */
    const langPart = language
      ? '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="language"\r\n\r\n' +
        language + '\r\n'
      : '';

    const closePart = '--' + boundary + '--\r\n';

    /* Assemble multipart buffer */
    const textEncoder   = new TextEncoder();
    const headerBytes   = textEncoder.encode(parts[0]);
    const modelBytes    = textEncoder.encode(modelPart);
    const formatBytes   = textEncoder.encode(formatPart);
    const granBytes     = textEncoder.encode(granPart);
    const langBytes     = language ? textEncoder.encode(langPart) : new Uint8Array(0);
    const closeBytes    = textEncoder.encode(closePart);
    const crlf          = textEncoder.encode('\r\n');

    const totalLength =
      headerBytes.length + audioBuffer.length + crlf.length +
      modelBytes.length + formatBytes.length + granBytes.length +
      langBytes.length + closeBytes.length;

    const combined = new Uint8Array(totalLength);
    let offset = 0;

    function appendBytes(bytes) {
      combined.set(bytes, offset);
      offset += bytes.length;
    }

    appendBytes(headerBytes);
    appendBytes(new Uint8Array(audioBuffer));
    appendBytes(crlf);
    appendBytes(modelBytes);
    appendBytes(formatBytes);
    appendBytes(granBytes);
    appendBytes(langBytes);
    appendBytes(closeBytes);

    /* ── Call OpenAI Whisper API ── */
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
      },
      body: combined,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI API error:', response.status, errText);
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: 'Transcription API error',
          detail: errText
        })
      };
    }

    const result = await response.json();

    /* ── Shape the response for the app ── */
    /*
      result.text       — full transcript string
      result.words      — array of { word, start, end } (word-level timestamps)
      result.segments   — array of sentence-level segments with timestamps
    */

    const shaped = {
      text:     result.text     || '',
      words:    result.words    || [],
      segments: result.segments || [],
      duration: result.duration || 0,
      language: result.language || 'en',
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(shaped),
    };

  } catch (err) {
    console.error('Transcribe function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Server error',
        message: err.message || String(err)
      })
    };
  }
};
