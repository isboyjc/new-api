// MuleRouter is a multimodal aggregation gateway. Its CarrotHub W3.0 endpoints
// serve the all-in-one Wan 3.0 video model: text-to-video, keyframe
// image-to-video and reference-to-video behind one flat request body, with one
// generation path per model.
//
// The plugin claims host protocols only and registers no native routes, so the
// upstream generation URLs never reach a client and the vendor result URL stays
// inside buildContentRequest, which the gateway proxies.
//
// The task envelope carries no usage statistics, so the seconds upstream bills
// are measured instead: the host probes the reference clips before the request
// is sent, and the produced clip once it exists. See billableSeconds.

const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"];
const PRO_VIDEO_RESOLUTIONS = ["1080p", "2k", "4k"];

// Every model is addressed as /vendors/<vendor>/v1/<model>/generation. The
// W3.0 family is served by carrothub; other MuleRouter models (flashvsr) carry
// their own vendor, so it stays part of the model table.
const VIDEO_MODELS = {
  "w3.0-video": { vendor: "carrothub", resolutions: VIDEO_RESOLUTIONS },
  "w3.0-video-prime": { vendor: "carrothub", resolutions: VIDEO_RESOLUTIONS },
  "w3.0-video-pro": { vendor: "carrothub", resolutions: PRO_VIDEO_RESOLUTIONS },
  "w3.0-video-prime-pro": { vendor: "carrothub", resolutions: PRO_VIDEO_RESOLUTIONS },
};

// Vendor list prices in USD per billed second, used only to derive the legacy
// per-call resolution ratios relative to each model's cheapest tier. Source:
// https://mulerouter.ai/docs/api-reference/endpoint/carrothub (2026-09).
const USD_PER_SECOND = {
  "w3.0-video": { "480p": 0.05, "720p": 0.1, "1080p": 0.2 },
  "w3.0-video-prime": { "480p": 0.068, "720p": 0.14, "1080p": 0.28 },
  "w3.0-video-pro": { "1080p": 0.18, "2k": 0.2, "4k": 0.23 },
  "w3.0-video-prime-pro": { "1080p": 0.26, "2k": 0.28, "4k": 0.31 },
};

const RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"];
const DEFAULT_RESOLUTION = "1080p";
const DEFAULT_RATIO = "adaptive";
const DEFAULT_DURATION = 5;
const MIN_DURATION = 2;
const MAX_DURATION = 30;
// Upstream picks the length from the prompt and the input media; a request
// cannot bound it in advance.
const SMART_DURATION = -1;
// Billed duration is input video seconds plus output video seconds, and
// upstream caps the total at 30s. A request whose billable length is not fixed
// at submission reserves that ceiling.
const MAX_BILLED_SECONDS = 30;
const MAX_SEED = 2147483647;
const MAX_REFERENCE_IMAGES = 10;
const MAX_REFERENCE_VIDEOS = 5;
// Reference videos bill their own seconds, and upstream caps their combined
// length, which bounds the input side of a reservation.
const MAX_REFERENCE_VIDEO_SECONDS = 15;
const MAX_REFERENCE_AUDIOS = 5;
// Upstream rejects input images above 20MB.
const MAX_INPUT_IMAGE_BYTES = 20971520;

// Usage facts follow the model's capability table so pricing lists only the
// resolution tiers that model offers.
function videoUsageSchema(resolutions) {
  const resolutionLabels = {};
  for (const resolution of resolutions) resolutionLabels[resolution] = { en: resolution, zh: resolution };
  return {
    // Billable seconds: input video duration plus output video duration.
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Video generation unit price", zh: "视频生成单价" },
    },
    // Requested output video resolution.
    resolution: {
      enum: resolutions,
      enumLabels: resolutionLabels,
      description: { en: "Output video resolution", zh: "输出视频分辨率" },
    },
  };
}

function videoUsageExamples(resolutions) {
  const cheapest = resolutions[0];
  const dearest = resolutions[resolutions.length - 1];
  return [
    { label: cheapest + " · 5s", facts: { seconds: 5, resolution: cheapest } },
    { label: dearest + " · 10s", facts: { seconds: 10, resolution: dearest } },
  ];
}

