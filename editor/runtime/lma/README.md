# Browser LMA in Zed

Open **Settings → AI → LLM Providers**, click **Configure**, and find LMA. If AI is disabled, enable it in Settings.

Use **Find Models** to search Hugging Face or enter an exact `owner/repository`. Click **Download** to save a GGUF or a complete split GGUF. Zed shows progress and streams the data to private browser file storage when available. Large models can show an advisory and continue downloading. **Import GGUF…** copies local files into the same library. **Downloaded Models** lists the saved files with their sizes. Click **Load** when ready to start inference or **Remove** to free the storage. Running a model depends on its architecture, quantization, and available browser memory. **Generation Settings** saves the output limit and temperature in `language_models.lma` in `settings.json`.

## Browser models

For Agent chat with project tools, search for `unsloth/Qwen3-0.6B-GGUF`, download `Qwen3-0.6B-Q4_K_M.gguf`, then click **Load** under **Downloaded Models** and select the model in the Agent Panel. This 397 MB model has an 8,192-token context and supports file reads, directory listings, text search, and path search. Zed’s Agent profile, workspace trust, and permissions apply. Project data and inference stay in the browser.

For inline predictions, choose **LMA** in **Settings → AI → Edit Predictions** or in the Edit Prediction status menu. LMA uses the active browser model under **Downloaded Models**. **Use for Edit Prediction** in the model library selects the same provider.

The Qwen2.5-Coder preset uses fill-in-the-middle predictions. Other loaded GGUF models can continue the current line where there is no code to the right of the cursor.

LMA keeps one model in memory at a time. After a refresh or two minutes of inactivity, the previously loaded model starts on demand when inference is requested. Downloaded and imported files stay in browser storage until removed.

The browser runner can load Qwen3.5 GGUF files that declare a multi-token prediction block without its weights. Ordinary decoding uses the main model layers. Load failures show the runner's diagnostic when available.

The provider selection is saved in `settings.json`.

```json
{
  "edit_predictions": {
    "provider": "lma"
  }
}
```

The browser runtime build instructions and pinned inference library are in the [corresponding source archive](../../../assets/vendor/zed/lma-source.tar.gz).

Model sources are [Qwen3 0.6B](https://huggingface.co/Qwen/Qwen3-0.6B), the [pinned Qwen3 GGUF](https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/tree/50968a4468ef4233ed78cd7c3de230dd1d61a56b), and the [pinned Qwen2.5-Coder 0.5B base GGUF](https://huggingface.co/lmstudio-community/Qwen2.5-Coder-0.5B-GGUF/tree/a25ae40c247296c6f1059f6afe3c4ebecb54d9b9).

## Desktop LMA

With an LMA build that supports `LMA_ZED_ORIGIN`, start a local server with this site as the allowed origin.

```sh
LMA_ZED_ORIGIN=https://gideoncox.com lma s MODEL
```

In the provider settings, click **Connect** for `http://127.0.0.1:8080`, enter an API key if the server requires one, and select a model marked **Desktop** in the Agent Panel. The server address is saved. The key and connection last until the page reloads. Desktop models provide Agent chat. Browser model removal affects the browser’s cache.
