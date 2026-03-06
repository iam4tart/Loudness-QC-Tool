POLISH: problem -> solution -> tech stack -> thinking pointers

[x] HTML button
[x] JS toggle
[x] Microphone access
[x] Audio capture
[x] Capture chunks
[x] K-weighting filter
[ ] Loudness calculation
[ ] Real-time display
[ ] Integrated loudness
[ ] Deploy

technically, audio heavy dsp tooling should be done in C++ for faster computation and with WASM compiled for JS, but loudness meter is not technically heavy therefore directly using webaudio api with audioworklet works here.

promise is a object representing a future value(async operation).
having states like pending, fulfilled, rejected. Used for non-blocking operations like API Calls, file reading, microphone access, etc

restaurant analogy to understand non-blocking operation -
sync => you order, stand at counter, wait, block line behind you
promise(async) => you order, get pages, sit down, line moves, food ready, pager buzzes, you eat
pages = you do other things while waiting

for microphone access - we do by utilizing GetUserMedia function promise, as javascript is single threaded, promises prevent blocking, microphone access takes time-promise and lets other code run while watching. without it, browser freezes

navigator in web api is the global object representing browser info and capabilities

audio capture is done by creating audio context which is the audio-processing graph built from audio modules linked together and then plugging in mic media stream using CreateMediaStreamSource function

postMesage is a thread-safe queue between main thread of JS and audio thread of audio worklet, in actual browser creates a real OS thread in C++, and js script code runs there via V8 or similar and JS never gets blocked.

browser decides the chunking rate of audio input based on sampleRate usually 44100Hz or 48000Hz
AudioWorklet calls process() with exactly 128 samples every time.
128 samples at 48kHz = 2.67ms between calls
128 samples at 44.1kHz = 2.90ms between calls

browser delivers mic data and webaudio processes in 128-sample blocks, mic has a fixed clock (crystal oscillator)

k-weighting filter is basically a frequency weighting method used in acoustics to measure perceived loudness of sounds. It has ability to accurately predict human loudness perception. Because human ear response is non-linear usually giving more weight to higher frquencies

k-weighting filter applies two filters in series ->
stage 1 - high shelf filter (pre-filter) - boosts frequencies above ~1.5kHz by ~4dB
stage 2 - high pass filter (RLB weighting) - rolls off everything below ~38Hz (removing sub-bass)

each filter is biquad filter. the coefficients (b0,b1,b2,a1,a2) for each filter are fixed constants derived from the ITU-bs.1770 spec - they differ depending on your sample rate (48kHz or 44.1kHz)

mean squaring ->
squaring makes everything positive and amplifies louder sounds more than the quiet ones (matches perception)
mean the squares over a sliding window of 400ms every 100ms (75% overlap), this gives "momentary loudness" reading 10 times per second.
in dsp, 50% or more overlap is considered a good balance between time resolution and frequency resolution, helping to minimize artifacts and more accurate representations of rapidly changing signals.

mean_square = sum(sample**2 for each sample in window) / num_samples
to convert to lufs -> LUFS = -0.691 + 10 x log10(mean_square)
the constant -0.691 from the spec calibrates the scale.
LUFS = 0 is the absolute maximum
normal speech/music lives around -23 to -14 LUFS

momentary loudness changes every 100ms, integrated loudness is the average over the entire program
ITU also adds 2 gating stages to ignore silence (pauses between words shouldn't drag the average down)

gate 1 - absolute gate: ignore any 400ms block below -70 LUFS, therefore pure silence is excluded
gate 2 - relative gate:
    1. calculate un-gated average first (ex. -18LUFs)
    2. set threshold = un-gated average - 10 LU (ex. -18-10 = -28LUFs)
    3. re-calculate average using only blocks above that threshold (ex. block stream [-16, -17, -18, -50, -51, -17, -16], throw away -50 and -51 which is below -28LUFs)

transfer function is a mathematical representation that describes how a system responds to an input signal, typically expressed in the z-domain. we use it to analyze and design filters by relating the input and output signals through a ratio of polynomials.

biquad filter's difference equation:
    y[n] = b0·x[n] + b1·x[n-1] + b2·x[n-2] - a1·y[n-1] - a2·[n-2]
where,
    x = input samples (history)
    y = output samples (history) 

sample rate decides the buffer size and hop size because depending on how fast the hardware is clocking within the same time duration, different number of samples are fired.

bufferSize = sampleRate * 0.4
// 48000 * 0.4 = 19200 samples = 400ms
// 44100 * 0.4 = 17640 samples = 400ms

hopSize = sampleRate * 0.1
// 48000 * 0.1 = 4800 samples = 100ms
// 44100 * 0.1 = 4410 samples = 100ms

Also, don't forget signal processing domain usually work with floats more than doubles and int

samplesSinceLastReport variable helps count samples because inside process() which runs at 2.67ms(128 samples), we have no clock and we have to send lufs update every 100ms

for the realtime display - audioworklet is running on separate thread calling process() every 128 samples while the ui is on the main thread, these can't share memory directly.

requestAnimationFrame - browser API that calls function right before the browser repaints the screen, ~60 times per second (every 16ms)

now, when metering visuals are made, question is to either choose a logarithmic display or linear display, LUFS is logarithmic unit.
dB is general ratio. It just means 10*log10 of some ratio, it has no absolute reference point on its own.
LUFS is dB applied with kweighting and referenced to full-scale - meaning 0 LUFS is the absolute maximum a digital system can represent.

so we are using linear dB scale for visual metering as
-60 to 0 LUFS spread evenly = linear scale
but since LUFS is already log, this is perceptually correct

delay calculation for full chain:

AUDIO INPUT
    ↓
128 samples arrive every 2.67ms <- hardware clock, non-negotiable
    ↓
process() runs, samples get K-weighted and pushed into buffer
time cost: ~0.1ms (just math)
    ↓
buffer fills up to 400ms worth of samples
BUGGEST DELAY - averaging over 400ms by spec
    ↓
every 100ms (hopSize), LUFS is calculated and postMessage fires
so wait is upto 100ms for the next report
    ↓
message crosses the thread boundary
time cost: ~0.1ms
    ↓
currentLufs variable is updated
    ↓
rAF picks it up on the next tick
wait: 0-16ms
    ↓
DOM updates, number updates are seen

TOTAL WORST CASE:   ~517ms
TOTAL AVERAGE:      ~450ms

Also, humans can't perceive display lag under ~100ms

Sources used:
[Get Microphone Permission](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Build_a_phone_with_peerjs/Connect_peers/Get_microphone_permission)
[GetUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
[CreateMediaStreamSource()](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamSource)
[Audio Worklet Design Pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern/)
[Basic K-weighting](https://www.numberanalytics.com/blog/mastering-k-weighting-acoustics)
[Papers of ITU bs.1770 standards](https://www.itu.int/rec/R-REC-BS.1770)
[Audio EQ Cookbook](https://webaudio.github.io/Audio-EQ-Cookbook/audio-eq-cookbook.html)
[Transfer Function Analysis](https://www.dsprelated.com/freebooks/filters/Transfer_Function_Analysis.html)
[requestAnimationFrame()](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
[High level overview of loudness (little old)](https://www.production-expert.com/production-expert-1/loudness-everything-you-need-to-know)

managing start and stop and start for averaging lufs