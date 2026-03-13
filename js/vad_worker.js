importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js');

let session = null;
let h = null; // LSTM hidden state
let c = null; // LSTM cell state

async function loadModel() {
    session = await ort.InferenceSession.create('./models/silero_vad.onnx');
    
    // initialize LSTM states as zeros
    // shape: 2 layers, 1 batch, 64 hidden units
    h = new ort.Tensor('float32', new Float32Array(2 * 1 * 64).fill(0), [2, 1, 64]);
    c = new ort.Tensor('float32', new Float32Array(2 * 1 * 64).fill(0), [2, 1, 64]);

    console.log("Silero VAD loaded");
    postMessage({type: 'ready'});
}

loadModel();