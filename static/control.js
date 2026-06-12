import {
  applyDesktopBitrateSdp,
  formatNetworkBitrate,
  getDesktopBitratePlan,
  getDesktopContentHint,
} from "./desktop-webrtc.js";

const state = {
  videos: [],
  selectedVideoId: null,
  projection: "180_sbs_lr",
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
};

const videoList = document.querySelector("#videoList");
const connection = document.querySelector("#connection");
const playPause = document.querySelector("#playPause");
const projection = document.querySelector("#projection");
const seek = document.querySelector("#seek");
const volume = document.querySelector("#volume");
const muted = document.querySelector("#muted");
const time = document.querySelector("#time");
const recenter = document.querySelector("#recenter");
const desktopEncoder = document.querySelector("#desktopEncoder");
const desktopContentHint = document.querySelector("#desktopContentHint");
const desktopDegradationPreference = document.querySelector("#desktopDegradationPreference");
const desktopWidth = document.querySelector("#desktopWidth");
const desktopHeight = document.querySelector("#desktopHeight");
const desktopFps = document.querySelector("#desktopFps");
const desktopBitrate = document.querySelector("#desktopBitrate");
const desktopSettingsStatus = document.querySelector("#desktopSettingsStatus");
const desktopShare = document.querySelector("#desktopShare");
const desktopShareStatus = document.querySelector("#desktopShareStatus");

let desktopCaptureStream = null;
let desktopPublisherPeer = null;
let desktopVideoSender = null;
let desktopPublisherStatsTimer = null;
let desktopPublisherSettings = null;
let lastDesktopOutboundStats = null;

const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);

ws.addEventListener("open", () => {
  connection.textContent = "Connected";
});

ws.addEventListener("close", () => {
  connection.textContent = "Disconnected";
});

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "state") {
    Object.assign(state, message.state);
    render();
  } else if (message.type === "browser-desktop-offer") {
    handleBrowserDesktopOffer(message.offer);
  } else if (message.type === "browser-desktop-ice") {
    addBrowserDesktopIce(message.candidate);
  } else if (message.type === "browser-desktop-stop") {
    closeDesktopPublisherPeer();
    if (desktopCaptureStream) {
      desktopShareStatus.textContent = "Browser capture ready";
    }
  }
});

const send = (message) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

const loadVideos = async () => {
  const response = await fetch("/api/videos");
  const data = await response.json();
  state.videos = data.videos;
  render();
};

const loadDesktopSettings = async () => {
  const response = await fetch("/api/desktop/settings");
  const data = await response.json();
  applyDesktopSettings(data.settings);
  desktopSettingsStatus.textContent = "Desktop settings ready";
};

const applyDesktopSettings = (settings) => {
  desktopEncoder.value = settings.encoder ?? "auto";
  desktopContentHint.value = settings.content_hint ?? "auto";
  desktopDegradationPreference.value = settings.degradation_preference ?? "maintain-resolution";
  desktopWidth.value = String(settings.width ?? 1920);
  desktopHeight.value = String(settings.height ?? 1080);
  desktopFps.value = String(settings.fps ?? 60);
  desktopBitrate.value = String(settings.bitrate_mbps ?? 16);
};

const readDesktopSettings = () => ({
  encoder: desktopEncoder.value,
  content_hint: desktopContentHint.value,
  degradation_preference: desktopDegradationPreference.value,
  width: Number(desktopWidth.value),
  height: Number(desktopHeight.value),
  fps: Number(desktopFps.value),
  bitrate_mbps: Number(desktopBitrate.value),
});

const saveDesktopSettings = async () => {
  desktopSettingsStatus.textContent = "Saving desktop settings";
  try {
    const response = await fetch("/api/desktop/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readDesktopSettings()),
    });
    const data = await response.json();
    applyDesktopSettings(data.settings);
    send({ type: "desktop-settings", settings: data.settings });
    try {
      await applyActiveDesktopCaptureSettings(data.settings);
    } catch {
      desktopShareStatus.textContent = "Browser capture ready; live sender settings unsupported";
    }
    desktopSettingsStatus.textContent = "Desktop settings saved";
  } catch {
    desktopSettingsStatus.textContent = "Could not save desktop settings";
  }
};

