/**
 * SymplClip AI Detect Function
 * Receives transcript + metadata, returns graded clip suggestions with captions
 * Called after transcribe.js has run
 */

exports.handler = async function(event, context) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { transcript, words, duration, contentType, topic, keywords } = body;

    if (!transcript || !words) {
      return { statusCode: 400, body: JSON.stringify({ error: 'transcript and words required' }) };
    }

    /* ── Build system prompt ── */
    const systemPrompt = `You are an expert video clip editor for social media.
You receive a full video transcript with word-level timestamps and identify the best shareable moments.
Each clip should:
- Be a complete thought or story — no cutting mid-sentence
- Be between 20 and 90 seconds long
- Work as a standalone piece of content
- Have a strong hook in the first 5 seconds
You must respond with valid JSON only. No markdown. No explanation outside the JSON.`;

    /* ── Build user prompt ── */
    const userPrompt = `Video type: ${contentType || 'general'}
Topic: ${topic || 'general'}
${keywords ? 'Keywords to prioritize: ' + keywords : ''}
Total duration: ${duration}s

Full transcript with word timestamps:
${JSON.stringify(words)}

Full transcript text:
${transcript}

Find the 3 to 6 best clips. Return this exact JSON structure:
{
  "clips": [
    {
      "start": 12.4,
      "end": 45.8,
      "grade": "A",
      "reason": "One sentence explaining why this is a strong clip",
      "hook": "The opening words of this clip",
      "captions": [
        { "word": "Welcome", "start": 12.4, "end": 12.8 },
        { "word": "to", "start": 12.9, "end": 13.1 }
      ]
    }
  ]
}
Grade scale: A = viral potential, B = strong, C = decent, D = weak but usable.
captions array must contain every word in the clip with its exact timestamp from the input.`;

    /* ── Call GPT-4o Mini ── */
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 4000,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI detect error:', response.status, errText);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: 'Detection API error', detail: errText })
      };
    }

    const result  = await response.json();
    const content = result.choices?.[0]?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch(e) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Invalid JSON from model', raw: content })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(parsed),
    };

  } catch (err) {
    console.error('Detect function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', message: err.message || String(err) })
    };
  }
};
