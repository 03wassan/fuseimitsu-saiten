'use strict'

let test_frequencies = []

window.addEventListener('load', initialize)

const correlation_worker = new Worker('./js/correlation_worker.js')
correlation_worker.addEventListener('message', interpret_correlation_result)

async function initialize() {
    const A4 = 440
    const notes = ['ラ', 'ラ#', 'シ', 'ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#']
    const notes_en = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#']
    for (let i = 0; i < 30; i++) {
        const note_frequency = A4 * Math.pow(2, i / 12)
        const note_name = notes[i % 12]
        const note = { 'frequency': note_frequency, 'name': notes[i % 12] }
        const just_above = { 'frequency': note_frequency * Math.pow(2, 1 / 48), 'name': note_name + ' (ちょっと高い)' }
        const just_below = { 'frequency': note_frequency * Math.pow(2, -1 / 48), 'name': note_name + ' (ちょっと低い)' }
        test_frequencies = test_frequencies.concat([just_below, note, just_above])
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    use_stream(stream)
}

function use_stream(stream) {
    const audio_context = new AudioContext()
    const microphone = audio_context.createMediaStreamSource(stream)
    const script_processor = audio_context.createScriptProcessor(1024, 1, 1)

    script_processor.connect(audio_context.destination)
    microphone.connect(script_processor)

    const sample_length_milliseconds = 100
    let buffer = []
    let recording = true

    window.capture_audio = function(event) {
        if (!recording) {
            return
        }

        buffer = buffer.concat(Array.prototype.slice.call(event.inputBuffer.getChannelData(0)))

        // Stop recording after sample_length_milliseconds.
        if (buffer.length > sample_length_milliseconds * audio_context.sampleRate / 1000) {
            recording = false

            correlation_worker.postMessage({
                'timeseries': buffer,
                'test_frequencies': test_frequencies,
                'sample_rate': audio_context.sampleRate
            })
            buffer = []
            setTimeout(() => { recording = true }, 250)
        }
    }

    script_processor.onaudioprocess = window.capture_audio
}

function interpret_correlation_result(event) {
    const frequency_amplitudes = event.data.frequency_amplitudes

    // Compute the (squared) magnitudes of the complex amplitudes for each
    // test frequency.
    const magnitudes = frequency_amplitudes.map(z => z[0] * z[0] + z[1] * z[1])

    // Find the maximum in the list of magnitudes.
    let maximum_index = -1
    let maximum_magnitude = 0
    for (let i = 0; i < magnitudes.length; i++) {
        if (magnitudes[i] <= maximum_magnitude) {
            continue
        }

        maximum_index = i
        maximum_magnitude = magnitudes[i]
    }

    // Compute the average magnitude. We'll only pay attention to frequencies
    // with magnitudes significantly above average.
    const average = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length
    const confidence = maximum_magnitude / average
    const confidence_threshold = 30
    if (confidence > confidence_threshold) {
        const dominant_frequency = test_frequencies[maximum_index]
        document.getElementById('note-name').textContent = dominant_frequency.name
        //console.log(dominant_frequency.frequency)
    } else {
        document.getElementById('note-name').textContent = '(˘ω˘)'
    }
}