const startBrowserCapture = async () => {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    desktopShareStatus.textContent = "Browser capture is not available";
    return;
  }

  const settings = readDesktopSettings();
  try {
    desktopCaptureStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: settings.width },
        height: { ideal: settings.height },
        frameRate: { ideal: settings.fps },
      },
      audio: false,
    });
    desktopShare.textContent = "Restart Browser Capture";
    for (const track of desktopCaptureStream.getVideoTracks()) {
      track.contentHint = getDesktopContentHint(settings);
      track.addEventListener("ended", () => {
        desktopCaptureStream = null;
        closeDesktopPublisherPeer();
        desktopShare.textContent = "Start Browser Capture";
        desktopShareStatus.textContent = "Browser capture stopped";
      });
    }
    const [videoTrack] = desktopCaptureStream.getVideoTracks();
    desktopShareStatus.textContent = videoTrack ? `Browser capture ready ${formatTrackSettings(videoTrack)}` : "Browser capture ready";
  } catch (error) {
    desktopShareStatus.textContent = `Browser capture failed: ${error.message ?? "unknown"}`;
  }
};

const handleBrowserDesktopOffer = async (offer) => {
  if (!desktopCaptureStream) {
    desktopShareStatus.textContent = "Press Start Browser Capture first";
    return;
  }

  closeDesktopPublisherPeer();
  desktopPublisherPeer = new RTCPeerConnection({ iceServers: [] });
  const settings = readDesktopSettings();
  desktopPublisherSettings = settings;
  for (const track of desktopCaptureStream.getTracks()) {
    if (track.kind === "video") {
      track.contentHint = getDesktopContentHint(settings);
    }
    const sender = desktopPublisherPeer.addTrack(track, desktopCaptureStream);
    if (track.kind === "video") {
      desktopVideoSender = sender;
      try {
        await applyBrowserCaptureSenderSettings(sender, settings);
      } catch {
        desktopShareStatus.textContent = "Browser capture ready; bitrate limit unsupported";
      }
    }
  }
  desktopPublisherPeer.onicecandidate = (event) => {
    if (event.candidate) {
      send({ type: "browser-desktop-ice", candidate: event.candidate.toJSON() });
    }
  };
  desktopPublisherPeer.onconnectionstatechange = () => {
    desktopShareStatus.textContent = `Browser capture WebRTC ${desktopPublisherPeer.connectionState}`;
  };

  await desktopPublisherPeer.setRemoteDescription(offer);
  const answer = await desktopPublisherPeer.createAnswer();
  const tunedAnswer = {
    type: answer.type,
    sdp: applyDesktopBitrateSdp(answer.sdp, settings),
  };
  await desktopPublisherPeer.setLocalDescription(tunedAnswer);
  if (desktopVideoSender) {
    try {
      await applyBrowserCaptureSenderSettings(desktopVideoSender, settings);
    } catch {
      desktopShareStatus.textContent = "Browser capture ready; sender bitrate limit unsupported";
    }
  }
  startDesktopPublisherStats();
  send({ type: "browser-desktop-answer", answer: desktopPublisherPeer.localDescription });
};

const applyBrowserCaptureSenderSettings = async (sender, settings) => {
  const parameters = sender.getParameters();
  const maxBitrate = Number(settings.bitrate_mbps) * 1_000_000;
  const maxFramerate = Number(settings.fps);
  parameters.degradationPreference = getDesktopDegradationPreference(settings);
  parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
  if (Number.isFinite(maxBitrate) && maxBitrate > 0) {
    parameters.encodings[0].maxBitrate = maxBitrate;
  }
  if (Number.isFinite(maxFramerate) && maxFramerate > 0) {
    parameters.encodings[0].maxFramerate = maxFramerate;
  }
  parameters.encodings[0].scaleResolutionDownBy = 1;
  parameters.encodings[0].priority = "high";
  parameters.encodings[0].networkPriority = "high";
  try {
    await sender.setParameters(parameters);
  } catch (error) {
    delete parameters.encodings[0].priority;
    delete parameters.encodings[0].networkPriority;
    try {
      await sender.setParameters(parameters);
    } catch {
      delete parameters.degradationPreference;
      await sender.setParameters(parameters);
    }
  }
};

const getDesktopDegradationPreference = (settings = {}) => {
  const configured = String(settings.degradation_preference ?? "maintain-resolution");
  return ["maintain-resolution", "maintain-framerate", "balanced"].includes(configured) ? configured : "maintain-resolution";
};

const applyActiveDesktopCaptureSettings = async (settings) => {
  desktopPublisherSettings = settings;
  if (desktopCaptureStream) {
    for (const track of desktopCaptureStream.getVideoTracks()) {
      track.contentHint = getDesktopContentHint(settings);
    }
  }
  if (desktopVideoSender) {
    try {
      await applyBrowserCaptureSenderSettings(desktopVideoSender, settings);
    } catch {
      desktopShareStatus.textContent = "Browser capture ready; live sender settings unsupported";
    }
  }
};

const addBrowserDesktopIce = async (candidate) => {
  if (!desktopPublisherPeer || !candidate?.candidate) return;
  await desktopPublisherPeer.addIceCandidate(candidate);
};

