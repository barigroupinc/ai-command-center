const VALID_MODELS = new Set(['deepseek', 'qwen-coder', 'kimi']);

async function run(prompt, model = 'deepseek') {
  const useModel = VALID_MODELS.has(model) ? model : 'deepseek';
  const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=${encodeURIComponent(useModel)}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(text || 'Pollinations request failed');
  return { text, meta: { provider: 'pollinations', model: useModel } };
}

module.exports = { name: 'free', run };
