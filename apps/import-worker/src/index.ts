import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { createJobUpdates } from "./job-updates.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { execa } from "execa";
import { nanoid } from "nanoid";
import { selectSourceItems } from "./source-items.js";

type ImportJob = {
  id: string;
  status?: string;
  source_url?: string;
  query?: string;
  metadata?: Record<string, unknown>;
};

type Diagnostics = {
  step: string;
  detail?: string;
  command?: string;
  source_url?: string;
  normalized_url?: string;
  files?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  last_output?: string[];
  timings?: Record<string, number>;
};

type PlaylistEntry = {
  id?: string;
  title?: string;
  url?: string;
  webpage_url?: string;
  thumbnail?: string;
  thumbnails?: { url?: string }[];
  channel?: string;
  uploader?: string;
  duration?: number;
  view_count?: number;
};

type YoutubeSearchResult = {
  id: string;
  title: string;
  url: string;
  thumbnail_url?: string;
  channel?: string;
  duration_seconds?: number;
  view_count?: number;
};

type YoutubeMediaInfo = {
  width?: number;
  height?: number;
  duration_seconds?: number;
};

const apiBase = process.env.PUBLIC_API_BASE_URL || "http://happie-api:8080";
const maxConcurrent = Number(process.env.MAX_CONCURRENT_IMPORTS || "2");
const maxMb = Number(process.env.MAX_IMPORT_FILE_SIZE_MB || "2048");
const maxPlaylistItems = process.env.MAX_PLAYLIST_ITEMS ? Number(process.env.MAX_PLAYLIST_ITEMS) : undefined;
const downloadFragments = Number(process.env.YTDLP_CONCURRENT_FRAGMENTS || "4");
const videoMaxHeight = Number(process.env.OPTIMIZED_VIDEO_MAX_HEIGHT || "720");
const videoCrf = Number(process.env.OPTIMIZED_VIDEO_CRF || "26");
const videoPreset = process.env.OPTIMIZED_VIDEO_PRESET || "medium";
const audioBitrate = process.env.OPTIMIZED_AUDIO_BITRATE || "96k";
const bucket = process.env.R2_BUCKET || "happie";
const workerToken = process.env.IMPORT_WORKER_TOKEN;
const ytdlpCookiesFile = process.env.YTDLP_COOKIES_FILE?.trim();
const youtubeFormat = `bv[height<=${videoMaxHeight}][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/bv[height<=${videoMaxHeight}]+ba/b[height<=${videoMaxHeight}]`;

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT || "http://minio:9000",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "minioadmin",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "minioadmin",
  },
});

function now() {
  return Date.now();
}

function secondsSince(startedAt: number) {
  return Math.round((Date.now() - startedAt) / 100) / 10;
}

function sizeMb(bytes: number) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function contentTypeForFile(file: string) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".m4a") return "audio/mp4";
  return "video/mp4";
}

function isImageFile(file: string) {
  return [".jpg", ".jpeg", ".png", ".webp"].includes(path.extname(file).toLowerCase());
}

function isImportedThumbnail(file: string) {
  return file.startsWith("youtube-thumbnail.") && isImageFile(file);
}

function mergeWorkerMetadata(job: ImportJob, diagnostics: Diagnostics) {
  return {
    ...(job.metadata || {}),
    worker: {
      ...(typeof job.metadata?.worker === "object" && job.metadata.worker ? job.metadata.worker : {}),
      ...diagnostics,
      updated_at: new Date().toISOString(),
    },
  };
}

function rememberOutput(lines: string[], chunk: Buffer | string) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = sanitizeDiagnosticText(line).trim();
    if (!trimmed) continue;
    lines.push(trimmed);
  }
  while (lines.length > 8) lines.shift();
}

function normalizeVideoUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);
  if (parsed.hostname === "www.youtubekids.com" || parsed.hostname === "youtubekids.com") {
    const videoId = parsed.searchParams.get("v");
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
  }
  return rawUrl;
}