const closeDesktopPublisherPeer = () => {
  stopDesktopPublisherStats();
  if (desktopPublisherPeer) {
    desktopPublisherPeer.close();
    desktopPublisherPeer = null;
  }
  desktopVideoSender = null;
  desktopPublisherSettings = null;
  lastDesktopOutboundStats = null;
};

const startDesktopPublisherStats = () => {
  stopDesktopPublisherStats();
  updateDesktopPublisherStats();
  desktopPublisherStatsTimer = window.setInterval(updateDesktopPublisherStats, 1000);
};

const stopDesktopPublisherStats = () => {
  if (desktopPublisherStatsTimer) {
    window.clearInterval(desktopPublisherStatsTimer);
    desktopPublisherStatsTimer = null;
  }
};

const updateDesktopPublisherStats = async () => {
  if (!desktopPublisherPeer || !desktopVideoSender) return;

  try {
    const stats = desktopVideoSender.getStats
      ? await desktopVideoSender.getStats()
      : await desktopPublisherPeer.getStats(desktopVideoSender.track);
    let outbound = null;
    let mediaSource = null;
    stats.forEach((report) => {
      if (report.type === "outbound-rtp" && (report.kind === "video" || report.mediaType === "video")) {
        outbound = report;
      } else if (report.type === "media-source" && (report.kind === "video" || report.mediaType === "video")) {
        mediaSource = report;
      }
    });
    if (!outbound) return;

    const now = Number(outbound.timestamp || performance.now());
    const bytesSent = Number(outbound.bytesSent || 0);
    const framesEncoded = Number(outbound.framesEncoded || 0);
    const framesSent = Number(outbound.framesSent || 0);
    const totalEncodeTime = Number(outbound.totalEncodeTime || 0);
    const qpSum = Number(outbound.qpSum || 0);
    let sendBitrate = 0;
    let encodedFps = 0;
    let sentFps = Number(outbound.framesPerSecond || 0);
    let encodeMsPerFrame = 0;
    let avgQp = 0;

    if (lastDesktopOutboundStats) {
      const elapsedSeconds = Math.max((now - lastDesktopOutboundStats.timestamp) / 1000, 0);
      const byteDelta = bytesSent - lastDesktopOutboundStats.bytesSent;
      const encodedFrameDelta = framesEncoded - lastDesktopOutboundStats.framesEncoded;
      const sentFrameDelta = framesSent - lastDesktopOutboundStats.framesSent;
      const encodeTimeDelta = totalEncodeTime - lastDesktopOutboundStats.totalEncodeTime;
      const qpDelta = qpSum - lastDesktopOutboundStats.qpSum;
      if (elapsedSeconds > 0 && byteDelta >= 0) {
        sendBitrate = (byteDelta * 8) / elapsedSeconds;
      }
      if (elapsedSeconds > 0 && encodedFrameDelta >= 0) {
        encodedFps = encodedFrameDelta / elapsedSeconds;
      }
      if (!sentFps && elapsedSeconds > 0 && sentFrameDelta >= 0) {
        sentFps = sentFrameDelta / elapsedSeconds;
      }
      if (encodedFrameDelta > 0 && encodeTimeDelta >= 0) {
        encodeMsPerFrame = (encodeTimeDelta * 1000) / encodedFrameDelta;
      }
      if (encodedFrameDelta > 0 && qpDelta >= 0) {
        avgQp = qpDelta / encodedFrameDelta;
      }
    }

    lastDesktopOutboundStats = { timestamp: now, bytesSent, framesEncoded, framesSent, totalEncodeTime, qpSum };
    const parts = [`Browser capture WebRTC ${desktopPublisherPeer.connectionState}`];
    const trackSettings = desktopVideoSender.track?.getSettings?.() ?? {};
    const trackWidth = trackSettings.width || mediaSource?.width || outbound.frameWidth;
    const trackHeight = trackSettings.height || mediaSource?.height || outbound.frameHeight;
    const trackFps = Number(mediaSource?.framesPerSecond || trackSettings.frameRate || 0);
    if (trackWidth && trackHeight) {
      parts.push(`src ${trackWidth}x${trackHeight}${trackFps > 0 ? `@${Math.round(trackFps)}fps` : ""}`);
    }
    if (sendBitrate > 0) parts.push(`tx ${formatNetworkBitrate(sendBitrate)}`);

    const plan = getDesktopBitratePlan(desktopPublisherSettings ?? readDesktopSettings());
    if (plan) parts.push(`cap ${formatNetworkBitrate(plan.maxBps)}`);
    if (Number(outbound.targetBitrate) > 0) parts.push(`target ${formatNetworkBitrate(Number(outbound.targetBitrate))}`);
    if (encodedFps > 0) parts.push(`enc ${Math.round(encodedFps)}fps`);
    if (sentFps > 0) parts.push(`sent ${Math.round(sentFps)}fps`);
    if (encodeMsPerFrame > 0) parts.push(`encode ${encodeMsPerFrame.toFixed(1)}ms/f`);
    if (avgQp > 0) parts.push(`qp ${Math.round(avgQp)}`);
    parts.push(`prefer ${formatDegradationPreference(desktopPublisherSettings ?? readDesktopSettings())}`);
    if (outbound.qualityLimitationReason && outbound.qualityLimitationReason !== "none") {
      parts.push(`limited ${outbound.qualityLimitationReason}`);
    }
    if (outbound.encoderImplementation) parts.push(outbound.encoderImplementation);

    desktopShareStatus.textContent = parts.join("; ");
  } catch (error) {
    desktopShareStatus.textContent = `Browser capture stats failed: ${error.message ?? "unknown"}`;
  }
};

