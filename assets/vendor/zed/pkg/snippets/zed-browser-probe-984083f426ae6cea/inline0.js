
    export function local_model_available() {
        return Boolean(globalThis.zedLocalAssistant?.available());
    }
    export function start_local_model(id, messages) {
        globalThis.zedLocalAssistant?.start(id, messages);
    }
    export function stop_local_model(id) {
        globalThis.zedLocalAssistant?.stop(id);
    }
