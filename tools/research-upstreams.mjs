import fs from 'node:fs';
import path from 'node:path';
const defaults = ['diegosouzapw/OmniRoute', 'maximhq/bifrost', 'BerriAI/litellm',
  'anthropics/claude-agent-sdk-typescript', 'openai/codex', 'anomalyco/opencode',
  'google-gemini/gemini-cli', 'QwenLM/qwen-code', 'Aider-AI/aider', 'block/goose', 'cline/cline',
  'modelcontextprotocol/specification', 'a2aproject/A2A', 'agentclientprotocol/agent-client-protocol',
  'ag-ui-protocol/ag-ui', 'ollama/ollama', 'ggml-org/llama.cpp', 'microsoft/Foundry-Local',
  'microsoft/onnxruntime', 'headroomlabs-ai/headroom', 'thedotmack/claude-mem', 'mem0ai/mem0',
  'oraios/serena', 'upstash/context7', 'langchain-ai/langgraph', 'microsoft/autogen',
  'electron/electron', 'tauri-apps/tauri', 'ggml-org/whisper.cpp', 'OHF-Voice/piper1-gpl', 'microsoft/OmniParser'];
const requested = process.argv.slice(2);
if (requested.some(repo => !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))) throw new Error('Invalid repository identity');
const repos = requested.length ? requested : defaults;
const out = path.resolve(`docs/evidence/north-star/research/${requested.length ? 'upstream-supplement' : 'upstream-catalog'}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
const records = [];
async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'JARVIS-Architecture-Research' }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP_${r.status}`);
  return r.json();
}
for (const repo of repos) {
  try {
    const metadata = await fetchJson(`https://api.github.com/repos/${repo}`);
    let release = null; let releaseReason = null;
    try { release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`); }
    catch (error) { releaseReason = String(error); }
    records.push({ repo, url: metadata.html_url, verifiedDate: '2026-09-30', fetchedAt: new Date().toISOString(),
      licenseSpdx: metadata.license?.spdx_id ?? 'UNKNOWN', archived: metadata.archived, pushedAt: metadata.pushed_at,
      defaultBranch: metadata.default_branch, openIssues: metadata.open_issues_count,
      latestRelease: release ? { tag: release.tag_name, publishedAt: release.published_at, url: release.html_url,
        afterResearchDate: release.published_at?.slice(0, 10) > '2026-09-30' } : null, releaseReason });
    console.log(`RESEARCH_OK ${repo} ${release?.tag_name ?? 'NO_RELEASE'} ${metadata.license?.spdx_id ?? 'UNKNOWN'}`);
  } catch (error) { records.push({ repo, verifiedDate: '2026-09-30', status: 'UNKNOWN', reason: String(error) }); console.log(`RESEARCH_UNKNOWN ${repo} ${error}`); }
  fs.writeFileSync(out, JSON.stringify({ researcher: 'Codex, agente basado en GPT-5, OpenAI', verifiedDate: '2026-09-30', records }, null, 2) + '\n');
}
