# Music Analyzer

Browser UI for loading a music file and inspecting:

- per-channel time/magnitude waveform lanes
- frequency-over-time spectrogram
- piano-roll note energy grid from A0 to C8
- tuner-style current note detection

## Start After Restart

After restarting the computer, open PowerShell and run:

```powershell
cd "C:\Users\Amirs\Downloads\Music\Parkhideh\music-visualizer-ui"
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

Then open:

```text
http://127.0.0.1:5173/
```

The URL works only while the dev server command is running.

## First-Time Setup

Dependencies are already installed in this folder. If `node_modules` is deleted or the app is moved to another computer, run:

```powershell
cd "C:\Users\Amirs\Downloads\Music\Parkhideh\music-visualizer-ui"
npm.cmd install
```

Then start the app with the command in `Start After Restart`.

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

To verify the app:

```powershell
npm.cmd run lint
npm.cmd run build
```

Use `npm.cmd`, not `npm`, if PowerShell blocks `npm.ps1`.