const formatDegradationPreference = (settings = {}) => {
  const preference = getDesktopDegradationPreference(settings);
  if (preference === "maintain-framerate") return "fps";
  if (preference === "balanced") return "balanced";
  return "resolution";
};

const formatTrackSettings = (track) => {
  const settings = track.getSettings?.() ?? {};
  const width = settings.width ? `${settings.width}` : "?";
  const height = settings.height ? `${settings.height}` : "?";
  const fps = settings.frameRate ? ` @ ${Math.round(settings.frameRate)}fps` : "";
  const hint = track.contentHint ? ` ${track.contentHint}` : "";
  return `${width}x${height}${fps}${hint}`;
};

const render = () => {
  const selected = state.videos.find((video) => video.id === state.selectedVideoId);
  state.duration = selected?.duration ?? state.duration ?? 0;

  videoList.innerHTML = "";
  for (const video of state.videos) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `video-card${video.id === state.selectedVideoId ? " active" : ""}`;
    card.innerHTML = `
      <div class="video-title">${escapeHtml(video.filename)}</div>
      <div class="video-meta">
        ${video.codec ?? "unknown"} · ${video.width ?? "?"}x${video.height ?? "?"} · ${formatDuration(video.duration)}
        <br>${formatBitrate(video.bitrate)} · ${video.projection.replaceAll("_", " ").toUpperCase()}
      </div>
    `;
    card.addEventListener("click", async () => {
      const selected = await fetchVideoMetadata(video);
      projection.value = selected.projection;
      send({ type: "load", videoId: selected.id, projection: selected.projection });
    });
    videoList.append(card);
  }

  playPause.textContent = state.playing ? "Pause" : "Play";
  projection.value = state.projection;
  seek.max = String(Math.max(state.duration, 1));
  seek.value = String(Math.min(state.currentTime, Number(seek.max)));
  volume.value = String(state.volume);
  muted.checked = state.muted;
  time.textContent = `${formatDuration(state.currentTime)} / ${formatDuration(state.duration)}`;
};

playPause.addEventListener("click", () => {
  send({ type: state.playing ? "pause" : "play" });
});

projection.addEventListener("change", () => {
  send({ type: "projection", projection: projection.value });
});

const fetchVideoMetadata = async (video) => {
  try {
    const response = await fetch(`/api/video/${encodeURIComponent(video.id)}`);
    if (!response.ok) return video;
    const data = await response.json();
    return { ...video, ...(data.video ?? {}) };
  } catch {
    return video;
  }
};

seek.addEventListener("input", () => {
  time.textContent = `${formatDuration(Number(seek.value))} / ${formatDuration(state.duration)}`;
});

seek.addEventListener("change", () => {
  send({ type: "seek", currentTime: Number(seek.value) });
});

volume.addEventListener("input", () => {
  send({ type: "volume", volume: Number(volume.value), muted: muted.checked });
});

muted.addEventListener("change", () => {
  send({ type: "volume", volume: Number(volume.value), muted: muted.checked });
});

recenter.addEventListener("click", () => {
  send({ type: "recenter" });
});

desktopShare.addEventListener("click", startBrowserCapture);

for (const input of [
  desktopEncoder,
  desktopContentHint,
  desktopDegradationPreference,
  desktopWidth,
  desktopHeight,
  desktopFps,
  desktopBitrate,
]) {
  input.addEventListener("change", saveDesktopSettings);
}

const formatDuration = (value) => {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
};

const formatBitrate = (value) => {
  if (!Number.isFinite(value)) return "unknown bitrate";
  return `${(value / 1_000_000).toFixed(1)} Mbps`;
};

const escapeHtml = (value) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);

loadVideos();
loadDesktopSettings();
