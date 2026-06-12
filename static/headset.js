import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { applyDesktopBitrateSdp, formatNetworkBitrate } from "./desktop-webrtc.js";

const viewer = document.querySelector("#viewer");
const status = document.querySelector("#status");
const diagnostics = document.querySelector("#diagnostics");
const startButton = document.querySelector("#start");
const startDesktopButton = document.querySelector("#startDesktop");
const enterVrButton = document.querySelector("#enterVr");

const state = {
  videos: [],
  selectedVideoId: null,
  projection: "180_sbs_lr",
  playing: false,
  currentTime: 0,
  volume: 1,
  muted: false,
};

const PROJECTION_MODES = [
  { value: "180_sbs_lr", label: "180" },
  { value: "flat_sbs_lr", label: "SBS" },
  { value: "180_fisheye_sbs_lr", label: "Fish" },
  { value: "360_sbs_lr", label: "360" },
];
const DESKTOP_PROJECTION_MODES = [
  { value: "flat", label: "Flat" },
  ...PROJECTION_MODES.filter((mode) => mode.value !== "flat_sbs_lr"),
];
const FLAT_SBS_VIEW = {
  distance: 3,
  width: 4,
};
const DEFAULT_PROJECTION_ZOOM_BOUNDS = { min: 0.7, max: 1.5 };
const FLAT_SBS_PROJECTION_ZOOM_BOUNDS = { min: 0.4, max: 2.0 };
const VR180_VIDEO_FRAME_RATE = 45;

const SETTING_PLACEHOLDER_ROWS = [
  {
    id: "renderScale",
    label: "Render scale",
    y: 0.36,
    startX: -0.54,
    gap: 0.24,
    width: 0.2,
    options: [
      { id: "render_scale_050", label: "0.5", value: 0.5 },
      { id: "render_scale_070", label: "0.7", value: 0.7 },
      { id: "render_scale_085", label: "0.85", value: 0.85 },
      { id: "render_scale_100", label: "1.0", value: 1 },
      { id: "render_scale_110", label: "1.1", value: 1.1 },
      { id: "render_scale_120", label: "1.2", value: 1.2 },
      { id: "render_scale_150", label: "1.5", value: 1.5 },
    ],
  },
  {
    id: "foveation",
    label: "Foveation",
    y: 0.2,
    options: [
      { id: "foveation_default", label: "Browser default", value: "default", isDefault: true },
      { id: "foveation_low", label: "Low", value: 0.25 },
      { id: "foveation_off", label: "Off", value: 0 },
      { id: "foveation_high", label: "High", value: 1 },
    ],
  },
  {
    id: "textureSample",
    label: "Texture sample",
    y: 0.02,
    options: [
      { id: "texture_linear_default", label: "Linear default", value: "linear", isDefault: true },
      { id: "texture_nearest", label: "Nearest", value: "nearest" },
      { id: "texture_aniso_4", label: "Aniso 4x", value: "aniso4" },
      { id: "texture_aniso_max", label: "Aniso max", value: "anisoMax" },
    ],
  },
  {
    id: "colorPreset",
    label: "Color",
    y: -0.16,
    options: [
      { id: "color_default", label: "Default", value: "default", isDefault: true },
      { id: "color_brightness", label: "Bright +", value: "brightness" },
      { id: "color_contrast", label: "Contrast +", value: "contrast" },
      { id: "color_saturation", label: "Saturation +", value: "saturation" },
    ],
  },
  {
    id: "videoFrameRate",
    label: "Video fps",
    y: -0.34,
    startX: -0.5,
    gap: 0.24,
    width: 0.22,
    options: [
      { id: "video_fps_native", label: "Native", value: "native", isDefault: true },
      { id: "video_fps_30", label: "30", value: 30 },
      { id: "video_fps_36", label: "36", value: 36 },
      { id: "video_fps_40", label: "40", value: 40 },
      { id: "video_fps_45", label: "45", value: 45 },
      { id: "video_fps_50", label: "50", value: 50 },
      { id: "video_fps_55", label: "55", value: 55 },
    ],
  },
  {
    id: "xrLayer",
    label: "Layer",
    y: -0.52,
    options: [
      { id: "xr_layer_mesh_default", label: "Mesh", value: "mesh", isDefault: true },
      { id: "xr_layer_media", label: "Media", value: "media" },
    ],
  },
];

const DEFAULT_SETTINGS = {
  renderScale: 1,
  foveation: 0,
  textureSample: "anisoMax",
  colorPreset: "default",
  videoFrameRate: "native",
  xrLayer: "mesh",
};
const HEADSET_SETTINGS_STORAGE_KEY = "vrvideopump.headsetSettings";

const DEFAULT_DESKTOP_VIEW = {
  distance: 3,
  pitchDeg: -6,
  yOffset: 0,
  width: 4,
};
const BROWSE_GRIP_HOLD_MS = 700;

const settings = loadHeadsetSettings();
let desktopView = loadDesktopViewSettings();

let video = document.createElement("video");
let texture = null;
let leftMesh = null;
let rightMesh = null;
let desktopMesh = null;
let currentVideoId = null;
let sphereCenterAngle = 0;
let hoveredControl = null;
let headsetPickerIndex = 0;
let panelOpacity = 1;
let lastPanelFocusAt = performance.now();
let ipdOffset = 0;
let videoTiltOffset = 0;
let videoHeightOffset = 0;
let projectionZoom = 1;
let flatSbsZoom = 1;
let menuOpen = true;
let browseOpen = false;
let settingsOpen = false;
let browseSource = "local";
let browsePath = "";
let browseParentPath = null;
let browseOffset = 0;
let browseItems = [];
let browseLoading = false;
let browseRequestId = 0;
let desktopActive = false;
let desktopProjection = "flat";
let desktopPeer = null;
let desktopStream = null;
let desktopSignalingStatus = "idle";
let desktopTrackStatus = "none";
let desktopVideoStatus = "idle";
let desktopStatsStatus = "none";
let lastDesktopStatsAt = 0;
let lastDesktopInboundStats = null;
let desktopReceiveBitrateBps = 0;
let desktopDecodedFps = 0;
let desktopRttMs = 0;
let lastDiagnosticsRenderAt = 0;
let mediaLayer = null;
let mediaLayerStatus = "mesh";

const interactiveControls = [];
const controllerPointers = [];
const controllerStates = [];
const browseTiles = [];
const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();
const xrInputSummary = ["none", "none"];
const thumbnailLoader = new THREE.TextureLoader();

class CappedVideoTexture extends THREE.VideoTexture {
  constructor(videoElement, maxFps) {
    super(videoElement);
    this.maxFps = maxFps;
    this.lastFrameUpdateAt = 0;

    if ("requestVideoFrameCallback" in videoElement) {
      if (this._requestVideoFrameCallbackId !== 0) {
        videoElement.cancelVideoFrameCallback(this._requestVideoFrameCallbackId);
      }

      const updateVideo = (now) => {
        if (this.maxFps <= 0 || now - this.lastFrameUpdateAt >= 1000 / this.maxFps) {
          this.needsUpdate = true;
          this.lastFrameUpdateAt = now;
        }
        this._requestVideoFrameCallbackId = videoElement.requestVideoFrameCallback(updateVideo);
      };
      this._requestVideoFrameCallbackId = videoElement.requestVideoFrameCallback(updateVideo);
    }
  }

  update() {
    if ("requestVideoFrameCallback" in this.image) return;
    if (this.image.readyState < this.image.HAVE_CURRENT_DATA) return;

    const now = performance.now();
    if (this.maxFps <= 0 || now - this.lastFrameUpdateAt >= 1000 / this.maxFps) {
      this.needsUpdate = true;
      this.lastFrameUpdateAt = now;
    }
  }
}

const scene = new THREE.Scene();
const videoGroup = new THREE.Group();
videoGroup.rotation.order = "YXZ";
scene.add(videoGroup);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.layers.enable(1);
camera.layers.disable(2);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setFramebufferScaleFactor(settings.renderScale);
renderer.xr.setFoveation?.(0);
viewer.append(renderer.domElement);

const vrPanel = createVrPanel();
camera.add(vrPanel);
const browsePanel = createBrowsePanel();
camera.add(browsePanel);
const settingsPanel = createSettingsPanel();
camera.add(settingsPanel);
setupControllers();

const vrButton = VRButton.createButton(renderer, {
  optionalFeatures: ["hand-tracking", "layers"],
});
vrButton.style.display = "none";
document.body.append(vrButton);
renderer.xr.addEventListener("sessionstart", () => {
  applyFoveationSetting();
  if (shouldUseMediaLayer()) rebuildSphere();
  queueRecenterVideo();
});
renderer.xr.addEventListener("sessionend", () => {
  mediaLayer = null;
  mediaLayerStatus = settings.xrLayer === "media" ? "media waits for VR" : "mesh";
});

enterVrButton.addEventListener("click", () => {
  vrButton.click();
});

const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);

ws.addEventListener("open", () => setStatus("Connected. Select a video in Browse."));
ws.addEventListener("close", () => setStatus("Disconnected from server."));
ws.addEventListener("message", async (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "state") {
    Object.assign(state, message.state);
    await applyState();
  } else if (message.type === "load") {
    if (desktopActive) {
      exitDesktopMode("Loading video.");
    }
    state.selectedVideoId = message.videoId;
    state.projection = message.projection ?? state.projection;
    state.playing = false;
    state.currentTime = 0;
    await applyState();
  } else if (message.type === "play") {
    state.playing = true;
    await playVideo();
  } else if (message.type === "pause") {
    state.playing = false;
    video.pause();
  } else if (message.type === "seek") {
    video.currentTime = Number(message.currentTime ?? 0);
  } else if (message.type === "volume") {
    state.volume = Number(message.volume ?? 1);
    state.muted = Boolean(message.muted);
    applyVolume();
  } else if (message.type === "projection") {
    state.projection = message.projection ?? state.projection;
    if (!desktopActive) {
      applyVideoFrameRateForProjection(state.projection);
      rebuildVideoTexture();
    }
  } else if (message.type === "recenter") {
    queueRecenterVideo();
  } else if (message.type === "browser-desktop-answer") {
    desktopSignalingStatus = "browser answer received";
    await applyDesktopAnswer(message.answer);
  } else if (message.type === "browser-desktop-ice") {
    await applyDesktopIce(message.candidate);
  }
});

const loadVideos = async () => {
  const response = await fetch("/api/videos");
  const data = await response.json();
  state.videos = data.videos;
  headsetPickerIndex = getSelectedVideoIndex();
  await loadBrowseDirectory("local", "");
  await applyState();
};

const applyState = async () => {
  if (desktopActive) {
    return;
  }

  const selected = state.videos.find((item) => item.id === state.selectedVideoId);
  if (!selected) {
    setStatus("Waiting for video selection in Browse.");
    return;
  }

  if (currentVideoId !== selected.id) {
    headsetPickerIndex = getSelectedVideoIndex();
    applyVideoFrameRateForProjection(state.projection);
    loadVideoElement(selected);
    rebuildSphere();
    currentVideoId = selected.id;
    setStatus(`Loaded ${selected.filename}`);
  }

  applyVolume();
  if (Math.abs(video.currentTime - state.currentTime) > 1.5) {
    video.currentTime = state.currentTime;
  }
  if (state.playing) {
    await playVideo();
  }
};