// One usage profile per distinct resolution set.
function videoUsageProfiles() {
  const profiles = [];
  for (const model of Object.keys(VIDEO_MODELS)) {
    const resolutions = VIDEO_MODELS[model].resolutions;
    let profile = profiles.find((entry) => entry.schema.resolution.enum === resolutions);
    if (!profile) {
      profile = { models: [], schema: videoUsageSchema(resolutions), examples: videoUsageExamples(resolutions) };
      profiles.push(profile);
    }
    profile.models.push(model);
  }
  return profiles;
}

export const meta = {
  apiVersion: 1,
  // The key is the only manifest field an end user ever sees: it is stored as
  // the task platform and shown in their task log. Everything else here is
  // root-only, so it names the upstream plainly for whoever maintains this.
  key: "mr-aoso",
  name: "MR (Aoso AI)",
  description: {
    en: "MuleRouter aggregated generation (CarrotHub W3.0 all-in-one video)",
    zh: "MuleRouter 聚合生成（CarrotHub W3.0 全能视频）",
  },
  version: "1.0.0",
  author: { name: "aoso.ai" },
  baseUrl: "https://api.mulerouter.ai",
  // Literal metadata also supports the dashboard's static script preview.
  models: ["w3.0-video", "w3.0-video-prime", "w3.0-video-pro", "w3.0-video-prime-pro"],
  fetchMode: "per_task",
  requiredCapabilities: ["media-probe@1"],
  usageSchema: videoUsageSchema(VIDEO_RESOLUTIONS),
  usageExamples: videoUsageExamples(VIDEO_RESOLUTIONS),
  usageProfiles: videoUsageProfiles(),
  protocols: [
    { name: "openai_responses", supports: ["stream", "sync", "background"] },
    "openai_video",
  ],
};

function trimmed(value) {
  return String(value || "").trim();
}

function isFilePlaceholder(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.__fileRef);
}

// The vendor image cap is the plugin's to enforce, so a client-supplied
// maxBytes never widens it.
function filePlaceholder(value) {
  const placeholder = { __fileRef: value.__fileRef, encoding: value.encoding === "base64" ? "base64" : "dataUrl", maxBytes: MAX_INPUT_IMAGE_BYTES };
  if (value.mimeType) placeholder.mimeType = value.mimeType;
  return placeholder;
}

// Image inputs accept a URL, a data URI or bare Base64, plus multipart uploads
// the host inlines. Upstream owns the format and dimension rules.
function mediaValue(value, field) {
  if (isFilePlaceholder(value)) return filePlaceholder(value);
  if (value !== null && typeof value === "object") throw new Error((field || "media input") + " must be a URL, a data URI or a Base64 string");
  return trimmed(value);
}

function mediaArray(value, field, limit) {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) throw new Error(field + " must be an array");
  const items = [];
  for (const item of value) {
    const media = mediaValue(item, field);
    if (media) items.push(media);
  }
  if (items.length > limit) throw new Error(field + " accepts at most " + limit + " items");
  return items;
}

