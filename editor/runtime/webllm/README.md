# Local Assistant runtime

The Zed Local Assistant dock uses WebLLM 0.2.89 to run
SmolLM2-360M-Instruct in a dedicated WebGPU worker. The model downloads on the
first send and WebLLM caches its artifacts in browser site data. Prompts,
conversation history, and attached editor selections pass to the same-origin
worker. Inference runs on the device and the dock keeps conversation state
in memory for the current workspace.

WebGPU is required for local inference. Browser editing and language servers
can use the editor's WebGL2 renderer on devices without WebGPU. The dock
supports chat, selected code, and cancellation. Zed's upstream agent tools,
automated edits, and provider configuration remain separate porting work.

## Corresponding artifacts

- [WebLLM source at v0.2.89](https://github.com/mlc-ai/web-llm/tree/df83db6cb05bd78daf0cb1afd8c5da550c4a7c6e) and [npm bundle](https://www.npmjs.com/package/@mlc-ai/web-llm/v/0.2.89).
- [SmolLM2 model source and license](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct/tree/a10cc1512eabd3dde888204e902eca88bddb4951) and [pinned WebLLM weights](https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f32_1-MLC/tree/1e6b2ca3684e2bc8a6d39eb36e8d6cd51eb12bda).
- [Pinned WebGPU model library](https://github.com/mlc-ai/binary-mlc-llm-libs/blob/5b7251f3bdce957be2a7bf73a6f6c560d9874df4/web-llm-models/v0_2_87/base/SmolLM2-360M-Instruct-q4f32_1_cs1k-webgpu.wasm).

Use the npm package's `lib/index.js` and the WebGPU model library linked above.
The packer verifies the original hashes and remaps build paths before packaging.

```sh
python3 packaging/zed/pack-web-llm.py WEB_LLM_JS MODEL_WASM editor/runtime/webllm
```