const loadVideoElement = (selected) => {
  stopDesktopStream();
  projectionZoom = 1;
  flatSbsZoom = 1;
  video.pause();
  video.remove();
  video = document.createElement("video");
  video.src = selected.url;
  video.loop = false;
  video.playsInline = true;
  video.controls = true;
  video.className = "debug-video";
  video.preload = "metadata";
  video.addEventListener("loadedmetadata", () => {
    const inferredProjection = inferProjectionFromVideoElement();
    if (!isFisheyeProjection(state.projection) && inferredProjection !== state.projection) {
      state.projection = inferredProjection;
      applyVideoFrameRateForProjection(state.projection);
      sendWsMessage({ type: "projection", projection: state.projection });
      rebuildVideoTexture();
      recenterVideo();
    } else if (isFlatSbsProjection(state.projection)) {
      applyVideoFrameRateForProjection(state.projection);
      rebuildVideoTexture();
      recenterVideo();
    }
    applyPresentationAdjustments();
    sendHeadsetState();
  });
  video.addEventListener("canplay", sendHeadsetState);
  video.addEventListener("playing", sendHeadsetState);
  video.addEventListener("play", sendHeadsetState);
  video.addEventListener("pause", sendHeadsetState);
  video.addEventListener("error", () => {
    setStatus(`Video error: ${video.error?.message ?? video.error?.code ?? "unknown"}`);
    sendHeadsetState();
  });
  video.addEventListener("timeupdate", throttle(sendHeadsetState, 750));
  document.body.append(video);

  texture?.dispose();
  texture = createVideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  applyTextureSettings();
};

const loadDesktopVideoElement = () => {
  video.pause();
  video.remove();
  video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.controls = true;
  video.className = "debug-video";
  video.muted = true;
  video.addEventListener("loadedmetadata", () => {
    desktopVideoStatus = `metadata ${video.videoWidth || 0}x${video.videoHeight || 0}`;
    rebuildDesktopPresentation();
    sendHeadsetState();
  });
  video.addEventListener("resize", () => {
    desktopVideoStatus = `resize ${video.videoWidth || 0}x${video.videoHeight || 0}`;
    rebuildDesktopPresentation();
  });
  video.addEventListener("canplay", () => {
    desktopVideoStatus = "canplay";
    sendHeadsetState();
  });
  video.addEventListener("playing", () => {
    desktopVideoStatus = "playing";
    sendHeadsetState();
  });
  video.addEventListener("waiting", () => {
    desktopVideoStatus = "waiting";
  });
  video.addEventListener("error", () => {
    desktopVideoStatus = `error ${video.error?.code ?? "unknown"}`;
    setStatus(`Desktop video error: ${video.error?.message ?? video.error?.code ?? "unknown"}`);
    sendHeadsetState();
  });
  document.body.append(video);

  texture?.dispose();
  texture = createVideoTexture(video, { forceNativeFrameRate: true });
  texture.colorSpace = THREE.SRGBColorSpace;
  applyTextureSettings();
};

const clearVideoMeshes = () => {
  if (leftMesh) {
    videoGroup.remove(leftMesh);
    leftMesh.geometry.dispose();
    leftMesh.material.dispose();
    leftMesh = null;
  }
  if (rightMesh) {
    videoGroup.remove(rightMesh);
    rightMesh.geometry.dispose();
    rightMesh.material.dispose();
    rightMesh = null;
  }
  if (desktopMesh) {
    videoGroup.remove(desktopMesh);
    desktopMesh.geometry.dispose();
    desktopMesh.material.dispose();
    desktopMesh = null;
  }
};

const rebuildSphere = () => {
  if (!texture) return;

  if (!PROJECTION_MODES.some((mode) => mode.value === state.projection)) {
    state.projection = "180_sbs_lr";
  }
  projectionZoom = clampProjectionZoom(projectionZoom, DEFAULT_PROJECTION_ZOOM_BOUNDS);
  flatSbsZoom = clampProjectionZoom(flatSbsZoom, FLAT_SBS_PROJECTION_ZOOM_BOUNDS);

  desktopActive = false;
  clearVideoMeshes();
  if (settings.xrLayer === "media" && !canUseMediaLayerProjection()) {
    mediaLayerStatus = "mesh projection";
  }
  if (tryActivateMediaLayer()) return;
  deactivateMediaLayer();

  if (isFlatSbsProjection(state.projection)) {
    rebuildFlatSbsScreen();
    return;
  }

  const is180 = state.projection.startsWith("180");
  const isFisheye = state.projection === "180_fisheye_sbs_lr";
  sphereCenterAngle = is180 ? Math.PI : 0;
  const geometry = is180
    ? new THREE.SphereGeometry(500, 96, 48, Math.PI / 2, Math.PI)
    : new THREE.SphereGeometry(500, 96, 48);
  geometry.scale(-1, 1, 1);
  geometry.rotateY(-Math.PI / 2);

  leftMesh = new THREE.Mesh(geometry, isFisheye ? makeFisheyeVideoMaterial(0, is180) : makeVideoMaterial(0, 0.5, is180));
  leftMesh.material.uniforms.eyeSign.value = -1;
  leftMesh.layers.set(1);
  videoGroup.add(leftMesh);

  rightMesh = new THREE.Mesh(geometry.clone(), isFisheye ? makeFisheyeVideoMaterial(0.5, is180) : makeVideoMaterial(0.5, 0.5, is180));
  rightMesh.material.uniforms.eyeSign.value = 1;
  rightMesh.layers.set(2);
  videoGroup.add(rightMesh);
};

function canUseMediaLayerProjection() {
  return state.projection === "180_sbs_lr" || state.projection === "360_sbs_lr";
}

function shouldUseMediaLayer() {
  return settings.xrLayer === "media" && !desktopActive && canUseMediaLayerProjection();
}

function tryActivateMediaLayer() {
  if (!shouldUseMediaLayer()) return false;
  if (mediaLayer) deactivateMediaLayer();

  const session = renderer.xr.getSession();
  const baseLayer = renderer.xr.getBaseLayer?.();
  const referenceSpace = renderer.xr.getReferenceSpace?.();
  if (!session || !baseLayer || !referenceSpace) {
    mediaLayerStatus = "media waits for VR";
    return false;
  }

  if (typeof XRMediaBinding === "undefined" || !session.renderState?.layers) {
    mediaLayerStatus = "media unsupported";
    return false;
  }

  try {
    const binding = new XRMediaBinding(session);
    mediaLayer = binding.createEquirectLayer(video, {
      space: referenceSpace,
      layout: "stereo-left-right",
      radius: 0,
      ...getMediaLayerEquirectAngles(),
    });
    mediaLayer.quality = "graphics-optimized";
    session.updateRenderState({ layers: [mediaLayer, baseLayer] });
    updateMediaLayerTransform();
    applyPresentationAdjustments();
    mediaLayerStatus = `media ${state.projection === "180_sbs_lr" ? "180 behind ui" : "360 behind ui"}`;
    return true;
  } catch (error) {
    mediaLayer = null;
    mediaLayerStatus = `media error ${error.message ?? "unknown"}`;
    return false;
  }
}

function deactivateMediaLayer() {
  if (!mediaLayer) {
    if (settings.xrLayer !== "media") mediaLayerStatus = "mesh";
    return;
  }

  const session = renderer.xr.getSession();
  const baseLayer = renderer.xr.getBaseLayer?.();
  try {
    if (session && baseLayer && session.renderState?.layers) {
      session.updateRenderState({ layers: [baseLayer] });
    }
  } catch {
    // Best-effort cleanup. The session may already be ending.
  }
  mediaLayer = null;
  mediaLayerStatus = "mesh";
}

function updateMediaLayerTransform() {
  if (!mediaLayer || typeof XRRigidTransform === "undefined") return;

  videoGroup.updateMatrixWorld(true);
  const quaternion = videoGroup.getWorldQuaternion(new THREE.Quaternion());
  mediaLayer.transform = new XRRigidTransform(
    { x: videoGroup.position.x, y: videoGroup.position.y, z: videoGroup.position.z },
    { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
  );
}

function getMediaLayerEquirectAngles() {
  const fullHorizontalAngle = state.projection === "180_sbs_lr" ? Math.PI : Math.PI * 2;
  const horizontalAngle = fullHorizontalAngle * projectionZoom;
  const verticalAngle = Math.PI * projectionZoom;
  return {
    centralHorizontalAngle: THREE.MathUtils.clamp(horizontalAngle, 0.1, fullHorizontalAngle),
    upperVerticalAngle: THREE.MathUtils.clamp(verticalAngle / 2 - videoHeightOffset, 0.05, Math.PI / 2),
    lowerVerticalAngle: THREE.MathUtils.clamp(-verticalAngle / 2 - videoHeightOffset, -Math.PI / 2, -0.05),
  };
}

function updateMediaLayerZoom() {
  if (!mediaLayer) return;
  const angles = getMediaLayerEquirectAngles();
  mediaLayer.centralHorizontalAngle = angles.centralHorizontalAngle;
  mediaLayer.upperVerticalAngle = angles.upperVerticalAngle;
  mediaLayer.lowerVerticalAngle = angles.lowerVerticalAngle;
}

function applyPresentationAdjustments() {
  applyVideoHeightOffset();
  updateMediaLayerZoom();
  updateMediaLayerTransform();
}

const rebuildFlatSbsScreen = () => {
  sphereCenterAngle = Math.PI;
  const width = FLAT_SBS_VIEW.width * flatSbsZoom;
  const height = width / getSbsEyeAspect();
  const geometry = new THREE.PlaneGeometry(width, height);

  const leftMaterial = makeVideoMaterial(0, 0.5, false);
  leftMaterial.side = THREE.DoubleSide;
  leftMesh = new THREE.Mesh(geometry, leftMaterial);
  leftMesh.material.uniforms.eyeSign.value = -1;
  leftMesh.position.set(0, 0, -FLAT_SBS_VIEW.distance);
  leftMesh.layers.set(1);
  videoGroup.add(leftMesh);

  const rightMaterial = makeVideoMaterial(0.5, 0.5, false);
  rightMaterial.side = THREE.DoubleSide;
  rightMesh = new THREE.Mesh(geometry.clone(), rightMaterial);
  rightMesh.material.uniforms.eyeSign.value = 1;
  rightMesh.position.copy(leftMesh.position);
  rightMesh.layers.set(2);
  videoGroup.add(rightMesh);
};

const rebuildDesktopScreen = () => {
  if (!texture) return;

  settings.foveation = 0;
  settings.textureSample = "anisoMax";
  applyFoveationSetting();
  applyDesktopTextureSettings();
  clearVideoMeshes();
  sphereCenterAngle = Math.PI;
  const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
  const width = DEFAULT_DESKTOP_VIEW.width;
  const height = width / aspect;
  desktopMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, color: 0xffffff, side: THREE.DoubleSide }),
  );
  desktopMesh.layers.set(0);
  videoGroup.add(desktopMesh);
  applyDesktopViewTransform();
  recenterVideo();
};

