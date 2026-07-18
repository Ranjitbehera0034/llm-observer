/**
 * Response Drift Detection — lexical/statistical, not deep semantic embeddings.
 *
 * Maintains a rolling term-frequency "centroid" per (provider, model) and
 * scores each new response by how different it is from that centroid
 * (1 - cosine similarity). A response is flagged when its similarity to the
 * baseline is a statistical outlier relative to that baseline's own recent
 * variability — i.e. this model just started answering very differently
 * than it usually does (a real, useful signal for catching silent
 * provider-side model swaps or a session going off the rails).
 *
 * This is explicitly NOT ground-truth hallucination detection — there is no
 * oracle for "correct" here, and it never inspects prompt content, only the
 * response text already stored locally for this request.
 */

export function extractAssistantText(raw: string): string {
    if (!raw) return '';
    const matches: string[] = [];
    // Matches the JSON string value following "content"/"text"/"response" —
    // covers OpenAI/Groq/Mistral (choices[].message.content), Anthropic
    // (content[].text), and Ollama-native (response), for both a single
    // parsed JSON body and concatenated SSE delta chunks alike.
    const re = /"(?:content|text|response)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        matches.push(m[1]);
    }
    return matches
        .join(' ')
        .replace(/\\n/g, ' ')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
}

export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 1);
}

/** Relative-frequency vector (sums to ~1) so it stays bounded across an EMA update. */
export function normalizedTermFrequency(tokens: string[]): Record<string, number> {
    if (tokens.length === 0) return {};
    const counts: Record<string, number> = {};
    for (const t of tokens) counts[t] = (counts[t] || 0) + 1;
    const total = tokens.length;
    const freq: Record<string, number> = {};
    for (const [k, v] of Object.entries(counts)) freq[k] = v / total;
    return freq;
}

export function cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length === 0 && keysB.length === 0) return 1;
    if (keysA.length === 0 || keysB.length === 0) return 0;

    const keys = new Set([...keysA, ...keysB]);
    let dot = 0, normA = 0, normB = 0;
    for (const k of keys) {
        const av = a[k] || 0;
        const bv = b[k] || 0;
        dot += av * bv;
        normA += av * av;
        normB += bv * bv;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Exponential moving average blend — bounded, doesn't grow unboundedly over many samples. */
export function updateCentroid(
    existing: Record<string, number>,
    incoming: Record<string, number>,
    alpha = 0.1
): Record<string, number> {
    const keys = new Set([...Object.keys(existing), ...Object.keys(incoming)]);
    const merged: Record<string, number> = {};
    for (const k of keys) {
        merged[k] = alpha * (incoming[k] || 0) + (1 - alpha) * (existing[k] || 0);
    }
    return merged;
}

export interface DriftBaselineState {
    termFreq: Record<string, number>;
    sampleCount: number;
    avgSimilarity: number | null;
    varianceSimilarity: number | null;
}

export interface DriftComputation {
    driftScore: number | null; // 1 - similarity to the pre-update baseline; null on the very first sample (no baseline yet)
    driftFlag: boolean;
    nextState: DriftBaselineState;
}

const WARMUP_SAMPLES = 10; // don't flag anything until the baseline has enough history
const Z_SCORE_THRESHOLD = 3; // flag when similarity is a 3-sigma-low outlier

/**
 * Pure function: given the current baseline state and a new response's raw
 * body, returns the drift score/flag for this response and the updated
 * baseline state to persist. No I/O — callers own persistence.
 */
export function computeDrift(state: DriftBaselineState, rawResponseBody: string): DriftComputation {
    const text = extractAssistantText(rawResponseBody);
    const tf = normalizedTermFrequency(tokenize(text));

    // No usable text extracted (e.g. tool-call-only response) — nothing to score
    if (Object.keys(tf).length === 0) {
        return { driftScore: null, driftFlag: false, nextState: state };
    }

    // First sample ever for this (provider, model): establish the baseline, no score yet
    if (state.sampleCount === 0) {
        return {
            driftScore: null,
            driftFlag: false,
            nextState: { termFreq: tf, sampleCount: 1, avgSimilarity: null, varianceSimilarity: null }
        };
    }

    const similarity = cosineSimilarity(tf, state.termFreq);
    const driftScore = 1 - similarity;

    // Welford's online algorithm for the running mean/variance of similarity
    const n = state.sampleCount + 1;
    const prevAvg = state.avgSimilarity ?? similarity;
    const prevM2 = (state.varianceSimilarity ?? 0) * Math.max(state.sampleCount - 1, 0);
    const delta = similarity - prevAvg;
    const newAvg = prevAvg + delta / n;
    const delta2 = similarity - newAvg;
    const newM2 = prevM2 + delta * delta2;
    const newVariance = n > 1 ? newM2 / (n - 1) : 0;

    let driftFlag = false;
    if (state.sampleCount >= WARMUP_SAMPLES && state.varianceSimilarity && state.varianceSimilarity > 0) {
        const stddev = Math.sqrt(state.varianceSimilarity);
        const z = (similarity - (state.avgSimilarity ?? similarity)) / stddev;
        driftFlag = z <= -Z_SCORE_THRESHOLD;
    }

    return {
        driftScore,
        driftFlag,
        nextState: {
            termFreq: updateCentroid(state.termFreq, tf),
            sampleCount: n,
            avgSimilarity: newAvg,
            varianceSimilarity: newVariance
        }
    };
}
