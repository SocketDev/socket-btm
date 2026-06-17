node:smol-http client — lean HTTP client with connection reuse.

Uses Node.js built-in http/https modules for maximum compatibility.
For pipelining, users should install undici and use setPipelining().

Usage:
import { request } from 'node:smol-http';

const res = await request('https://registry.npmjs.org/lodash');
console.log(res.status, res.body);
