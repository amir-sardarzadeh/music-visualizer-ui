# Music Analyzer

Browser UI for loading a music file and inspecting:

- per-channel time/magnitude waveform lanes
- frequency-over-time spectrogram
- piano-roll note energy grid from A0 to C8
- tuner-style current note detection

## Requirements

- Node.js and npm

## Setup

Clone the repository and install dependencies:

```sh
git clone https://github.com/amir-sardarzadeh/music-visualizer-ui.git
cd music-visualizer-ui
npm install
```

## Development

Start the local development server:

```sh
npm run dev
```

Vite will print a local URL, usually `http://localhost:5173/`. Open that URL in a browser while the dev server is running.

## Controls

- Choose or drag-drop an audio file.
- Use Play/Restart and the time slider for playback.
- Drag inside any analyzer bar to move the red time needle.
- Use Time Zoom buttons to zoom the time axis.
- Scroll over the Frequency - Time panel to zoom the frequency axis.
- Hold `Ctrl` and drag up/down inside the Frequency - Time panel to pan the frequency window.
- Use the reset button in the Frequency - Time header to reset frequency zoom.
- Tune note detection with Sensitivity, Smooth, Low, High, and Harmonic controls.

## Checks

To verify the app locally:

```sh
npm run lint
npm run build
```
