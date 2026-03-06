document.addEventListener("DOMContentLoaded", () => {
    let isRecording = false;
    const button = document.getElementById("recording-button");
    const micSelect = document.getElementById("mic-select");

    navigator.mediaDevices.enumerateDevices().then(devices => {
        devices.filter(d => d.kind === "audioinput").forEach(d => {
            const option = document.createElement("option");
            option.value = d.deviceId;
            option.text = d.label;
            micSelect.appendChild(option);
        });
    }).catch((e) => {
        console.error(`${e.name}: ${e.message}`);
    });

    button.onclick = Record;

    function Record() {
        if (!isRecording) {
            navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: { exact: micSelect.value },
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            })
                .then(async stream => {
                    isRecording = true;
                    button.textContent = "Stop Recording";

                    const audioContext = new AudioContext();
                    await audioContext.audioWorklet.addModule('./js/loudness-processor.js');
                    const source = audioContext.createMediaStreamSource(stream);
                    const workletNode = new AudioWorkletNode(audioContext, 'loudness-processor');

                    workletNode.port.onmessage = (e) => {
                        console.log("LUFS", e.data.lufs);
                    };

                    source.connect(workletNode);
                    workletNode.connect(audioContext.destination);

                    window.audioContext = audioContext;
                    window.workletNode = workletNode;
                })
                .catch(err => {
                    console.error("Microphone access denied", err);
                    alert("Please allow microphone access")
                });
        }
        else {
            isRecording = false;
            button.textContent = "Start Recording";

            if (window.workletNode) window.workletNode.disconnect();
            if (window.audioContext) window.audioContext.close();
        }
    }
});