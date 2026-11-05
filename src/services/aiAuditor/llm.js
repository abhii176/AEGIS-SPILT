const { env } = require('../../config/env');
const { parseAcceptanceCriteria, extractFilesFromDiff } = require('./parseCriteria');

/**
 * Call OpenAI or Anthropic for structured milestone audit JSON.
 * Inject `fetchImpl` / force provider in tests.
 */

function resolveProvider({
  provider = env.ai?.provider || 'auto',
  openaiApiKey = env.ai?.openaiApiKey,
  anthropicApiKey = env.ai?.anthropicApiKey,
} = {}) {
  const pref = String(provider || 'auto').toLowerCase();
  if (pref === 'deterministic' || pref === 'none' || pref === 'off') {
    return { name: null, reason: 'forced_deterministic' };
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
  // auto
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

/**
 * @returns {Promise<object|null>} structured audit or null to signal fallback
 */
async function auditWithLlm(args, deps = {}) {
  const {
    openaiApiKey = env.ai?.openaiApiKey,
    anthropicApiKey = env.ai?.anthropicApiKey,
    provider = env.ai?.provider || 'auto',
    fetchImpl = globalThis.fetch,
    openaiCaller = callOpenAi,
    anthropicCaller = callAnthropic,
  } = deps;

  const resolved = resolveProvider({ provider, openaiApiKey, anthropicApiKey });
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
  if (resolved.name === 'openai') {
    parsed = await openaiCaller({
      apiKey: resolved.apiKey,
      system: prompt.system,
      user: prompt.user,
      fetchImpl,
    });
  } else {
    parsed = await anthropicCaller({
      apiKey: resolved.apiKey,
      system: prompt.system,
      user: prompt.user,
      fetchImpl,
    });
  }

  return normalizeLlmResult(parsed, criteria, resolved.name);
}

module.exports = {
  resolveProvider,
  buildPrompt,
  normalizeLlmResult,
  callOpenAi,
  callAnthropic,
  auditWithLlm,
};
