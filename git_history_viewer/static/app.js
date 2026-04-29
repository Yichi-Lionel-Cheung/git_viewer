const appConfig = JSON.parse(document.getElementById("app-config")?.textContent || "{}");
const DEFAULT_REPO = appConfig.defaultRepo || "";
const DEFAULT_REF = appConfig.defaultRef || "HEAD";

const els = {
  form: document.getElementById("repoForm"),
  repo: document.getElementById("repoInput"),
  ref: document.getElementById("refInput"),
  load: document.getElementById("loadButton"),
  status: document.getElementById("status"),
  commits: document.getElementById("statCommits"),
  files: document.getElementById("statFiles"),
  lines: document.getElementById("statLines"),
  delta: document.getElementById("statDelta"),
  title: document.getElementById("commitTitle"),
  index: document.getElementById("commitIndex"),
  hash: document.getElementById("commitHash"),
  date: document.getElementById("commitDate"),
  author: document.getElementById("commitAuthor"),
  canvas: document.getElementById("visual"),
  timeline: document.getElementById("timeline"),
  prev: document.getElementById("prevButton"),
  play: document.getElementById("playButton"),
  next: document.getElementById("nextButton"),
  speed: document.getElementById("speed"),
  progress: document.getElementById("loadProgress"),
  progressTrack: document.querySelector(".progress-track"),
  progressFill: document.getElementById("progressFill"),
  progressLabel: document.getElementById("progressLabel"),
  progressPct: document.getElementById("progressPct"),
};

const colors = {
  paper: "#f4f0e7",
  ink: "#211f1b",
  muted: "#6f675c",
  line: "#c9bea9",
  folder: "rgba(218, 207, 188, 0.38)",
  folderAlt: "rgba(199, 188, 168, 0.25)",
  cell: "#c9bda8",
  cellEmpty: "rgba(174, 162, 140, 0.22)",
  hover: "rgba(33, 31, 27, 0.12)",
  base: "#8f846f",
  add: "#258a45",
  del: "#c23b36",
};

const state = {
  history: null,
  index: 0,
  playing: false,
  timer: 0,
  hoverPath: null,
  hitboxes: [],
  layout: null,
  layoutKey: "",
  renderFiles: new Map(),
  renderChanges: new Map(),
  changePulse: 1,
  animationFrame: 0,
  animation: null,
  loadJob: null,
  loadPoll: 0,
};

els.repo.value = DEFAULT_REPO;
els.ref.value = DEFAULT_REF || "HEAD";

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadHistory();
});

els.timeline.addEventListener("input", () => {
  pause();
  state.index = Number(els.timeline.value);
  updateFrame(true);
});

els.prev.addEventListener("click", () => step(-1));
els.next.addEventListener("click", () => step(1));
els.play.addEventListener("click", () => setPlaying(!state.playing));

els.canvas.addEventListener("mousemove", (event) => {
  const rect = els.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const hit = [...state.hitboxes]
    .reverse()
    .find((item) => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height);
  const nextPath = hit ? hit.path : null;
  if (nextPath !== state.hoverPath) {
    state.hoverPath = nextPath;
    draw();
  }
});

els.canvas.addEventListener("mouseleave", () => {
  state.hoverPath = null;
  draw();
});

window.addEventListener("resize", () => {
  state.layoutKey = "";
  draw();
});
window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) {
    return;
  }
  if (event.key === " ") {
    event.preventDefault();
    setPlaying(!state.playing);
  } else if (event.key === "ArrowLeft") {
    step(-1);
  } else if (event.key === "ArrowRight") {
    step(1);
  }
});

async function loadHistory() {
  const repo = els.repo.value.trim();
  const ref = els.ref.value.trim() || "HEAD";
  if (!repo) {
    setStatus("Enter a repository path or GitHub URL.");
    return;
  }

  pause();
  window.clearTimeout(state.loadPoll);
  state.loadJob = null;
  state.history = null;
  state.index = 0;
  state.hoverPath = null;
  state.layout = null;
  state.layoutKey = "";
  state.renderFiles = new Map();
  state.renderChanges = new Map();
  els.load.disabled = true;
  els.load.textContent = "Loading";
  showProgress("Starting history scan", 0, 0);
  setStatus("Starting history scan...");
  updateFrame(false);

  try {
    const url = `/api/start-history?repo=${encodeURIComponent(repo)}&ref=${encodeURIComponent(ref)}`;
    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load repository.");
    }
    state.loadJob = payload.job_id;
    pollHistoryJob(payload.job_id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message);
    els.load.disabled = false;
    els.load.textContent = "Load";
    hideProgress();
  }
}