const rebuildDesktopProjection = () => {
  if (!texture) return;

  settings.foveation = 0;
  applyFoveationSetting();
  applyTextureSettings();
  clearVideoMeshes();

  const is180 = desktopProjection.startsWith("180");
  const isFisheye = desktopProjection === "180_fisheye_sbs_lr";
  sphereCenterAngle = is180 ? Math.PI : 0;
  const geometry = is180
    ? new THREE.SphereGeometry(500, 96, 48, Math.PI / 2, Math.PI)
    : new THREE.SphereGeometry(500, 96, 48);
  geometry.scale(-1, 1, 1);
  geometry.rotateY(-Math.PI / 2);

  leftMesh = new THREE.Mesh(geometry, isFisheye ? makeFisheyeVideoMaterial(0, is180) : makeVideoMaterial(0, 0.5, is180));
  leftMesh.material.uniforms.eyeSign.value = -1;
  leftMesh.layers.set(1);
  videoGroup.add(leftMesh);

  rightMesh = new THREE.Mesh(geometry.clone(), isFisheye ? makeFisheyeVideoMaterial(0.5, is180) : makeVideoMaterial(0.5, 0.5, is180));
  rightMesh.material.uniforms.eyeSign.value = 1;
  rightMesh.layers.set(2);
  videoGroup.add(rightMesh);
  recenterVideo();
};

const rebuildDesktopPresentation = () => {
  if (desktopProjection === "flat") {
    rebuildDesktopScreen();
  } else {
    rebuildDesktopProjection();
  }
};

function getSphericalHeightUvOffset() {
  return videoHeightOffset / Math.PI;
}

