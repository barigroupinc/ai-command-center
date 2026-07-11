const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-6';

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

async function run(prompt, { system, maxTokens = 4096 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { output: null, error: 'ANTHROPIC_API_KEY is not configured' };
  }
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    return { output: text, error: null };
  } catch (err) {
    return { output: null, error: err.message || String(err) };
  }
}

module.exports = { name: 'claude', model: MODEL, run };
