# minilm-builder

Downloads [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), converts it to ONNX, and quantizes it for embedded text-embedding inside Socket CLI. MiniLM generates 384-dimension sentence embeddings — small, fast, and good enough for the similarity and classification work we do against user code and package metadata.

Output is consumed by the `models` package. The first build downloads from HuggingFace; subsequent builds hit the checkpoint cache.
