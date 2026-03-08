import { Request } from 'express';

export interface ProviderResponse {
    provider: string;
    model: string;
    isStreaming: boolean;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    pricing_unknown: boolean;
    hasTools: boolean;
}

export interface IProvider {
    /** Map path to correct provider API if needed */
    getBaseUrl(): string;

    /** Get the Authorization header formatted for this provider */
    getAuthHeader(req: Request): Record<string, string>;

    /** Parse the incoming request to get model, stream flags, tools etc */
    parseRequest(req: Request, body: any): { model: string; isStreaming: boolean; hasTools: boolean };

    /** Parse the outgoing response from provider to get tokens, usage */
    parseResponse(responseBody: any, requestData: any): ProviderResponse;

    /** Parse the fully accumulated stream text from provider to get tokens, usage */
    parseStreamResponse(responseData: string, requestData: any): ProviderResponse;


    /** Specifically calculate cost for a given token usage and model */
    calculateCost(model: string, promptTokens: number, completionTokens: number): { costUsd: number, unknown: boolean };
}
