document.addEventListener("DOMContentLoaded", () => {
    let isRecording = false;
    const button = document.getElementById("recording-button");
    const micSelect = document.getElementById("mic-select");
    const barMomentary = document.getElementById("bar-momentary");
    const barShortterm = document.getElementById("bar-shortterm");
    const valMomentary = document.getElementById("val-momentary");
    const valShortterm = document.getElementById("val-shortterm");
    let currentLufs = -Infinity;
    let momentaryLufs = -Infinity;
    let shortTermLufs = -Infinity;

    const MIN_LUFS = -60;
    const MAX_LUFS = 0;

    const scale = document.getElementById("scale");
    const scaleMarks = [0, -6, -14, -18, -23, -60];

    scaleMarks.forEach(lufs => {
        const pct = ((lufs - MIN_LUFS) / (MAX_LUFS - MIN_LUFS)) * 100;
        const label = document.createElement("span");
        label.textContent = lufs;
        label.style.position = "absolute";
        label.style.top = (100 - pct) + "%";
        scale.appendChild(label);
    });

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

    function lufsToHeight(lufs) {
        const clamped = Math.max(MIN_LUFS, Math.min(MAX_LUFS, lufs));
        return ((clamped - MIN_LUFS) / (MAX_LUFS - MIN_LUFS)) * 100;
    }

    function drawMeter() {
        if (isFinite(momentaryLufs)) {
            barMomentary.style.height = lufsToHeight(momentaryLufs) + "%";
            valMomentary.textContent = momentaryLufs.toFixed(1) + " LUFS";
        } else {
            barMomentary.style.height = "0%";
            valMomentary.textContent = "--- LUFS";
        }

        if (isFinite(shortTermLufs)) {
            barShortterm.style.height = lufsToHeight(shortTermLufs) + "%";
            valShortterm.textContent = shortTermLufs.toFixed(1) + " LUFS";
        } else {
            barShortterm.style.height = "0%";
            valShortterm.textContent = "--- LUFS";
        }

        requestAnimationFrame(drawMeter);
    }
    requestAnimationFrame(drawMeter);

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
                        momentaryLufs = e.data.momentary;
                        shortTermLufs = e.data.shortTerm;
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
            momentaryLufs = -Infinity;
            shortTermLufs = -Infinity;

            if (window.workletNode) window.workletNode.disconnect();
            if (window.audioContext) window.audioContext.close();
        }
    }
});