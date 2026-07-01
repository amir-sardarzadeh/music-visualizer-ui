import FFT from 'fft.js'

export type AnalysisStage = 'decode' | 'waveform' | 'spectrum' | 'done'

export type AnalysisProgress = {
  stage: AnalysisStage
  percent: number
  detail: string
}

export type ChannelWaveform = {
  channel: number
  mins: Float32Array
  maxes: Float32Array
  rms: Float32Array
  peak: number
}

export type SpectrogramData = {
  columns: number
  rows: number
  minFrequency: number
  maxFrequency: number
  fftSize: number
  hopSize: number
  magnitudes: Uint8ClampedArray
  frequencyRows: Float32Array
}

export type NoteRollData = {
  columns: number
  noteCount: number
  midiMin: number
  midiMax: number
  energies: Uint8ClampedArray
}

export type AudioAnalysis = {
  fileName: string
  fileSize: number
  duration: number
  sampleRate: number
  numberOfChannels: number
  waveform: ChannelWaveform[]
  spectrogram: SpectrogramData
  noteRoll: NoteRollData
  summary: {
    peakAmplitude: number
    peakDb: number
    dominantFrequency: number
    dominantNote: string
  }
}

type ProgressHandler = (progress: AnalysisProgress) => void

const FFT_SIZE = 4096
const MAX_COLUMNS = 1400
const WAVEFORM_POINTS = 3600
const SPECTROGRAM_ROWS = 192
const MIN_FREQUENCY = 30
const MAX_FREQUENCY = 12000
const MIDI_MIN = 21
const MIDI_MAX = 108
const EPSILON = 1e-12
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext

export async function analyzeAudioFile(
  file: File,
  onProgress?: ProgressHandler,
): Promise<AudioAnalysis> {
  onProgress?.({ stage: 'decode', percent: 0.04, detail: 'Reading audio file' })

  const arrayBuffer = await file.arrayBuffer()
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext

  if (!AudioContextClass) {
    throw new Error('This browser does not expose the Web Audio API.')
  }

  const audioContext = new AudioContextClass()

  try {
    onProgress?.({ stage: 'decode', percent: 0.12, detail: 'Decoding audio samples' })
    const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    return await analyzeAudioBuffer(buffer, file.name, file.size, onProgress)
  } finally {
    await audioContext.close()
  }
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440)
}

export function midiToNoteName(midi: number): string {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${note}${octave}`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00'
  }

  const rounded = Math.floor(seconds)
  const mins = Math.floor(rounded / 60)
  const secs = rounded % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function formatFrequency(hertz: number): string {
  if (!Number.isFinite(hertz) || hertz <= 0) {
    return '0 Hz'
  }

  if (hertz >= 1000) {
    const value = hertz / 1000
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} kHz`
  }

  return `${Math.round(hertz)} Hz`
}

async function analyzeAudioBuffer(
  buffer: AudioBuffer,
  fileName: string,
  fileSize: number,
  onProgress?: ProgressHandler,
): Promise<AudioAnalysis> {
  onProgress?.({ stage: 'waveform', percent: 0.18, detail: 'Building channel waveforms' })

  const waveform = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
    buildWaveform(buffer.getChannelData(channel), channel + 1),
  )
  const peakAmplitude = waveform.reduce((peak, channel) => Math.max(peak, channel.peak), 0)

  onProgress?.({ stage: 'spectrum', percent: 0.24, detail: 'Mixing channels for FFT' })
  const mono = mixDown(buffer)

  const spectralViews = await buildSpectralViews(
    mono,
    buffer.sampleRate,
    onProgress,
  )

  return {
    fileName,
    fileSize,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels,
    waveform,
    spectrogram: spectralViews.spectrogram,
    noteRoll: spectralViews.noteRoll,
    summary: {
      peakAmplitude,
      peakDb: 20 * Math.log10(Math.max(peakAmplitude, EPSILON)),
      dominantFrequency: spectralViews.dominantFrequency,
      dominantNote: spectralViews.dominantNote,
    },
  }
}