// A 100MB video would inflate the request body past any practical limit, so
// upstream takes videos and audios as URLs only.
function urlArray(value, field, limit) {
  const items = mediaArray(value, field, limit);
  for (const item of items) {
    if (typeof item !== "string" || !/^https?:\/\//i.test(item))
      throw new Error(field + " must contain public HTTP or HTTPS URLs; Base64 is not accepted");
  }
  return items;
}

function requireHttpURL(value, field) {
  if (!/^https?:\/\//i.test(value)) throw new Error(field + " must be a public HTTP or HTTPS URL");
}

function booleanValue(value, field) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(field + " must be true or false");
}

function videoDuration(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_DURATION;
  const duration = Number(value);
  if (duration === SMART_DURATION) return SMART_DURATION;
  if (!Number.isInteger(duration) || duration < MIN_DURATION || duration > MAX_DURATION)
    throw new Error("duration must be -1 (smart duration) or an integer between " + MIN_DURATION + " and " + MAX_DURATION);
  return duration;
}

// Unlike Bailian, MuleRouter has no -1 sentinel for a random seed.
function videoSeed(value) {
  if (value === undefined || value === null || value === "") return null;
  const seed = Number(value);
  if (seed === -1) throw new Error("seed -1 is not supported; omit seed for a random seed");
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new Error("seed must be an integer between 0 and " + MAX_SEED);
  return seed;
}

function modelFor(ctx, req) {
  const model = trimmed((ctx && (ctx.upstreamModel || ctx.model)) || (req && req.model));
  if (!VIDEO_MODELS[model]) throw new Error("unsupported model: " + (model || "(empty)"));
  return model;
}

// One normalizer for every client surface, so the OpenAI protocols and the
// billing estimate see exactly the vendor body that is submitted.
function convert(ctx) {
  const req = ctx.requestBody;
  if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
  const model = modelFor(ctx, req);
  const profile = VIDEO_MODELS[model];

  const prompt = trimmed(req.prompt);
  const firstFrame = mediaValue(req.first_frame, "first_frame");
  const lastFrame = mediaValue(req.last_frame, "last_frame");
  const referenceImages = mediaArray(req.reference_images, "reference_images", MAX_REFERENCE_IMAGES);
  const referenceVideos = urlArray(req.reference_videos, "reference_videos", MAX_REFERENCE_VIDEOS);
  const referenceAudios = urlArray(req.reference_audios, "reference_audios", MAX_REFERENCE_AUDIOS);
  const file = trimmed(req.file);
  const link = trimmed(req.link);

  const keyframes = Boolean(firstFrame || lastFrame);
  const references = Boolean(referenceImages.length || referenceVideos.length || referenceAudios.length || file || link);
  if (keyframes && references)
    throw new Error(
      "cannot mix the keyframe mode (first_frame / last_frame) with the reference mode (reference_images / reference_videos / reference_audios / file / link)"
    );
  if (file && link) throw new Error("file and link cannot be combined");
  if (file) requireHttpURL(file, "file");
  if (link) requireHttpURL(link, "link");
  if (!prompt && !keyframes && !references) throw new Error("prompt or at least one media input is required");

  const body = {};
  if (prompt) body.prompt = prompt;
  if (firstFrame) body.first_frame = firstFrame;
  if (lastFrame) body.last_frame = lastFrame;
  if (referenceImages.length) body.reference_images = referenceImages;
  if (referenceVideos.length) body.reference_videos = referenceVideos;
  if (referenceAudios.length) body.reference_audios = referenceAudios;
  if (file) body.file = file;
  if (link) body.link = link;

  const resolution = trimmed(req.resolution).toLowerCase() || DEFAULT_RESOLUTION;
  if (!profile.resolutions.includes(resolution)) throw new Error(model + " resolution must be one of " + profile.resolutions.join(", "));
  body.resolution = resolution;

  const ratio = trimmed(req.ratio).toLowerCase() || DEFAULT_RATIO;
  if (!RATIOS.includes(ratio)) throw new Error("ratio must be one of " + RATIOS.join(", "));
  body.ratio = ratio;

  body.duration = videoDuration(req.duration);
  if (req.audio !== undefined && req.audio !== null && req.audio !== "") body.audio = booleanValue(req.audio, "audio");
  if (req.prompt_extend !== undefined && req.prompt_extend !== null && req.prompt_extend !== "")
    body.prompt_extend = booleanValue(req.prompt_extend, "prompt_extend");
  const seed = videoSeed(req.seed);
  if (seed !== null) body.seed = seed;

  return { model: model, body: body };
}

function videoAction(body) {
  if (body.first_frame || body.last_frame) return "image_to_video";
  if (body.reference_images || body.reference_videos || body.reference_audios || body.file || body.link) return "reference_to_video";
  return "text_to_video";
}

const PROBE_INPUT_PREFIX = "ref-";
const PROBE_OUTPUT_KEY = "output";

function probedSeconds(media, key) {
  const entry = media && media[key];
  const seconds = entry && Number(entry.seconds);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

// Upstream bills the seconds inside the reference videos as well as the seconds
// it produces, and reports neither back, so the host measures the clips before
// the request is sent. An unmeasured clip is refused rather than billed at the
// upstream limit: the reservation would stand at several times the real cost
// with nothing to settle it, and a clip this gateway cannot fetch is usually
// one upstream cannot fetch either.
function inputSeconds(body, media, strict) {
  const urls = body.reference_videos || [];
  if (!urls.length) return 0;
  let total = 0;
  for (let index = 0; index < urls.length; index++) {
    const seconds = probedSeconds(media, PROBE_INPUT_PREFIX + index);
    if (seconds === null) {
      if (strict)
        throw new Error(
          "could not read the duration of reference_videos[" +
            index +
            "]; it must be a publicly reachable mp4 or mov URL, and reference video seconds are billed"
        );
      return MAX_REFERENCE_VIDEO_SECONDS;
    }
    total += seconds;
  }
  return Math.min(total, MAX_REFERENCE_VIDEO_SECONDS);
}

// The output side is the requested duration. Smart duration leaves it to
// upstream, so a submission can only reserve the ceiling; the produced clip is
// measured at completion and settles the difference.
function billableSeconds(body, media, strict) {
  const output = body.duration === SMART_DURATION ? MAX_BILLED_SECONDS : body.duration;
  return Math.min(MAX_BILLED_SECONDS, output + inputSeconds(body, media, strict));
}

function resolutionRatio(model, resolution) {
  const rates = USD_PER_SECOND[model];
  if (!rates) return null;
  const base = rates[VIDEO_MODELS[model].resolutions[0]];
  const rate = rates[resolution];
  if (!base || !rate) return null;
  return rate / base;
}

function apiRoot(ctx) {
  return trimmed(ctx.baseUrl).replace(/\/+$/, "");
}

function generationURL(ctx, model) {
  return apiRoot(ctx) + "/vendors/" + VIDEO_MODELS[model].vendor + "/v1/" + model + "/generation";
}

// The vendor issues two credential kinds and refuses each on the other's
// endpoints: an inference key that generates, and an account key that only
// reads the account. One channel holds both as `<inference key>|<account key>`,
// the same shape other plugins here use for multi-part credentials.
function inferenceKey(ctx) {
  const key = trimmed(ctx.apiKey) || trimmed(ctx.authHeader);
  const separator = key.indexOf("|");
  return separator === -1 ? key : key.slice(0, separator).trim();
}

function accountKey(ctx) {
  const key = trimmed(ctx.apiKey) || trimmed(ctx.authHeader);
  const separator = key.indexOf("|");
  return separator === -1 ? "" : key.slice(separator + 1).trim();
}

// For an api_key plugin the host puts the bare channel key in authHeader, so
// the scheme is the plugin's to add. Only prepend it when it is missing.
function authorization(ctx) {
  const key = inferenceKey(ctx);
  return /^bearer\s/i.test(key) ? key : "Bearer " + key;
}

// The create response nests its failure in task_info.error while the task
// envelope documents a top-level error; accept both.
function taskError(body) {
  const info = (body && body.task_info) || {};
  const error = info.error || (body && body.error);
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  const code = error.code === undefined ? error.error_code : error.code;
  const text = [trimmed(error.title), trimmed(error.detail) || trimmed(error.message)].filter(Boolean).join(": ");
  const prefix = code === undefined || code === null || code === "" ? "" : "[" + code + "] ";
  return trimmed(prefix + text);
}

// The endpoint reference documents the result as `videos[]`, while the shared
// call-flow documentation points at `output.url`. Read both rather than betting
// on one: a result that cannot be located fails a task upstream already billed.
function videoURL(body) {
  const output = (body && body.output) || {};
  for (const candidate of [body && body.videos, output.videos]) {
    for (const video of Array.isArray(candidate) ? candidate : []) {
      const url = trimmed(typeof video === "string" ? video : video && video.url);
      if (url) return url;
    }
  }
  return trimmed(output.url) || trimmed(output.video_url) || trimmed(body && body.video_url) || trimmed(body && body.url);
}

export function buildSubmitRequest(ctx) {
  const converted = convert(ctx);
  // Refuse here rather than in the usage hook: this runs before any quota is
  // reserved and reports the offending field to the caller.
  inputSeconds(converted.body, ctx.media, true);
  return {
    url: generationURL(ctx, converted.model),
    method: "POST",
    headers: { Authorization: authorization(ctx), "Content-Type": "application/json", Accept: "application/json" },
    body: converted.body,
    action: videoAction(converted.body),
  };
}

// The host hands every status code to this hook, and a rejected payload comes
// back as 400 carrying the task envelope with an error object.
export function parseSubmitResponse(ctx, resp) {
  const body = resp.body || {};
  const info = body.task_info || {};
  const failure = taskError(body);
  if (failure) throw new Error(failure);
  if (trimmed(info.status).toLowerCase() === "failed") throw new Error("upstream rejected the generation request");
  const status = Number(resp.statusCode);
  if (Number.isFinite(status) && status >= 400) throw new Error("upstream returned HTTP " + status);
  if (!trimmed(info.id)) throw new Error("task_info.id is empty");
  // The measured input seconds cannot be recovered at completion, and whether
  // upstream chose the length decides if the produced clip is worth measuring.
  const converted = convert(ctx);
  const state = {
    input_seconds: inputSeconds(converted.body, ctx.media),
    smart_duration: converted.body.duration === SMART_DURATION,
  };
  return { taskId: trimmed(info.id), taskData: body, state: state };
}

export function extractUsage(ctx) {
  const converted = convert(ctx);
  const seconds = billableSeconds(converted.body, ctx.media);
  const resolution = converted.body.resolution;
  if (ctx.usagePurpose === "billing_ratios") {
    const ratios = { seconds: seconds };
    const rate = resolutionRatio(converted.model, resolution);
    if (rate !== null) ratios["resolution-" + resolution] = rate;
    return ratios;
  }
  return { seconds: seconds, resolution: resolution };
}

export function buildQueryRequest(ctx) {
  return {
    url: generationURL(ctx, modelFor(ctx)) + "/" + ctx.taskId,
    method: "GET",
    headers: { Accept: "application/json", Authorization: authorization(ctx) },
  };
}

// The endpoint reference and the shared task documentation disagree on the
// status vocabulary, and a task that is being retried reports a fifth value,
// so every documented spelling maps here.
const TASK_STATUSES = {
  queued: "QUEUED",
  pending: "QUEUED",
  running: "IN_PROGRESS",
  processing: "IN_PROGRESS",
  retrying: "IN_PROGRESS",
  succeeded: "SUCCESS",
  completed: "SUCCESS",
  failed: "FAILURE",
  canceled: "FAILURE",
  cancelled: "FAILURE",
};

export function parseTaskResult(ctx, body) {
  const info = (body && body.task_info) || {};
  const reported = (trimmed(info.status) || trimmed(body && body.status)).toLowerCase();
  const status = TASK_STATUSES[reported];
  if (!status) return { status: "UNKNOWN", reason: "unrecognized status: " + (reported || "(empty)") };
  // A failed task is reported inside a 200 response, so the host cannot
  // classify it from the HTTP status.
  if (status === "FAILURE") return { status: "FAILURE", reason: taskError(body) || "task failed" };
  if (status !== "SUCCESS") return { status: status };
  const url = videoURL(body);
  if (!url) return { status: "FAILURE", reason: "task succeeded without a video" };
  return { status: "SUCCESS", url: url };
}

// Upstream reports no usage, so the only settleable quantity is the length of
// the clip it produced, and that only matters when the request let upstream
// choose it. A requested duration is already exact, and an unmeasurable clip
// keeps the reservation rather than guessing.
export function extractUsageOnComplete(task, _taskResult, _body) {
  const state = (task && task.state) || {};
  if (state.smart_duration !== true) return null;
  const output = probedSeconds(task && task.media, PROBE_OUTPUT_KEY);
  if (output === null) return null;
  const input = Number(state.input_seconds);
  const inputTotal = Number.isFinite(input) && input >= 0 ? Math.min(input, MAX_REFERENCE_VIDEO_SECONDS) : MAX_REFERENCE_VIDEO_SECONDS;
  return { seconds: Math.min(MAX_BILLED_SECONDS, inputTotal + output) };
}

// The host measures what this names: the reference clips while the request is
// still being prepared, and the produced clip at completion.
export function listProbeMedia(ctx) {
  if (ctx && ctx.requestBody) {
    // Index the normalized list, not the raw one: billing reads the same keys
    // back from the converted body, and a blank entry there shifts every index.
    let urls;
    try {
      urls = convert(ctx).body.reference_videos;
    } catch (error) {
      // An invalid request fails later with its own message; probing stays quiet.
      return [];
    }
    if (!Array.isArray(urls)) return [];
    const wanted = [];
    for (let index = 0; index < urls.length; index++) {
      wanted.push({ key: PROBE_INPUT_PREFIX + index, url: urls[index], maxSeconds: MAX_REFERENCE_VIDEO_SECONDS });
    }
    return wanted;
  }
  // Completion: a requested duration needs no measurement.
  if (!ctx || !ctx.state || ctx.state.smart_duration !== true) return [];
  const url = videoURL(ctx.data);
  return url ? [{ key: PROBE_OUTPUT_KEY, url: url, maxSeconds: MAX_BILLED_SECONDS }] : [];
}

// Balance is read with the account key only. Returning nothing leaves the
// channel on the host's "not supported" answer, which matters because a
// balance of zero disables a channel.
export function buildBalanceRequest(ctx) {
  const account = accountKey(ctx);
  if (!account) return null;
  return {
    url: apiRoot(ctx) + "/user/billing/balance",
    method: "GET",
    headers: { Authorization: "Bearer " + account, Accept: "application/json" },
  };
}

// The vendor reports balances in millionths of a US dollar; the channel column
// holds dollars.
export function parseBalance(ctx, body) {
  const available = Number(body && body.available_balance);
  if (!Number.isFinite(available) || available < 0) throw new Error("upstream returned no usable balance");
  return { balance: available / 1000000 };
}

export function listArtifacts(task) {
  return task.status === "SUCCESS" && videoURL(task.data) ? [{ key: "video", type: "video" }] : [];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  const url = videoURL(ctx.data);
  if (!url) throw new Error("artifact_not_found");
  return { url: url, method: ctx.clientRequest.method, credentialless: true };
}

const VIDEO_SIZES = {
  "832x480": { resolution: "480p", ratio: "16:9" },
  "854x480": { resolution: "480p", ratio: "16:9" },
  "480x832": { resolution: "480p", ratio: "9:16" },
  "480x854": { resolution: "480p", ratio: "9:16" },
  "640x480": { resolution: "480p", ratio: "4:3" },
  "480x640": { resolution: "480p", ratio: "3:4" },
  "480x480": { resolution: "480p", ratio: "1:1" },
  "1280x720": { resolution: "720p", ratio: "16:9" },
  "720x1280": { resolution: "720p", ratio: "9:16" },
  "960x720": { resolution: "720p", ratio: "4:3" },
  "720x960": { resolution: "720p", ratio: "3:4" },
  "720x720": { resolution: "720p", ratio: "1:1" },
  "1920x1080": { resolution: "1080p", ratio: "16:9" },
  "1080x1920": { resolution: "1080p", ratio: "9:16" },
  "1440x1080": { resolution: "1080p", ratio: "4:3" },
  "1080x1440": { resolution: "1080p", ratio: "3:4" },
  "1080x1080": { resolution: "1080p", ratio: "1:1" },
  "2560x1440": { resolution: "2k", ratio: "16:9" },
  "1440x2560": { resolution: "2k", ratio: "9:16" },
  "3840x2160": { resolution: "4k", ratio: "16:9" },
  "2160x3840": { resolution: "4k", ratio: "9:16" },
};

function videoSize(value) {
  const size = trimmed(value).toLowerCase().replace(/\*/g, "x");
  if (!size.includes("x")) {
    if (!VIDEO_RESOLUTIONS.includes(size) && !PRO_VIDEO_RESOLUTIONS.includes(size)) throw new Error("invalid size: " + trimmed(value));
    return { resolution: size, ratio: "" };
  }
  const mapped = VIDEO_SIZES[size];
  if (!mapped) throw new Error("invalid size: " + trimmed(value));
  return mapped;
}

// OpenAI's video fields are accepted as aliases for the vendor ones; every
// other W3.0 field is read from the request top level unchanged.
function normalizeVideoRequest(req) {
  const normalized = Object.assign({}, req);
  if (normalized.seconds !== undefined) {
    if (normalized.duration === undefined) normalized.duration = normalized.seconds;
    delete normalized.seconds;
  }
  if (trimmed(normalized.size)) {
    const size = videoSize(normalized.size);
    if (normalized.resolution === undefined) normalized.resolution = size.resolution;
    if (normalized.ratio === undefined && size.ratio) normalized.ratio = size.ratio;
  }
  delete normalized.size;
  // `image` is the field the vendor's own quickstart sends for a single input
  // picture, and OpenAI clients send `input_reference` for the same thing.
  for (const alias of ["input_reference", "image"]) {
    if (normalized[alias] === undefined) continue;
    if (normalized.first_frame === undefined && mediaValue(normalized[alias])) normalized.first_frame = normalized[alias];
    delete normalized[alias];
  }
  return normalized;
}

// One image is the opening frame, two are the opening and closing frames, and
// more than a keyframe pair can hold become reference images. Media the client
// addressed by its vendor field name is left exactly as it was sent.
function applyPromptImages(requestBody, prompt, images) {
  if (prompt) requestBody.prompt = prompt;
  const addressed =
    requestBody.first_frame !== undefined ||
    requestBody.last_frame !== undefined ||
    requestBody.reference_images !== undefined ||
    requestBody.reference_videos !== undefined ||
    requestBody.reference_audios !== undefined ||
    requestBody.file !== undefined ||
    requestBody.link !== undefined;
  if (addressed || !images.length) return requestBody;
  if (images.length === 1) requestBody.first_frame = images[0];
  else if (images.length === 2) {
    requestBody.first_frame = images[0];
    requestBody.last_frame = images[1];
  } else requestBody.reference_images = images;
  return requestBody;
}

function responsesInput(req) {
  const texts = [],
    images = [];
  const input = req.input;
  if (typeof input === "string") texts.push(input);
  else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") {
        texts.push(item);
        continue;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const content = item.content === undefined ? [item] : Array.isArray(item.content) ? item.content : [item.content];
      for (const part of content) {
        if (typeof part === "string") {
          texts.push(part);
          continue;
        }
        if (!part || typeof part !== "object" || Array.isArray(part)) continue;
        if (["input_text", "text"].includes(part.type) && typeof part.text === "string") texts.push(part.text);
        if (["input_image", "image_url"].includes(part.type)) {
          let image = part.image_url;
          if (image && typeof image === "object") image = image.url;
          if (trimmed(image)) images.push(trimmed(image));
        }
      }
    }
  }
  return {
    prompt: texts
      .filter(function (text) {
        return trimmed(text);
      })
      .join("\n"),
    images: images,
  };
}

