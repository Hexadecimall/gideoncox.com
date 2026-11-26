# Browser LMA in Zed

Open **Settings → AI → LLM Providers**, click **Configure**, and find LMA. Choose **Download or Load Qwen3 for Agent**, then select the model in the Agent Panel. If AI is disabled, enable it in Settings.

The 397 MB Qwen3 model has an 8,192-token context. Its available project tools are file reads, directory listings, text search, and path search. Zed’s Agent profile, workspace trust, and permissions apply. Project data and inference stay in the browser.

For inline predictions, choose **Download or Load Qwen2.5-Coder**, then **Use for Edit Prediction**. This 398 MB base model is configured through Zed’s existing Edit Prediction settings. **Choose GGUF Model…** loads a compatible local file up to 512 MB for Agent chat.

LMA keeps one model in memory at a time. Preset models stay in browser storage and reload on demand after a refresh or two minutes of inactivity. Selecting a GGUF from disk applies to the current session.

The Edit Prediction button writes these fields to `settings.json`.

```json
{
  "edit_predictions": {
    "provider": "open_ai_compatible_api",
    "open_ai_compatible_api": {
      "api_url": "lma://browser/completions",
      "model": "qwen2.5-coder",
      "prompt_format": "qwen",
      "max_output_tokens": 48,
      "prediction_debounce": 650
    }
  }
}
```

The browser runtime build instructions and pinned inference library are in the [corresponding source archive](../../../assets/vendor/zed/lma-source.tar.gz).

Model sources are [Qwen3 0.6B](https://huggingface.co/Qwen/Qwen3-0.6B), the [pinned Qwen3 GGUF](https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/tree/50968a4468ef4233ed78cd7c3de230dd1d61a56b), and the [pinned Qwen2.5-Coder 0.5B base GGUF](https://huggingface.co/lmstudio-community/Qwen2.5-Coder-0.5B-GGUF/tree/a25ae40c247296c6f1059f6afe3c4ebecb54d9b9).
