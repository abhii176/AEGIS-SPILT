const { env } = require('../../config/env');
const { parseAcceptanceCriteria, extractFilesFromDiff } = require('./parseCriteria');

/**
 * Call Gemini, OpenAI, or Anthropic for structured milestone audit JSON.
 * Inject `fetchImpl` / force provider in tests.
 */

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

function geminiProviderLabel(model = DEFAULT_GEMINI_MODEL) {
  const id = String(model || DEFAULT_GEMINI_MODEL).trim();
  if (id === DEFAULT_GEMINI_MODEL) return 'Gemini 2.5 Flash';
  return `Gemini (${id})`;
}

function resolveProvider({
  provider = env.ai?.provider || 'auto',
  geminiApiKey = env.ai?.geminiApiKey,
  geminiModel = env.ai?.geminiModel || DEFAULT_GEMINI_MODEL,
  openaiApiKey = env.ai?.openaiApiKey,
  anthropicApiKey = env.ai?.anthropicApiKey,
} = {}) {
  const pref = String(provider || 'auto').toLowerCase();
  const geminiModelId = geminiModel || DEFAULT_GEMINI_MODEL;
  if (pref === 'deterministic' || pref === 'none' || pref === 'off') {
    return { name: null, reason: 'forced_deterministic' };
  }
  if (pref === 'gemini') {
    return geminiApiKey
      ? { name: 'gemini', apiKey: geminiApiKey, model: geminiModelId }
      : { name: null, reason: 'gemini_key_missing' };
  }
  if (pref === 'openai') {
    return openaiApiKey
      ? { name: 'openai', apiKey: openaiApiKey }
      : { name: null, reason: 'openai_key_missing' };
  }
  if (pref === 'anthropic') {
    return anthropicApiKey
      ? { name: 'anthropic', apiKey: anthropicApiKey }
      : { name: null, reason: 'anthropic_key_missing' };
  }
  // auto — Gemini first (free AI Studio key), then OpenAI, then Anthropic
  if (geminiApiKey) return { name: 'gemini', apiKey: geminiApiKey, model: geminiModelId };
  if (openaiApiKey) return { name: 'openai', apiKey: openaiApiKey };
  if (anthropicApiKey) return { name: 'anthropic', apiKey: anthropicApiKey };
  return { name: null, reason: 'no_api_key' };
}

function buildPrompt({ milestoneId, acceptanceCriteria, criteria, diff, files }) {
  const fileList = files?.length ? files : extractFilesFromDiff(diff);
  const diffClip = String(diff || '').slice(0, 14000);
  return {
    system: `You are Aegis-Split's milestone code auditor for a hackathon escrow product.
Compare a GitHub PR diff against acceptance criteria. Be strict but practical.
Return ONLY valid JSON with this shape:
{"passed":boolean,"reason":string,"checks":[{"criterion":string,"met":boolean,"evidence":string}]}
- Include one checks[] entry per criterion (same wording).
- passed is true only if every criterion is met.
- evidence must cite a file path and/or short diff snippet when possible.
- Do not invent files that are not in the diff.`,
    user: JSON.stringify(
      {
        milestoneId,
        acceptanceCriteria,
        criteria,
        files: fileList,
        diff: diffClip,
      },
      null,
      2
    ),
  };
}

function normalizeLlmResult(parsed, criteria, provider) {
  const checksIn = Array.isArray(parsed?.checks) ? parsed.checks : [];
  const checks = criteria.map((criterion, i) => {
    const hit =
      checksIn.find(
        (c) => String(c?.criterion || '').trim().toLowerCase() === criterion.toLowerCase()
      ) || checksIn[i];
    return {
      criterion,
      met: Boolean(hit?.met),
      evidence: String(hit?.evidence || hit?.reason || 'No evidence returned by model.'),
    };
  });
  const allMet = checks.length > 0 && checks.every((c) => c.met);
  const passed = typeof parsed?.passed === 'boolean' ? parsed.passed && allMet : allMet;
  const reason =
    String(parsed?.reason || '').trim() ||
    (passed
      ? `All ${checks.length} criteria met (${provider}).`
      : `One or more criteria unmet (${provider}).`);

  return {
    passed,
    reason,
    checks,
    engine: 'llm',
    provider,
    score: checks.length ? checks.filter((c) => c.met).length / checks.length : 0,
  };
}

