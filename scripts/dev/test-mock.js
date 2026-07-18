const http = require('http');

const target = http.createServer((req, res) => {
    res.writeHead(429, {'Transfer-Encoding': 'chunked', 'Content-Type': 'application/json'});
    res.write('{"error": "rate_limited"}');
    res.end();
});

const proxy = http.createServer((req, res) => {
    const _writeHead = res.writeHead;
    const _write = res.write;
    const _end = res.end;

    let intercepted = false;
    let body = '';

    res.writeHead = function(statusCode, headers) {
        if (statusCode >= 400) intercepted = true;
        return this; // intercept
    };
    
    res.write = function(chunk) {
        if (intercepted) { body += chunk; return true; }
        return _write.call(this, chunk);
    };

    res.end = function(chunk, encoding, cb) {
        if (chunk) body += chunk;
        if (intercepted) {
            const enriched = '{"enriched": true, "old": ' + body + '}';
            res.removeHeader('Transfer-Encoding');
            res.setHeader('Content-Length', Buffer.byteLength(enriched));
            // Force disable chunked encoding which node caching sets
            res.chunkedEncoding = false;
            res.useChunkedEncodingByDefault = false;

            _writeHead.call(this, 429);
            _write.call(this, enriched);
            return _end.call(this);
        }
        return _end.call(this, chunk, encoding, cb);
    };

    // emulate http-proxy behavior
    const proxyReq = http.request({ port: 8999, method: 'POST', path: '/' }, (proxyRes) => {
        // http-proxy copies headers FIRST
        for (const k in proxyRes.headers) {
            res.setHeader(k, proxyRes.headers[k]);
        }
        res.writeHead(proxyRes.statusCode);
        proxyRes.on('data', chunk => res.write(chunk));
        proxyRes.on('end', () => res.end());
    });
    proxyReq.end();
});

target.listen(8999, () => {
    proxy.listen(8998, () => {
        const { execSync } = require('child_process');
        try {
            const out = execSync('curl -i http://127.0.0.1:8998').toString();
            console.log(out);
        } catch (e) {
            console.error(e.message);
        }
        target.close();
        proxy.close();
    });
});
