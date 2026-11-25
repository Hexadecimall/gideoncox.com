# Browser LMA in Zed

Enable AI in Zed settings with `"disable_ai": false`. Open **Configure Providers** in the Agent Panel. **Download or Load Qwen3 for Agent** offers the pinned 397 MB model for browser-local chat and Zed's read-only project tools.

The Agent can read files, list directories, search text, and find paths. The selected Agent profile, workspace trust, and Zed's tool permissions still apply. Qwen3 uses a 3,072-token context. Project reads and inference run in the browser.

**Download or Load Qwen2.5-Coder** offers the 491 MB model for chat and inline Edit Prediction. **Choose GGUF Model…** opens a compatible local file up to 512 MB. The loaded model occupies one worker at a time. Switching models frees the previous worker, and another visit can load the downloaded weights from browser storage.

Set these fields in `settings.json` to use Qwen for inline predictions.

```json
{
  "edit_predictions": {
    "provider": "open_ai_compatible_api",
    "open_ai_compatible_api": {
      "api_url": "lma://browser/completions",
      "model": "qwen2.5-coder",
      "prompt_format": "qwen"
    }
  }
}
```

The browser runtime build instructions and pinned inference library are in the [corresponding source archive](../../../assets/vendor/zed/lma-source.tar.gz).


Model sources are [Qwen3 0.6B](https://huggingface.co/Qwen/Qwen3-0.6B) with the [pinned GGUF quantization](https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/tree/50968a4468ef4233ed78cd7c3de230dd1d61a56b), and [Qwen2.5-Coder 0.5B Instruct GGUF](https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/tree/ebb2015119c907b064c512bf053e945850b5875f).
