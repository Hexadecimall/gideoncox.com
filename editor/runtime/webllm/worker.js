import { WebWorkerMLCEngineHandler } from './web-llm.js?v=0.2.89';

const handler = new WebWorkerMLCEngineHandler();
addEventListener('message', event => handler.onmessage(event));