async function pollHistoryJob(jobId) {
  try {
    const response = await fetch(`/api/job?id=${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to read load progress.");
    }
    if (jobId !== state.loadJob) {
      return;
    }

    updateProgress(payload.done || 0, payload.total || 0, payload.message || "Loading history");

    if (payload.status === "done") {
      if (!payload.result) {
        throw new Error("Load finished without a history payload.");
      }
      prepareHistory(payload.result);
      state.history = payload.result;
      state.index = 0;
      els.timeline.max = String(Math.max(0, payload.result.frames.length - 1));
      els.timeline.value = "0";
      updateProgress(payload.total || 1, payload.total || 1, "Complete");
      hideProgress();
      setStatus(`Loaded ${payload.result.frames.length.toLocaleString()} commits from ${payload.result.repo}`);
      els.load.disabled = false;
      els.load.textContent = "Load";
      updateFrame(false);
      return;
    }

    if (payload.status === "error") {
      throw new Error(payload.error || "Load failed.");
    }

    state.loadPoll = window.setTimeout(() => pollHistoryJob(jobId), 120);
  } catch (error) {
    if (jobId !== state.loadJob) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message);
    els.load.disabled = false;
    els.load.textContent = "Load";
    hideProgress();
  }
}

function updateFrame(animated = false) {
  const history = state.history;
  if (!history || history.frames.length === 0) {
    els.title.textContent = "No repository loaded";
    els.index.textContent = "0/0";
    els.hash.textContent = "";
    els.date.textContent = "";
    els.author.textContent = "";
    els.commits.textContent = "0";
    els.files.textContent = "0";
    els.lines.textContent = "0";
    els.delta.textContent = "+0 -0";
    state.renderFiles = new Map();
    state.renderChanges = new Map();
    state.layout = null;
    state.layoutKey = "";
    draw();
    return;
  }

  state.index = clamp(state.index, 0, history.frames.length - 1);
  const frame = history.frames[state.index];
  els.timeline.value = String(state.index);
  els.title.textContent = frame.subject || "(no subject)";
  els.index.textContent = `${state.index + 1}/${history.frames.length}`;
  els.hash.textContent = frame.short_hash;
  els.date.textContent = frame.date;
  els.author.textContent = frame.author;
  els.commits.textContent = history.frames.length.toLocaleString();
  els.files.textContent = frame.file_count.toLocaleString();
  els.lines.textContent = frame.total_lines.toLocaleString();
  els.delta.textContent = `+${frame.additions.toLocaleString()} -${frame.deletions.toLocaleString()}`;
  if (animated) {
    animateToFrame(frame);
  } else {
    window.cancelAnimationFrame(state.animationFrame);
    state.animation = null;
    setRenderFrame(frame);
    draw();
  }
}

function setPlaying(next) {
  if (!state.history || state.history.frames.length === 0) {
    return;
  }
  state.playing = next;
  els.play.textContent = next ? "Pause" : "Play";
  window.clearTimeout(state.timer);
  if (next) {
    scheduleNext();
  }
}

function pause() {
  setPlaying(false);
}

function scheduleNext() {
  if (!state.playing || !state.history) {
    return;
  }
  state.timer = window.setTimeout(() => {
    if (!state.history) {
      return;
    }
    if (state.index >= state.history.frames.length - 1) {
      setPlaying(false);
      return;
    }
    state.index += 1;
    updateFrame(true);
    scheduleNext();
  }, playDelay());
}

function step(delta) {
  if (!state.history) {
    return;
  }
  pause();
  state.index = clamp(state.index + delta, 0, state.history.frames.length - 1);
  updateFrame(true);
}

function draw() {
  const canvas = els.canvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, width, height);
  state.hitboxes = [];

  if (!state.history || state.history.frames.length === 0) {
    drawEmpty(ctx, width, height);
    return;
  }

  const frame = state.history.frames[state.index];
  const layout = ensureLayout(width, height);
  drawFolderRects(ctx, layout.folders);
  drawFileRects(ctx, layout.files);

  if (state.hoverPath) {
    drawHover(ctx, width, frame, layout);
  }
}

function drawEmpty(ctx, width, height) {
  ctx.textAlign = "center";
  ctx.fillStyle = colors.ink;
  ctx.font = "800 22px 'Avenir Next', Candara, sans-serif";
  ctx.fillText("Load a repository to start", width / 2, height / 2 - 8);
  ctx.fillStyle = colors.muted;
  ctx.font = "14px 'Avenir Next', Candara, sans-serif";
  ctx.fillText("Every code file will occupy one rectangle in a folder-grouped plane.", width / 2, height / 2 + 22);
  ctx.textAlign = "left";
}

function prepareHistory(history) {
  const maxLines = new Map();
  let scaleLines = 0;
  for (const frame of history.frames) {
    const frameFiles = new Map(frame.files.map((file) => [file.path, file.lines]));
    const frameChanges = new Map(frame.changes.map((change) => [change.path, change]));
    const framePaths = new Set([...frameFiles.keys(), ...frameChanges.keys()]);
    let visualLines = 0;
    for (const file of frame.files) {
      maxLines.set(file.path, Math.max(maxLines.get(file.path) || 0, file.lines));
    }
    for (const path of framePaths) {
      const lines = frameFiles.get(path) || 0;
      const change = frameChanges.get(path) || { additions: 0, deletions: 0 };
      visualLines += Math.max(lines, change.additions, change.deletions);
    }
    scaleLines = Math.max(scaleLines, frame.total_lines, visualLines);
  }
  history.maxLines = [...maxLines.entries()]
    .map(([path, lines]) => ({ path, lines: Math.max(1, lines) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  history.scaleLines = Math.max(1, scaleLines);
}

function playDelay() {
  return Math.max(150, 920 / Number(els.speed.value));
}

function transitionDuration() {
  return Math.min(760, Math.max(180, playDelay() * 0.78));
}

function frameFileMap(frame) {
  return new Map(frame.files.map((file) => [file.path, file.lines]));
}

function frameChangeMap(frame) {
  return new Map(frame.changes.map((change) => [change.path, change]));
}

function setRenderFrame(frame) {
  state.renderFiles = frameFileMap(frame);
  state.renderChanges = frameChangeMap(frame);
  state.changePulse = 1;
}

function animateToFrame(frame) {
  const targetFiles = frameFileMap(frame);
  const targetChanges = frameChangeMap(frame);
  const paths = new Set([...state.renderFiles.keys(), ...targetFiles.keys()]);
  window.cancelAnimationFrame(state.animationFrame);
  state.animation = {
    startedAt: performance.now(),
    duration: transitionDuration(),
    startFiles: new Map(state.renderFiles),
    targetFiles,
    targetChanges,
    paths,
  };
  state.animationFrame = window.requestAnimationFrame(tickAnimation);
}

function tickAnimation(now) {
  const animation = state.animation;
  if (!animation) {
    return;
  }
  const progress = clamp((now - animation.startedAt) / animation.duration, 0, 1);
  const eased = easeInOutCubic(progress);
  const nextFiles = new Map();
  for (const path of animation.paths) {
    const start = animation.startFiles.get(path) || 0;
    const target = animation.targetFiles.get(path) || 0;
    const value = lerp(start, target, eased);
    if (value > 0.01) {
      nextFiles.set(path, value);
    }
  }
  state.renderFiles = nextFiles;
  state.renderChanges = animation.targetChanges;
  state.changePulse = eased;
  draw();
  if (progress < 1) {
    state.animationFrame = window.requestAnimationFrame(tickAnimation);
    return;
  }
  state.renderFiles = animation.targetFiles;
  state.renderChanges = animation.targetChanges;
  state.changePulse = 1;
  state.animation = null;
  draw();
}

function ensureLayout(width, height) {
  const history = state.history;
  const margin = 18;
  const rect = {
    x: margin,
    y: margin,
    width: Math.max(1, width - margin * 2),
    height: Math.max(1, height - margin * 2),
  };
  const layout = {
    files: [],
    folders: [],
    byPath: new Map(),
    unitArea: history && history.scaleLines > 0
      ? (rect.width * rect.height) / history.scaleLines
      : 0,
    contentRect: rect,
  };

  if (!history || history.maxLines.length === 0) {
    state.layout = layout;
    return layout;
  }

  const tree = buildTree(history.maxLines);
  const contentRect = absoluteContentRect(rect, tree.weight, history.scaleLines);
  layout.contentRect = contentRect;
  layoutNode(tree, contentRect, layout, 0);
  for (const file of layout.files) {
    layout.byPath.set(file.path, file);
  }
  state.layout = layout;
  return layout;
}

function absoluteContentRect(rect, visualLines, scaleLines) {
  if (visualLines <= 0 || scaleLines <= 0) {
    return { x: rect.x, y: rect.y, width: 0, height: 0 };
  }
  const scale = Math.sqrt(clamp(visualLines / scaleLines, 0, 1));
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

function buildTree(files) {
  const root = makeFolderNode("", "");
  for (const file of files) {
    const lines = state.renderFiles.get(file.path) || 0;
    const change = state.renderChanges.get(file.path) || { additions: 0, deletions: 0 };
    const layoutLines = Math.max(
      lines,
      change.additions * state.changePulse,
      change.deletions * state.changePulse
    );
    const parts = file.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const childPath = node.path ? `${node.path}/${part}` : part;
      if (!node.children.has(part)) {
        node.children.set(part, makeFolderNode(part, childPath));
      }
      node = node.children.get(part);
    }
    node.files.push({
      kind: "file",
      name: parts[parts.length - 1],
      path: file.path,
      weight: layoutLines,
      lines,
      layoutLines,
      maxLines: file.lines,
    });
  }
  computeWeight(root);
  return root;
}

function makeFolderNode(name, path) {
  return {
    kind: "folder",
    name,
    path,
    children: new Map(),
    files: [],
    childList: [],
    weight: 0,
  };
}

function computeWeight(node) {
  const folders = [...node.children.values()];
  let weight = node.files.reduce((sum, file) => sum + file.weight, 0);
  for (const folder of folders) {
    weight += computeWeight(folder);
  }
  node.childList = [...folders, ...node.files].sort(compareLayoutNode);
  node.weight = weight;
  return node.weight;
}

function compareLayoutNode(a, b) {
  if (a.kind !== b.kind) {
    return a.kind === "folder" ? -1 : 1;
  }
  return a.path.localeCompare(b.path);
}

function layoutNode(node, rect, layout, depth) {
  if (node.kind === "file") {
    if (node.weight <= 0 || rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const cleanRect = snapRect(rect);
    const file = {
      path: node.path,
      name: node.name,
      maxLines: node.maxLines,
      lines: node.lines,
      layoutLines: node.layoutLines,
      depth,
      rect: cleanRect,
    };
    layout.files.push(file);
    return;
  }

  if (node.weight <= 0 || rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const folderRect = snapRect(rect);
  if (depth > 0 && rect.width > 1 && rect.height > 1) {
    layout.folders.push({
      path: node.path,
      name: node.name,
      depth,
      rect: folderRect,
    });
  }

  const labelHeight = depth > 0 && rect.width > 42 && rect.height > 28 ? 15 : 0;
  const pad = depth === 0 ? 0 : Math.min(8, Math.max(2, Math.min(rect.width, rect.height) * 0.035));
  const inner = {
    x: rect.x + pad,
    y: rect.y + pad + labelHeight,
    width: Math.max(0, rect.width - pad * 2),
    height: Math.max(0, rect.height - pad * 2 - labelHeight),
  };
  const activeChildren = node.childList.filter((child) => child.weight > 0);
  if (inner.width <= 0 || inner.height <= 0 || activeChildren.length === 0) {
    return;
  }

  for (const item of partitionItems(activeChildren, inner)) {
    layoutNode(item.node, item.rect, layout, depth + 1);
  }
}

function partitionItems(items, rect) {
  if (items.length === 0 || rect.width <= 0 || rect.height <= 0) {
    return [];
  }
  if (items.length === 1) {
    return [{ node: items[0], rect }];
  }

  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) {
    return [];
  }
  const target = total / 2;
  let split = 1;
  let acc = items[0].weight;
  for (let index = 1; index < items.length; index += 1) {
    const next = acc + items[index].weight;
    if (Math.abs(target - next) > Math.abs(target - acc)) {
      break;
    }
    acc = next;
    split = index + 1;
  }
  split = clamp(split, 1, items.length - 1);

  const first = items.slice(0, split);
  const second = items.slice(split);
  const firstWeight = first.reduce((sum, item) => sum + item.weight, 0);
  const ratio = firstWeight / total;

  if (rect.width >= rect.height) {
    const firstWidth = rect.width * ratio;
    return [
      ...partitionItems(first, { x: rect.x, y: rect.y, width: firstWidth, height: rect.height }),
      ...partitionItems(second, {
        x: rect.x + firstWidth,
        y: rect.y,
        width: rect.width - firstWidth,
        height: rect.height,
      }),
    ];
  }

  const firstHeight = rect.height * ratio;
  return [
    ...partitionItems(first, { x: rect.x, y: rect.y, width: rect.width, height: firstHeight }),
    ...partitionItems(second, {
      x: rect.x,
      y: rect.y + firstHeight,
      width: rect.width,
      height: rect.height - firstHeight,
    }),
  ];
}

function drawFolderRects(ctx, folders) {
  for (const folder of folders) {
    const rect = folder.rect;
    ctx.fillStyle = folder.depth % 2 === 0 ? colors.folder : colors.folderAlt;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    if (rect.width > 44 && rect.height > 28) {
      ctx.fillStyle = "rgba(244, 240, 231, 0.72)";
      ctx.fillRect(rect.x, rect.y, rect.width, Math.min(15, rect.height));
      ctx.font = "700 10px 'Avenir Next', Candara, sans-serif";
      ctx.fillStyle = colors.muted;
      ctx.fillText(fitMiddle(ctx, folder.path, rect.width - 8), rect.x + 4, rect.y + 11);
    }
  }
}

function drawFileRects(ctx, files) {
  if (files.length === 0) {
    drawNoFiles(ctx);
    return;
  }

  for (const file of files) {
    const rect = file.rect;
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }
    const cell = insetRect(rect, fileGap(rect));
    const lines = state.renderFiles.get(file.path) || 0;
    const change = state.renderChanges.get(file.path) || { additions: 0, deletions: 0 };
    const hovered = state.hoverPath === file.path;

    ctx.fillStyle = lines > 0 ? colors.cell : colors.cellEmpty;
    ctx.fillRect(cell.x, cell.y, cell.width, cell.height);

    drawChangeBlock(ctx, cell, change.additions * state.changePulse, file.layoutLines, colors.add, "top-left");
    drawChangeBlock(ctx, cell, change.deletions * state.changePulse, file.layoutLines, colors.del, "bottom-right");

    if (hovered) {
      ctx.fillStyle = colors.hover;
      ctx.fillRect(cell.x, cell.y, cell.width, cell.height);
    }

    if (cell.width > 54 && cell.height > 28) {
      ctx.font = "700 10px 'SFMono-Regular', Menlo, Consolas, monospace";
      ctx.fillStyle = "#2f2b24";
      ctx.fillText(fitMiddle(ctx, file.name, cell.width - 8), cell.x + 4, cell.y + 12);
      if (cell.height > 45) {
        ctx.font = "10px 'SFMono-Regular', Menlo, Consolas, monospace";
        ctx.fillStyle = colors.muted;
        ctx.fillText(`${Math.round(lines).toLocaleString()} lines`, cell.x + 4, cell.y + 27);
      }
    }

    state.hitboxes.push({
      x: cell.x,
      y: cell.y,
      width: cell.width,
      height: cell.height,
      path: file.path,
    });
  }
}

function drawNoFiles(ctx) {
  const canvas = els.canvas;
  const rect = canvas.getBoundingClientRect();
  ctx.textAlign = "center";
  ctx.fillStyle = colors.muted;
  ctx.font = "700 16px 'Avenir Next', Candara, sans-serif";
  ctx.fillText("No code files matched the current filters.", rect.width / 2, rect.height / 2);
  ctx.textAlign = "left";
}

function drawChangeBlock(ctx, cell, amount, maxLines, color, anchor) {
  if (amount <= 0 || maxLines <= 0 || cell.width <= 0 || cell.height <= 0) {
    return;
  }
  const block = areaRect(cell, amount / maxLines, anchor, true);
  if (block.width <= 0 || block.height <= 0) {
    return;
  }
  ctx.fillStyle = color;
  ctx.fillRect(block.x, block.y, block.width, block.height);
}

function areaRect(rect, ratio, anchor, useMinSize) {
  const cleanRatio = clamp(ratio, 0, 1);
  if (cleanRatio <= 0) {
    return { x: rect.x, y: rect.y, width: 0, height: 0 };
  }
  const scale = Math.sqrt(cleanRatio);
  const minSize = useMinSize ? 2 : 0;
  const width = Math.min(rect.width, Math.max(minSize, rect.width * scale));
  const height = Math.min(rect.height, Math.max(minSize, rect.height * scale));
  if (anchor === "top-left") {
    return { x: rect.x, y: rect.y, width, height };
  }
  if (anchor === "bottom-right") {
    return {
      x: rect.x + rect.width - width,
      y: rect.y + rect.height - height,
      width,
      height,
    };
  }
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  };
}

function drawHover(ctx, width, frame, layout) {
  const path = state.hoverPath;
  if (!path) {
    return;
  }
  const file = layout.byPath.get(path);
  if (!file) {
    return;
  }

  const change = state.renderChanges.get(path) || { additions: 0, deletions: 0 };
  const lines = Math.round(state.renderFiles.get(path) || 0);
  const boxWidth = Math.min(520, width - 36);
  const boxHeight = 86;
  const left = clamp(file.rect.x, 18, Math.max(18, width - boxWidth - 18));
  const top = clamp(file.rect.y + file.rect.height + 8, 18, Math.max(18, els.canvas.getBoundingClientRect().height - boxHeight - 18));

  ctx.fillStyle = "#fffaf0";
  ctx.fillRect(left, top, boxWidth, boxHeight);
  ctx.strokeStyle = colors.line;
  ctx.strokeRect(left, top, boxWidth, boxHeight);
  ctx.font = "700 12px 'SFMono-Regular', Menlo, Consolas, monospace";
  ctx.fillStyle = colors.ink;
  ctx.fillText(fitMiddle(ctx, path, boxWidth - 24), left + 12, top + 24);
  ctx.font = "12px 'SFMono-Regular', Menlo, Consolas, monospace";
  ctx.fillStyle = colors.muted;
  ctx.fillText(
    `${lines.toLocaleString()} lines now   visual ${Math.round(file.layoutLines).toLocaleString()}   max ${file.maxLines.toLocaleString()}   +${Math.round(change.additions).toLocaleString()}   -${Math.round(change.deletions).toLocaleString()}`,
    left + 12,
    top + 52
  );
  ctx.fillText(`commit ${frame.index + 1}`, left + 12, top + 72);
}

function fitMiddle(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  if (text.length <= 6) {
    return text;
  }
  let left = Math.ceil(text.length / 2);
  let right = Math.floor(text.length / 2);
  while (left > 2 && right > 2) {
    const next = `${text.slice(0, left)}...${text.slice(text.length - right)}`;
    if (ctx.measureText(next).width <= maxWidth) {
      return next;
    }
    if (left >= right) {
      left -= 1;
    } else {
      right -= 1;
    }
  }
  return `${text.slice(0, 2)}...`;
}

function fileGap(rect) {
  const shortSide = Math.min(rect.width, rect.height);
  if (shortSide < 4) {
    return 0;
  }
  if (shortSide < 12) {
    return 0.5;
  }
  return 1;
}

function insetRect(rect, amount) {
  return {
    x: rect.x + amount,
    y: rect.y + amount,
    width: Math.max(0, rect.width - amount * 2),
    height: Math.max(0, rect.height - amount * 2),
  };
}

function snapRect(rect) {
  return {
    x: Math.round(rect.x * 2) / 2,
    y: Math.round(rect.y * 2) / 2,
    width: Math.max(0, Math.round(rect.width * 2) / 2),
    height: Math.max(0, Math.round(rect.height * 2) / 2),
  };
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

function setStatus(message) {
  els.status.textContent = message;
}

function showProgress(message, done, total) {
  els.progress.hidden = false;
  updateProgress(done, total, message);
}

function hideProgress() {
  els.progress.hidden = true;
  els.progressFill.classList.remove("indeterminate");
  els.progressFill.style.width = "0%";
  els.progressTrack.setAttribute("aria-valuenow", "0");
  els.progressLabel.textContent = "Idle";
  els.progressPct.textContent = "0%";
}

function updateProgress(done, total, message) {
  const cleanDone = Math.max(0, Number(done) || 0);
  const cleanTotal = Math.max(0, Number(total) || 0);
  els.progress.hidden = false;
  els.progressLabel.textContent = message || "Loading history";
  if (cleanTotal <= 0) {
    els.progressFill.classList.add("indeterminate");
    els.progressFill.style.width = "";
    els.progressTrack.removeAttribute("aria-valuenow");
    els.progressPct.textContent = "...";
    return;
  }

  const percent = Math.min(100, Math.round((cleanDone / cleanTotal) * 100));
  els.progressFill.classList.remove("indeterminate");
  els.progressFill.style.width = `${percent}%`;
  els.progressTrack.setAttribute("aria-valuenow", String(percent));
  els.progressPct.textContent = `${cleanDone.toLocaleString()}/${cleanTotal.toLocaleString()}  ${percent}%`;
}

draw();
if (DEFAULT_REPO) {
  loadHistory();
}
