# VR Video Pump

Linux native Local WebXR video server for watching side-by-side VR videos in a Quest 3 VR headset or similar browser. Put your VR videos or images to videos folder, access the hosted site in your headset browser and enjoy. You can also access files on your NAS.

## Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

## Run over HTTP for desktop smoke testing

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open:

- Control page: `http://localhost:8000/control`
- Headset page: `http://localhost:8000/headset`

## Run over HTTPS for Quest WebXR testing

WebXR immersive mode needs a secure context. A self-signed cert may be enough to load the page after accepting the browser warning, but if Quest refuses WebXR we should switch to a locally trusted CA or a real trusted LAN hostname certificate.

Quick self-signed cert:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -subj "/CN=vrvideopump.local"
```
Then run start the app with:
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8443 \
  --ssl-keyfile certs/key.pem \
  --ssl-certfile certs/cert.pem
```

Find your PC LAN IP:

```bash
ip -brief addr
```

Then open these on the same network:

- Quest: `https://YOUR_PC_IP:8443/headset`
- Optional PC control page: `https://YOUR_PC_IP:8443/control`

## Current Notes

- `/headset` owns browsing, projection selection, playback, and WebXR entry.
- `/control` is still available as a simple desktop testing panel.
- The Quest user must press `Start Video` at least once if the browser blocks remote autoplay.
- The Quest user must press `Enter VR`; browsers do not allow a remote PC page to force immersive VR mode.
- Quest hand tracking is requested as an optional WebXR feature. If hand tracking is enabled in Quest settings, a pinch should trigger the same in-headset panel actions as a controller select.
- Quest left controller shortcuts: grip opens/closes the VR menu, X goes back in the browser or opens Browse from playback, Y recenters, thumbstick left/right seeks -30/+30 seconds, thumbstick up/down scrolls Browse when the menu is open and adjusts video tilt when the menu is closed, and trigger still clicks the pointed UI item. Controller laser pointers are hidden while the menu is closed.
- The playback UI has a projection button that cycles `180`, flat `SBS`, fisheye `Fish`, and `360` SBS modes. The server uses VR metadata when available, then falls back to aspect ratio: square-per-eye SBS defaults to `180`, 16:9-per-eye SBS defaults to flat `SBS`, and 2:1-per-eye SBS defaults to `360`.
- The playback UI has `Out` / `In` buttons for centered projection zoom. In 180 modes, `Out` shrinks the image with empty edges instead of squeezing the projection, with a `0.7x` to `1.5x` range. In flat `SBS`, it changes the screen size with a wider `0.4x` to `2.0x` range. The default is `1.0x`.
- Headset render scale defaults to `1.0`. Settings are saved in the browser; changing render scale while in VR exits/reloads the headset page so the WebXR framebuffer scale can apply cleanly.
- If desktop streaming is started accidentally, pressing `Browse` in the headset stops the desktop stream and returns to normal video browsing.
- The in-headset `Browse` panel can switch between `Local` videos from `videos/` and `Remote` videos from a mounted SMB share, enter subfolders, go back, and scroll through a thumbnail grid.
- Selecting a video in the in-headset browser loads it and starts playback immediately.
- Browse thumbnails are generated on demand with `ffmpeg` from deeper inside the video and cached in `.cache/thumbnails/`.
- Videos are scanned from `videos/`.
- If projection metadata and dimensions are unavailable, videos fall back to `180_sbs_lr`.

## Pre-cache thumbnails

For large remote folders, pre-generate thumbnails once so the Quest browser does not need to wait while browsing:

```bash
.venv/bin/python scripts/precache_thumbnails.py
```

Useful options:

```bash
.venv/bin/python scripts/precache_thumbnails.py --dry-run
.venv/bin/python scripts/precache_thumbnails.py --force
```

## Remote SMB Videos

Browsers cannot play `smb://` videos directly, so VR Video Pump still serves remote videos over HTTP. For seek/playback to work, the server process needs the SMB share exposed as a normal seekable filesystem path, either through GVFS or a CIFS mount.

```bash
sudo mkdir -p /mnt/vr-videos
sudo mount -t cifs //nas.local/Share /mnt/vr-videos -o username=YOUR_USERNAME,password=YOUR_PASSWORD,uid=$(id -u),gid=$(id -g),iocharset=utf8
```

Create `config.json` from `config.example.json` and enable the remote source:

```json
{
  "remote": {
    "enabled": true,
    "smb_url": "smb://nas.local/Share/",
    "username": "your-username",
    "password": "your-password",
    "path": "/mnt/vr-videos"
  }
}
```

If `path` is omitted, the app derives the usual GVFS mount path from `smb_url`. Mount the share first with your file manager or `gio mount smb://nas.local/Share/`, then restart the app. The username/password fields are kept in this app config for the remote source, but the actual SMB authentication is currently handled by the mount layer.

## Run With Systemd

On a Linux server, use systemd to mount the NAS and run the app automatically. The included units assume the project lives at `/opt/vrvideopump/`, the NAS mount is `/mnt/vr-videos`, and user/group id is `1000`. Edit the unit files before installing them if your paths or user are different.

Create the mount point and SMB credentials file:

```bash
sudo mkdir -p /mnt/vr-videos /etc/samba
sudo nano /etc/samba/credentials-vrvideopump
sudo chmod 600 /etc/samba/credentials-vrvideopump
```

Credentials file contents:

```ini
username=YOUR_USERNAME
password=YOUR_PASSWORD
```

Install and start the units:

```bash
sudo cp deploy/systemd/mnt-smb.service /etc/systemd/system/
sudo cp deploy/systemd/vrvideopump.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mnt-smb.service
sudo systemctl enable --now vrvideopump.service
```

If the NAS is off, the mount service can fail and Remote will appear empty. Turn the NAS on, wait for it to boot, then restart the mount and app services.

Check status/logs:

```bash
systemctl status mnt-smb.service
systemctl status vrvideopump.service
journalctl -u vrvideopump.service -f
```

If the server user id is not `1000`, edit `uid=1000,gid=1000` in `deploy/systemd/mnt-smb.service` before copying it.

## Publishing Notes

Do not upload local runtime files such as `config.json`, `certs/`, `videos/`, `.cache/`, `.venv/`, `__pycache__/`, `.mas/`, `.agents/`, or `.codex/`. They are ignored by `.gitignore`, but GitHub's web uploader can still upload any file you manually select.

## License

MIT. See `LICENSE`.
