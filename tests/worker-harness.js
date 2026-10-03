import {parentPort} from 'node:worker_threads';
globalThis.self={addEventListener:(type,listener)=>{if(type==='message')parentPort.on('message',data=>listener({data}));},postMessage:value=>parentPort.postMessage(value)};
await import('../src/worker.js');
parentPort.postMessage({type:'ready'});