async function callOpenAi({
  apiKey,
  model = env.ai?.openaiModel || 'gpt-4o-mini',
  system,
  user,
  fetchImpl = globalThis.fetch,
}) {
  const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`OpenAI audit failed (${res.status}): ${text.slice(0, 200)}`);
    err.code = 'openai_audit_failed';
    err.status = 502;
    throw err;
  }
  const data = JSON.parse(text);
  const content = data.choices?.[0]?.message?.content || '{}';
  return JSON.parse(content);
}

async function callAnthropic({
  apiKey,
  model = env.ai?.anthropicModel || 'claude-3-5-haiku-latest',
  system,
  user,
  fetchImpl = globalThis.fetch,
}) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Anthropic audit failed (${res.status}): ${text.slice(0, 200)}`);
    err.code = 'anthropic_audit_failed';
    err.status = 502;
    throw err;
  }
  const data = JSON.parse(text);
  const content = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
}

async function callGemini({
  apiKey,
  model = env.ai?.geminiModel || DEFAULT_GEMINI_MODEL,
  system,
  user,
  fetchImpl = globalThis.fetch,
}) {
  const modelId = model || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Gemini audit failed (${res.status}): ${text.slice(0, 200)}`);
    err.code = 'gemini_audit_failed';
    err.status = 502;
    throw err;
  }
  const data = JSON.parse(text);
  const parts = data.candidates?.[0]?.content?.parts || [];
  if (!parts.length) {
    const err = new Error(
      `Gemini audit failed: ${data.promptFeedback?.blockReason || 'no candidates'}`
    );
    err.code = 'gemini_audit_failed';
    err.status = 502;
    throw err;
  }
  // Gemini 2.5 may attach thought parts ahead of the JSON answer. Use the visible text.
  const visible = parts.filter((p) => !p.thought && p.text);
  const content = (visible.length ? visible : parts).map((p) => p.text || '').join('\n');
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
}

/**
 * @returns {Promise<object|null>} structured audit or null to signal fallback
 */
async function auditWithLlm(args, deps = {}) {
  const {
    geminiApiKey = env.ai?.geminiApiKey,
    geminiModel = env.ai?.geminiModel || DEFAULT_GEMINI_MODEL,
    openaiApiKey = env.ai?.openaiApiKey,
    anthropicApiKey = env.ai?.anthropicApiKey,
    provider = env.ai?.provider || 'auto',
    fetchImpl = globalThis.fetch,
    geminiCaller = callGemini,
    openaiCaller = callOpenAi,
    anthropicCaller = callAnthropic,
  } = deps;

  const resolved = resolveProvider({
    provider,
    geminiApiKey,
    geminiModel,
    openaiApiKey,
    anthropicApiKey,
  });
  if (!resolved.name) return null;

  const criteria = parseAcceptanceCriteria(args.acceptanceCriteria);
  if (!criteria.length) return null;

  const prompt = buildPrompt({
    milestoneId: args.milestoneId,
    acceptanceCriteria: args.acceptanceCriteria,
    criteria,
    diff: args.diff,
    files: args.files,
  });

  let parsed;
  if (resolved.name === 'gemini') {
    parsed = await geminiCaller({
      apiKey: resolved.apiKey,
      model: resolved.model || DEFAULT_GEMINI_MODEL,
      system: prompt.system,
      user: prompt.user,
      fetchImpl,
    });
  } else if (resolved.name === 'openai') {
    parsed = await openaiCaller({
      apiKey: resolved.apiKey,
      system: prompt.system,
      user: prompt.user,
      fetchImpl,
    });
  } else if (resolved.name === 'anthropic') {
    parsed = await anthropicCaller({
      apiKey: resolved.apiKey,
      system: prompt.system,
      user: prompt.user,
      fetchImpl,
    });
  } else {
    return null;
  }

  const normalized = normalizeLlmResult(parsed, criteria, resolved.name);
  if (resolved.name === 'gemini') {
    normalized.model = resolved.model || DEFAULT_GEMINI_MODEL;
    normalized.providerLabel = geminiProviderLabel(normalized.model);
  }
  return normalized;
}

module.exports = {
  DEFAULT_GEMINI_MODEL,
  resolveProvider,
  geminiProviderLabel,
  buildPrompt,
  normalizeLlmResult,
  callGemini,
  callOpenAi,
  callAnthropic,
  auditWithLlm,
};
