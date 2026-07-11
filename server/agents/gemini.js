const { GoogleGenAI } = require('@google/genai');

const MODEL = 'gemini-2.5-flash';

let client = null;
function getClient() {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

async function run(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    return { output: null, error: 'GEMINI_API_KEY is not configured' };
  }
  try {
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: prompt,
    });
    return { output: response.text || '', error: null };
  } catch (err) {
    return { output: null, error: err.message || String(err) };
  }
}

module.exports = { name: 'gemini', model: MODEL, run };
