document.addEventListener("DOMContentLoaded", () => {
    let isRecording = false;
    const button = document.getElementById("recording-button");
    const micSelect = document.getElementById("mic-select");
    const barMomentary = document.getElementById("bar-momentary");
    const barShortterm = document.getElementById("bar-shortterm");
    const valMomentary = document.getElementById("val-momentary");
    const valShortterm = document.getElementById("val-shortterm");
    let momentaryLufs = -Infinity;
    let shortTermLufs = -Infinity;
    let integratedLufs = -Infinity;
    let truePeakLufs = -Infinity;

    const vadWorker = new Worker('./js/vad_worker.js');
    vadWorker.onmessage = (e) => {
        if(e.data.type === 'ready') {
            console.log('VAD ready');
        }
    }

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

    async function refreshDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === "audioinput");
            
            const currentSelection = micSelect.value;
            micSelect.innerHTML = "";
            
            audioInputs.forEach(d => {
                const option = document.createElement("option");
                option.value = d.deviceId;
                option.text = d.label || `Microphone ${micSelect.length + 1}`;
                micSelect.appendChild(option);
            });

            if (currentSelection && [...micSelect.options].some(o => o.value === currentSelection)) {
                micSelect.value = currentSelection;
            }
        } catch (e) {
            console.error(`${e.name}: ${e.message}`);
        }
    }

    refreshDevices();

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

        if (isFinite(integratedLufs)) {
            document.getElementById("bar-integrated").style.height = lufsToHeight(integratedLufs) + "%";
            document.getElementById("val-integrated").textContent = integratedLufs.toFixed(1) + " LUFS";
        } else {
            document.getElementById("bar-integrated").style.height = "0%";
            document.getElementById("val-integrated").textContent = "--- LUFS";
        }

        if (isFinite(truePeakLufs)) {
            document.getElementById("bar-truepeak").style.height = lufsToHeight(truePeakLufs) + "%";
            document.getElementById("val-truepeak").textContent = truePeakLufs.toFixed(1) + " dBTP";
        } else {
            document.getElementById("bar-truepeak").style.height = "0%";
            document.getElementById("val-truepeak").textContent = "--- dBTP";
        }

        requestAnimationFrame(drawMeter);
    }
    requestAnimationFrame(drawMeter);

    function Record() {
        if (!isRecording) {
            const constraints = {
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            };

            if (micSelect.value) {
                constraints.audio.deviceId = { exact: micSelect.value };
            }

            navigator.mediaDevices.getUserMedia(constraints)
                .then(async stream => {
                    await refreshDevices();
                    isRecording = true;
                    button.textContent = "Stop Recording";

                    const audioContext = new AudioContext();
                    await audioContext.audioWorklet.addModule('./js/loudness-processor.js');
                    const source = audioContext.createMediaStreamSource(stream);
                    const workletNode = new AudioWorkletNode(audioContext, 'loudness-processor');

                    workletNode.port.onmessage = (e) => {
                        if (e.data.momentary !== undefined) {
                            momentaryLufs = e.data.momentary;
                            shortTermLufs = e.data.shortTerm;
                            truePeakLufs = e.data.truePeak;
                        }
                        if (e.data.integrated !== undefined) {
                            integratedLufs = e.data.integrated;
                        }
                    };

                    source.connect(workletNode);
                    workletNode.connect(audioContext.destination);

                    window.audioContext = audioContext;
                    window.workletNode = workletNode;
                })
                .catch(err => {
                    console.error("Microphone access denied", err);
                    alert("Please allow microphone access");
                });
        } else {
            isRecording = false;
            button.textContent = "Start Recording";
            momentaryLufs = -Infinity;
            shortTermLufs = -Infinity;
            truePeakLufs = -Infinity; 

            window.workletNode.port.postMessage({ command: "getIntegrated" });

            setTimeout(() => {
                if (window.workletNode) window.workletNode.disconnect();
                if (window.audioContext) window.audioContext.close();
            }, 300);
        }
    }
});