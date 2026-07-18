import {
    extractAssistantText,
    tokenize,
    normalizedTermFrequency,
    cosineSimilarity,
    updateCentroid,
    computeDrift,
    DriftBaselineState
} from '../responseDrift';

describe('extractAssistantText', () => {
    it('extracts content from a non-streaming OpenAI-style response', () => {
        const raw = JSON.stringify({ choices: [{ message: { content: 'The answer is 42.' } }] });
        expect(extractAssistantText(raw)).toContain('The answer is 42.');
    });

    it('extracts text from an Anthropic-style content-block response', () => {
        const raw = JSON.stringify({ content: [{ type: 'text', text: 'Here is your summary.' }] });
        expect(extractAssistantText(raw)).toContain('Here is your summary.');
    });

    it('extracts and concatenates text across concatenated SSE delta chunks', () => {
        const raw =
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
            'data: [DONE]\n\n';
        const text = extractAssistantText(raw);
        expect(text).toContain('Hello');
        expect(text).toContain('world');
    });

    it('returns empty string for empty or non-matching input', () => {
        expect(extractAssistantText('')).toBe('');
        expect(extractAssistantText('{"tool_calls":[{"id":"x"}]}')).toBe('');
    });
});

describe('tokenize / normalizedTermFrequency', () => {
    it('lowercases, strips punctuation, and drops single-char tokens', () => {
        expect(tokenize('Hello, World! A test.')).toEqual(['hello', 'world', 'test']);
    });

    it('produces a distribution that sums to ~1', () => {
        const tf = normalizedTermFrequency(['a', 'b', 'a', 'c']);
        const sum = Object.values(tf).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 10);
        expect(tf['a']).toBeCloseTo(0.5, 10);
    });
});

describe('cosineSimilarity', () => {
    it('is 1 for identical vectors', () => {
        const v = { a: 0.5, b: 0.5 };
        expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
    });

    it('is 0 for completely disjoint vocabularies', () => {
        expect(cosineSimilarity({ a: 1 }, { z: 1 })).toBe(0);
    });

    it('is 1 when both vectors are empty (no signal, not treated as maximally different)', () => {
        expect(cosineSimilarity({}, {})).toBe(1);
    });
});

describe('updateCentroid', () => {
    it('stays bounded across many repeated updates (no unbounded growth)', () => {
        let centroid: Record<string, number> = {};
        for (let i = 0; i < 500; i++) {
            centroid = updateCentroid(centroid, { word: 1 });
        }
        expect(centroid.word).toBeLessThanOrEqual(1.0001);
    });
});

describe('computeDrift', () => {
    const emptyState: DriftBaselineState = { termFreq: {}, sampleCount: 0, avgSimilarity: null, varianceSimilarity: null };

    it('establishes a baseline on the first sample with no score', () => {
        const raw = JSON.stringify({ choices: [{ message: { content: 'Normal helpful response about cooking pasta.' } }] });
        const result = computeDrift(emptyState, raw);
        expect(result.driftScore).toBeNull();
        expect(result.driftFlag).toBe(false);
        expect(result.nextState.sampleCount).toBe(1);
    });

    it('scores near zero drift for a response similar to the baseline', () => {
        const first = computeDrift(emptyState, JSON.stringify({ choices: [{ message: { content: 'The weather today is sunny and warm.' } }] }));
        const second = computeDrift(first.nextState, JSON.stringify({ choices: [{ message: { content: 'The weather today is sunny and mild.' } }] }));
        expect(second.driftScore).not.toBeNull();
        expect(second.driftScore!).toBeLessThan(0.5);
    });

    it('does not flag drift before the warmup sample count is reached, even with wildly different content', () => {
        let state = emptyState;
        for (let i = 0; i < 5; i++) {
            const result = computeDrift(state, JSON.stringify({ choices: [{ message: { content: 'consistent topic about gardening flowers soil' } }] }));
            state = result.nextState;
        }
        const outlier = computeDrift(state, JSON.stringify({ choices: [{ message: { content: 'quantum blockchain neural spacecraft economics jurisprudence' } }] }));
        expect(outlier.driftFlag).toBe(false); // below WARMUP_SAMPLES, never flags
    });

    it('flags a statistically anomalous response once warmed up on a consistent baseline', () => {
        let state = emptyState;
        // Build a stable baseline: same topic, minor wording variation, well past warmup
        const consistentSamples = [
            'The garden needs watering every morning with fresh water.',
            'Water the garden every morning using fresh clean water.',
            'Every morning the garden requires fresh water for watering.',
            'Fresh water every morning keeps the garden well watered.',
            'The garden morning routine needs fresh watering water.',
            'Morning garden care requires fresh water for watering.',
            'Watering the garden each morning needs fresh clean water.',
            'Fresh morning water keeps the garden watered well.',
            'The garden requires morning watering with fresh water.',
            'Every garden morning needs fresh watering water routine.',
            'Morning watering keeps the fresh garden water routine.',
            'The garden fresh water morning routine needs watering.'
        ];
        for (const text of consistentSamples) {
            const result = computeDrift(state, JSON.stringify({ choices: [{ message: { content: text } }] }));
            state = result.nextState;
        }

        const outlier = computeDrift(state, JSON.stringify({
            choices: [{ message: { content: 'Quantum spacecraft blockchain jurisprudence neural economics cryptography aviation legislation' } }]
        }));
        expect(outlier.driftScore).not.toBeNull();
        expect(outlier.driftFlag).toBe(true);
    });

    it('returns null score when no assistant text can be extracted (e.g. tool-call-only response)', () => {
        const result = computeDrift(emptyState, JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'x' }] } }] }));
        expect(result.driftScore).toBeNull();
        expect(result.nextState).toBe(emptyState); // unchanged — nothing usable to learn from
    });
});
