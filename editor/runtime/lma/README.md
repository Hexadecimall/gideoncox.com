# Browser LMA in Zed

Enable AI in Zed settings with `"disable_ai": false`. In the Agent Panel, open **Configure Providers** and choose a GGUF file up to 512 MB. **Download or Load Qwen2.5-Coder** downloads the pinned 491 MB model on first use and loads it from browser storage on later visits.

Agent chat and inline predictions run locally in a WebAssembly worker. This version supports text responses. Agent tool calls are pending.

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
