Status: proof of concept, bugs likely

# YouTube DJ

Personal browser DJ workspace for one YouTube track.

Live proof of concept: https://youtubedj.codyh.xyz

## Run

Requires Node 22+, `yt-dlp`, and `ffmpeg`.

```bash
npm install
npm start
```

Open http://localhost:3000 and paste a YouTube URL. Audio is downloaded to `.cache/`, decoded in the browser, and processed locally with speed and pitch controls.

The public proof of concept limits tracks to 20 minutes and processes one download at a time.