function buildWaveform(samples: Float32Array, channel: number): ChannelWaveform {
  const samplesPerPoint = Math.max(1, Math.ceil(samples.length / WAVEFORM_POINTS))
  const pointCount = Math.ceil(samples.length / samplesPerPoint)
  const mins = new Float32Array(pointCount)
  const maxes = new Float32Array(pointCount)
  const rms = new Float32Array(pointCount)
  let peak = 0

  for (let point = 0; point < pointCount; point += 1) {
    const start = point * samplesPerPoint
    const end = Math.min(samples.length, start + samplesPerPoint)
    let min = 1
    let max = -1
    let sumSquares = 0

    for (let sample = start; sample < end; sample += 1) {
      const value = samples[sample]
      min = Math.min(min, value)
      max = Math.max(max, value)
      peak = Math.max(peak, Math.abs(value))
      sumSquares += value * value
    }

    mins[point] = min
    maxes[point] = max
    rms[point] = Math.sqrt(sumSquares / Math.max(1, end - start))
  }

  return { channel, mins, maxes, rms, peak }
}

function mixDown(buffer: AudioBuffer): Float32Array {
  const channelCount = buffer.numberOfChannels
  const samples = new Float32Array(buffer.length)

  for (let channel = 0; channel < channelCount; channel += 1) {
    const channelData = buffer.getChannelData(channel)
    const gain = 1 / channelCount

    for (let index = 0; index < channelData.length; index += 1) {
      samples[index] += channelData[index] * gain
    }
  }

  return samples
}

async function buildSpectralViews(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: ProgressHandler,
) {
  const fft = new FFT(FFT_SIZE)
  const window = makeHannWindow(FFT_SIZE)
  const input = new Array<number>(FFT_SIZE).fill(0)
  const output = fft.createComplexArray()
  const maxStart = Math.max(0, samples.length - FFT_SIZE)
  const hopSize =
    samples.length <= FFT_SIZE
      ? FFT_SIZE
      : Math.max(512, Math.floor(maxStart / Math.max(1, MAX_COLUMNS - 1)))
  const columns = samples.length <= FFT_SIZE ? 1 : Math.floor(maxStart / hopSize) + 1
  const rowBands = makeFrequencyBands(SPECTROGRAM_ROWS, sampleRate)
  const noteBands = makeNoteBands(sampleRate)
  const spectrumRaw = new Float32Array(columns * SPECTROGRAM_ROWS)
  const noteRaw = new Float32Array(columns * noteBands.length)
  const noteTotals = new Float64Array(noteBands.length)
  let maxSpectrumDb = -120
  let maxNoteDb = -120
  let strongestPower = 0
  let strongestBin = 0

  for (let column = 0; column < columns; column += 1) {
    const start = Math.min(column * hopSize, maxStart)

    for (let index = 0; index < FFT_SIZE; index += 1) {
      input[index] = (samples[start + index] ?? 0) * window[index]
    }

    fft.realTransform(output, input)

    const half = FFT_SIZE / 2
    for (let bin = 1; bin <= half; bin += 1) {
      const real = output[bin * 2] ?? 0
      const imaginary = output[bin * 2 + 1] ?? 0
      const power = real * real + imaginary * imaginary

      if (power > strongestPower) {
        strongestPower = power
        strongestBin = bin
      }
    }

    for (let row = 0; row < rowBands.length; row += 1) {
      const band = rowBands[row]
      const power = bandPower(output, band.from, band.to)
      const db = decibelsFromPower(power)
      spectrumRaw[column * SPECTROGRAM_ROWS + row] = db
      maxSpectrumDb = Math.max(maxSpectrumDb, db)
    }

    for (let note = 0; note < noteBands.length; note += 1) {
      const band = noteBands[note]
      const power = band.from <= band.to ? bandPower(output, band.from, band.to) : 0
      const db = decibelsFromPower(power)
      noteRaw[column * noteBands.length + note] = db
      noteTotals[note] += power
      maxNoteDb = Math.max(maxNoteDb, db)
    }

    if (column % 20 === 0) {
      onProgress?.({
        stage: 'spectrum',
        percent: 0.28 + (column / Math.max(1, columns - 1)) * 0.64,
        detail: `FFT frame ${column + 1} / ${columns}`,
      })
      await yieldToBrowser()
    }
  }

  const bestNoteIndex = indexOfMax(noteTotals)
  const dominantFrequency = strongestBin > 0 ? (strongestBin * sampleRate) / FFT_SIZE : 0
  const dominantNote =
    bestNoteIndex >= 0 && noteTotals[bestNoteIndex] > 0
      ? midiToNoteName(MIDI_MIN + bestNoteIndex)
      : 'None'

  onProgress?.({ stage: 'done', percent: 0.96, detail: 'Normalizing visual layers' })

  return {
    dominantFrequency,
    dominantNote,
    spectrogram: {
      columns,
      rows: SPECTROGRAM_ROWS,
      minFrequency: rowBands[0]?.center ?? MIN_FREQUENCY,
      maxFrequency: rowBands.at(-1)?.center ?? Math.min(MAX_FREQUENCY, sampleRate / 2),
      fftSize: FFT_SIZE,
      hopSize,
      magnitudes: normalizeToBytes(spectrumRaw, maxSpectrumDb, 72),
      frequencyRows: Float32Array.from(rowBands.map((band) => band.center)),
    },
    noteRoll: {
      columns,
      noteCount: noteBands.length,
      midiMin: MIDI_MIN,
      midiMax: MIDI_MAX,
      energies: normalizeToBytes(noteRaw, maxNoteDb, 64),
    },
  }
}

