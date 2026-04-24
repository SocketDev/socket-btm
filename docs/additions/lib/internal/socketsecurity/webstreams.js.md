Socket Security Fast WebStreams - C++ Enhanced Implementation

C++ fast paths for WebStreams while maintaining:

1. WPT (Web Platform Tests) compatibility
2. Full WHATWG Streams API compliance
3. Delegates to JS fast-webstreams for complex cases

Lazy-load native binding — this module is loaded during V8 snapshot
generation where the binding may not be fully initialized.
