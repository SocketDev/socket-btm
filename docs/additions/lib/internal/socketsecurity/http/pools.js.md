HTTP Object Pools
Reuse objects to avoid GC pressure on hot paths.
Request/response objects are pooled in C++ (smol_http binding) for
cross-boundary reuse and stable V8 hidden classes. JS-specific fields
(query, params, \_headerMap, etc.) are layered on at acquire time and
cleaned up at release time before returning to the native pool.