function responsesVideoText(ctx) {
  const artifact = ctx && ctx.artifacts && ctx.artifacts.video;
  const url = trimmed(artifact && artifact.url);
  if (!url) throw new Error("video artifact is unavailable");
  const escaped = url
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return '<video controls src="' + escaped + '"></video>';
}

export const protocols = {
  openai_responses: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = ctx.body.value;
      if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
      const model = trimmed(ctx.model);
      if (!model) throw new Error("model is required");
      if (req.input !== undefined && typeof req.input !== "string" && !Array.isArray(req.input)) throw new Error("input must be a string or array");
      if (req.images !== undefined && !Array.isArray(req.images)) throw new Error("images must be an array");
      const input = responsesInput(req);
      const prompt = input.prompt || trimmed(req.prompt);
      const images = [];
      for (const image of [req.image, req.input_reference].concat(req.images || [], input.images)) {
        if (trimmed(image) && !images.includes(trimmed(image))) images.push(trimmed(image));
      }
      const requestBody = normalizeVideoRequest(Object.assign({}, req, { model: model }));
      delete requestBody.input;
      delete requestBody.images;
      delete requestBody.image;
      applyPromptImages(requestBody, prompt, images);
      // Model-dependent validation waits for buildSubmitRequest: a channel
      // alias is not resolved to its upstream model until a channel is pinned.
      return { kind: "submit", model: model, action: videoAction(requestBody), requestBody: requestBody };
    },
    renderEvents: function (ctx, task, previousState) {
      const status = String(task.status || "UNKNOWN").toUpperCase();
      const value = Number(String(task.progress || "").replace("%", ""));
      const progress = Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
      const state = { status: status, progress: progress };
      if (status === "SUCCESS") {
        const text = responsesVideoText(ctx);
        const events = previousState && previousState.status === status ? [] : [{ type: "output", data: text }];
        return { events: events, state: state, done: true };
      }
      if (status === "FAILURE")
        return { events: [{ type: "error", code: "task_failed", message: task.fail_reason || "task failed" }], state: state, done: true };
      if (previousState && previousState.status === status && previousState.progress === progress) return { events: [], state: state, done: false };
      const event = { type: "progress", message: status.toLowerCase() };
      if (progress !== null) event.progress = progress;
      return { events: [event], state: state, done: false };
    },
    renderFinal: function (ctx, _task) {
      return {
        output: [
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: responsesVideoText(ctx), annotations: [], logprobs: [] }],
          },
        ],
        // Echoed to the client, so it carries the plugin key the task log
        // already shows rather than the upstream vendor name.
        metadata: { vendor: "mr-aoso" },
      };
    },
  },
  openai_video: {
    decodeRequest: function (ctx) {
      let req;
      if (ctx.body && ctx.body.kind === "json") {
        req = ctx.body.value;
        if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
        req = Object.assign({}, req);
      } else if (ctx.body && ctx.body.kind === "multipart") {
        req = {};
        const fields = ctx.body.fields || {};
        for (const name of Object.keys(fields)) {
          const values = fields[name] || [];
          if (["reference_images", "reference_videos", "reference_audios"].includes(name)) {
            req[name] = values.slice();
            continue;
          }
          if (values.length > 1) throw new Error(name + " must be provided once");
          req[name] = values[0];
        }
        for (const key of ["seconds", "duration", "seed"]) {
          if (req[key] !== undefined) req[key] = Number(req[key]);
        }
        for (const file of ctx.body.files || []) {
          const upload = { __fileRef: file.ref, encoding: "dataUrl", mimeType: trimmed(file.mimeType) || "image/png", maxBytes: MAX_INPUT_IMAGE_BYTES };
          if (file.field === "input_reference" || file.field === "first_frame") req.first_frame = upload;
          else if (file.field === "last_frame") req.last_frame = upload;
          else if (/^reference_images(\[\d*\])?$/.test(file.field)) req.reference_images = (req.reference_images || []).concat([upload]);
          else throw new Error("unexpected file field: " + file.field);
        }
      } else throw new Error("JSON or multipart body required");
      const requestBody = normalizeVideoRequest(Object.assign({}, req, { model: ctx.model }));
      return { kind: "submit", model: ctx.model, action: videoAction(requestBody), requestBody: requestBody };
    },
    // The vendor result URL is deliberately absent: clients read the video
    // through the gateway's own content endpoint.
    render: function (ctx, task) {
      const statuses = { NOT_START: "queued", SUBMITTED: "queued", QUEUED: "queued", IN_PROGRESS: "in_progress", SUCCESS: "completed", FAILURE: "failed" };
      const output = {
        id: task.task_id,
        object: "video",
        model: task.properties ? task.properties.origin_model_name || "" : "",
        status: statuses[task.status] || "unknown",
        progress: Number(String(task.progress || "0").replace("%", "")),
        created_at: task.created_at,
        completed_at: task.updated_at,
      };
      if (task.status === "FAILURE") output.error = { code: "task_failed", message: task.fail_reason || "task failed" };
      return output;
    },
  },
};
