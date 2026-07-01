import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangeEvent,
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from 'react'
import {
  Activity,
  AudioLines,
  FileAudio,
  Music2,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Upload,
  Waves,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import './App.css'
import {
  analyzeAudioFile,
  formatDuration,
  formatFrequency,
  midiToFrequency,
  midiToNoteName,
} from './audioAnalysis'
import type { AnalysisProgress, AudioAnalysis } from './audioAnalysis'

const MAX_TIME_ZOOM = 32
const MIN_FREQUENCY_SPAN = Math.log(2)
const WAVEFORM_AXIS = { left: 72, right: 18, top: 22, bottom: 36 }
const SPECTROGRAM_AXIS = { left: 76, right: 18, top: 20, bottom: 36 }
const PIANO_AXIS = { left: 84, right: 18, top: 18, bottom: 34 }

type TimelineView = {
  start: number
  end: number
  zoom: number
}

type FrequencyView = {
  min: number
  max: number
}

type NoteSettings = {
  threshold: number
  smoothing: number
  minMidi: number
  maxMidi: number
  harmonic: number
}

type LiveNote = {
  name: string
  frequency: number
  cents: number
  strength: number
}

function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [noteThreshold, setNoteThreshold] = useState(26)
  const [noteSmoothing, setNoteSmoothing] = useState(4)
  const [noteMinMidi, setNoteMinMidi] = useState(36)
  const [noteMaxMidi, setNoteMaxMidi] = useState(84)
  const [harmonicBias, setHarmonicBias] = useState(55)
  const [timeZoom, setTimeZoom] = useState(1)
  const [frequencyViewOverride, setFrequencyViewOverride] = useState<FrequencyView | null>(null)
  const { currentTime, isPlaying, setCurrentTime } = useAudioClock(audioRef, audioUrl)

  const loadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(file.name)) {
      setError('Choose an audio file.')
      return
    }

    const nextUrl = URL.createObjectURL(file)
    setAudioUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl)
      }

      return nextUrl
    })
    setAnalysis(null)
    setError(null)
    setTimeZoom(1)
    setFrequencyViewOverride(null)
    setProgress({ stage: 'decode', percent: 0, detail: 'Queued' })

    try {
      const nextAnalysis = await analyzeAudioFile(file, setProgress)
      setAnalysis(nextAnalysis)
      setProgress({ stage: 'done', percent: 1, detail: 'Ready' })
    } catch (caught) {
      setProgress(null)
      setAnalysis(null)
      setError(caught instanceof Error ? caught.message : 'The audio file could not be analyzed.')
    }
  }, [])

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
    }
  }, [audioUrl])

  const openPicker = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]

      if (file) {
        void loadFile(file)
      }

      event.target.value = ''
    },
    [loadFile],
  )

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsDragging(false)
      const file = event.dataTransfer.files?.[0]

      if (file) {
        void loadFile(file)
      }
    },
    [loadFile],
  )

  const duration = analysis?.duration ?? 0
  const timeline = useMemo(
    () => makeTimelineView(duration, currentTime, timeZoom),
    [duration, currentTime, timeZoom],
  )
  const frequencyView = useMemo(
    () => makeFrequencyView(analysis, frequencyViewOverride),
    [analysis, frequencyViewOverride],
  )
  const noteSettings = useMemo(
    () => ({
      threshold: noteThreshold,
      smoothing: noteSmoothing,
      minMidi: Math.min(noteMinMidi, noteMaxMidi),
      maxMidi: Math.max(noteMinMidi, noteMaxMidi),
      harmonic: harmonicBias,
    }),
    [harmonicBias, noteMaxMidi, noteMinMidi, noteSmoothing, noteThreshold],
  )
  const currentNote = useMemo(
    () => getLiveNote(analysis, currentTime, noteSettings),
    [analysis, currentTime, noteSettings],
  )

  const seekToTime = useCallback(
    (nextTime: number) => {
      const audio = audioRef.current
      const audioDuration =
        audio && Number.isFinite(audio.duration) ? audio.duration : duration
      const maxTime = Math.max(duration, audioDuration, 0)
      const safeTime = maxTime > 0 ? clampNumber(nextTime, 0, maxTime) : 0

      if (audio) {
        audio.currentTime = safeTime
      }

      setCurrentTime(safeTime)
    },
    [duration, setCurrentTime],
  )

  const handleSeek = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      seekToTime(Number(event.target.value))
    },
    [seekToTime],
  )

  const zoomIn = useCallback(() => {
    setTimeZoom((zoom) => Math.min(MAX_TIME_ZOOM, zoom * 2))
  }, [])

  const zoomOut = useCallback(() => {
    setTimeZoom((zoom) => Math.max(1, zoom / 2))
  }, [])

  const zoomFrequency = useCallback(
    (anchorFrequency: number, factor: number) => {
      if (!analysis || !frequencyView) {
        return
      }

      setFrequencyViewOverride((previous) => {
        const current = makeFrequencyView(analysis, previous)
        return zoomFrequencyView(
          current,
          {
            min: analysis.spectrogram.minFrequency,
            max: analysis.spectrogram.maxFrequency,
          },
          anchorFrequency,
          factor,
        )
      })
    },
    [analysis, frequencyView],
  )

  const panFrequency = useCallback(
    (deltaRatio: number) => {
      if (!analysis || !frequencyView) {
        return
      }

      setFrequencyViewOverride((previous) => {
        const current = makeFrequencyView(analysis, previous)
        return panFrequencyView(
          current,
          {
            min: analysis.spectrogram.minFrequency,
            max: analysis.spectrogram.maxFrequency,
          },
          deltaRatio,
        )
      })
    },
    [analysis, frequencyView],
  )

  const resetFrequencyZoom = useCallback(() => {
    setFrequencyViewOverride(null)
  }, [])

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current

    if (!audioUrl || !audio) {
      return
    }

    if (audio.paused) {
      void audio.play()
    } else {
      audio.pause()
    }
  }, [audioUrl])

  const resetTrack = useCallback(() => {
    const audio = audioRef.current

    if (audio) {
      audio.currentTime = 0
      audio.pause()
    }

    setCurrentTime(0)
  }, [setCurrentTime])

  const progressPercent = progress ? Math.round(progress.percent * 100) : 0

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <AudioLines size={24} />
          </div>
          <div className="brand-copy">
            <h1>Music Analyzer</h1>
            <p>Waveform, spectrum, and piano-roll inspection</p>
          </div>
        </div>

        <button className="toolbar-button" type="button" onClick={openPicker}>
          <Upload size={18} />
          Choose Audio
        </button>
      </header>

      <div className="workspace">
        <input
          ref={inputRef}
          className="file-input"
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg"
          onChange={handleInput}
        />

        <section
          className={`drop-zone ${isDragging ? 'is-dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className="drop-icon" aria-hidden="true">
            <FileAudio size={26} />
          </div>
          <div className="drop-copy">
            <strong>{analysis?.fileName ?? 'Drop audio'}</strong>
            <span>
              {analysis
                ? `${formatDuration(analysis.duration)} - ${analysis.numberOfChannels} channel${
                    analysis.numberOfChannels === 1 ? '' : 's'
                  }`
                : 'MP3, WAV, M4A, AAC, FLAC, OGG'}
            </span>
          </div>
          <button className="primary-button" type="button" onClick={openPicker}>
            <Upload size={18} />
            Browse
          </button>
        </section>

        {error ? (
          <section className="notice error" role="alert">
            {error}
          </section>
        ) : null}

        {progress && progress.stage !== 'done' ? (
          <section className="notice">
            <div>
              <strong>{progress.detail}</strong>
              <span>{progressPercent}%</span>
            </div>
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </section>
        ) : null}

        {audioUrl ? (
          <section className="transport">
            <audio ref={audioRef} src={audioUrl} preload="metadata" />
            <div className="transport-buttons">
              <button className="icon-button" type="button" onClick={togglePlayback} title="Play">
                {isPlaying ? <Pause size={19} /> : <Play size={19} />}
              </button>
              <button className="icon-button" type="button" onClick={resetTrack} title="Restart">
                <RotateCcw size={18} />
              </button>
            </div>
            <div className="time-control">
              <span>{formatDuration(currentTime)}</span>
              <input
                type="range"
                min="0"
                max={Math.max(duration, currentTime, 0.01)}
                step="0.01"
                value={Math.min(currentTime, Math.max(duration, currentTime))}
                onChange={handleSeek}
                aria-label="Playback time"
              />
              <span>{formatDuration(duration)}</span>
            </div>
            <div className="zoom-control">
              <span>Time Zoom</span>
              <div className="zoom-buttons">
                <button
                  className="icon-button compact"
                  type="button"
                  onClick={zoomOut}
                  disabled={timeZoom <= 1}
                  title="Zoom out"
                >
                  <ZoomOut size={16} />
                </button>
                <strong>{timeZoom}x</strong>
                <button
                  className="icon-button compact"
                  type="button"
                  onClick={zoomIn}
                  disabled={timeZoom >= MAX_TIME_ZOOM}
                  title="Zoom in"
                >
                  <ZoomIn size={16} />
                </button>
              </div>
              <small>
                {formatDuration(timeline.start)} - {formatDuration(timeline.end)}
              </small>
            </div>
            <TunerBox note={currentNote} />
            <StatsGrid analysis={analysis} />
          </section>
        ) : null}

        <AnalyzerStrip
          icon={<Waves size={18} />}
          title="Time - Magnitude"
          meta={analysis ? `${analysis.numberOfChannels} channel lanes - ${timeZoom}x` : 'No track'}
        >
          {analysis ? (
            <WaveformCanvas
              analysis={analysis}
              currentTime={currentTime}
              timeline={timeline}
              onSeek={seekToTime}
            />
          ) : (
            <EmptyStrip label="No waveform" />
          )}
        </AnalyzerStrip>

        <AnalyzerStrip
          icon={<Activity size={18} />}
          title="Frequency - Time"
          meta={
            analysis && frequencyView
              ? `${formatFrequency(frequencyView.min)} to ${formatFrequency(frequencyView.max)} - ${timeZoom}x`
              : 'No spectrum'
          }
          actions={
            analysis ? (
              <button
                className="icon-button compact"
                type="button"
                onClick={resetFrequencyZoom}
                title="Reset frequency zoom"
              >
                <RotateCcw size={15} />
              </button>
            ) : null
          }
        >
          {analysis && frequencyView ? (
            <SpectrogramCanvas
              analysis={analysis}
              currentTime={currentTime}
              timeline={timeline}
              frequencyView={frequencyView}
              onSeek={seekToTime}
              onFrequencyZoom={zoomFrequency}
              onFrequencyPan={panFrequency}
            />
          ) : (
            <EmptyStrip label="No spectrogram" />
          )}
        </AnalyzerStrip>

        <AnalyzerStrip
          icon={<Music2 size={18} />}
          title="Notes - Piano Levels"
          meta={analysis ? `${analysis.noteRoll.noteCount} piano notes - ${timeZoom}x` : 'No notes'}
          actions={
            <div className="note-controls">
              <label>
                <SlidersHorizontal size={15} />
                <span>Sensitivity</span>
                <strong>{noteThreshold}</strong>
                <input
                  type="range"
                  min="0"
                  max="90"
                  value={noteThreshold}
                  onChange={(event) => setNoteThreshold(Number(event.target.value))}
                />
              </label>
              <label>
                <span>Smooth</span>
                <strong>{noteSmoothing}</strong>
                <input
                  type="range"
                  min="0"
                  max="18"
                  value={noteSmoothing}
                  onChange={(event) => setNoteSmoothing(Number(event.target.value))}
                />
              </label>
              <label>
                <span>Low</span>
                <strong>{midiToNoteName(noteMinMidi)}</strong>
                <input
                  type="range"
                  min={analysis?.noteRoll.midiMin ?? 21}
                  max={analysis?.noteRoll.midiMax ?? 108}
                  value={noteMinMidi}
                  onChange={(event) => setNoteMinMidi(Number(event.target.value))}
                />
              </label>
              <label>
                <span>High</span>
                <strong>{midiToNoteName(noteMaxMidi)}</strong>
                <input
                  type="range"
                  min={analysis?.noteRoll.midiMin ?? 21}
                  max={analysis?.noteRoll.midiMax ?? 108}
                  value={noteMaxMidi}
                  onChange={(event) => setNoteMaxMidi(Number(event.target.value))}
                />
              </label>
              <label>
                <span>Harmonic</span>
                <strong>{harmonicBias}</strong>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={harmonicBias}
                  onChange={(event) => setHarmonicBias(Number(event.target.value))}
                />
              </label>
            </div>
          }
        >
          {analysis ? (
            <PianoRollCanvas
              analysis={analysis}
              currentTime={currentTime}
              timeline={timeline}
              threshold={noteSettings.threshold}
              onSeek={seekToTime}
            />
          ) : (
            <EmptyStrip label="No note grid" />
          )}
        </AnalyzerStrip>
      </div>
    </main>
  )
}

type StripProps = {
  icon: ReactNode
  title: string
  meta: string
  actions?: ReactNode
  children: ReactNode
}

function AnalyzerStrip({ icon, title, meta, actions, children }: StripProps) {
  return (
    <section className="analyzer-strip">
      <div className="strip-header">
        <div className="strip-title">
          {icon}
          <div>
            <h2>{title}</h2>
            <span>{meta}</span>
          </div>
        </div>
        {actions ? <div className="strip-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

function StatsGrid({ analysis }: { analysis: AudioAnalysis | null }) {
  const rows = analysis
    ? [
        ['Channels', analysis.numberOfChannels.toString()],
        ['Rate', `${(analysis.sampleRate / 1000).toFixed(1)} kHz`],
        ['Peak', `${analysis.summary.peakDb.toFixed(1)} dB`],
        ['Dominant', formatFrequency(analysis.summary.dominantFrequency)],
        ['Note', analysis.summary.dominantNote],
        ['FFT', analysis.spectrogram.fftSize.toString()],
      ]
    : [
        ['Channels', '--'],
        ['Rate', '--'],
        ['Peak', '--'],
        ['Dominant', '--'],
        ['Note', '--'],
        ['FFT', '--'],
      ]

  return (
    <div className="stats-grid">
      {rows.map(([label, value]) => (
        <div className="stat" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  )
}

function TunerBox({ note }: { note: LiveNote | null }) {
  const cents = note ? clampNumber(note.cents, -50, 50) : 0
  const label =
    note && Math.abs(note.cents) > 2
      ? `${Math.abs(Math.round(note.cents))}c ${note.cents > 0 ? 'sharp' : 'flat'}`
      : 'in tune'

  return (
    <div className="tuner-box">
      <span>Now</span>
      <strong>{note?.name ?? '--'}</strong>
      <small>
        {note ? `${formatFrequency(note.frequency)} - ${label} - ${Math.round(note.strength * 100)}%` : 'no note'}
      </small>
      <div className="tuner-meter" aria-hidden="true">
        <i style={{ left: `${50 + cents}%` }} />
      </div>
    </div>
  )
}

function EmptyStrip({ label }: { label: string }) {
  return (
    <div className="empty-strip">
      <FileAudio size={20} />
      <span>{label}</span>
    </div>
  )
}

function WaveformCanvas({
  analysis,
  currentTime,
  timeline,
  onSeek,
}: {
  analysis: AudioAnalysis
  currentTime: number
  timeline: TimelineView
  onSeek: (time: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const pointerHandlers = useTimelinePointer(frameRef, timeline, WAVEFORM_AXIS, onSeek)

  useCanvasRenderer(
    canvasRef,
    (ctx, width, height) => {
      drawWaveform(ctx, width, height, analysis, currentTime, timeline)
    },
  )

  return (
    <div
      ref={frameRef}
      className="canvas-frame waveform-frame"
      style={{ height: `${Math.max(282, analysis.numberOfChannels * 92 + 68)}px` }}
      {...pointerHandlers}
    >
      <canvas ref={canvasRef} className="analysis-canvas" />
    </div>
  )
}

function SpectrogramCanvas({
  analysis,
  currentTime,
  timeline,
  frequencyView,
  onSeek,
  onFrequencyZoom,
  onFrequencyPan,
}: {
  analysis: AudioAnalysis
  currentTime: number
  timeline: TimelineView
  frequencyView: FrequencyView
  onSeek: (time: number) => void
  onFrequencyZoom: (anchorFrequency: number, factor: number) => void
  onFrequencyPan: (deltaRatio: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const frequencyDragRef = useRef<{ lastY: number } | null>(null)
  const pointerHandlers = useTimelinePointer(frameRef, timeline, SPECTROGRAM_AXIS, onSeek)
  const heatmap = useMemo(
    () =>
      createHeatmapCanvas(
        analysis.spectrogram.columns,
        analysis.spectrogram.rows,
        analysis.spectrogram.magnitudes,
        spectrumColor,
      ),
    [analysis],
  )

  useCanvasRenderer(
    canvasRef,
    (ctx, width, height) => {
      drawSpectrogram(ctx, width, height, analysis, currentTime, heatmap, timeline, frequencyView)
    },
  )

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      const element = frameRef.current

      if (!element) {
        return
      }

      const rect = element.getBoundingClientRect()

      if (event.cancelable) {
        event.preventDefault()
      }

      event.stopPropagation()

      const contentHeight = Math.max(
        1,
        rect.height - SPECTROGRAM_AXIS.top - SPECTROGRAM_AXIS.bottom,
      )
      const localY = clampNumber(event.clientY - rect.top - SPECTROGRAM_AXIS.top, 0, contentHeight)
      const anchorFrequency = yToFrequency(localY, contentHeight, frequencyView)
      const factor = event.deltaY < 0 ? 0.78 : 1.28

      onFrequencyZoom(anchorFrequency, factor)
    },
    [frequencyView, onFrequencyZoom],
  )

  useEffect(() => {
    const element = frameRef.current

    if (!element) {
      return undefined
    }

    element.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      element.removeEventListener('wheel', handleWheel)
    }
  }, [handleWheel])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)

      if (event.ctrlKey) {
        event.preventDefault()
        frequencyDragRef.current = { lastY: event.clientY }
        return
      }

      frequencyDragRef.current = null
      pointerHandlers.onPointerDown(event)
    },
    [pointerHandlers],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = frequencyDragRef.current

      if (drag && event.buttons === 1) {
        const element = frameRef.current

        if (!element) {
          return
        }

        event.preventDefault()
        const rect = element.getBoundingClientRect()
        const contentHeight = Math.max(
          1,
          rect.height - SPECTROGRAM_AXIS.top - SPECTROGRAM_AXIS.bottom,
        )
        const deltaY = event.clientY - drag.lastY
        drag.lastY = event.clientY
        onFrequencyPan(deltaY / contentHeight)
        return
      }

      if (!event.ctrlKey) {
        pointerHandlers.onPointerMove(event)
      }
    },
    [onFrequencyPan, pointerHandlers],
  )

  const stopFrequencyDrag = useCallback(() => {
    frequencyDragRef.current = null
  }, [])

  return (
    <div
      ref={frameRef}
      className="canvas-frame spectrogram-frame"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopFrequencyDrag}
      onPointerCancel={stopFrequencyDrag}
    >
      <canvas ref={canvasRef} className="analysis-canvas" />
    </div>
  )
}

function PianoRollCanvas({
  analysis,
  currentTime,
  timeline,
  threshold,
  onSeek,
}: {
  analysis: AudioAnalysis
  currentTime: number
  timeline: TimelineView
  threshold: number
  onSeek: (time: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const pointerHandlers = useTimelinePointer(frameRef, timeline, PIANO_AXIS, onSeek)
  const heatmap = useMemo(
    () => createNoteCanvas(analysis.noteRoll, threshold),
    [analysis, threshold],
  )

  useCanvasRenderer(
    canvasRef,
    (ctx, width, height) => {
      drawPianoRoll(ctx, width, height, analysis, currentTime, heatmap, timeline)
    },
  )

  return (
    <div ref={frameRef} className="canvas-frame piano-frame" {...pointerHandlers}>
      <canvas ref={canvasRef} className="analysis-canvas" />
    </div>
  )
}

function useTimelinePointer(
  frameRef: RefObject<HTMLDivElement | null>,
  timeline: TimelineView,
  axis: { left: number; right: number },
  onSeek: (time: number) => void,
) {
  const seekFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const element = frameRef.current

      if (!element) {
        return
      }

      onSeek(pointerToTime(event.clientX, element, axis, timeline))
    },
    [axis, frameRef, onSeek, timeline],
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      seekFromPointer(event)
    },
    [seekFromPointer],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.buttons === 1) {
        seekFromPointer(event)
      }
    },
    [seekFromPointer],
  )

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
  }
}

function useAudioClock(audioRef: RefObject<HTMLAudioElement | null>, source: string | null) {
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    const audio = audioRef.current

    if (!audio) {
      return undefined
    }

    let frame = 0

    const sync = () => {
      setCurrentTime(audio.currentTime)

      if (!audio.paused) {
        frame = window.requestAnimationFrame(sync)
      }
    }

    const handlePlay = () => {
      setIsPlaying(true)
      sync()
    }
    const handlePause = () => {
      setIsPlaying(false)
      setCurrentTime(audio.currentTime)
    }
    const handleSeek = () => setCurrentTime(audio.currentTime)

    setCurrentTime(0)
    setIsPlaying(false)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handlePause)
    audio.addEventListener('timeupdate', handleSeek)
    audio.addEventListener('loadedmetadata', handleSeek)

    return () => {
      window.cancelAnimationFrame(frame)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handlePause)
      audio.removeEventListener('timeupdate', handleSeek)
      audio.removeEventListener('loadedmetadata', handleSeek)
    }
  }, [audioRef, source])

  return { currentTime, isPlaying, setCurrentTime }
}

function useCanvasRenderer(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
) {
  const drawRef = useRef(draw)

  useEffect(() => {
    drawRef.current = draw
  }, [draw])

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) {
      return undefined
    }

    let frame = 0
    const render = () => {
      renderCanvas(canvas, drawRef.current)
    }

    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(render)
    })

    resizeObserver.observe(canvas)
    render()

    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
    }
  }, [canvasRef])

  useEffect(() => {
    const canvas = canvasRef.current

    if (canvas) {
      renderCanvas(canvas, draw)
    }
  }, [canvasRef, draw])
}

function renderCanvas(
  canvas: HTMLCanvasElement,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
) {
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return
  }

  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, Math.floor(rect.width))
  const height = Math.max(1, Math.floor(rect.height))
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)

  canvas.width = Math.floor(width * pixelRatio)
  canvas.height = Math.floor(height * pixelRatio)
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  draw(ctx, width, height)
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  analysis: AudioAnalysis,
  currentTime: number,
  timeline: TimelineView,
) {
  const { left: axisLeft, right: axisRight, top, bottom } = WAVEFORM_AXIS
  const contentWidth = Math.max(1, width - axisLeft - axisRight)
  const contentHeight = Math.max(1, height - top - bottom)
  const laneHeight = contentHeight / analysis.waveform.length

  paintSurface(ctx, width, height)
  drawTimeGrid(ctx, axisLeft, top, contentWidth, contentHeight, timeline)

  analysis.waveform.forEach((channel, channelIndex) => {
    const laneTop = top + channelIndex * laneHeight
    const baseline = laneTop + laneHeight / 2
    const amplitude = laneHeight * 0.38
    const color = channelColor(channelIndex)
    const points = channel.mins.length

    ctx.fillStyle = channelIndex % 2 === 0 ? '#fbfbf9' : '#f2f2ee'
    ctx.fillRect(axisLeft, laneTop, contentWidth, laneHeight)
    ctx.strokeStyle = '#d8d8d3'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(axisLeft, baseline)
    ctx.lineTo(axisLeft + contentWidth, baseline)
    ctx.stroke()

    ctx.fillStyle = '#5b5d5a'
    ctx.font = '12px system-ui, Segoe UI, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(`Ch ${channel.channel}`, 14, baseline)

    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1, contentWidth / points)

    for (let point = 0; point < points; point += 1) {
      const pointTime = (point / Math.max(1, points - 1)) * analysis.duration

      if (pointTime < timeline.start || pointTime > timeline.end) {
        continue
      }

      const x = axisLeft + ((pointTime - timeline.start) / timelineSpan(timeline)) * contentWidth
      const yMax = baseline - channel.maxes[point] * amplitude
      const yMin = baseline - channel.mins[point] * amplitude
      ctx.moveTo(x, yMin)
      ctx.lineTo(x, yMax)
    }

    ctx.stroke()

    ctx.beginPath()
    ctx.strokeStyle = withAlpha(color, 0.35)
    ctx.lineWidth = 1

    let startedRms = false

    for (let point = 0; point < points; point += 1) {
      const pointTime = (point / Math.max(1, points - 1)) * analysis.duration

      if (pointTime < timeline.start || pointTime > timeline.end) {
        continue
      }

      const x = axisLeft + ((pointTime - timeline.start) / timelineSpan(timeline)) * contentWidth
      const y = baseline - channel.rms[point] * amplitude

      if (!startedRms) {
        ctx.moveTo(x, y)
        startedRms = true
      } else {
        ctx.lineTo(x, y)
      }
    }

    ctx.stroke()
  })

  drawPlayhead(ctx, axisLeft, top, contentWidth, contentHeight, timeline, currentTime)
}

function drawSpectrogram(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  analysis: AudioAnalysis,
  currentTime: number,
  heatmap: HTMLCanvasElement,
  timeline: TimelineView,
  frequencyView: FrequencyView,
) {
  const { left: axisLeft, right: axisRight, top, bottom } = SPECTROGRAM_AXIS
  const contentWidth = Math.max(1, width - axisLeft - axisRight)
  const contentHeight = Math.max(1, height - top - bottom)

  paintSurface(ctx, width, height)
  ctx.imageSmoothingEnabled = false
  drawSpectrogramImage(
    ctx,
    heatmap,
    axisLeft,
    top,
    contentWidth,
    contentHeight,
    timeline,
    analysis.duration,
    frequencyView,
    {
      min: analysis.spectrogram.minFrequency,
      max: analysis.spectrogram.maxFrequency,
    },
  )
  drawFrequencyGrid(
    ctx,
    axisLeft,
    top,
    contentWidth,
    contentHeight,
    frequencyView.min,
    frequencyView.max,
  )
  drawTimeGrid(ctx, axisLeft, top, contentWidth, contentHeight, timeline)
  drawPlayhead(ctx, axisLeft, top, contentWidth, contentHeight, timeline, currentTime)
}

function drawPianoRoll(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  analysis: AudioAnalysis,
  currentTime: number,
  heatmap: HTMLCanvasElement,
  timeline: TimelineView,
) {
  const { left: axisLeft, right: axisRight, top, bottom } = PIANO_AXIS
  const contentWidth = Math.max(1, width - axisLeft - axisRight)
  const contentHeight = Math.max(1, height - top - bottom)
  const noteCount = analysis.noteRoll.noteCount
  const rowHeight = contentHeight / noteCount

  paintSurface(ctx, width, height)

  for (let index = 0; index < noteCount; index += 1) {
    const midi = analysis.noteRoll.midiMin + index
    const displayIndex = noteCount - 1 - index
    const y = top + displayIndex * rowHeight
    const blackKey = isBlackKey(midi)

    ctx.fillStyle = blackKey ? '#e7e7e4' : '#fbfbf9'
    ctx.fillRect(axisLeft, y, contentWidth, Math.max(1, rowHeight))

    if (midi % 12 === 0) {
      ctx.strokeStyle = '#c9c9c2'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(axisLeft, y)
      ctx.lineTo(axisLeft + contentWidth, y)
      ctx.stroke()

      ctx.fillStyle = '#4b4d4b'
      ctx.font = '11px system-ui, Segoe UI, sans-serif'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(midiToNoteName(midi), axisLeft - 10, y + rowHeight / 2)
    }

    drawPianoKey(ctx, 12, y, axisLeft - 22, Math.max(1, rowHeight), blackKey)
  }

  ctx.imageSmoothingEnabled = false
  drawTimelineImage(ctx, heatmap, axisLeft, top, contentWidth, contentHeight, timeline, analysis.duration)
  drawTimeGrid(ctx, axisLeft, top, contentWidth, contentHeight, timeline)
  drawPlayhead(ctx, axisLeft, top, contentWidth, contentHeight, timeline, currentTime)
}

function drawPianoKey(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  blackKey: boolean,
) {
  ctx.fillStyle = blackKey ? '#2f302e' : '#ffffff'
  ctx.fillRect(x, y, blackKey ? width * 0.68 : width, height)
  ctx.strokeStyle = '#cfcfca'
  ctx.strokeRect(x, y, width, height)
}

function paintSurface(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#f7f7f3'
  ctx.fillRect(0, 0, width, height)
}

function drawTimeGrid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  timeline: TimelineView,
) {
  const span = timelineSpan(timeline)
  const ticks = makeTimeTicks(timeline.start, timeline.end, Math.max(3, Math.floor(width / 150)))

  ctx.strokeStyle = 'rgba(70, 72, 70, 0.16)'
  ctx.fillStyle = '#595c59'
  ctx.font = '11px system-ui, Segoe UI, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  ticks.forEach((tick) => {
    const tickX = x + ((tick - timeline.start) / span) * width
    ctx.beginPath()
    ctx.moveTo(tickX, y)
    ctx.lineTo(tickX, y + height)
    ctx.stroke()
    ctx.fillText(formatTimeTick(tick, span), tickX, y + height + 8)
  })
}

function drawFrequencyGrid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  minFrequency: number,
  maxFrequency: number,
) {
  const labels = makeFrequencyTicks(minFrequency, maxFrequency)
  const logRange = Math.log(maxFrequency / minFrequency)

  ctx.font = '11px system-ui, Segoe UI, sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  labels.forEach((frequency) => {
    const normalized = Math.log(frequency / minFrequency) / logRange
    const rowY = y + height * (1 - normalized)

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)'
    ctx.beginPath()
    ctx.moveTo(x, rowY)
    ctx.lineTo(x + width, rowY)
    ctx.stroke()

    ctx.fillStyle = '#4c4f4c'
    ctx.fillText(formatFrequency(frequency), x - 10, rowY)
  })
}

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  timeline: TimelineView,
  currentTime: number,
) {
  const span = timelineSpan(timeline)

  if (span <= 0 || currentTime < timeline.start || currentTime > timeline.end) {
    return
  }

  const playheadX = x + ((currentTime - timeline.start) / span) * width
  ctx.strokeStyle = '#e14f3f'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(playheadX, y)
  ctx.lineTo(playheadX, y + height)
  ctx.stroke()
}

function drawTimelineImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
  timeline: TimelineView,
  duration: number,
) {
  if (duration <= 0 || image.width <= 1) {
    ctx.drawImage(image, x, y, width, height)
    return
  }

  const startRatio = clampNumber(timeline.start / duration, 0, 1)
  const endRatio = clampNumber(timeline.end / duration, startRatio, 1)
  const sourceX = Math.floor(startRatio * image.width)
  const sourceWidth = Math.max(1, Math.ceil((endRatio - startRatio) * image.width))

  ctx.drawImage(
    image,
    sourceX,
    0,
    Math.min(sourceWidth, image.width - sourceX),
    image.height,
    x,
    y,
    width,
    height,
  )
}

function drawSpectrogramImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
  timeline: TimelineView,
  duration: number,
  frequencyView: FrequencyView,
  fullRange: FrequencyView,
) {
  if (duration <= 0 || image.width <= 1 || image.height <= 1) {
    ctx.drawImage(image, x, y, width, height)
    return
  }

  const startRatio = clampNumber(timeline.start / duration, 0, 1)
  const endRatio = clampNumber(timeline.end / duration, startRatio, 1)
  const sourceX = Math.floor(startRatio * image.width)
  const sourceWidth = Math.max(1, Math.ceil((endRatio - startRatio) * image.width))
  const sourceTop = frequencyToImageY(frequencyView.max, image.height, fullRange)
  const sourceBottom = frequencyToImageY(frequencyView.min, image.height, fullRange)
  const sourceY = Math.floor(Math.min(sourceTop, sourceBottom))
  const sourceHeight = Math.max(1, Math.ceil(Math.abs(sourceBottom - sourceTop)))

  ctx.drawImage(
    image,
    sourceX,
    clampNumber(sourceY, 0, image.height - 1),
    Math.min(sourceWidth, image.width - sourceX),
    Math.min(sourceHeight, image.height - sourceY),
    x,
    y,
    width,
    height,
  )
}

function createHeatmapCanvas(
  columns: number,
  rows: number,
  data: Uint8ClampedArray,
  color: (value: number) => [number, number, number, number],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = columns
  canvas.height = rows
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return canvas
  }

  const image = ctx.createImageData(columns, rows)

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const source = column * rows + row
      const targetRow = rows - 1 - row
      const target = (targetRow * columns + column) * 4
      const [red, green, blue, alpha] = color(data[source])
      image.data[target] = red
      image.data[target + 1] = green
      image.data[target + 2] = blue
      image.data[target + 3] = alpha
    }
  }

  ctx.putImageData(image, 0, 0)
  return canvas
}

function createNoteCanvas(noteRoll: AudioAnalysis['noteRoll'], threshold: number): HTMLCanvasElement {
  const thresholdByte = (threshold / 100) * 255
  const canvas = document.createElement('canvas')
  canvas.width = noteRoll.columns
  canvas.height = noteRoll.noteCount
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return canvas
  }

  const image = ctx.createImageData(noteRoll.columns, noteRoll.noteCount)

  for (let column = 0; column < noteRoll.columns; column += 1) {
    for (let note = 0; note < noteRoll.noteCount; note += 1) {
      const source = column * noteRoll.noteCount + note
      const targetRow = noteRoll.noteCount - 1 - note
      const target = (targetRow * noteRoll.columns + column) * 4
      const value = noteRoll.energies[source]
      const [red, green, blue, alpha] =
        value >= thresholdByte ? noteColor(value) : [0, 0, 0, 0]

      image.data[target] = red
      image.data[target + 1] = green
      image.data[target + 2] = blue
      image.data[target + 3] = alpha
    }
  }

  ctx.putImageData(image, 0, 0)
  return canvas
}

function spectrumColor(value: number): [number, number, number, number] {
  const [red, green, blue] = palette(value / 255, [
    [17, 18, 18],
    [20, 103, 110],
    [205, 150, 33],
    [220, 76, 62],
    [255, 247, 214],
  ])

  return [red, green, blue, 255]
}

function noteColor(value: number): [number, number, number, number] {
  const intensity = value / 255
  const [red, green, blue] = palette(intensity, [
    [28, 135, 126],
    [232, 183, 54],
    [225, 79, 63],
    [255, 246, 205],
  ])

  return [red, green, blue, Math.round(70 + intensity * 185)]
}

function palette(value: number, colors: Array<[number, number, number]>): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, value))
  const scaled = clamped * (colors.length - 1)
  const index = Math.min(colors.length - 2, Math.floor(scaled))
  const mix = scaled - index
  const from = colors[index]
  const to = colors[index + 1]

  return [
    Math.round(from[0] + (to[0] - from[0]) * mix),
    Math.round(from[1] + (to[1] - from[1]) * mix),
    Math.round(from[2] + (to[2] - from[2]) * mix),
  ]
}

function makeTimelineView(duration: number, currentTime: number, zoom: number): TimelineView {
  if (!Number.isFinite(duration) || duration <= 0) {
    return { start: 0, end: 0, zoom: 1 }
  }

  const safeZoom = clampNumber(zoom, 1, MAX_TIME_ZOOM)
  const span = duration / safeZoom
  const center = clampNumber(currentTime, 0, duration)
  const start = clampNumber(center - span / 2, 0, Math.max(0, duration - span))

  return {
    start,
    end: start + span,
    zoom: safeZoom,
  }
}

function makeFrequencyView(
  analysis: AudioAnalysis | null,
  override: FrequencyView | null,
): FrequencyView | null {
  if (!analysis) {
    return null
  }

  const full = {
    min: analysis.spectrogram.minFrequency,
    max: analysis.spectrogram.maxFrequency,
  }

  if (!override) {
    return full
  }

  return {
    min: clampNumber(override.min, full.min, full.max),
    max: clampNumber(override.max, full.min, full.max),
  }
}

function zoomFrequencyView(
  current: FrequencyView | null,
  full: FrequencyView,
  anchorFrequency: number,
  factor: number,
): FrequencyView {
  const safeCurrent = current ?? full
  const fullMinLog = Math.log(full.min)
  const fullMaxLog = Math.log(full.max)
  const lowLog = Math.log(safeCurrent.min)
  const highLog = Math.log(safeCurrent.max)
  const span = highLog - lowLog
  const fullSpan = fullMaxLog - fullMinLog
  const nextSpan = clampNumber(span * factor, MIN_FREQUENCY_SPAN, fullSpan)
  const anchorLog = clampNumber(Math.log(anchorFrequency), lowLog, highLog)
  const anchorRatio = span > 0 ? (anchorLog - lowLog) / span : 0.5
  let nextLow = anchorLog - anchorRatio * nextSpan
  let nextHigh = nextLow + nextSpan

  if (nextLow < fullMinLog) {
    nextLow = fullMinLog
    nextHigh = nextLow + nextSpan
  }

  if (nextHigh > fullMaxLog) {
    nextHigh = fullMaxLog
    nextLow = nextHigh - nextSpan
  }

  return {
    min: Math.exp(nextLow),
    max: Math.exp(nextHigh),
  }
}

function panFrequencyView(
  current: FrequencyView | null,
  full: FrequencyView,
  deltaRatio: number,
): FrequencyView {
  const safeCurrent = current ?? full
  const fullMinLog = Math.log(full.min)
  const fullMaxLog = Math.log(full.max)
  const lowLog = Math.log(safeCurrent.min)
  const highLog = Math.log(safeCurrent.max)
  const span = highLog - lowLog
  let nextLow = lowLog + deltaRatio * span
  let nextHigh = highLog + deltaRatio * span

  if (nextLow < fullMinLog) {
    nextLow = fullMinLog
    nextHigh = nextLow + span
  }

  if (nextHigh > fullMaxLog) {
    nextHigh = fullMaxLog
    nextLow = nextHigh - span
  }

  return {
    min: Math.exp(nextLow),
    max: Math.exp(nextHigh),
  }
}

function getLiveNote(
  analysis: AudioAnalysis | null,
  currentTime: number,
  settings: NoteSettings,
): LiveNote | null {
  if (!analysis || analysis.duration <= 0 || analysis.noteRoll.columns <= 0) {
    return null
  }

  const { noteRoll } = analysis
  const column = Math.round(
    clampNumber(currentTime / analysis.duration, 0, 1) * (noteRoll.columns - 1),
  )
  const fromColumn = Math.max(0, column - settings.smoothing)
  const toColumn = Math.min(noteRoll.columns - 1, column + settings.smoothing)
  const minMidi = clampNumber(settings.minMidi, noteRoll.midiMin, noteRoll.midiMax)
  const maxMidi = clampNumber(settings.maxMidi, noteRoll.midiMin, noteRoll.midiMax)
  const threshold = settings.threshold / 100
  const harmonicMix = settings.harmonic / 100
  let bestMidi = minMidi
  let bestScore = 0

  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const fundamental = noteWindowEnergy(noteRoll, midi, fromColumn, toColumn)
    const second = noteWindowEnergy(noteRoll, midi + 12, fromColumn, toColumn)
    const third = noteWindowEnergy(noteRoll, midi + 19, fromColumn, toColumn)
    const fourth = noteWindowEnergy(noteRoll, midi + 24, fromColumn, toColumn)
    const score = fundamental + harmonicMix * (second * 0.58 + third * 0.34 + fourth * 0.2)

    if (score > bestScore) {
      bestScore = score
      bestMidi = midi
    }
  }

  if (bestScore < Math.max(0.04, threshold * 0.55)) {
    return null
  }

  let weightedMidi = 0
  let totalWeight = 0
  const fromMidi = Math.max(minMidi, bestMidi - 2)
  const toMidi = Math.min(maxMidi, bestMidi + 2)

  for (let midi = fromMidi; midi <= toMidi; midi += 1) {
    const value = noteWindowEnergy(noteRoll, midi, fromColumn, toColumn)
    const weight = value * value
    weightedMidi += midi * weight
    totalWeight += weight
  }

  const estimate = totalWeight > 0 ? weightedMidi / totalWeight : bestMidi
  const midi = clampNumber(Math.round(estimate), minMidi, maxMidi)
  const cents = clampNumber((estimate - midi) * 100, -50, 50)

  return {
    name: midiToNoteName(midi),
    frequency: midiToFrequency(midi),
    cents,
    strength: clampNumber(bestScore, 0, 1),
  }
}

function noteWindowEnergy(
  noteRoll: AudioAnalysis['noteRoll'],
  midi: number,
  fromColumn: number,
  toColumn: number,
): number {
  if (midi < noteRoll.midiMin || midi > noteRoll.midiMax) {
    return 0
  }

  const note = midi - noteRoll.midiMin
  let sum = 0
  let count = 0

  for (let column = fromColumn; column <= toColumn; column += 1) {
    sum += noteRoll.energies[column * noteRoll.noteCount + note] / 255
    count += 1
  }

  return count > 0 ? sum / count : 0
}

function pointerToTime(
  clientX: number,
  element: HTMLDivElement,
  axis: { left: number; right: number },
  timeline: TimelineView,
): number {
  const rect = element.getBoundingClientRect()
  const contentWidth = Math.max(1, rect.width - axis.left - axis.right)
  const localX = clampNumber(clientX - rect.left - axis.left, 0, contentWidth)

  return timeline.start + (localX / contentWidth) * timelineSpan(timeline)
}

function timelineSpan(timeline: TimelineView): number {
  return Math.max(0.01, timeline.end - timeline.start)
}

function yToFrequency(y: number, height: number, view: FrequencyView): number {
  const normalized = 1 - clampNumber(y / Math.max(1, height), 0, 1)
  return view.min * (view.max / view.min) ** normalized
}

function frequencyToImageY(frequency: number, height: number, fullRange: FrequencyView): number {
  const normalized =
    Math.log(clampNumber(frequency, fullRange.min, fullRange.max) / fullRange.min) /
    Math.log(fullRange.max / fullRange.min)

  return (1 - normalized) * height
}

function makeFrequencyTicks(minFrequency: number, maxFrequency: number): number[] {
  const ticks: number[] = []
  const minPower = Math.floor(Math.log10(minFrequency))
  const maxPower = Math.ceil(Math.log10(maxFrequency))

  for (let power = minPower; power <= maxPower; power += 1) {
    const base = 10 ** power

    for (const multiplier of [1, 2, 5]) {
      const frequency = base * multiplier

      if (frequency >= minFrequency && frequency <= maxFrequency) {
        ticks.push(frequency)
      }
    }
  }

  if (ticks.length < 3) {
    const span = Math.log(maxFrequency / minFrequency)
    for (let index = 0; index <= 4; index += 1) {
      ticks.push(minFrequency * Math.exp((span * index) / 4))
    }
  }

  return Array.from(new Set(ticks.map((frequency) => Math.round(frequency))))
}

function makeTimeTicks(start: number, end: number, targetCount: number): number[] {
  const span = end - start

  if (!Number.isFinite(span) || span <= 0) {
    return [start]
  }

  const step = niceStep(span / targetCount)
  const firstTick = Math.ceil(start / step) * step
  const ticks: number[] = []

  for (let tick = firstTick; tick <= end + step * 0.5; tick += step) {
    ticks.push(clampNumber(tick, start, end))
  }

  if (!ticks.includes(start)) {
    ticks.unshift(start)
  }

  if (!ticks.includes(end)) {
    ticks.push(end)
  }

  return Array.from(new Set(ticks.map((tick) => Number(tick.toFixed(2)))))
}

function formatTimeTick(seconds: number, span: number): string {
  if (span < 12) {
    const mins = Math.floor(seconds / 60)
    const secs = seconds - mins * 60
    return `${mins}:${secs.toFixed(1).padStart(4, '0')}`
  }

  return formatDuration(seconds)
}

function niceStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value))
  const normalized = value / power

  if (normalized <= 1) {
    return power
  }

  if (normalized <= 2) {
    return 2 * power
  }

  if (normalized <= 5) {
    return 5 * power
  }

  return 10 * power
}

function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(midi % 12)
}

function channelColor(index: number): string {
  return ['#d6533f', '#168c82', '#c0921f', '#5965d8', '#b64d91', '#2c8f48'][index % 6]
}

function withAlpha(hex: string, alpha: number): string {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export default App
