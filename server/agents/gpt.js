const OpenAI = require('openai');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

let client = null;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

async function run(prompt) {
  if (!process.env.OPENAI_API_KEY) {
    return { output: null, error: 'OPENAI_API_KEY is not configured' };
  }
  try {
    const response = await getClient().chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.choices?.[0]?.message?.content || '';
    return { output: text, error: null };
  } catch (err) {
    return { output: null, error: err.message || String(err) };
  }
}

module.exports = { name: 'gpt', model: MODEL, run };
