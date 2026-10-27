# Touchline Studio

A personal Windows app for recording and editing football analysis videos.

- **Record:** your camera plus the Lineup Builder window. Switch live between full-screen face cam and screen with a facecam corner; the facecam animates smoothly between the two.
- **Edit:** import your recordings or any clip from your PC, then reorder, trim and split them, and add transitions. Detach the audio, re-record your voice, add background music, and export an MP4 ready for YouTube.

Everything runs locally. FFmpeg is bundled, there are no accounts and no watermarks.

---

## Setup (once)

1. Install **Node.js LTS** from <https://nodejs.org> (default options).
2. Unzip this folder somewhere permanent, e.g. `Documents\touchline-studio`.
3. Double-click **`Start Touchline Studio.bat`**.
   The first run downloads Electron and FFmpeg, which takes a few minutes. After that it opens straight away.

**Want a normal app with a Start-menu icon?** Double-click **`Build Installer.bat`**. Then run `dist\Touchline Studio Setup 1.0.0.exe`, which gives you a desktop shortcut. You can delete the source folder afterwards.

Files are saved under `Documents\Touchline Studio\`:

| Folder | What's in it |
|---|---|
| `Recordings` | Everything you record (MP4) |
| `Audio` | Voiceovers and detached audio (WAV) |
| `Imported` | Converted copies of clips the preview couldn't play directly (e.g. MKV, AVI, HEVC) |
| `Exports` | Finished videos |
| `Projects` | Saved `.tsproj` project files |

Your current project also autosaves, so closing the app never loses work.

---

## Recording a video

1. **Sources → Choose…** and pick the browser window with Lineup Builder. A window is better than a whole screen, because notifications and other apps stay out of the shot.
2. Pick your camera and mic. Tick **Record computer sound too** if you'll play clips during the recording.
3. Set the facecam corner, size, shape (rounded or circle) and border colour.
4. Press **Start recording**. A small floating bar appears at the top of your screen. It isn't captured in the recording.
5. Switch over to Lineup Builder and talk. Change the layout at any time, without coming back to the app:

| Shortcut (works from any app) | Action |
|---|---|
| `Ctrl` + `Alt` + `1` | Face cam full screen |
| `Ctrl` + `Alt` + `2` | Lineup Builder + facecam in the corner |
| `Ctrl` + `Alt` + `3` | Lineup Builder only |
| `Ctrl` + `Alt` + `P` | Pause / resume |
| `Ctrl` + `Alt` + `R` | Start / stop |

When you stop, the recording is saved as MP4 and dropped onto the timeline.

### Recording quality

Set it in **Recording quality** on the right of the Record tab. An estimate of the file size per minute is shown under the controls.

| Setting | Options | Notes |
|---|---|---|
| Resolution | 1080p · 1440p | 1440p keeps small Lineup Builder text crisp, and YouTube streams 1440p with better compression. |
| Frame rate | 30 · 60 fps | 60 fps is smoother but needs more CPU. |
| Bitrate | Standard · High · Max | At 1080p30 these are 10, 16 and 25 Mbps. They scale up for 1440p and 60 fps, to a maximum of 80 Mbps. |

The default is 1080p · 30 fps · High.

After each recording the app checks the frame rate your PC actually achieved. If it fell short of the setting, the app tells you which setting to lower. After a 1440p or 60 fps recording, the project's export settings switch to match.

> Keep Touchline Studio open in the background while recording, behind the browser or on a second monitor. Don't minimise it.

---

## Editing

- **Import:** use the Import button, or drag files from Explorer anywhere onto the window. MP4, MOV, WEBM, MKV, AVI, MP3, WAV and more are supported.
- **Arrange:** drag clips from Media onto the timeline at any position, or double-click to add at the end. Drag clips left and right to reorder.
- **Trim:** drag the left or right edge of a clip. You can also type exact start and end times, or use `I` / `O` to set them at the playhead.
- **Split:** put the playhead where you want to cut and press `S`.
- **Transitions:** hover between two clips and click **+**, then pick one in the right panel. The options are Cut, Fade, Blur, Swipe left and right, Wipe, Dip to black or white, Zoom, Circle, Pixelate and Dissolve. Set the duration with the slider. To set every cut at once, deselect all clips and use **Apply to all cuts** in the Project panel.
- **Detach audio:** select a clip and click **Detach audio**. Its sound moves to its own purple track. From there you can:
  - nudge its sync frame by frame,
  - change its volume,
  - swap in a different audio file,
  - or mute it.
- **Re-record voice:** select a clip and click **Re-record voice**. The clip plays and your mic records for exactly its length. The new take replaces the clip's audio, shown as an orange track. Record again as many times as you like.
- **Background music:** click ♫ on an audio file in Media. It loops under the whole video and fades out at the end. Set its volume in the Project panel; 15–25% works well under speech.
- **Export:** choose 720p, 1080p, 1440p or 4K at 30 or 60 fps. The output is an H.264/AAC MP4 with 192 kbps audio, ready to upload to YouTube. Quality options:
  - **Fast** (CRF 22): smaller files
  - **Balanced** (CRF 19): the default
  - **High** (CRF 17, slower preset): best quality, takes longer to export
- Exporting above your recording's resolution or frame rate doesn't add detail or smoothness. The exception is a 1440p upload, which can still look better on YouTube.

### Editor shortcuts

`Space` play/pause · `S` split · `I`/`O` set start/end · `←`/`→` one frame (`Shift` = 1 s) · `Home`/`End` ·
`Delete` remove clip · `Ctrl+D` duplicate · `Ctrl+Z` / `Ctrl+Y` undo/redo · `Ctrl+S` save · `Ctrl+E` export · `Ctrl+scroll` zoom timeline

---

## Under the hood

- Electron app. FFmpeg and FFprobe are bundled via `ffmpeg-static` / `ffprobe-static`.
- `main.js`: file handling, screen capture, global hotkeys, and the FFmpeg jobs (save recording, convert imports, detach audio, export).
- `shared/exportGraph.js`: turns the timeline into one FFmpeg filter graph. Every clip is normalised to the same size, frame rate and audio format, then joined with `concat` (cuts) or `xfade`/`acrossfade` (transitions). Run `npm run test:export` to check it against generated clips.
- `src/js/recorder.js`: composites camera and screen onto a 1920×1080 canvas at 30 fps. It records with MediaRecorder and streams the chunks to disk, so long recordings don't use up memory.
- `src/js/player.js`: the timeline preview, including live previews of the transitions.
- Press `F12` in the app to open DevTools if something misbehaves.
