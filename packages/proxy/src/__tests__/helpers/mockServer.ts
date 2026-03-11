/**
 * Creates a mock LLM upstream server to avoid real API calls during tests.
 * Returns deterministic OpenAI/Anthropic-style responses.
 */
import http from 'http';

export interface MockServer {
    url: string;
    close: () => Promise<void>;
    setHandler: (handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) => void;
}

let currentHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | null = null;

export function createMockLlmServer(): Promise<MockServer> {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            if (currentHandler) {
                currentHandler(req, res);
            } else {
                // Default: OpenAI-style 200 response
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    id: 'chatcmpl-test',
                    object: 'chat.completion',
                    model: 'gpt-4',
                    choices: [{ message: { role: 'assistant', content: 'test response' }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
                }));
            }
        });

        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve({
                url: `http://127.0.0.1:${addr.port}`,
                close: () => new Promise<void>((r, e) => server.close((err) => err ? e(err) : r())),
                setHandler: (handler) => { currentHandler = handler; }
            });
        });
    });
}
