export const DEFAULT_EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const DEFAULT_EMBED_DIM = 384;
const MAX_TOKENS = 256;

export interface EmbedderOptions {
  model?: string;
  dim?: number;
  /** Override env var; primarily for tests. */
  fake?: boolean;
}

export interface Embedder {
  readonly model: string;
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
  embedOne(text: string): Promise<Float32Array>;
}

type FeatureExtractor = (
  texts: string | string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

let pipelineCache: Promise<FeatureExtractor> | null = null;
let pipelineCacheKey: string | null = null;

function isFakeMode(opt?: boolean): boolean {
  if (opt !== undefined) return opt;
  return process.env["APEX_VECTOR_FAKE"] === "1";
}

async function loadPipeline(model: string): Promise<FeatureExtractor> {
  if (pipelineCache && pipelineCacheKey === model) return pipelineCache;
  pipelineCacheKey = model;
  pipelineCache = (async (): Promise<FeatureExtractor> => {
    const mod = (await import("@xenova/transformers")) as unknown as {
      pipeline: (
        task: string,
        model: string,
        opts?: Record<string, unknown>,
      ) => Promise<FeatureExtractor>;
      env: { allowRemoteModels: boolean; allowLocalModels: boolean };
    };
    return mod.pipeline("feature-extraction", model, { quantized: true });
  })();
  return pipelineCache;
}

export function createEmbedder(opts: EmbedderOptions = {}): Embedder {
  const model = opts.model ?? DEFAULT_EMBED_MODEL;
  const dim = opts.dim ?? DEFAULT_EMBED_DIM;
  const fake = isFakeMode(opts.fake);

  if (fake) {
    return {
      model: `fake:${model}`,
      dim,
      async embed(texts: string[]): Promise<Float32Array[]> {
        return texts.map((t) => syntheticVector(t, dim));
      },
      async embedOne(text: string): Promise<Float32Array> {
        return syntheticVector(text, dim);
      },
    };
  }

  return {
    model,
    dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      const pipe = await loadPipeline(model);
      const truncated = texts.map(truncateForEmbedding);
      const tensor = await pipe(truncated, { pooling: "mean", normalize: true });
      const flat =
        tensor.data instanceof Float32Array
          ? tensor.data
          : new Float32Array(tensor.data as number[]);
      const [n, d] = tensor.dims as [number, number];
      const out: Float32Array[] = [];
      for (let i = 0; i < n; i++) {
        out.push(flat.slice(i * d, (i + 1) * d));
      }
      return out;
    },
    async embedOne(text: string): Promise<Float32Array> {
      const pipe = await loadPipeline(model);
      const tensor = await pipe(truncateForEmbedding(text), {
        pooling: "mean",
        normalize: true,
      });
      const flat =
        tensor.data instanceof Float32Array
          ? tensor.data
          : new Float32Array(tensor.data as number[]);
      return flat.slice(0, flat.length);
    },
  };
}

/** Crude word-based truncation; the tokenizer enforces the real limit downstream. */
function truncateForEmbedding(text: string): string {
  const words = text.split(/\s+/);
  if (words.length <= MAX_TOKENS) return text;
  return words.slice(0, MAX_TOKENS).join(" ");
}

/** Deterministic hash-based fake embedding. Stable across runs; same input → same vector. */
export function syntheticVector(text: string, dim: number): Float32Array {
  const out = new Float32Array(dim);
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    out.fill(0);
    return out;
  }
  for (const tok of tokens) {
    let h1 = fnv1a(tok);
    let h2 = fnv1a(`${tok}#salt`);
    for (let i = 0; i < dim; i++) {
      h1 = mix(h1, i);
      h2 = mix(h2, i + 7);
      const sign = (h2 & 1) === 0 ? 1 : -1;
      out[i] = (out[i] ?? 0) + (sign * (h1 % 1000)) / 1000;
    }
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    const v = out[i] ?? 0;
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) {
    out[i] = (out[i] ?? 0) / norm;
  }
  return out;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mix(h: number, salt: number): number {
  let x = (h ^ salt) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Test-only: clear the cached pipeline (e.g. when switching fake/real modes). */
export function _resetEmbedderCache(): void {
  pipelineCache = null;
  pipelineCacheKey = null;
}