const makeVideoMaterial = (offsetX, repeatX, zoomable) =>
  new THREE.ShaderMaterial({
    uniforms: {
      videoMap: { value: texture },
      offsetX: { value: offsetX },
      repeatX: { value: repeatX },
      projectionZoom: { value: zoomable ? projectionZoom : 1 },
      heightUvOffset: { value: zoomable ? getSphericalHeightUvOffset() : 0 },
      brightness: { value: getColorSettings().brightness },
      contrast: { value: getColorSettings().contrast },
      saturation: { value: getColorSettings().saturation },
      eyeSign: { value: 0 },
      ipdOffset: { value: ipdOffset },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D videoMap;
      uniform float offsetX;
      uniform float repeatX;
      uniform float projectionZoom;
      uniform float heightUvOffset;
      uniform float brightness;
      uniform float contrast;
      uniform float saturation;
      uniform float eyeSign;
      uniform float ipdOffset;
      varying vec2 vUv;

      vec3 adjustColor(vec3 color) {
        color *= brightness;
        color = (color - 0.5) * contrast + 0.5;
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luma), color, saturation);
        return clamp(color, 0.0, 1.0);
      }

      void main() {
        vec2 localUv = (vUv - 0.5) / projectionZoom + 0.5;

        if (projectionZoom < 0.999 && (localUv.x < 0.0 || localUv.x > 1.0 || localUv.y < 0.0 || localUv.y > 1.0)) {
          discard;
        }

        localUv = clamp(localUv, 0.0, 1.0);
        localUv.y = clamp(localUv.y + heightUvOffset, 0.0, 1.0);
        vec2 sampleUv = vec2(offsetX + (localUv.x * repeatX) + (eyeSign * ipdOffset), localUv.y);
        vec4 videoColor = texture2D(videoMap, sampleUv);
        gl_FragColor = vec4(adjustColor(videoColor.rgb), videoColor.a);
      }
    `,
  });

const makeFisheyeVideoMaterial = (offsetX, zoomable) =>
  new THREE.ShaderMaterial({
    uniforms: {
      videoMap: { value: texture },
      offsetX: { value: offsetX },
      projectionZoom: { value: zoomable ? projectionZoom : 1 },
      heightUvOffset: { value: zoomable ? getSphericalHeightUvOffset() : 0 },
      brightness: { value: getColorSettings().brightness },
      contrast: { value: getColorSettings().contrast },
      saturation: { value: getColorSettings().saturation },
      eyeSign: { value: 0 },
      ipdOffset: { value: ipdOffset },
    },
    vertexShader: `
      varying vec3 vDirection;

      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D videoMap;
      uniform float offsetX;
      uniform float projectionZoom;
      uniform float heightUvOffset;
      uniform float brightness;
      uniform float contrast;
      uniform float saturation;
      uniform float eyeSign;
      uniform float ipdOffset;
      varying vec3 vDirection;

      const float PI = 3.141592653589793;

      vec3 adjustColor(vec3 color) {
        color *= brightness;
        color = (color - 0.5) * contrast + 0.5;
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luma), color, saturation);
        return clamp(color, 0.0, 1.0);
      }

      void main() {
        vec3 direction = normalize(vDirection);
        float angleFromForward = acos(clamp(-direction.z, -1.0, 1.0));

        if (angleFromForward > PI * 0.5) {
          discard;
        }

        float radius = angleFromForward / (PI * 0.5);
        float azimuth = atan(direction.y, direction.x);
        vec2 circleUv = vec2(cos(azimuth), sin(azimuth)) * radius * 0.5 + 0.5;
        circleUv = (circleUv - 0.5) / projectionZoom + 0.5;
        circleUv.y += heightUvOffset;

        if (circleUv.x < 0.0 || circleUv.x > 1.0 || circleUv.y < 0.0 || circleUv.y > 1.0) {
          discard;
        }

        vec2 sampleUv = vec2(offsetX + circleUv.x * 0.5 + eyeSign * ipdOffset, circleUv.y);
        vec4 videoColor = texture2D(videoMap, sampleUv);
        gl_FragColor = vec4(adjustColor(videoColor.rgb), videoColor.a);
      }
    `,
  });

function isFlatSbsProjection(projection) {
  return projection === "flat_sbs_lr";
}

function isFisheyeProjection(projection) {
  return projection === "180_fisheye_sbs_lr";
}

function clampProjectionZoom(value, bounds) {
  return THREE.MathUtils.clamp(Math.round(value * 10) / 10, bounds.min, bounds.max);
}

function getSbsEyeAspect() {
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    return video.videoWidth / 2 / video.videoHeight;
  }
  return 16 / 9;
}

function inferProjectionFromDimensions(width, height) {
  if (!width || !height) return "180_sbs_lr";

  const eyeAspect = width / 2 / height;
  if (Math.abs(eyeAspect - 2) <= 0.2) return "360_sbs_lr";
  if (Math.abs(eyeAspect - 16 / 9) <= 0.25) return "flat_sbs_lr";
  if (Math.abs(eyeAspect - 1) <= 0.18) return "180_sbs_lr";
  return "180_sbs_lr";
}

function inferProjectionFromVideoElement() {
  return inferProjectionFromDimensions(video.videoWidth, video.videoHeight);
}

const applyVolume = () => {
  video.volume = Math.max(0, Math.min(1, state.volume));
  video.muted = state.muted;
};

const playVideo = async () => {
  try {
    await video.play();
    setStatus(desktopActive ? "Desktop stream playing." : "Playing.");
  } catch {
    setStatus("Press Start Video in the headset once, then PC controls can drive playback.");
  }
};

startButton.addEventListener("click", async () => {
  await playVideo();
});

startDesktopButton.addEventListener("click", () => {
  startDesktopStream().catch((error) => setStatus(`Desktop stream error: ${error.message ?? "unknown"}`));
});

const pauseVideo = () => {
  state.playing = false;
  video.pause();
  sendWsMessage({ type: "pause" });
  sendHeadsetState();
};

const togglePlayback = async () => {
  if (video.paused) {
    state.playing = true;
    sendWsMessage({ type: "play" });
    await playVideo();
  } else {
    pauseVideo();
  }
};

const seekBy = (delta) => {
  seekTo((video.currentTime || 0) + delta);
};

const seekTo = (time) => {
  if (desktopActive) return;
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  video.currentTime = Math.max(0, Math.min(video.duration, time));
  state.currentTime = video.currentTime;
  sendWsMessage({ type: "seek", currentTime: video.currentTime });
  sendHeadsetState();
};

const recenterVideo = () => {
  const viewCamera = getViewCamera();
  viewCamera.updateMatrixWorld(true);
  const direction = new THREE.Vector3();
  const position = new THREE.Vector3();
  viewCamera.getWorldDirection(direction);
  viewCamera.getWorldPosition(position);
  const cameraYaw = Math.atan2(direction.x, direction.z);
  const cameraPitch = Math.asin(THREE.MathUtils.clamp(direction.y, -0.95, 0.95));
  videoGroup.position.copy(position);
  videoGroup.position.y += videoHeightOffset;
  videoGroup.rotation.set(cameraPitch + videoTiltOffset, cameraYaw - sphereCenterAngle, 0, "YXZ");
  updateMediaLayerTransform();
};

function getViewCamera() {
  if (!renderer.xr.isPresenting) return camera;

  const xrCamera = renderer.xr.getCamera(camera);
  return xrCamera.cameras?.[0] ?? xrCamera;
}

function queueRecenterVideo() {
  recenterVideo();
  requestAnimationFrame(() => {
    recenterVideo();
    requestAnimationFrame(recenterVideo);
  });
  setTimeout(recenterVideo, 120);
}

async function startDesktopStream() {
  stopDesktopStream({ notify: false });
  desktopActive = true;
  desktopProjection = "flat";
  desktopSignalingStatus = "starting";
  currentVideoId = "desktop-live";
  state.selectedVideoId = null;
  state.playing = true;
  state.currentTime = 0;
  setStatus("Starting desktop stream.");
  loadDesktopVideoElement();
  rebuildDesktopPresentation();

  const desktopSettings = await fetchDesktopSettings();
  const peer = new RTCPeerConnection({ iceServers: [] });
  desktopPeer = peer;
  const transceiver = peer.addTransceiver("video", { direction: "recvonly" });
  applyDesktopCodecPreference(transceiver, desktopSettings);
  peer.ontrack = async (event) => {
    desktopTrackStatus = `${event.track.kind} ${event.track.readyState}`;
    event.track.addEventListener("mute", () => {
      desktopTrackStatus = `${event.track.kind} muted`;
    });
    event.track.addEventListener("unmute", () => {
      desktopTrackStatus = `${event.track.kind} unmuted`;
    });
    event.track.addEventListener("ended", () => {
      desktopTrackStatus = `${event.track.kind} ended`;
    });
    desktopStream = event.streams[0] ?? new MediaStream([event.track]);
    video.srcObject = desktopStream;
    await playVideo();
    rebuildDesktopPresentation();
  };
  peer.onicecandidate = (event) => {
    if (event.candidate) {
      sendWsMessage({
        type: "browser-desktop-ice",
        candidate: event.candidate.toJSON(),
      });
    }
  };
  peer.onconnectionstatechange = () => {
    setStatus(`Desktop WebRTC ${peer.connectionState}.`);
  };
  peer.oniceconnectionstatechange = () => {
    desktopSignalingStatus = `ice ${peer.iceConnectionState}`;
  };
  peer.onsignalingstatechange = () => {
    desktopSignalingStatus = `signaling ${peer.signalingState}`;
  };

  const offer = await peer.createOffer();
  const tunedOffer = {
    type: offer.type,
    sdp: applyDesktopBitrateSdp(offer.sdp, desktopSettings),
  };
  await peer.setLocalDescription(tunedOffer);
  desktopSignalingStatus = "local offer created";
  if (sendWsMessage({ type: "browser-desktop-offer", offer: peer.localDescription })) {
    desktopSignalingStatus = "offer sent";
    setStatus("Desktop offer sent.");
  } else {
    desktopSignalingStatus = `ws not open (${ws.readyState})`;
    setStatus(`Desktop offer not sent; WebSocket state ${ws.readyState}.`);
  }
}

async function fetchDesktopSettings() {
  try {
    const response = await fetch("/api/desktop/settings");
    const data = await response.json();
    return data.settings ?? {};
  } catch {
    return {};
  }
}

function applyDesktopCodecPreference(transceiver, settings) {
  const capabilities = RTCRtpReceiver.getCapabilities?.("video");
  if (!capabilities?.codecs?.length || !transceiver.setCodecPreferences) return;

  const preferredMime = settings.encoder === "vp8" ? "video/VP8" : "video/H264";
  const preferred = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() === preferredMime.toLowerCase());
  if (preferred.length === 0) return;

  const supporting = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() !== preferredMime.toLowerCase());
  transceiver.setCodecPreferences([...preferred, ...supporting]);
  desktopSignalingStatus = `pref ${preferredMime}`;
}

function stopDesktopStream({ notify = true } = {}) {
  if (desktopPeer) {
    desktopPeer.close();
    desktopPeer = null;
  }
  if (desktopStream) {
    for (const track of desktopStream.getTracks()) {
      track.stop();
    }
    desktopStream = null;
  }
  if (video.srcObject) {
    video.srcObject = null;
  }
  if (desktopActive && notify) {
    sendWsMessage({ type: "browser-desktop-stop" });
  }
  desktopActive = false;
  desktopSignalingStatus = "idle";
  desktopTrackStatus = "none";
  desktopVideoStatus = "idle";
  desktopStatsStatus = "none";
  lastDesktopInboundStats = null;
  desktopReceiveBitrateBps = 0;
  desktopDecodedFps = 0;
  desktopRttMs = 0;
}

function exitDesktopMode(statusMessage = "Desktop stream stopped.") {
  stopDesktopStream();
  clearVideoMeshes();
  currentVideoId = null;
  state.playing = false;
  state.currentTime = 0;
  setStatus(statusMessage);
}

async function applyDesktopAnswer(answer) {
  if (!desktopPeer || !answer) return;
  await desktopPeer.setRemoteDescription(answer);
  desktopSignalingStatus = "answer applied";
}

async function applyDesktopIce(candidate) {
  if (!desktopPeer || !candidate?.candidate) return;
  await desktopPeer.addIceCandidate(candidate);
  desktopSignalingStatus = "remote ice added";
}

async function updateDesktopStats() {
  if (!desktopPeer || !desktopActive) return;
  const now = performance.now();
  if (now - lastDesktopStatsAt < 1000) return;
  lastDesktopStatsAt = now;

  try {
    const stats = await desktopPeer.getStats();
    let inbound = null;
    let pair = null;
    stats.forEach((report) => {
      if (report.type === "inbound-rtp" && (report.kind === "video" || report.mediaType === "video")) {
        inbound = report;
      } else if (report.type === "candidate-pair" && report.state === "succeeded") {
        pair = report;
      }
    });
    const parts = [];
    if (inbound) {
      const timestamp = Number(inbound.timestamp || now);
      const bytesReceived = Number(inbound.bytesReceived || 0);
      const framesReceived = Number(inbound.framesReceived || 0);
      const framesDecoded = Number(inbound.framesDecoded ?? inbound.framesReceived ?? 0);
      const framesDropped = Number(inbound.framesDropped || 0);
      const totalDecodeTime = Number(inbound.totalDecodeTime || 0);
      let receivedFps = 0;
      let decodeMsPerFrame = 0;
      let droppedDelta = 0;
      if (lastDesktopInboundStats) {
        const elapsedSeconds = Math.max((timestamp - lastDesktopInboundStats.timestamp) / 1000, 0);
        const byteDelta = bytesReceived - lastDesktopInboundStats.bytesReceived;
        const receivedFrameDelta = framesReceived - lastDesktopInboundStats.framesReceived;
        const decodedFrameDelta = framesDecoded - lastDesktopInboundStats.framesDecoded;
        const decodeTimeDelta = totalDecodeTime - lastDesktopInboundStats.totalDecodeTime;
        droppedDelta = framesDropped - lastDesktopInboundStats.framesDropped;
        if (elapsedSeconds > 0 && byteDelta >= 0) {
          desktopReceiveBitrateBps = (byteDelta * 8) / elapsedSeconds;
        }
        if (elapsedSeconds > 0 && receivedFrameDelta >= 0) {
          receivedFps = receivedFrameDelta / elapsedSeconds;
        }
        if (elapsedSeconds > 0 && decodedFrameDelta >= 0) {
          desktopDecodedFps = decodedFrameDelta / elapsedSeconds;
        }
        if (decodedFrameDelta > 0 && decodeTimeDelta >= 0) {
          decodeMsPerFrame = (decodeTimeDelta * 1000) / decodedFrameDelta;
        }
      }
      lastDesktopInboundStats = { timestamp, bytesReceived, framesReceived, framesDecoded, framesDropped, totalDecodeTime };
      if (desktopReceiveBitrateBps > 0) parts.push(`rx ${formatNetworkBitrate(desktopReceiveBitrateBps)}`);
      if (receivedFps > 0) parts.push(`recv ${Math.round(receivedFps)}fps`);
      if (desktopDecodedFps > 0) parts.push(`dec ${Math.round(desktopDecodedFps)}fps`);
      if (decodeMsPerFrame > 0) parts.push(`decode ${decodeMsPerFrame.toFixed(1)}ms/f`);
      parts.push(`packets ${inbound.packetsReceived ?? 0}`);
      parts.push(`bytes ${bytesReceived}`);
      parts.push(`frames ${framesDecoded}`);
      if (inbound.frameWidth && inbound.frameHeight) parts.push(`${inbound.frameWidth}x${inbound.frameHeight}`);
      if (framesDropped) parts.push(`dropped ${framesDropped}${droppedDelta > 0 ? ` +${droppedDelta}` : ""}`);
      if (inbound.freezeCount) parts.push(`freezes ${inbound.freezeCount}`);
    }
    if (pair) {
      desktopRttMs = Math.round((pair.currentRoundTripTime ?? 0) * 1000);
      parts.push(`rtt ${desktopRttMs}ms`);
    }
    desktopStatsStatus = parts.length ? parts.join(", ") : "no inbound video stats";
  } catch (error) {
    desktopStatsStatus = `stats error ${error.message ?? "unknown"}`;
  }
}

function adjustVideoTilt(delta) {
  videoTiltOffset = THREE.MathUtils.clamp(videoTiltOffset + delta, -0.35, 0.35);
  videoGroup.rotation.x = THREE.MathUtils.clamp(videoGroup.rotation.x + delta, -1.2, 1.2);
  updateMediaLayerTransform();
}

function adjustVideoHeight(delta) {
  const previous = videoHeightOffset;
  videoHeightOffset = THREE.MathUtils.clamp(videoHeightOffset + delta, -0.6, 0.6);
  videoGroup.position.y += videoHeightOffset - previous;
  applyVideoHeightOffset();
  updateMediaLayerZoom();
  updateMediaLayerTransform();
  setStatus(`Height ${videoHeightOffset.toFixed(2)}m`);
}

function loadHeadsetSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HEADSET_SETTINGS_STORAGE_KEY) ?? "{}");
    return normalizeHeadsetSettings({ ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === "object" ? parsed : {}) });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveHeadsetSettings() {
  localStorage.setItem(HEADSET_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function normalizeHeadsetSettings(value) {
  const renderScaleValues = SETTING_PLACEHOLDER_ROWS.find((row) => row.id === "renderScale")?.options.map((option) => option.value) ?? [
    DEFAULT_SETTINGS.renderScale,
  ];
  const videoFrameRateValues = SETTING_PLACEHOLDER_ROWS.find((row) => row.id === "videoFrameRate")?.options.map((option) => option.value) ?? [
    DEFAULT_SETTINGS.videoFrameRate,
  ];
  const renderScale = Number(value.renderScale);
  const videoFrameRate = value.videoFrameRate === "native" ? "native" : Number(value.videoFrameRate);
  return {
    renderScale: renderScaleValues.includes(renderScale) ? renderScale : DEFAULT_SETTINGS.renderScale,
    foveation: ["default", 0, 0.25, 1].includes(value.foveation) ? value.foveation : DEFAULT_SETTINGS.foveation,
    textureSample: ["linear", "nearest", "aniso4", "anisoMax"].includes(value.textureSample)
      ? value.textureSample
      : DEFAULT_SETTINGS.textureSample,
    colorPreset: ["default", "brightness", "contrast", "saturation"].includes(value.colorPreset) ? value.colorPreset : DEFAULT_SETTINGS.colorPreset,
    videoFrameRate: videoFrameRateValues.includes(videoFrameRate) ? videoFrameRate : DEFAULT_SETTINGS.videoFrameRate,
    xrLayer: ["mesh", "media"].includes(value.xrLayer) ? value.xrLayer : DEFAULT_SETTINGS.xrLayer,
  };
}

function loadDesktopViewSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem("vrvideopump.desktopView") ?? "{}");
    return normalizeDesktopView({ ...DEFAULT_DESKTOP_VIEW, ...(parsed && typeof parsed === "object" ? parsed : {}) });
  } catch {
    return { ...DEFAULT_DESKTOP_VIEW };
  }
}

function saveDesktopViewSettings() {
  localStorage.setItem("vrvideopump.desktopView", JSON.stringify(desktopView));
}

function normalizeDesktopView(view) {
  const configuredWidth = Number(view.width);
  const width = configuredWidth === 3.2 ? DEFAULT_DESKTOP_VIEW.width : configuredWidth;
  return {
    distance: THREE.MathUtils.clamp(Number(view.distance) || DEFAULT_DESKTOP_VIEW.distance, 1.6, 6),
    pitchDeg: THREE.MathUtils.clamp(Number(view.pitchDeg) || 0, -30, 30),
    yOffset: THREE.MathUtils.clamp(Number(view.yOffset) || 0, -1.2, 1.2),
    width: THREE.MathUtils.clamp(width || DEFAULT_DESKTOP_VIEW.width, 1.8, 5.2),
  };
}

function applyDesktopViewTransform() {
  if (!desktopMesh) return;
  desktopMesh.position.set(0, desktopView.yOffset, -desktopView.distance);
  desktopMesh.rotation.set(THREE.MathUtils.degToRad(desktopView.pitchDeg), 0, 0);
  desktopMesh.scale.setScalar(desktopView.width / DEFAULT_DESKTOP_VIEW.width);
}

function adjustDesktopDistance(delta) {
  desktopView = normalizeDesktopView({ ...desktopView, distance: desktopView.distance + delta });
  saveDesktopViewSettings();
  applyDesktopViewTransform();
  setStatus(`Desktop distance ${desktopView.distance.toFixed(1)}m`);
}

function adjustDesktopPitch(deltaDeg) {
  desktopView = normalizeDesktopView({ ...desktopView, pitchDeg: desktopView.pitchDeg + deltaDeg });
  saveDesktopViewSettings();
  applyDesktopViewTransform();
  setStatus(`Desktop pitch ${Math.round(desktopView.pitchDeg)} deg`);
}

function adjustProjectionZoom(delta) {
  if (desktopActive) {
    if (desktopProjection === "flat") {
      adjustDesktopDistance(delta > 0 ? -0.15 : 0.15);
      return;
    }
    projectionZoom = clampProjectionZoom(projectionZoom + delta, DEFAULT_PROJECTION_ZOOM_BOUNDS);
    rebuildDesktopPresentation();
    setStatus(`Desktop projection zoom ${projectionZoom.toFixed(1)}x`);
    return;
  }
  if (isFlatSbsProjection(state.projection)) {
    flatSbsZoom = clampProjectionZoom(flatSbsZoom + delta, FLAT_SBS_PROJECTION_ZOOM_BOUNDS);
    rebuildSphere();
    setStatus(`SBS screen zoom ${flatSbsZoom.toFixed(1)}x`);
    return;
  }
  projectionZoom = clampProjectionZoom(projectionZoom + delta, DEFAULT_PROJECTION_ZOOM_BOUNDS);
  if (mediaLayer) {
    updateMediaLayerZoom();
  } else {
    rebuildSphere();
  }
  setStatus(`Projection zoom ${projectionZoom.toFixed(1)}x`);
}

function resetPresentationAdjustments() {
  projectionZoom = 1;
  flatSbsZoom = 1;
  const previousHeight = videoHeightOffset;
  videoHeightOffset = 0;
  videoGroup.position.y -= previousHeight;

  if (desktopActive) {
    rebuildDesktopPresentation();
  } else if (isFlatSbsProjection(state.projection)) {
    rebuildSphere();
  } else if (mediaLayer) {
    applyPresentationAdjustments();
  } else {
    applyVideoHeightOffset();
    rebuildSphere();
  }

  setStatus("Reset height and zoom.");
}

function applySetting(settingId, value, label) {
  settings[settingId] = value;
  saveHeadsetSettings();

  let statusMessage = `Applied ${label}`;
  if (settingId === "renderScale") {
    statusMessage = applyRenderScaleSetting(label);
  } else if (settingId === "foveation") {
    applyFoveationSetting();
  } else if (settingId === "textureSample") {
    applyTextureSettings();
  } else if (settingId === "colorPreset") {
    applyColorSettings();
  } else if (settingId === "videoFrameRate") {
    rebuildVideoTexture();
  } else if (settingId === "xrLayer") {
    rebuildSphere();
    statusMessage = `Applied ${label}: ${mediaLayerStatus}`;
  }

  updateSettingsPanel();
  setStatus(statusMessage);
}

function applyVideoFrameRateForProjection(projection) {
  const frameRate = getProjectionVideoFrameRate(projection);
  if (frameRate === null || settings.videoFrameRate === frameRate) return false;

  settings.videoFrameRate = frameRate;
  saveHeadsetSettings();
  updateSettingsPanel();
  return true;
}

function getProjectionVideoFrameRate(projection) {
  if (projection === "flat_sbs_lr") return "native";
  if (projection === "180_sbs_lr" || projection === "180_fisheye_sbs_lr") return VR180_VIDEO_FRAME_RATE;
  return null;
}

function applyRenderScaleSetting(label) {
  if (renderer.xr.getSession()) {
    restartForRenderScaleChange();
    return `${label} saved. Restarting headset view to apply.`;
  }
  renderer.xr.setFramebufferScaleFactor(settings.renderScale);
  return `Applied ${label}`;
}

function restartForRenderScaleChange() {
  const session = renderer.xr.getSession();
  if (!session) {
    location.reload();
    return;
  }

  let reloading = false;
  const reloadOnce = () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  };
  session.addEventListener("end", reloadOnce, { once: true });
  session.end().catch(reloadOnce);
  setTimeout(reloadOnce, 1800);
}

function applyFoveationSetting() {
  if (!renderer.xr.setFoveation) return;
  renderer.xr.setFoveation(settings.foveation === "default" ? 0 : settings.foveation);
}

function createVideoTexture(videoElement, { forceNativeFrameRate = false } = {}) {
  const frameRate = forceNativeFrameRate ? "native" : settings.videoFrameRate;
  return Number.isFinite(frameRate) ? new CappedVideoTexture(videoElement, frameRate) : new THREE.VideoTexture(videoElement);
}

function rebuildVideoTexture() {
  if (!video) return;
  texture?.dispose();
  texture = createVideoTexture(video, { forceNativeFrameRate: desktopActive });
  texture.colorSpace = THREE.SRGBColorSpace;
  if (desktopActive) {
    applyDesktopTextureSettings();
    rebuildDesktopPresentation();
  } else {
    applyTextureSettings();
    rebuildSphere();
  }
}

function applyTextureSettings() {
  if (!texture) return;

  if (settings.textureSample === "nearest") {
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.anisotropy = 1;
  } else {
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.anisotropy =
      settings.textureSample === "anisoMax" ? maxAnisotropy : settings.textureSample === "aniso4" ? Math.min(4, maxAnisotropy) : 1;
  }

  texture.needsUpdate = true;
}

function applyDesktopTextureSettings() {
  if (!texture) return;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 1;
  texture.needsUpdate = true;
}

function getColorSettings() {
  if (settings.colorPreset === "brightness") return { brightness: 1.12, contrast: 1, saturation: 1 };
  if (settings.colorPreset === "contrast") return { brightness: 1, contrast: 1.14, saturation: 1 };
  if (settings.colorPreset === "saturation") return { brightness: 1, contrast: 1, saturation: 1.18 };
  return { brightness: 1, contrast: 1, saturation: 1 };
}

function applyColorSettings() {
  const colorSettings = getColorSettings();
  for (const mesh of [leftMesh, rightMesh]) {
    if (!mesh?.material?.uniforms) continue;
    if (mesh.material.uniforms.brightness) mesh.material.uniforms.brightness.value = colorSettings.brightness;
    if (mesh.material.uniforms.contrast) mesh.material.uniforms.contrast.value = colorSettings.contrast;
    if (mesh.material.uniforms.saturation) mesh.material.uniforms.saturation.value = colorSettings.saturation;
  }
}

function applyVideoHeightOffset() {
  const heightUvOffset = getSphericalHeightUvOffset();
  for (const mesh of [leftMesh, rightMesh]) {
    if (mesh?.material?.uniforms?.heightUvOffset) {
      mesh.material.uniforms.heightUvOffset.value = heightUvOffset;
    }
  }
}

function cycleProjectionMode() {
  if (desktopActive) {
    const currentIndex = DESKTOP_PROJECTION_MODES.findIndex((mode) => mode.value === desktopProjection);
    const nextMode = DESKTOP_PROJECTION_MODES[(currentIndex + 1) % DESKTOP_PROJECTION_MODES.length] ?? DESKTOP_PROJECTION_MODES[0];
    desktopProjection = nextMode.value;
    rebuildDesktopPresentation();
    setStatus(`Desktop projection ${nextMode.label}.`);
    return;
  }
  const currentIndex = PROJECTION_MODES.findIndex((mode) => mode.value === state.projection);
  const nextMode = PROJECTION_MODES[(currentIndex + 1) % PROJECTION_MODES.length] ?? PROJECTION_MODES[0];
  state.projection = nextMode.value;
  const changedFrameRate = applyVideoFrameRateForProjection(state.projection);
  if (changedFrameRate) {
    rebuildVideoTexture();
  } else {
    rebuildSphere();
  }
  applyPresentationAdjustments();
  recenterVideo();
  setStatus(`Projection ${nextMode.label}, video fps ${getVideoFrameRateLabel()}.`);
  sendWsMessage({ type: "projection", projection: state.projection });
}

function exitVrSession() {
  const session = renderer.xr.getSession();
  if (session) {
    session.end();
  } else {
    location.reload();
  }
}

function createVrPanel() {
  const panel = new THREE.Group();
  panel.position.set(0, -0.28, -1.8);

  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 0.72),
    new THREE.MeshBasicMaterial({ color: 0x111820, transparent: true, opacity: 0.78 }),
  );
  background.material.userData.baseOpacity = 0.78;
  background.position.z = -0.012;
  background.userData = { kind: "panel" };
  interactiveControls.push(background);
  panel.add(background);

  panel.add(makeVrButton("Desktop", -1.04, 0.22, 0.36, 0.13, "startDesktop"));
  panel.add(makeVrButton("H-", -0.7, 0.22, 0.2, 0.13, "heightDown"));
  panel.add(makeVrButton("H+", -0.49, 0.22, 0.2, 0.13, "heightUp"));
  panel.add(makeVrButton("R", -0.29, 0.22, 0.16, 0.13, "resetView"));

  const videoLabel = makeLabel("No video", 1536, 128, 1.04, 0.12);
  videoLabel.name = "videoLabel";
  videoLabel.position.set(0.32, 0.22, 0.02);
  panel.add(videoLabel);

  panel.add(makeVrButton("Browse", -1.03, 0.05, 0.34, 0.13, "toggleBrowse"));
  panel.add(makeVrButton("Play", -0.71, 0.05, 0.24, 0.13, "toggle"));
  const backButton = makeVrButton("-30", -0.46, 0.05, 0.22, 0.13, "back30");
  backButton.name = "backButton";
  panel.add(backButton);
  const forwardButton = makeVrButton("+30", -0.22, 0.05, 0.22, 0.13, "forward30");
  forwardButton.name = "forwardButton";
  panel.add(forwardButton);
  panel.add(makeVrButton("Center", 0.06, 0.05, 0.3, 0.13, "recenter"));
  const projectionButton = makeVrButton("180", 0.36, 0.05, 0.24, 0.13, "cycleProjection");
  projectionButton.name = "projectionButton";
  panel.add(projectionButton);
  const outButton = makeVrButton("Out", 0.61, 0.05, 0.22, 0.13, "zoomOut");
  outButton.name = "outButton";
  panel.add(outButton);
  const inButton = makeVrButton("In", 0.82, 0.05, 0.16, 0.13, "zoomIn");
  inButton.name = "inButton";
  panel.add(inButton);
  panel.add(makeVrButton("Settings", 1.06, 0.05, 0.24, 0.13, "openSettings"));
  panel.add(makeVrButton("X", 1.14, 0.28, 0.17, 0.13, "exitVr", { baseColor: 0x6d1f1f, hoverColor: 0xa73535 }));

  const progressTrack = new THREE.Mesh(
    new THREE.PlaneGeometry(1.74, 0.052),
    new THREE.MeshBasicMaterial({ color: 0x38434c, transparent: true }),
  );
  progressTrack.position.set(-0.21, -0.14, 0.01);
  progressTrack.userData = { kind: "seekbar", width: 1.74 };
  interactiveControls.push(progressTrack);
  panel.add(progressTrack);

  const progressFill = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 0.055),
    new THREE.MeshBasicMaterial({ color: 0x73d2de, transparent: true }),
  );
  progressFill.name = "progressFill";
  progressFill.position.set(-1.08, -0.14, 0.02);
  progressFill.scale.x = 0.001;
  progressFill.geometry.translate(0.5, 0, 0);
  panel.add(progressFill);

  const timeLabel = makeLabel("0:00 / 0:00", 512, 96, 0.72, 0.12);
  timeLabel.name = "timeLabel";
  timeLabel.position.set(-0.56, -0.28, 0.02);
  panel.add(timeLabel);

  const ipdLabel = makeLabel("IPD 0", 512, 96, 0.42, 0.095);
  ipdLabel.name = "ipdLabel";
  ipdLabel.position.set(0.03, -0.28, 0.02);
  panel.add(ipdLabel);

  const ipdTrack = new THREE.Mesh(
    new THREE.PlaneGeometry(0.58, 0.052),
    new THREE.MeshBasicMaterial({ color: 0x38434c, transparent: true }),
  );
  ipdTrack.position.set(0.45, -0.28, 0.01);
  ipdTrack.userData = { kind: "ipdSlider", width: 0.58 };
  interactiveControls.push(ipdTrack);
  panel.add(ipdTrack);

  const ipdMarker = new THREE.Mesh(
    new THREE.PlaneGeometry(0.035, 0.11),
    new THREE.MeshBasicMaterial({ color: 0x73d2de, transparent: true }),
  );
  ipdMarker.name = "ipdMarker";
  ipdMarker.position.set(0.45, -0.28, 0.025);
  panel.add(ipdMarker);

  const bitrateLabel = makeLabel("Net --", 512, 96, 0.48, 0.095);
  bitrateLabel.name = "bitrateLabel";
  bitrateLabel.position.set(1, -0.28, 0.02);
  panel.add(bitrateLabel);

  return panel;
}

function createSettingsPanel() {
  const panel = new THREE.Group();
  panel.position.set(0, -0.36, -1.8);
  panel.visible = false;

  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 1.38),
    new THREE.MeshBasicMaterial({ color: 0x111820, transparent: true, opacity: 0.82 }),
  );
  background.material.userData.baseOpacity = 0.82;
  background.position.z = -0.012;
  background.userData = { kind: "panel" };
  interactiveControls.push(background);
  panel.add(background);

  const title = makeLabel("Settings", 768, 96, 0.54, 0.12);
  title.position.set(-0.84, 0.56, 0.02);
  panel.add(title);

  panel.add(makeVrButton("Back", 0.83, 0.56, 0.3, 0.12, "closeSettings"));
  panel.add(makeVrButton("X", 1.12, 0.56, 0.16, 0.12, "exitVr", { baseColor: 0x6d1f1f, hoverColor: 0xa73535 }));

  for (const row of SETTING_PLACEHOLDER_ROWS) {
    addSettingsRow(panel, row);
  }

  const note = makeLabel("Green marks saved choice. Render scale restarts VR.", 1536, 96, 1.82, 0.09);
  note.position.set(0, -0.65, 0.02);
  panel.add(note);

  return panel;
}

function addSettingsRow(panel, row) {
  const rowLabel = makeLabel(row.label, 512, 96, 0.46, 0.11);
  rowLabel.position.set(-0.91, row.y, 0.02);
  panel.add(rowLabel);

  const startX = row.startX ?? -0.42;
  const gap = row.gap ?? 0.36;
  const width = row.width ?? 0.34;
  for (const [index, option] of row.options.entries()) {
    const x = startX + index * gap;
    const isSelected = settings[row.id] === option.value;
    const button = makeVrButton(option.label, x, row.y, width, 0.11, "settingsPlaceholder", {
      baseColor: isSelected ? 0x245b3b : 0x25313a,
      hoverColor: isSelected ? 0x347f55 : 0x40606a,
    });
    button.userData.settingId = option.id;
    button.userData.settingKey = row.id;
    button.userData.settingValue = option.value;
    button.userData.settingLabel = `${row.label}: ${option.label}`;
    panel.add(button);
  }
}

function createBrowsePanel() {
  const panel = new THREE.Group();
  panel.position.set(0, -0.44, -1.8);
  panel.visible = false;

  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 1.62),
    new THREE.MeshBasicMaterial({ color: 0x111820, transparent: true, opacity: 0.78 }),
  );
  background.material.userData.baseOpacity = 0.78;
  background.position.z = -0.012;
  background.userData = { kind: "panel" };
  interactiveControls.push(background);
  panel.add(background);

  panel.add(makeVrButton("Local", -1.03, 0.68, 0.36, 0.12, "browseLocal"));
  panel.add(makeVrButton("Remote", -0.62, 0.68, 0.42, 0.12, "browseRemote"));
  panel.add(makeVrButton("Back", 0.63, 0.68, 0.32, 0.12, "browseBack"));
  panel.add(makeVrButton("Close", 1, 0.68, 0.36, 0.12, "toggleBrowse"));
  panel.add(makeVrButton("^", 1.12, 0.38, 0.18, 0.22, "browseUp"));
  panel.add(makeVrButton("v", 1.12, -0.58, 0.18, 0.22, "browseDown"));

  const browseLabel = makeLabel("Local /", 768, 96, 0.46, 0.1);
  browseLabel.name = "browseLabel";
  browseLabel.position.set(0.04, 0.68, 0.02);
  panel.add(browseLabel);

  for (let index = 0; index < 25; index += 1) {
    const column = index % 5;
    const row = Math.floor(index / 5);
    const x = -0.82 + column * 0.41;
    const y = 0.39 - row * 0.24;

    const tile = new THREE.Mesh(
      new THREE.PlaneGeometry(0.39, 0.22),
      new THREE.MeshBasicMaterial({ color: 0x182129, transparent: true }),
    );
    tile.name = `browseTile${index}`;
    tile.position.set(x, y, 0.02);
    tile.userData = {
      kind: "browserRow",
      tileIndex: index,
      itemIndex: -1,
      baseColor: 0x182129,
      hoverColor: 0x314954,
    };
    interactiveControls.push(tile);
    browseTiles.push(tile);
    panel.add(tile);

    const thumbnail = new THREE.Mesh(
      new THREE.PlaneGeometry(0.375, 0.211),
      new THREE.MeshBasicMaterial({ color: 0x0b0f13, transparent: true }),
    );
    thumbnail.name = `browseThumbnail${index}`;
    thumbnail.position.set(x, y, 0.03);
    thumbnail.userData = { currentUrl: null };
    panel.add(thumbnail);

    const tileLabel = makeLabel("", 512, 96, 0.375, 0.09);
    tileLabel.name = `browseTileLabel${index}`;
    tileLabel.position.set(x, y, 0.04);
    tileLabel.visible = false;
    panel.add(tileLabel);
  }

  return panel;
}

function makeVrButton(label, x, y, width, height, action, options = {}) {
  const button = makeLabel(label, 256, 128, width, height);
  button.position.set(x, y, 0.02);
  button.userData = {
    kind: "button",
    action,
    baseColor: options.baseColor ?? 0x25313a,
    hoverColor: options.hoverColor ?? 0x40606a,
    textureLabel: label,
    width,
    height,
  };
  button.material.color.setHex(button.userData.baseColor);
  interactiveControls.push(button);
  return button;
}

function makeLabel(label, canvasWidth, canvasHeight, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  drawCanvasLabel(context, canvas, label);

  const labelTexture = new THREE.CanvasTexture(canvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: labelTexture, color: 0xffffff, transparent: true }),
  );
  mesh.userData.currentLabel = label;
  return mesh;
}

function setupControllers() {
  for (let index = 0; index < 2; index += 1) {
    const controller = renderer.xr.getController(index);
    controller.addEventListener("selectstart", onControllerSelect);
    controller.addEventListener("connected", (event) => {
      xrInputSummary[index] = getXrInputLabel(event.data);
      controllerStates[index] = {
        inputSource: event.data,
        gripPressed: false,
        gripPressedAt: 0,
        gripHoldTriggered: false,
        xPressed: false,
        yPressed: false,
        horizontalAxisPressed: 0,
        verticalAxisPressed: 0,
        lastHorizontalAxisAt: 0,
        lastVerticalAxisAt: 0,
      };
      updateDiagnostics();
    });
    controller.addEventListener("disconnected", () => {
      xrInputSummary[index] = "none";
      controllerStates[index] = null;
      updateDiagnostics();
    });
    scene.add(controller);

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    const line = new THREE.Line(
      lineGeometry,
      new THREE.LineBasicMaterial({ color: 0x73d2de, transparent: true, opacity: 0.85 }),
    );
    line.name = "pointer";
    line.scale.z = 2;
    controller.add(line);
    controllerPointers.push(controller);
  }
}

function getXrInputLabel(inputSource) {
  const hand = inputSource.hand ? "hand" : "controller";
  const handedness = inputSource.handedness || "unknown";
  const rayMode = inputSource.targetRayMode || "unknown";
  return `${hand}/${handedness}/${rayMode}`;
}

function onControllerSelect(event) {
  if (!menuOpen) return;
  const hit = getControllerHit(event.target);
  if (!hit) return;
  markPanelFocused();

  const object = hit.object;
  if (object.userData.kind === "seekbar") {
    const localPoint = object.worldToLocal(hit.point.clone());
    const width = object.userData.width;
    const ratio = THREE.MathUtils.clamp(localPoint.x / width + 0.5, 0, 1);
    seekTo(ratio * video.duration);
    return;
  }
  if (object.userData.kind === "ipdSlider") {
    const localPoint = object.worldToLocal(hit.point.clone());
    const ratio = THREE.MathUtils.clamp(localPoint.x / object.userData.width + 0.5, 0, 1);
    setIpdOffset((ratio - 0.5) * 0.06);
    return;
  }

  if (object.userData.action === "toggle") {
    togglePlayback();
  } else if (object.userData.action === "startDesktop") {
    startDesktopStream().catch((error) => setStatus(`Desktop stream error: ${error.message ?? "unknown"}`));
  } else if (object.userData.action === "back30") {
    if (desktopActive) {
      if (desktopProjection === "flat") {
        adjustDesktopPitch(-2);
      } else {
        adjustVideoTilt(-0.035);
      }
    } else {
      seekBy(-30);
    }
  } else if (object.userData.action === "forward30") {
    if (desktopActive) {
      if (desktopProjection === "flat") {
        adjustDesktopPitch(2);
      } else {
        adjustVideoTilt(0.035);
      }
    } else {
      seekBy(30);
    }
  } else if (object.userData.action === "recenter") {
    queueRecenterVideo();
    sendWsMessage({ type: "recenter" });
  } else if (object.userData.action === "cycleProjection") {
    cycleProjectionMode();
  } else if (object.userData.action === "zoomOut") {
    adjustProjectionZoom(-0.1);
  } else if (object.userData.action === "zoomIn") {
    adjustProjectionZoom(0.1);
  } else if (object.userData.action === "heightDown") {
    adjustVideoHeight(-0.08);
  } else if (object.userData.action === "heightUp") {
    adjustVideoHeight(0.08);
  } else if (object.userData.action === "resetView") {
    resetPresentationAdjustments();
  } else if (object.userData.action === "openSettings") {
    openSettingsPanel();
  } else if (object.userData.action === "closeSettings") {
    closeSettingsPanel();
  } else if (object.userData.action === "settingsPlaceholder") {
    applySetting(object.userData.settingKey, object.userData.settingValue, object.userData.settingLabel);
  } else if (object.userData.action === "exitVr") {
    exitVrSession();
  } else if (object.userData.action === "toggleBrowse") {
    toggleBrowsePanel();
  } else if (object.userData.action === "browseLocal") {
    setBrowseSource("local");
  } else if (object.userData.action === "browseRemote") {
    setBrowseSource("remote");
  } else if (object.userData.action === "browseBack") {
    browseBack();
  } else if (object.userData.action === "browseUp") {
    scrollBrowse(-1);
  } else if (object.userData.action === "browseDown") {
    scrollBrowse(1);
  } else if (object.userData.kind === "browserRow") {
    activateBrowserItem(object.userData.itemIndex);
  }
}

function getControllerHit(controller) {
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  const hits = raycaster.intersectObjects(interactiveControls.filter(isInteractiveVisible), false);
  return hits[0] ?? null;
}

function isInteractiveVisible(object) {
  let current = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function updateVrControls() {
  updateQuestControllerShortcuts();

  let nextHovered = null;
  if (menuOpen) {
    for (const controller of controllerPointers) {
      const hit = getControllerHit(controller);
      if (hit) {
        nextHovered = hit.object;
        break;
      }
    }
  }

  if (hoveredControl !== nextHovered) {
    if (hoveredControl?.userData.kind === "button") {
      hoveredControl.material.color.setHex(hoveredControl.userData.baseColor);
    } else if (hoveredControl?.userData.kind === "browserRow") {
      hoveredControl.material.color.setHex(hoveredControl.userData.baseColor);
    }
    hoveredControl = nextHovered;
    if (hoveredControl?.userData.kind === "button") {
      hoveredControl.material.color.setHex(hoveredControl.userData.hoverColor);
    } else if (hoveredControl?.userData.kind === "browserRow") {
      hoveredControl.material.color.setHex(hoveredControl.userData.hoverColor);
    }
  }
  // Re-enable this if hover/proximity should show the menu again.
  // if (nextHovered) {
  //   markPanelFocused();
  // }

  const progressFill = vrPanel.getObjectByName("progressFill");
  if (progressFill) {
    const ratio = Number.isFinite(video.duration) && video.duration > 0 ? (video.currentTime || 0) / video.duration : 0;
    progressFill.scale.x = Math.max(0.001, THREE.MathUtils.clamp(ratio, 0, 1) * 1.74);
  }

  const videoLabel = vrPanel.getObjectByName("videoLabel");
  if (videoLabel) {
    refreshLabel(videoLabel, getPickerLabel());
  }

  const projectionButton = vrPanel.getObjectByName("projectionButton");
  if (projectionButton) {
    refreshLabel(projectionButton, getProjectionLabel());
  }

  const backButton = vrPanel.getObjectByName("backButton");
  if (backButton) {
    refreshLabel(backButton, desktopActive ? (desktopProjection === "flat" ? "Pitch-" : "Tilt-") : "-30");
  }

  const forwardButton = vrPanel.getObjectByName("forwardButton");
  if (forwardButton) {
    refreshLabel(forwardButton, desktopActive ? (desktopProjection === "flat" ? "Pitch+" : "Tilt+") : "+30");
  }

  const outButton = vrPanel.getObjectByName("outButton");
  if (outButton) {
    refreshLabel(outButton, desktopActive && desktopProjection === "flat" ? "Far" : "Out");
  }

  const inButton = vrPanel.getObjectByName("inButton");
  if (inButton) {
    refreshLabel(inButton, desktopActive && desktopProjection === "flat" ? "Near" : "In");
  }

  for (const controller of controllerPointers) {
    const pointer = controller.getObjectByName("pointer");
    if (pointer) pointer.visible = menuOpen;
  }

  const timeLabel = vrPanel.getObjectByName("timeLabel");
  if (timeLabel) {
    refreshLabel(timeLabel, `${formatDuration(video.currentTime)} / ${formatDuration(video.duration)}`);
  }

  const ipdLabel = vrPanel.getObjectByName("ipdLabel");
  if (ipdLabel) {
    refreshLabel(ipdLabel, `IPD ${Math.round(ipdOffset * 1000)}`);
  }

  const ipdMarker = vrPanel.getObjectByName("ipdMarker");
  if (ipdMarker) {
    ipdMarker.position.x = 0.45 + THREE.MathUtils.clamp(ipdOffset / 0.06 + 0.5, 0, 1) * 0.58 - 0.29;
  }

  const bitrateLabel = vrPanel.getObjectByName("bitrateLabel");
  if (bitrateLabel) {
    refreshLabel(bitrateLabel, getBitrateLabel());
  }

  updateSettingsPanel();
  updateBrowsePanel();
  updatePanelOpacity();
}

function updateQuestControllerShortcuts() {
  const now = performance.now();

  for (const state of controllerStates) {
    const inputSource = state?.inputSource;
    const gamepad = inputSource?.gamepad;
    if (!gamepad || inputSource.handedness !== "left") continue;

    const gripPressed = Boolean(gamepad.buttons[1]?.pressed);
    if (gripPressed && !state.gripPressed) {
      state.gripPressedAt = now;
      state.gripHoldTriggered = false;
    } else if (gripPressed && !state.gripHoldTriggered && now - state.gripPressedAt >= BROWSE_GRIP_HOLD_MS) {
      openBrowsePanel();
      state.gripHoldTriggered = true;
    } else if (!gripPressed && state.gripPressed) {
      if (!state.gripHoldTriggered) {
        togglePlaybackPanel();
      }
      state.gripPressedAt = 0;
    }
    state.gripPressed = gripPressed;

    const xPressed = Boolean(gamepad.buttons[4]?.pressed);
    if (xPressed && !state.xPressed) {
      togglePlayback();
    }
    state.xPressed = xPressed;

    const yPressed = Boolean(gamepad.buttons[5]?.pressed);
    if (yPressed && !state.yPressed) {
      queueRecenterVideo();
      sendWsMessage({ type: "recenter" });
    }
    state.yPressed = yPressed;

    const horizontalAxis = getThumbstickAxis(gamepad, "horizontal");
    const axisDirection = horizontalAxis < -0.65 ? -1 : horizontalAxis > 0.65 ? 1 : 0;
    const axisReady = now - state.lastHorizontalAxisAt > 350;
    if (axisDirection !== 0 && (state.horizontalAxisPressed !== axisDirection || axisReady)) {
      seekBy(axisDirection * 30);
      state.lastHorizontalAxisAt = now;
    }
    state.horizontalAxisPressed = axisDirection;

    const verticalAxis = getThumbstickAxis(gamepad, "vertical");
    const verticalDirection = verticalAxis < -0.65 ? -1 : verticalAxis > 0.65 ? 1 : 0;
    const verticalReady = now - state.lastVerticalAxisAt > 350;
    if (verticalDirection !== 0 && (state.verticalAxisPressed !== verticalDirection || verticalReady)) {
      if (browseOpen && menuOpen) {
        scrollBrowse(verticalDirection);
      } else if (!menuOpen) {
        adjustVideoTilt(verticalDirection * 0.09);
      }
      state.lastVerticalAxisAt = now;
    }
    state.verticalAxisPressed = verticalDirection;
  }
}

function getThumbstickAxis(gamepad, direction) {
  if (!gamepad.axes?.length) return 0;
  const preferred = direction === "horizontal" ? [2, 0] : [3, 1];
  for (const index of preferred) {
    const value = gamepad.axes[index] ?? 0;
    if (Math.abs(value) > 0.2) return value;
  }
  return 0;
}

function setIpdOffset(value) {
  ipdOffset = THREE.MathUtils.clamp(value, -0.03, 0.03);
  applyIpdOffset();
}

function applyIpdOffset() {
  for (const mesh of [leftMesh, rightMesh]) {
    if (mesh?.material?.uniforms?.ipdOffset) {
      mesh.material.uniforms.ipdOffset.value = ipdOffset;
    }
  }
}

function markPanelFocused() {
  lastPanelFocusAt = performance.now();
}

function updatePanelOpacity() {
  const targetOpacity = menuOpen ? 1 : 0;
  panelOpacity = THREE.MathUtils.lerp(panelOpacity, targetOpacity, menuOpen ? 0.45 : 0.65);
  setObjectOpacity(vrPanel, !browseOpen && !settingsOpen ? panelOpacity : 0);
  setObjectOpacity(browsePanel, browseOpen && !settingsOpen && menuOpen ? panelOpacity : 0);
  setObjectOpacity(settingsPanel, settingsOpen && menuOpen ? panelOpacity : 0);
}

function setObjectOpacity(object, opacity) {
  object.traverse((child) => {
    if (!child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.transparent = true;
      material.opacity = opacity * (material.userData.baseOpacity ?? 1);
      material.depthWrite = false;
    }
  });
}

async function loadVideoInfo(selected, { autoplay = false } = {}) {
  if (desktopActive) {
    exitDesktopMode("Loading video.");
  }
  state.selectedVideoId = selected.id;
  state.projection = selected.projection;
  state.playing = autoplay;
  state.currentTime = 0;
  sendWsMessage({ type: "load", videoId: selected.id, projection: selected.projection });
  if (autoplay) {
    sendWsMessage({ type: "play" });
  }
  await applyState();
}

function toggleBrowsePanel() {
  if (desktopActive) {
    exitDesktopMode("Desktop stream stopped. Browse opened.");
  }
  browseOpen = !browseOpen;
  settingsOpen = false;
  menuOpen = true;
  browsePanel.visible = browseOpen;
  settingsPanel.visible = false;
  if (browseOpen && browseItems.length === 0 && !browseLoading) {
    loadBrowseDirectory(browseSource, browsePath);
  }
  markPanelFocused();
}

function openBrowsePanel() {
  if (desktopActive) {
    exitDesktopMode("Desktop stream stopped. Browse opened.");
  }
  browseOpen = true;
  settingsOpen = false;
  menuOpen = true;
  browsePanel.visible = true;
  settingsPanel.visible = false;
  if (browseItems.length === 0 && !browseLoading) {
    loadBrowseDirectory(browseSource, browsePath);
  }
  markPanelFocused();
}

function togglePlaybackPanel() {
  const playbackPanelOpen = menuOpen && !browseOpen && !settingsOpen;
  menuOpen = !playbackPanelOpen;
  browseOpen = false;
  settingsOpen = false;
  browsePanel.visible = false;
  settingsPanel.visible = false;
  markPanelFocused();
}

function openSettingsPanel() {
  settingsOpen = true;
  browseOpen = false;
  menuOpen = true;
  settingsPanel.visible = true;
  browsePanel.visible = false;
  markPanelFocused();
}

function closeSettingsPanel() {
  settingsOpen = false;
  menuOpen = true;
  settingsPanel.visible = false;
  markPanelFocused();
}

function updateSettingsPanel() {
  settingsPanel.traverse((child) => {
    if (child.userData?.action !== "settingsPlaceholder") return;

    const isSelected = settings[child.userData.settingKey] === child.userData.settingValue;
    const nextBaseColor = isSelected ? 0x245b3b : 0x25313a;
    const nextHoverColor = isSelected ? 0x347f55 : 0x40606a;

    child.userData.baseColor = nextBaseColor;
    child.userData.hoverColor = nextHoverColor;
    if (child !== hoveredControl) {
      child.material.color.setHex(nextBaseColor);
    }
  });
}

function setBrowseSource(source) {
  menuOpen = true;
  settingsOpen = false;
  browseSource = source;
  browsePath = "";
  browseParentPath = null;
  browseOffset = 0;
  browseItems = [];
  browsePanel.visible = true;
  settingsPanel.visible = false;
  browseOpen = true;
  loadBrowseDirectory(source, "");
  markPanelFocused();
}

async function loadBrowseDirectory(source, path) {
  const requestId = ++browseRequestId;
  browseLoading = true;
  markPanelFocused();

  try {
    const params = new URLSearchParams({ source, path });
    const response = await fetch(`/api/browse?${params.toString()}`);
    const data = await response.json();
    if (requestId !== browseRequestId) return;
    browseSource = data.source;
    browsePath = data.path;
    browseParentPath = data.parentPath;
    browseItems = data.items;
    browseOffset = 0;
  } catch {
    if (requestId !== browseRequestId) return;
    browseItems = [];
  } finally {
    if (requestId === browseRequestId) {
      browseLoading = false;
    }
  }
}

function browseBack() {
  if (browseParentPath === null) return;
  loadBrowseDirectory(browseSource, browseParentPath);
}

function scrollBrowse(delta) {
  const pageSize = browseTiles.length;
  const maxOffset = Math.max(0, browseItems.length - pageSize);
  browseOffset = THREE.MathUtils.clamp(browseOffset + delta * 5, 0, maxOffset);
  markPanelFocused();
}

async function activateBrowserItem(itemIndex) {
  const item = browseItems[itemIndex];
  if (!item) return;

  if (item.type === "directory") {
    loadBrowseDirectory(browseSource, item.path);
    return;
  }

  const selected = await fetchVideoMetadata({
    id: item.id,
    filename: item.filename ?? item.name,
    url: item.url,
    source: item.source,
    thumbnailUrl: item.thumbnailUrl,
    projection: item.projection ?? "180_sbs_lr",
  });
  upsertVideo(selected);
  headsetPickerIndex = state.videos.findIndex((videoItem) => videoItem.id === selected.id);
  if (headsetPickerIndex < 0) headsetPickerIndex = 0;
  loadVideoInfo(selected, { autoplay: true });
}

async function fetchVideoMetadata(videoInfo) {
  try {
    const response = await fetch(`/api/video/${encodeURIComponent(videoInfo.id)}`);
    if (!response.ok) return videoInfo;
    const data = await response.json();
    return { ...videoInfo, ...(data.video ?? {}) };
  } catch {
    return videoInfo;
  }
}

function upsertVideo(videoInfo) {
  const index = state.videos.findIndex((item) => item.id === videoInfo.id);
  if (index >= 0) {
    state.videos[index] = { ...state.videos[index], ...videoInfo };
  } else {
    state.videos.push(videoInfo);
  }
}

function updateBrowsePanel() {
  vrPanel.visible = menuOpen && !browseOpen && !settingsOpen;
  browsePanel.visible = menuOpen && browseOpen && !settingsOpen;
  settingsPanel.visible = menuOpen && settingsOpen;
  if (!menuOpen || !browseOpen) return;

  const maxOffset = Math.max(0, browseItems.length - browseTiles.length);
  browseOffset = THREE.MathUtils.clamp(browseOffset, 0, maxOffset);

  const browseLabel = browsePanel.getObjectByName("browseLabel");
  if (browseLabel) {
    const sourceLabel = browseSource === "remote" ? "Remote" : "Local";
    const currentPath = browsePath || "/";
    const position = browseItems.length ? `${browseOffset + 1}-${Math.min(browseOffset + browseTiles.length, browseItems.length)}/${browseItems.length}` : "empty";
    refreshLabel(browseLabel, `${sourceLabel} ${shortenPath(currentPath)} ${position}`);
  }

  for (const tile of browseTiles) {
    const itemIndex = browseOffset + tile.userData.tileIndex;
    const item = browseItems[itemIndex];
    tile.userData.itemIndex = item ? itemIndex : -1;
    tile.userData.baseColor = item?.id === state.selectedVideoId ? 0x24424a : 0x182129;
    tile.visible = Boolean(item);
    if (tile !== hoveredControl) {
      tile.material.color.setHex(tile.userData.baseColor);
    }

    if (!item) {
      updateBrowseThumbnail(tile.userData.tileIndex, null);
      updateBrowseTileLabel(tile.userData.tileIndex, tile.userData.tileIndex === 0 ? getEmptyBrowseLabel() : "");
      continue;
    }

    updateBrowseTileLabel(tile.userData.tileIndex, item.type === "directory" ? shortenBrowseFilename(item.name) : "");
    updateBrowseThumbnail(tile.userData.tileIndex, item.type === "video" ? item.thumbnailUrl : null);
  }
}

function updateBrowseTileLabel(tileIndex, label) {
  const tileLabel = browsePanel.getObjectByName(`browseTileLabel${tileIndex}`);
  if (!tileLabel) return;
  tileLabel.visible = Boolean(label);
  if (label) {
    refreshLabel(tileLabel, label);
  }
}

function updateBrowseThumbnail(rowIndex, thumbnailUrl) {
  const thumbnail = browsePanel.getObjectByName(`browseThumbnail${rowIndex}`);
  if (!thumbnail || thumbnail.userData.currentUrl === thumbnailUrl) return;

  thumbnail.userData.currentUrl = thumbnailUrl;
  thumbnail.visible = Boolean(thumbnailUrl);
  thumbnail.material.map?.dispose();
  thumbnail.material.map = null;
  thumbnail.material.color.setHex(0x0b0f13);
  thumbnail.material.needsUpdate = true;

  if (!thumbnailUrl) return;

  thumbnailLoader.load(
    thumbnailUrl,
    (texture) => {
      if (thumbnail.userData.currentUrl !== thumbnailUrl) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      thumbnail.material.map = texture;
      thumbnail.material.color.setHex(0xffffff);
      thumbnail.material.needsUpdate = true;
    },
    undefined,
    () => {
      if (thumbnail.userData.currentUrl === thumbnailUrl) {
        thumbnail.visible = false;
      }
    },
  );
}

function getEmptyBrowseLabel() {
  if (browseLoading) return "Loading...";
  if (browseSource === "remote") return "No remote videos found";
  return "No local videos found";
}

function getSelectedVideoIndex() {
  const selectedIndex = state.videos.findIndex((item) => item.id === state.selectedVideoId);
  return selectedIndex >= 0 ? selectedIndex : 0;
}

function getPickerLabel() {
  if (desktopActive) return "Desktop Live";
  if (state.videos.length === 0) return "No videos found";
  const picked = state.videos[headsetPickerIndex] ?? state.videos[0];
  return picked.filename ?? "No video";
}

function getProjectionLabel() {
  if (desktopActive) {
    return DESKTOP_PROJECTION_MODES.find((mode) => mode.value === desktopProjection)?.label ?? "Flat";
  }
  return PROJECTION_MODES.find((mode) => mode.value === state.projection)?.label ?? "180";
}

function getBitrateLabel() {
  if (!desktopActive) return "Net --";
  if (desktopReceiveBitrateBps <= 0) return "Net wait";
  const fps = desktopDecodedFps > 0 ? ` ${Math.round(desktopDecodedFps)}fps` : "";
  return `${formatNetworkBitrate(desktopReceiveBitrateBps)}${fps}`;
}

function shortenBrowseFilename(filename) {
  return filename.length > 64 ? `${filename.slice(0, 30)}...${filename.slice(-29)}` : filename;
}

function shortenPath(path) {
  if (path === "/") return "/";
  return path.length > 28 ? `.../${path.slice(-24)}` : path;
}

function refreshLabel(mesh, label) {
  if (mesh.userData.currentLabel === label) return;
  mesh.userData.currentLabel = label;
  const canvas = mesh.material.map.image;
  const context = canvas.getContext("2d");
  drawCanvasLabel(context, canvas, label);
  mesh.material.map.needsUpdate = true;
}

function drawCanvasLabel(context, canvas, label) {
  context.fillStyle = "#25313a";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#f2f5f7";
  const baseFontSize = 42;
  let fontSize = baseFontSize;
  context.font = `bold ${fontSize}px system-ui, sans-serif`;
  const maxWidth = canvas.width - 24;
  while (fontSize > 16 && context.measureText(label).width > maxWidth) {
    fontSize -= 2;
    context.font = `bold ${fontSize}px system-ui, sans-serif`;
  }
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, canvas.width / 2, canvas.height / 2);
}

function sendWsMessage(message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

const sendHeadsetState = () => {
  if (ws.readyState !== WebSocket.OPEN) return;
  updateDiagnostics();
  ws.send(
    JSON.stringify({
      type: "headset-state",
      currentTime: video.currentTime || 0,
      playing: !video.paused,
    }),
  );
};

function setStatus(message) {
  status.textContent = message;
  updateDiagnostics();
}

function updateDiagnostics() {
  updateDesktopStats();
  const selected = state.videos.find((item) => item.id === state.selectedVideoId);
  diagnostics.textContent = [
    `video: ${desktopActive ? "Desktop Live" : selected?.filename ?? "none"}`,
    `source: ${desktopActive ? "webrtc" : formatVideoSourceLabel(selected)}`,
    `projection: ${desktopActive ? `desktop ${desktopProjection}` : state.projection}`,
    `layer/fps: ${mediaLayerStatus} / ${getVideoFrameRateLabel()}`,
    `webrtc: ${desktopPeer?.connectionState ?? "none"}`,
    `ice/signaling: ${desktopPeer?.iceConnectionState ?? "none"} / ${desktopPeer?.signalingState ?? "none"}`,
    `desktop signaling: ${desktopSignalingStatus}`,
    `desktop track: ${desktopTrackStatus}`,
    `desktop video: ${desktopVideoStatus}`,
    `desktop stats: ${desktopStatsStatus}`,
    `ready/network: ${video.readyState}/${video.networkState}`,
    `buffer: ${getBufferedAheadLabel()}`,
    `quality: ${getVideoQualityLabel()}`,
    `paused: ${video.paused}`,
    `time: ${(video.currentTime || 0).toFixed(2)} / ${(video.duration || 0).toFixed(2)}`,
    `decoded: ${video.videoWidth || 0}x${video.videoHeight || 0}`,
    `xr input: ${xrInputSummary.join(", ")}`,
    `menu: ${menuOpen ? "open" : "closed"}`,
    `tilt/height: ${Math.round(THREE.MathUtils.radToDeg(videoTiltOffset))} deg / ${videoHeightOffset.toFixed(2)}m`,
    `zoom: ${projectionZoom.toFixed(1)}x / sbs ${flatSbsZoom.toFixed(1)}x`,
    `desktop view: ${desktopView.distance.toFixed(1)}m, ${Math.round(desktopView.pitchDeg)} deg pitch`,
    `error: ${video.error ? `${video.error.code} ${video.error.message}` : "none"}`,
  ].join("\n");
}

function formatVideoSourceLabel(selected) {
  if (!selected) return "none";
  const parts = [selected.sourceLabel ?? selected.source ?? "video"];
  if (selected.codec) parts.push(selected.codec);
  if (selected.width && selected.height) parts.push(`${selected.width}x${selected.height}`);
  if (selected.fps) parts.push(`${Number(selected.fps).toFixed(2)}fps`);
  if (selected.bitrate) parts.push(formatNetworkBitrate(selected.bitrate));
  if (selected.size) parts.push(formatBytes(selected.size));
  return parts.join(" ");
}

function getBufferedAheadLabel() {
  const currentTime = video.currentTime || 0;
  for (let index = 0; index < video.buffered.length; index += 1) {
    if (video.buffered.start(index) <= currentTime && currentTime <= video.buffered.end(index)) {
      return `${Math.max(0, video.buffered.end(index) - currentTime).toFixed(1)}s`;
    }
  }
  return "0.0s";
}

function getVideoQualityLabel() {
  if (!video.getVideoPlaybackQuality) return "unsupported";
  const quality = video.getVideoPlaybackQuality();
  const parts = [`total ${quality.totalVideoFrames ?? 0}`];
  parts.push(`dropped ${quality.droppedVideoFrames ?? 0}`);
  if (quality.corruptedVideoFrames) parts.push(`corrupt ${quality.corruptedVideoFrames}`);
  return parts.join(", ");
}

function getVideoFrameRateLabel() {
  return Number.isFinite(settings.videoFrameRate) ? `${settings.videoFrameRate} upload` : "native";
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function maybeUpdateDiagnostics() {
  const now = performance.now();
  if (now - lastDiagnosticsRenderAt < 250) return;
  lastDiagnosticsRenderAt = now;
  updateDiagnostics();
}

function formatDuration(value) {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

function throttle(fn, wait) {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn();
    }
  };
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  maybeUpdateDiagnostics();
  updateVrControls();
  renderer.render(scene, camera);
});

loadVideos();
