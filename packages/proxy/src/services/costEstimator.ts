import { getPricingWithFuzzy } from '../utils/pricing';

/**
 * Estimates the token count for a list of messages.
 * Uses a rough approximation of (character count / 4) for text content.
 * Adds 1000 tokens per image for vision-based requests.
 */
export const estimateTokenCount = (messages: any[]): number => {
    if (!Array.isArray(messages)) return 0;
    
    let totalChars = 0;
    let imageCount = 0;

    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            totalChars += msg.content.length;
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === 'text' && part.text) {
                    totalChars += part.text.length;
                } else if (part.type === 'image' || part.type === 'image_url') {
                    imageCount++;
                }
            }
        }
    }

    // Rough approximation: 4 characters per token
    const textTokens = Math.ceil(totalChars / 4);
    
    // Fixed overhead for images (standard conservative estimate)
    const visionTokens = imageCount * 1000;

    return textTokens + visionTokens;
};

/**
 * Estimates the total cost of a request based on input tokens and a multiplier for output.
 */
export const estimateRequestCost = (
    provider: string,
    model: string,
    inputTokens: number,
    multiplier: number = 3.0
): number => {
    const pricing = getPricingWithFuzzy(provider, model);
    
    if (!pricing) {
        // Fallback: If no pricing found, use a conservative default 
        // (approx $15/MTok input, $75/MTok output - Claude 3 Opus levels)
        const fallbackInput = 15 / 1_000_000;
        const fallbackOutput = 75 / 1_000_000;
        const estimatedOutput = inputTokens * multiplier;
        return (inputTokens * fallbackInput) + (estimatedOutput * fallbackOutput);
    }

    // Pricing from cache might have input_cost_per_1m or input keys
    const inputPrice = (pricing.input_cost_per_1m || pricing.input || 0) / 1_000_000;
    const outputPrice = (pricing.output_cost_per_1m || pricing.output || 0) / 1_000_000;
    const estimatedOutput = inputTokens * multiplier;

    return (inputTokens * inputPrice) + (estimatedOutput * outputPrice);
};