function metadataString(job: ImportJob, key: string) {
  const value = job.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function metadataNumber(job: ImportJob, key: string) {
  const value = job.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function withYtDlpAuth(args: string[]) {
  return ytdlpCookiesFile ? ["--cookies", ytdlpCookiesFile, ...args] : args;
}

function redactCommandArgs(args: string[]) {
  return args.map((arg, index) => (index > 0 && args[index - 1] === "--cookies" ? "[redacted]" : arg));
}

function sanitizeDiagnosticText(value: string) {
  let sanitized = value.replace(
    /(--cookies(?:=|\s+))(?:"[^"]*"|'[^']*'|\S+)/gi,
    "$1[redacted]",
  );
  if (ytdlpCookiesFile) {
    sanitized = sanitized.split(ytdlpCookiesFile).join("[cookie file]");
  }
  return sanitized.slice(0, 2_000);
}

function playlistEntryUrl(entry: PlaylistEntry) {
  if (entry.webpage_url?.startsWith("http")) return entry.webpage_url;
  if (entry.url?.startsWith("http")) return entry.url;
  if (entry.id) return `https://www.youtube.com/watch?v=${entry.id}`;
  if (entry.url) return `https://www.youtube.com/watch?v=${entry.url}`;
  return "";
}

function entriesToSearchResults(entries: PlaylistEntry[], limit: number): YoutubeSearchResult[] {
  const seen = new Set<string>();
  const results: YoutubeSearchResult[] = [];
  for (const entry of entries) {
    const id = entry.id?.trim();
    if (!id || seen.has(id)) continue;
    const url = playlistEntryUrl(entry);
    if (!url.startsWith("http")) continue;
    seen.add(id);
    const thumbnail = entry.thumbnail
      || [...(entry.thumbnails || [])].reverse().find((item) => item.url)?.url
      || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    results.push({
      id,
      title: entry.title?.trim() || "Untitled video",
      url,
      thumbnail_url: thumbnail,
      channel: entry.channel?.trim() || entry.uploader?.trim() || undefined,
      duration_seconds: Number.isFinite(entry.duration) ? Math.round(Number(entry.duration)) : undefined,
      view_count: Number.isFinite(entry.view_count) ? Math.round(Number(entry.view_count)) : undefined,
    });
    if (results.length >= limit) break;
  }
  return results;
}

function entriesToItems(entries: PlaylistEntry[]) {
  const seen = new Set<string>();
  const items: { url: string; title?: string; external_id?: string; index: number }[] = [];
  for (const [index, entry] of entries.entries()) {
    const url = playlistEntryUrl(entry);
    if (!url.startsWith("http")) continue;
    const externalId = entry.id || entry.url || undefined;
    if (externalId) {
      if (seen.has(externalId)) continue;
      seen.add(externalId);
    }
    items.push({ url, title: entry.title || undefined, external_id: externalId, index: index + 1 });
  }
  return items;
}

async function api<T>(pathName: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (workerToken) headers.set("X-Worker-Token", workerToken);
  const res = await fetch(`${apiBase}${pathName}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

const jobUpdates = createJobUpdates((id, body) =>
  api(`/worker/imports/${id}/status`, { method: "POST", body: JSON.stringify(body) }));
const update = jobUpdates.update;

async function updateDiagnostics(job: ImportJob, progress: number, diagnostics: Diagnostics) {
  if (job.status === "failed" || job.status === "completed" || job.status === "cancelled") return;
  job.metadata = mergeWorkerMetadata(job, diagnostics);
  await update(job.id, { status: job.status || "processing", progress, metadata: job.metadata });
}

async function runTracked(
  job: ImportJob,
  progress: number,
  diagnostics: Diagnostics,
  command: string,
  args: string[],
  timeout: number,
) {
  const effectiveArgs = command === "yt-dlp" ? withYtDlpAuth(args) : args;
  const output: string[] = [];
  const startedAt = now();
  await updateDiagnostics(job, progress, {
    ...diagnostics,
    command: `${command} ${redactCommandArgs(effectiveArgs).map((arg) => (arg.includes(" ") ? `'${arg}'` : arg)).join(" ")}`,
    last_output: output,
  });
  const subprocess = execa(command, effectiveArgs, { timeout });
  subprocess.stdout?.on("data", (chunk) => {
    rememberOutput(output, chunk);
    void updateDiagnostics(job, progress, { ...diagnostics, last_output: output, timings: { elapsed_seconds: secondsSince(startedAt) } }).catch(() => {});
  });
  subprocess.stderr?.on("data", (chunk) => {
    rememberOutput(output, chunk);
    void updateDiagnostics(job, progress, { ...diagnostics, last_output: output, timings: { elapsed_seconds: secondsSince(startedAt) } }).catch(() => {});
  });
  return subprocess;
}

function attachTrackedOutput(
  job: ImportJob,
  progress: number,
  diagnostics: Diagnostics,
  output: string[],
  startedAt: number,
  subprocess: ReturnType<typeof execa>,
) {
  subprocess.stdout?.on("data", (chunk) => {
    rememberOutput(output, chunk);
    void updateDiagnostics(job, progress, { ...diagnostics, last_output: output, timings: { elapsed_seconds: secondsSince(startedAt) } }).catch(() => {});
  });
  subprocess.stderr?.on("data", (chunk) => {
    rememberOutput(output, chunk);
    void updateDiagnostics(job, progress, { ...diagnostics, last_output: output, timings: { elapsed_seconds: secondsSince(startedAt) } }).catch(() => {});
  });
}

async function uploadFile(localPath: string, key: string, contentType: string) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: createReadStream(localPath),
    ContentType: contentType,
  }));
}

function scaledDimensions(info: YoutubeMediaInfo) {
  if (!info.width || !info.height) return info;
  if (info.height <= videoMaxHeight) return info;
  const width = Math.round((info.width * videoMaxHeight) / info.height / 2) * 2;
  return { ...info, width, height: videoMaxHeight };
}

async function inspectYoutubeMedia(job: ImportJob, videoUrl: string): Promise<YoutubeMediaInfo> {
  const { stdout } = await runTracked(job, 22, {
    step: "Inspecting YouTube media",
    detail: "yt-dlp is reading video metadata without downloading the file",
    source_url: job.source_url,
    normalized_url: videoUrl,
  }, "yt-dlp", [
    "--js-runtimes", "node",
    "--remote-components", "ejs:github",
    "--no-playlist",
    "-f", youtubeFormat,
    "--dump-single-json",
    videoUrl,
  ], 120_000);
  const parsed = JSON.parse(stdout);
  return {
    width: parsed.width ? Number(parsed.width) : undefined,
    height: parsed.height ? Number(parsed.height) : undefined,
    duration_seconds: parsed.duration ? Math.round(Number(parsed.duration)) : undefined,
  };
}

function parseFfmpegTimeSeconds(text: string): number | undefined {
  const matches = [...text.matchAll(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
  const last = matches[matches.length - 1];
  if (!last) return undefined;
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}

const TRANSCODE_PROGRESS_START = 52;
const TRANSCODE_PROGRESS_END = 74;

async function streamYoutubeTranscodeToStorage(job: ImportJob, videoUrl: string, key: string, sourceInfo: YoutubeMediaInfo, sourcePath: string) {
  const output: string[] = [];
  const diagnostics = {
    step: "Streaming iPad MP4",
    detail: "FFmpeg is converting downloaded source directly into object storage",
    source_url: job.source_url,
    normalized_url: videoUrl,
    files: { width: sourceInfo.width, height: sourceInfo.height },
    storage: { mp4_key: key },
  };
  const startedAt = now();
  await updateDiagnostics(job, TRANSCODE_PROGRESS_START, { ...diagnostics, last_output: output });

  const ffmpeg = execa("ffmpeg", [
    "-y",
    "-i", sourcePath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-vf", `scale=if(gt(ih\\,${videoMaxHeight})\\,-2\\,iw):if(gt(ih\\,${videoMaxHeight})\\,${videoMaxHeight}\\,ih)`,
    "-c:v", "libx264",
    "-preset", videoPreset,
    "-crf", String(videoCrf),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", audioBitrate,
    "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4",
    "pipe:1",
  ], { timeout: 30 * 60_000, stdin: "pipe", stdout: "pipe", buffer: false });

  // FFmpeg's stderr time= counter against the known source duration is the only
  // live signal for this phase, which is the longest one in the whole import.
  let transcodeProgress = TRANSCODE_PROGRESS_START;
  let lastProgressUpdate = 0;
  const trackTranscode = (chunk: Buffer | string) => {
    rememberOutput(output, chunk);
    const transcodedSeconds = parseFfmpegTimeSeconds(String(chunk));
    if (transcodedSeconds !== undefined && sourceInfo.duration_seconds) {
      const ratio = Math.min(1, transcodedSeconds / sourceInfo.duration_seconds);
      transcodeProgress = TRANSCODE_PROGRESS_START + ratio * (TRANSCODE_PROGRESS_END - TRANSCODE_PROGRESS_START);
    }
    if (now() - lastProgressUpdate < 1000) return;
    lastProgressUpdate = now();
    void updateDiagnostics(job, transcodeProgress, {
      ...diagnostics,
      last_output: output,
      timings: { elapsed_seconds: secondsSince(startedAt) },
    }).catch(() => {});
  };
  ffmpeg.stderr?.on("data", trackTranscode);

  let fileSizeBytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      fileSizeBytes += Buffer.byteLength(chunk);
      callback(null, chunk);
    },
  });
  const uploader = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: ffmpeg.stdout!.pipe(counter),
      ContentType: "video/mp4",
    },
    queueSize: 2,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false,
  });
  const upload = uploader.done();
  try {
    await Promise.all([ffmpeg, upload]);
  } catch (error) {
    ffmpeg.kill("SIGKILL");
    counter.destroy();
    await uploader.abort().catch(() => {});
    await Promise.allSettled([ffmpeg, upload]);
    throw new Error(sanitizeDiagnosticText(`${error instanceof Error ? error.message : error}\n${output.join("\n")}`));
  }
  if (fileSizeBytes > maxMb * 1024 * 1024) throw new Error("optimized file exceeds size limit");
  return { fileSizeBytes, info: scaledDimensions(sourceInfo) };
}

async function processJob(job: ImportJob) {
  jobUpdates.reset(job.id);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `happie-${job.id}-`));
  try {
    const importKind = metadataString(job, "import_kind");
    if (importKind === "playlist" || importKind === "source") {
      if (!job.source_url) throw new Error(`${importKind} job has no source_url`);
      job.status = "processing";
      const args = [
        "--js-runtimes", "node",
        "--remote-components", "ejs:github",
        "--flat-playlist",
        "--dump-single-json",
      ];
      if (maxPlaylistItems && Number.isFinite(maxPlaylistItems) && maxPlaylistItems > 0) {
        args.push("--playlist-end", String(maxPlaylistItems));
      }
      args.push(job.source_url);
      const { stdout } = await runTracked(job, 20, {
        step: importKind === "source" ? "Polling trusted source" : "Reading playlist",
        detail: importKind === "source"
          ? "yt-dlp is checking the source for new videos"
          : "yt-dlp is collecting the videos in this playlist",
        source_url: job.source_url,
      }, "yt-dlp", args, 5 * 60_000);
      const playlist = JSON.parse(stdout);
      const entries = Array.isArray(playlist.entries) ? playlist.entries as PlaylistEntry[] : [];
      const sourceResult = importKind === "source"
        ? selectSourceItems(
          entriesToItems(entries),
          metadataString(job, "source_last_seen_external_id"),
          Math.min(50, Math.max(1, metadataNumber(job, "max_videos") ?? 10)),
        )
        : { items: entriesToItems(entries), observedExternalId: undefined };
      const { items, observedExternalId } = sourceResult;
      if (entries.length === 0 || (importKind !== "source" && items.length === 0)) {
        throw new Error("No importable videos were found in this playlist.");
      }
      if (importKind === "source" && items.length === 0) {
        await update(job.id, {
          status: "completed",
          progress: 100,
          metadata: mergeWorkerMetadata(job, {
            step: "Source up to date",
            detail: "No new videos found",
            source_url: job.source_url,
            files: { source_items: entries.length, queued_items: 0, skipped_duplicates: 0 },
          }),
        });
        return;
      }
      await updateDiagnostics(job, 65, {
        step: "Creating video jobs",
        detail: importKind === "source"
          ? `${items.length} new videos found`
          : `${items.length} videos found`,
        source_url: job.source_url,
        files: { playlist_items: items.length },
      });
      const result = await api<{ created_count: number; skipped_duplicates: number }>(`/worker/imports/${job.id}/playlist-items`, {
        method: "POST",
        body: JSON.stringify({ items, observed_external_id: observedExternalId }),
      });
      await update(job.id, {
        status: "completed",
        progress: 100,
        metadata: mergeWorkerMetadata(job, {
          step: importKind === "source" ? "Source poll complete" : "Playlist queued",
          detail: `${result.created_count} video imports created, ${result.skipped_duplicates} already in library`,
          source_url: job.source_url,
          files: { playlist_items: items.length, queued_items: result.created_count, skipped_duplicates: result.skipped_duplicates },
        }),
      });
      return;
    }

    if (job.query && !job.source_url) {
      // Never report status "searching" mid-flight: it used to be in the
      // worker pickup set, and a second worker loop would re-run the job.
      job.status = "processing";
      const requested = Math.min(50, Math.max(1, metadataNumber(job, "max_videos") ?? 10));
      const fetchCount = requested;
      const { stdout } = await runTracked(job, 20, {
        step: "Searching YouTube",
        detail: `Looking for up to ${requested} new videos matching "${job.query}"`,
      }, "yt-dlp", [
        "--js-runtimes", "node",
        "--remote-components", "ejs:github",
        "--flat-playlist",
        "--dump-single-json",
        `ytsearch${fetchCount}:${job.query}`,
      ], 5 * 60_000);
      const playlist = JSON.parse(stdout);
      const entries = Array.isArray(playlist.entries) ? playlist.entries as PlaylistEntry[] : [];
      const results = entriesToSearchResults(entries, requested);
      if (results.length === 0) {
        throw new Error("YouTube returned no results for this search.");
      }
      job.metadata = {
        ...(job.metadata || {}),
        search_results: results,
      };
      await update(job.id, {
        status: "completed",
        progress: 100,
        metadata: mergeWorkerMetadata(job, {
          step: "Results ready",
          detail: `${results.length} videos ready to review`,
          files: { search_results: results.length, requested },
        }),
      });
      return;
    }

    if (!job.source_url) throw new Error("job has no source_url");
    const videoUrl = normalizeVideoUrl(job.source_url);
    job.status = "downloading";
    await update(job.id, {
      status: "downloading",
      progress: 15,
      metadata: mergeWorkerMetadata(job, {
        step: "Preparing download",
        source_url: job.source_url,
        normalized_url: videoUrl,
      }),
    });
    const sourceInfo = await inspectYoutubeMedia(job, videoUrl);
    const sourcePath = path.join(workDir, "source.mkv");
    await runTracked(job, 30, {
      step: "Downloading source",
      detail: "Downloading separate video and audio streams before conversion",
      source_url: job.source_url,
    }, "yt-dlp", [
      "--js-runtimes", "node", "--remote-components", "ejs:github",
      "--no-playlist", "--newline", "--progress-delta", "2",
      "--concurrent-fragments", String(downloadFragments),
      "--max-filesize", `${maxMb}M`, "-f", youtubeFormat,
      "--merge-output-format", "mkv", "--remux-video", "mkv",
      "-o", sourcePath, videoUrl,
    ], 30 * 60_000);
    if ((await fs.stat(sourcePath)).size > maxMb * 1024 * 1024) {
      throw new Error("source file exceeds size limit");
    }
    if (!sourceInfo.width || !sourceInfo.height) {
      throw new Error("YouTube did not provide a downloadable video stream for this URL.");
    }
    await updateDiagnostics(job, 40, {
      step: "Source ready",
      detail: "Source downloaded and ready for iPad processing",
      files: { width: sourceInfo.width, height: sourceInfo.height, duration_seconds: sourceInfo.duration_seconds },
    });

    job.status = "processing";
    const prefix = `imports/youtube/${job.id}/${nanoid(8)}`;
    const mp4Key = `${prefix}/ipad.mp4`;
    await update(job.id, { status: "processing", progress: 45, metadata: mergeWorkerMetadata(job, { step: "Starting streamed iPad transcode", files: { width: sourceInfo.width, height: sourceInfo.height } }) });
    let thumbPath = path.join(workDir, "thumbnail.jpg");
    const thumbnailImport = runTracked(job, 54, {
      step: "Importing thumbnail",
      detail: "yt-dlp is fetching the source thumbnail while FFmpeg transcodes",
      source_url: job.source_url,
      normalized_url: videoUrl,
    }, "yt-dlp", [
      "--js-runtimes", "node",
      "--remote-components", "ejs:github",
      "--no-playlist",
      "--skip-download",
      "--write-thumbnail",
      "--convert-thumbnails", "jpg",
      "-o", path.join(workDir, "youtube-thumbnail.%(ext)s"),
      videoUrl,
    ], 120_000).catch(() => undefined);
    const { fileSizeBytes: mp4Size, info } = await streamYoutubeTranscodeToStorage(job, videoUrl, mp4Key, sourceInfo, sourcePath)
      .finally(() => thumbnailImport);
    const thumbnailFiles = await fs.readdir(workDir);
    const importedThumb = thumbnailFiles.find(isImportedThumbnail);
    if (importedThumb) {
      thumbPath = path.join(workDir, importedThumb);
      await updateDiagnostics(job, 68, {
        step: "Thumbnail imported",
        detail: importedThumb,
        files: { ipad_mp4_mb: sizeMb(mp4Size) },
      });
    } else {
      await runTracked(job, 75, { step: "Creating thumbnail" }, "ffmpeg", [
        "-y", "-ss", "00:00:00.5", "-i", sourcePath, "-frames:v", "1", thumbPath,
      ], 120_000);
    }
    const thumbStat = await fs.stat(thumbPath);

    job.status = "uploading";
    await update(job.id, {
      status: "uploading",
      progress: 75,
      metadata: mergeWorkerMetadata(job, {
        step: "Uploading to storage",
        detail: "Sending optimized iPad MP4 and thumbnail to R2",
        files: { ipad_mp4_mb: sizeMb(mp4Size), thumbnail_kb: Math.round(thumbStat.size / 102.4) / 10 },
      }),
    });
    const thumbExt = path.extname(thumbPath).toLowerCase() || ".jpg";
    const thumbKey = `${prefix}/thumbnail${thumbExt}`;
    await updateDiagnostics(job, 93, { step: "Uploading thumbnail", detail: thumbKey });
    await uploadFile(thumbPath, thumbKey, contentTypeForFile(thumbPath));

    await update(job.id, {
      status: "completed",
      progress: 100,
      video: {
        title: String(job.metadata?.title || job.source_url),
        description: "Imported from user-supplied YouTube URL.",
        duration_seconds: info.duration_seconds,
        thumbnail_key: thumbKey,
        file_size_bytes: mp4Size,
      },
      assets: [
        { kind: "mp4", storage_key: mp4Key, mime_type: "video/mp4", quality: `ipad-${videoMaxHeight}p-crf${videoCrf}-${videoPreset}`, width: info.width, height: info.height, duration_seconds: info.duration_seconds, file_size_bytes: mp4Size },
        { kind: "thumbnail", storage_key: thumbKey, mime_type: contentTypeForFile(thumbPath), quality: importedThumb ? "source" : "poster", file_size_bytes: thumbStat.size },
      ],
      metadata: mergeWorkerMetadata(job, {
        step: "Complete",
        detail: "Optimized video and thumbnail are ready",
        files: { ipad_mp4_mb: sizeMb(mp4Size), thumbnail_kb: Math.round(thumbStat.size / 102.4) / 10 },
        storage: { mp4_key: mp4Key, thumbnail_key: thumbKey },
      }),
    });
  } catch (error) {
    job.status = "failed";
    const errorMessage = sanitizeDiagnosticText(error instanceof Error ? error.message : String(error));
    await update(job.id, {
      status: "failed",
      progress: 100,
      error_message: errorMessage,
      metadata: mergeWorkerMetadata(job, {
        step: "Failed",
        detail: errorMessage,
      }),
    }).catch((updateError) => {
      console.error(`Failed to record import failure for ${job.id}`, updateError);
    });
  } finally {
    jobUpdates.reset(job.id);
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function loop(workerIndex: number) {
  for (;;) {
    try {
      const job = await api<ImportJob | null>("/worker/imports/next", { method: "POST", body: "{}" });
      if (job) {
        console.log(`worker ${workerIndex} processing ${job.id}`);
        await processJob(job);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.error(error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

for (let i = 0; i < maxConcurrent; i += 1) {
  void loop(i + 1);
}
