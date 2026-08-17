import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const EMBEDDING_DIM = 256;
const KGRAM = 4;

/**
 * Keywords and operators are the structural skeleton of a program and are kept
 * verbatim. Identifiers and literals are the parts a copier renames first, so
 * they are collapsed to placeholders — that is what makes the resulting vector
 * survive `for (int i…)` → `for (int idx…)` style edits.
 */
const KEYWORDS = new Set([
  // control flow / declarations shared across the supported languages
  'if', 'else', 'elif', 'for', 'while', 'do', 'switch', 'case', 'default', 'break',
  'continue', 'return', 'goto', 'try', 'catch', 'except', 'finally', 'throw', 'raise',
  'def', 'function', 'lambda', 'class', 'struct', 'enum', 'union', 'typedef', 'template',
  'public', 'private', 'protected', 'static', 'const', 'constexpr', 'inline', 'virtual',
  'new', 'delete', 'this', 'self', 'super', 'import', 'from', 'include', 'using',
  'namespace', 'let', 'var', 'yield', 'async', 'await', 'in', 'is', 'not', 'and', 'or',
  'true', 'false', 'null', 'none', 'nullptr', 'undefined', 'void', 'int', 'long', 'short',
  'char', 'float', 'double', 'bool', 'string', 'auto', 'unsigned', 'signed', 'size_t',
  // container/algorithm names carry real signal about approach
  'vector', 'map', 'set', 'unordered_map', 'unordered_set', 'queue', 'stack', 'deque',
  'priority_queue', 'pair', 'list', 'dict', 'tuple', 'sort', 'push_back', 'append',
  'len', 'range', 'print', 'cout', 'cin', 'printf', 'scanf', 'input', 'console',
]);

/** Removes comments and string/char literals, which carry no structural signal. */
function stripNoise(code) {
  return String(code)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // /* block */
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')  // // line  (the guard avoids URLs)
    .replace(/#[^\n]*/g, ' ')               // # line (Python, preprocessor)
    .replace(/"""[\s\S]*?"""/g, ' STR ')    // Python docstrings
    .replace(/'''[\s\S]*?'''/g, ' STR ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' STR ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' STR ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' STR ');
}

export function tokenize(code) {
  const cleaned = stripNoise(code);
  const raw = cleaned.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[^\sA-Za-z0-9_]/g) ?? [];

  return raw.map((token) => {
    if (/^\d/.test(token)) return 'NUM';
    if (/^[A-Za-z_]/.test(token)) {
      const lower = token.toLowerCase();
      return KEYWORDS.has(lower) ? lower : 'ID';
    }
    return token;
  });
}

/** FNV-1a — small, fast, and stable across processes. */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Signed feature hashing over token k-grams, log-weighted and L2-normalised.
 * The sign bit cancels collisions in expectation instead of letting them
 * inflate every bucket.
 */
export function localEmbed(code) {
  const tokens = tokenize(code);
  const counts = new Map();

  for (let i = 0; i + KGRAM <= tokens.length; i += 1) {
    const gram = tokens.slice(i, i + KGRAM).join('\u0001');
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }

  const vector = new Array(EMBEDDING_DIM).fill(0);
  for (const [gram, count] of counts) {
    const h = hash32(gram);
    const index = h % EMBEDDING_DIM;
    const sign = (h >>> 31) & 1 ? -1 : 1;
    vector[index] += sign * Math.log1p(count);
  }

  const norm = Math.hypot(...vector);
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

async function voyageEmbed(code) {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.voyageApiKey}`,
    },
    body: JSON.stringify({ input: [code.slice(0, 32_000)], model: env.voyageModel }),
  });

  if (!response.ok) {
    throw new Error(`Voyage embeddings failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json();
  const vector = body?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error('Voyage returned no embedding.');

  const norm = Math.hypot(...vector);
  return norm === 0 ? vector : vector.map((v) => v / norm);
}

/**
 * Returns an L2-normalised vector, so cosine similarity is a plain dot product.
 *
 * No hosted embedding provider is required by default, so the default provider is a
 * deterministic local vectoriser — no API key, no network, and well suited to
 * code because it works on normalised token structure rather than prose meaning.
 * Set EMBEDDING_PROVIDER=voyage to swap in a hosted code-embedding model.
 */
export async function embedCode(code) {
  if (env.embeddingProvider === 'voyage') {
    if (!env.voyageApiKey) {
      logger.warn('EMBEDDING_PROVIDER=voyage but VOYAGE_API_KEY is unset — using local embeddings.');
      return localEmbed(code);
    }
    try {
      return await voyageEmbed(code);
    } catch (err) {
      // A similarity check is not worth failing a judged submission over.
      logger.warn('voyage embedding failed, falling back to local:', err.message);
      return localEmbed(code);
    }
  }
  return localEmbed(code);
}

/** Both inputs are expected to be L2-normalised. */
export function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}
