# Music Analyzer

Browser UI for loading a music file and inspecting:

- per-channel time/magnitude waveform lanes
- frequency-over-time spectrogram
- piano-roll note energy grid from A0 to C8
- tuner-style current note detection

## Requirements

- Node.js 20 or newer
- npm, which is included with Node.js

## Run Locally

Open a terminal, then clone the repository:

```sh
git clone https://github.com/amir-sardarzadeh/music-visualizer-ui.git
cd music-visualizer-ui
```

Install the project dependencies:

```sh
npm install
```

Start the local development server:

```sh
npm run dev
```

After the server starts, Vite prints a local address like:

```text
http://localhost:5173/
```

Open that address in a browser. Keep the terminal window running while using the app. Press `Ctrl+C` in the terminal to stop the server.

On Windows PowerShell, if `npm run dev` is blocked by script execution policy, use:

```powershell
npm.cmd run dev
```

## Production Build

Create a production build:

```sh
npm run build
```

Preview the production build locally:

```sh
npm run preview
```

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