function makeHannWindow(size: number): Float32Array {
  const window = new Float32Array(size)

  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1))
  }

  return window
}

function makeFrequencyBands(rows: number, sampleRate: number) {
  const nyquist = sampleRate / 2
  const maxFrequency = Math.min(MAX_FREQUENCY, nyquist)
  const ratio = maxFrequency / MIN_FREQUENCY

  return Array.from({ length: rows }, (_, row) => {
    const low = MIN_FREQUENCY * ratio ** (row / rows)
    const high = MIN_FREQUENCY * ratio ** ((row + 1) / rows)
    const from = Math.max(1, Math.floor((low * FFT_SIZE) / sampleRate))
    const to = Math.min(FFT_SIZE / 2, Math.max(from, Math.ceil((high * FFT_SIZE) / sampleRate)))

    return {
      from,
      to,
      center: Math.sqrt(low * high),
    }
  })
}

function makeNoteBands(sampleRate: number) {
  const nyquist = sampleRate / 2

  return Array.from({ length: MIDI_MAX - MIDI_MIN + 1 }, (_, index) => {
    const midi = MIDI_MIN + index
    const center = midiToFrequency(midi)
    const low = center * 2 ** (-1 / 24)
    const high = center * 2 ** (1 / 24)
    const from = Math.max(1, Math.floor((low * FFT_SIZE) / sampleRate))
    const to =
      low > nyquist
        ? 0
        : Math.min(FFT_SIZE / 2, Math.max(from, Math.ceil((high * FFT_SIZE) / sampleRate)))

    return { from, to }
  })
}

function bandPower(output: number[], from: number, to: number): number {
  let power = 0

  for (let bin = from; bin <= to; bin += 1) {
    const real = output[bin * 2] ?? 0
    const imaginary = output[bin * 2 + 1] ?? 0
    power = Math.max(power, real * real + imaginary * imaginary)
  }

  return power
}

function decibelsFromPower(power: number): number {
  return 10 * Math.log10(power / (FFT_SIZE * FFT_SIZE) + EPSILON)
}

function normalizeToBytes(values: Float32Array, maxDb: number, rangeDb: number): Uint8ClampedArray {
  const normalized = new Uint8ClampedArray(values.length)
  const floor = maxDb - rangeDb

  for (let index = 0; index < values.length; index += 1) {
    const value = (values[index] - floor) / rangeDb
    normalized[index] = Math.round(clamp(value, 0, 1) * 255)
  }

  return normalized
}

function indexOfMax(values: Float64Array): number {
  let bestIndex = -1
  let bestValue = -Infinity

  for (let index = 0; index < values.length; index += 1) {
    if (values[index] > bestValue) {
      bestValue = values[index]
      bestIndex = index
    }
  }

  return bestIndex
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0)
  })
}
