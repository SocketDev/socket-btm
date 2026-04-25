node:smol-https - HTTPS server using smol-http with TLS

Like Node.js's https module, this is a thin wrapper around smol-http
that requires TLS configuration and defaults to port 443.

Usage:
import { serve } from 'node:smol-https';
import { readFileSync } from 'node:fs';

serve({
port: 443,
key: readFileSync('server.key'),
cert: readFileSync('server.cert'),
fetch(req) {
return 'Hello, HTTPS!';
},
});

TLS options can be passed directly (key, cert, ca, passphrase)
or via a tls object with any Node.js tls.createServer options.

Note: For HTTP utilities (caching, fast responses, etc.), import from
node:smol-http directly. This module only exports the serve() function,
following the same pattern as Node.js's http/https module separation.
