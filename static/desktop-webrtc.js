const SDP_LINE_ENDING = "\r\n";
const GOOGLE_BITRATE_CODECS = new Set(["AV1", "H264", "VP8", "VP9"]);
const DESKTOP_CONTENT_HINTS = new Set(["motion", "detail", "text"]);

export function getDesktopBitratePlan(settings = {}) {
  const maxMbps = Number(settings.bitrate_mbps);
  if (!Number.isFinite(maxMbps) || maxMbps <= 0) return null;

  const maxKbps = Math.max(1, Math.round(maxMbps * 1000));
  const minKbps = Math.min(maxKbps, Math.max(1000, Math.round(maxKbps * 0.25)));
  return {
    maxBps: maxKbps * 1000,
    maxKbps,
    minKbps,
    startKbps: maxKbps,
  };
}

export function getDesktopContentHint(settings = {}) {
  const configured = String(settings.content_hint ?? "auto");
  if (DESKTOP_CONTENT_HINTS.has(configured)) return configured;

  const bitrate = Number(settings.bitrate_mbps);
  const fps = Number(settings.fps);
  return bitrate >= 50 || fps >= 50 ? "motion" : "detail";
}

export function applyDesktopBitrateSdp(sdp, settings = {}) {
  const plan = getDesktopBitratePlan(settings);
  if (!sdp || !plan) return sdp;

  const sections = splitSdpSections(sdp);
  const tuned = sections.map((section) => (section[0]?.startsWith("m=video ") ? tuneVideoSection(section, plan) : section));
  return tuned.flat().join(SDP_LINE_ENDING) + SDP_LINE_ENDING;
}

export function formatNetworkBitrate(bitsPerSecond) {
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return "-- Mbps";
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

function splitSdpSections(sdp) {
  const lines = sdp.trim().split(/\r\n|\n/);
  const sections = [];
  let current = [];

  for (const line of lines) {
    if (line.startsWith("m=") && current.length) {
      sections.push(current);
      current = [];
    }
    current.push(line);
  }

  if (current.length) sections.push(current);
  return sections;
}

function tuneVideoSection(section, plan) {
  let tuned = section.filter((line) => !line.startsWith("b=AS:") && !line.startsWith("b=TIAS:"));
  const bandwidthInsertAt = Math.max(tuned.findIndex((line) => line.startsWith("c=")), 0) + 1;
  tuned.splice(bandwidthInsertAt, 0, `b=AS:${plan.maxKbps}`, `b=TIAS:${plan.maxBps}`);

  const codecPayloadTypes = findGoogleBitratePayloadTypes(tuned);
  const bitrateParams = [
    `x-google-start-bitrate=${plan.startKbps}`,
    `x-google-min-bitrate=${plan.minKbps}`,
    `x-google-max-bitrate=${plan.maxKbps}`,
  ];

  for (const payloadType of codecPayloadTypes) {
    tuned = upsertFmtpParams(tuned, payloadType, bitrateParams);
  }

  return tuned;
}

function findGoogleBitratePayloadTypes(section) {
  const payloadTypes = [];

  for (const line of section) {
    const match = line.match(/^a=rtpmap:(\d+) ([^/]+)/i);
    if (!match) continue;

    const codec = match[2].toUpperCase();
    if (GOOGLE_BITRATE_CODECS.has(codec)) {
      payloadTypes.push(match[1]);
    }
  }

  return payloadTypes;
}

function upsertFmtpParams(section, payloadType, params) {
  const fmtpPrefix = `a=fmtp:${payloadType}`;
  const fmtpIndex = section.findIndex((line) => line.startsWith(`${fmtpPrefix} `));

  if (fmtpIndex >= 0) {
    const line = section[fmtpIndex];
    const firstSpace = line.indexOf(" ");
    const existingParams = firstSpace >= 0 ? line.slice(firstSpace + 1).split(";") : [];
    const filteredParams = existingParams
      .map((param) => param.trim())
      .filter((param) => param && !param.startsWith("x-google-start-bitrate=") && !param.startsWith("x-google-min-bitrate=") && !param.startsWith("x-google-max-bitrate="));
    section[fmtpIndex] = `${fmtpPrefix} ${[...filteredParams, ...params].join(";")}`;
    return section;
  }

  const rtpmapIndex = section.findIndex((line) => line.startsWith(`a=rtpmap:${payloadType} `));
  if (rtpmapIndex >= 0) {
    section.splice(rtpmapIndex + 1, 0, `${fmtpPrefix} ${params.join(";")}`);
  }
  return section;
}
