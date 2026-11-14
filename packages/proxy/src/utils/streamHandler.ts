export interface StreamUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens?: number;
}

export class StreamHandler {
    private buffer: string = '';
    private usage: StreamUsage | null = null;
    private provider: string;

    constructor(provider: string) {
        this.provider = provider;
    }

    processChunk(chunkStr: string): void {
        this.buffer += chunkStr;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;

            if (trimmed.startsWith('data: ')) {
                try {
                    const dataStr = trimmed.substring(6);
                    const parsed = JSON.parse(dataStr);
                    this.extractUsage(parsed);
                } catch (e) {
                    // Ignore parse errors for non-JSON or partial data
                }
            }
        }
    }

    private extractUsage(parsed: any): void {
        switch (this.provider) {
            case 'moonshot':
            case 'deepseek':
            case 'openrouter':
            case 'xai':
            case 'custom':
            case 'openai':
            case 'groq':
            case 'mistral':
                if (parsed.response?.usage) parsed = parsed.response;
                if (parsed.usage) parsed.usage = { ...parsed.usage, prompt_tokens: parsed.usage.prompt_tokens ?? parsed.usage.input_tokens, completion_tokens: parsed.usage.completion_tokens ?? parsed.usage.output_tokens };
                if (parsed.usage && [parsed.usage.prompt_tokens, parsed.usage.completion_tokens].every(n => Number.isSafeInteger(n) && n >= 0)) {
                    this.usage = {
                        prompt_tokens: parsed.usage.prompt_tokens || 0,
                        completion_tokens: parsed.usage.completion_tokens || 0,
                        total_tokens: parsed.usage.total_tokens ?? parsed.usage.prompt_tokens + parsed.usage.completion_tokens,
                        ...((parsed.usage.prompt_tokens_details?.cached_tokens ?? parsed.usage.input_tokens_details?.cached_tokens ?? parsed.usage.prompt_cache_hit_tokens) !== undefined ? { cached_tokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? parsed.usage.input_tokens_details?.cached_tokens ?? parsed.usage.prompt_cache_hit_tokens } : {}),
                    };
                }
                // Groq specific x_groq usage
                if (this.provider === 'groq' && parsed.x_groq?.usage) {
                    this.usage = {
                        prompt_tokens: parsed.x_groq.usage.prompt_tokens || (this.usage?.prompt_tokens ?? 0),
                        completion_tokens: parsed.x_groq.usage.completion_tokens || (this.usage?.completion_tokens ?? 0),
                        total_tokens: parsed.x_groq.usage.total_tokens || (this.usage?.total_tokens ?? 0),
                    };
                }
                break;

            case 'anthropic':
                if (!this.usage) this.usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
                if (parsed.type === 'message_start' && parsed.message?.usage) {
                    this.usage.prompt_tokens += parsed.message.usage.input_tokens || 0;
                    this.usage.completion_tokens += parsed.message.usage.output_tokens || 0;
                } else if (parsed.type === 'message_delta' && parsed.usage) {
                    this.usage.completion_tokens += parsed.usage.output_tokens || 0;
                }
                this.usage.total_tokens = this.usage.prompt_tokens + this.usage.completion_tokens;
                break;

            case 'google':
                if (parsed.usageMetadata) {
                    this.usage = {
                        prompt_tokens: parsed.usageMetadata.promptTokenCount || 0,
                        completion_tokens: parsed.usageMetadata.candidatesTokenCount || 0,
                        total_tokens: parsed.usageMetadata.totalTokenCount || 0
                    };
                }
                break;
        }
    }

    getUsage(): StreamUsage | null {
        return this.usage;
    }
}
