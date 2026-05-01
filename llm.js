const fetch = require('node-fetch');
require('dotenv').config();

const BASE_URL = process.env.LLAMA_BASE_URL || 'http://localhost:8080';
const API_KEY = process.env.LLAMA_API_KEY || 'sk-zee-69ab26018b70d72f64cff26eec58c752be4aef6844bf7489';

async function* chatStream(messages) {
  const url = `${BASE_URL}/v1/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      messages,
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(`LLM API Error: ${response.status} ${response.statusText}`);
  }

  // Handle SSE streaming
  const decoder = new (require('util').TextDecoder)("utf-8");
  for await (const chunk of response.body) {
    const text = decoder.decode(chunk, { stream: true });
    const lines = text.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') return;
        
        try {
          const data = JSON.parse(dataStr);
          if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
            yield data.choices[0].delta.content;
          }
        } catch (e) {
          // Ignore parse errors on partial chunks
        }
      }
    }
  }
}

async function complete(prompt, maxTokens = 100) {
  const url = `${BASE_URL}/v1/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`LLM API Error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.choices && data.choices.length > 0) {
    return data.choices[0].message.content.trim();
  }
  return '';
}

module.exports = {
  chatStream,
  complete
};
