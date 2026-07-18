import net from 'net';
import http from 'http';
import express from 'express';
import { handleProxyRequest } from './packages/proxy/src/proxy';
import { initDb } from './packages/database/src/db';

(async () => {
    await initDb(':memory:');

    const app = express();
    app.use(express.json());

    app.all('/v1/openai/*', (req, res) => {
        (req as any).customTargetUrl = `http://127.0.0.1:8999`;
        req.url = req.url.replace('/v1/openai', '/v1');
        handleProxyRequest(req as any, res as any, 'openai');
    });

    const targetServer = http.createServer((req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end(JSON.stringify({ error: { message: "Test error" } }));
    });

    targetServer.listen(8999, () => {
        const proxyServer = app.listen(8998, () => {
            const client = new net.Socket();
            client.connect(8998, '127.0.0.1', () => {
                console.log('Connected to proxy');
                const data = JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'test' }] });
                client.write(
                    "POST /v1/openai/chat/completions HTTP/1.1\r\n" +
                    "Host: 127.0.0.1:8998\r\n" +
                    "Content-Type: application/json\r\n" +
                    "Content-Length: " + Buffer.byteLength(data) + "\r\n" +
                    "Connection: close\r\n\r\n" +
                    data
                );
            });

            let output = '';
            client.on('data', (data) => {
                console.log('RECEIVED BYTES:\n' + data.toString());
                output += data.toString();
            });

            client.on('close', () => {
                console.log('Socket closed');
                proxyServer.close();
                targetServer.close();
            });
        });
    });
})();
