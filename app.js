const STORAGE_KEY = "story-checkin-v1";
const palette = ["#8fb8a8", "#e0a46b", "#8aa4d6", "#d7838f", "#a99ad6", "#d8c06a", "#72b7c9", "#9dbf7a"];
const iconMap = [
  ["买菜", "菜", "🥬"], ["购物", "购", "🛒"], ["游泳", "泳", "🏊"], ["读书", "书", "📚"],
  ["阅读", "阅", "📚"], ["朋友", "友", "👥"], ["聚会", "聚", "🎉"], ["游戏", "游", "🎮"],
  ["跑步", "跑", "🏃"], ["健身", "练", "💪"], ["散步", "步", "🚶"], ["做饭", "饭", "🍳"],
  ["学习", "学", "✏️"], ["写作", "写", "📝"], ["工作", "工", "💼"], ["睡觉", "睡", "🌙"],
  ["电影", "影", "🎬"], ["音乐", "音", "🎧"], ["整理", "整", "🧺"], ["骑车", "骑", "🚲"]
];
const seedStories = [
  "上午跑步二十分钟，晚上读书。",
  "今天买菜做饭，和朋友聊天。",
  "午后游泳，晚上打游戏放松。",
  "今天学习了一会儿，也整理了房间。",
  "下班后散步，看了一部电影。"
];

let state = loadState();
let expandedTaskId = null;
let filteredTaskId = null;
let parsedDraft = [];
let draftOriginal = "";
let selectedDay = null;
let editingTaskId = null;
let recording = false;
let recognition = null;
let transcriptBuffer = "";
let interimTranscript = "";
let silenceTimer = null;
let lastArcTapAt = 0;
let longPressTimer = null;
let reorderState = null;
let audioContext = null;
let analyser = null;
let microphoneStream = null;
let audioFrame = null;
let lastVolumeAt = 0;

const $ = (id) => document.getElementById(id);

const els = {
  taskGrid: $("taskGrid"),
  calendarGrid: $("calendarGrid"),
  calendarMode: $("calendarMode"),
  todayLabel: $("todayLabel"),
  showAllButton: $("showAllButton"),
  arcControl: $("arcControl"),
  arcHint: $("arcHint"),
  voiceStatus: $("voiceStatus"),
  textModal: $("textModal"),
  storyInput: $("storyInput"),
  cancelText: $("cancelText"),
  submitText: $("submitText"),
  confirmModal: $("confirmModal"),
  confirmOriginal: $("confirmOriginal"),
  parsedList: $("parsedList"),
  manualEventInput: $("manualEventInput"),
  addManualEvent: $("addManualEvent"),
  cancelConfirm: $("cancelConfirm"),
  saveCheckin: $("saveCheckin"),
  dayModal: $("dayModal"),
  dayDate: $("dayDate"),
  dayTitle: $("dayTitle"),
  dayOriginal: $("dayOriginal"),
  dayEvents: $("dayEvents"),
  dayManualInput: $("dayManualInput"),
  dayAddEvent: $("dayAddEvent"),
  closeDay: $("closeDay"),
  taskEditModal: $("taskEditModal"),
  editTaskName: $("editTaskName"),
  editTaskIcon: $("editTaskIcon"),
  editTaskColor: $("editTaskColor"),
  cancelTaskEdit: $("cancelTaskEdit"),
  saveTaskEdit: $("saveTaskEdit"),
  toast: $("toast"),
  confettiLayer: $("confettiLayer")
};

function todayKey() {
  return formatDate(new Date());
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date) {
  const next = new Date(date);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return JSON.parse(saved);
  return createSeedState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createSeedState() {
  const tasks = [
    makeTask("读书", "📚", "#8fb8a8"),
    makeTask("游泳", "🏊", "#72b7c9"),
    makeTask("买菜", "🥬", "#9dbf7a"),
    makeTask("打游戏", "🎮", "#a99ad6"),
    makeTask("跑步", "🏃", "#d7838f"),
    makeTask("和朋友玩", "👥", "#e0a46b")
  ];
  const entries = {};
  for (let i = 0; i < 42; i += 1) {
    const date = formatDate(addDays(new Date(), -i));
    if (Math.random() < 0.42 && i !== 0) continue;
    const count = 1 + Math.floor(Math.random() * 3);
    const shuffled = [...tasks].sort(() => Math.random() - 0.5);
    entries[date] = {
      date,
      original: seedStories[i % seedStories.length],
      title: summarize(seedStories[i % seedStories.length], shuffled.slice(0, count).map((task) => task.name)),
      taskIds: shuffled.slice(0, count).map((task) => task.id)
    };
  }
  return { tasks, entries };
}

function makeTask(name, icon, color) {
  return { id: uid("task"), name, icon, color };
}

function taskById(id) {
  return state.tasks.find((task) => task.id === id);
}

function eventMeta(name) {
  const found = iconMap.find(([key]) => name.includes(key) || key.includes(name));
  const icon = found ? found[2] : "✨";
  const color = palette[Math.abs(hash(name)) % palette.length];
  return { icon, color };
}

function hash(text) {
  return [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function findOrCreateTask(name) {
  const normalized = name.trim();
  let task = state.tasks.find((item) => item.name === normalized);
  if (!task) {
    const meta = eventMeta(normalized);
    task = makeTask(normalized, meta.icon, meta.color);
    state.tasks.push(task);
  }
  return task;
}

const taskAliasMap = [
  ["学英语", ["英语", "背单词", "单词", "口语", "听力", "外语", "英文"]],
  ["读书", ["看书", "阅读", "读完", "读了", "书"]],
  ["跑步", ["晨跑", "夜跑", "慢跑", "跑了"]],
  ["游泳", ["泳池", "游了泳", "下水"]],
  ["健身", ["撸铁", "训练", "练腿", "练胸", "运动"]],
  ["买菜", ["采购", "菜市场", "超市买菜"]],
  ["打游戏", ["游戏", "玩游戏", "开黑"]],
  ["和朋友玩", ["朋友", "聚会", "见朋友", "聊天"]]
];

function existingTaskMatches(text) {
  const found = new Set();
  state.tasks.forEach((task) => {
    if (text.includes(task.name)) {
      found.add(task.name);
      return;
    }
    const aliasEntry = taskAliasMap.find(([name]) => name === task.name || task.name.includes(name) || name.includes(task.name));
    if (aliasEntry?.[1].some((alias) => text.includes(alias))) found.add(task.name);
  });
  return found;
}

function parseEvents(text) {
  const triggerPattern = /(帮我)?(打卡|记录|记一下|记上|存一下|保存一下)(一下)?(这个|这件事|这项)?|(这个|这件事|这项)(帮我)?(打卡|记录|记一下|记上|存一下|保存一下)(一下)?/;
  const segments = text
    .split(/[。！？!?\n]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => triggerPattern.test(segment));
  const source = segments.join("。");
  const found = existingTaskMatches(text);
  if (!source) return [...found].slice(0, 8);
  const known = iconMap.map(([key]) => key);
  known.forEach((key) => {
    if (source.includes(key)) found.add(key === "阅读" ? "读书" : key === "游戏" ? "打游戏" : key);
  });
  source
    .split(/[，。！？、,.!?\n\s]+/)
    .map((part) => part
      .replace(/今天|上午|下午|晚上|然后|还有|一下|一会儿|了|去|和/g, "")
      .replace(/帮我|打卡|记录|记一下|记上|存一下|保存一下|这个|这件事|这项/g, "")
      .trim())
    .filter((part) => part.length >= 2 && part.length <= 8)
    .forEach((part) => {
      if (!["我讲完", "OK保存", "保存"].some((stop) => part.includes(stop))) found.add(part);
    });
  return [...found].slice(0, 8);
}

async function parseWithAI(text) {
  const response = await fetch("/api/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      existingTasks: state.tasks.map((task) => ({
        name: task.name,
        icon: task.icon,
        color: task.color
      }))
    })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "AI parse failed");
  }
  return response.json();
}

function localParsedDraft(text) {
  const names = parseEvents(text);
  return names.map((name) => {
    const existing = state.tasks.find((task) => task.name === name);
    const meta = existing || eventMeta(name);
    return {
      name,
      icon: meta.icon,
      color: meta.color,
      selected: true
    };
  });
}

function summarize(text, names) {
  if (names.length === 0) return "今日记录";
  if (names.length === 1) return `${names[0]}小记`;
  return `${names.slice(0, 2).join("与")}`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  setTimeout(() => els.toast.classList.add("hidden"), 1900);
}

function celebrate() {
  const colors = ["#8fb8a8", "#e0a46b", "#8aa4d6", "#d7838f", "#a99ad6", "#d8c06a", "#72b7c9", "#f6f1e7", "#f06f5f"];
  const shapes = ["rect", "dot", "star"];
  els.confettiLayer.innerHTML = "";
  els.confettiLayer.classList.add("active");
  for (let i = 0; i < 96; i += 1) {
    const piece = document.createElement("span");
    const side = i % 2 === 0 ? "left" : "right";
    const spread = Math.random() * 42 + 18;
    piece.className = `confetti-piece ${shapes[i % shapes.length]} ${side}`;
    piece.style.setProperty("--start-x", side === "left" ? "18vw" : "82vw");
    piece.style.setProperty("--x", `${side === "left" ? spread : -spread}vw`);
    piece.style.setProperty("--y", `${Math.random() * -62 - 34}vh`);
    piece.style.setProperty("--fall", `${Math.random() * 24 + 12}vh`);
    piece.style.setProperty("--r", `${Math.random() * 900 - 450}deg`);
    piece.style.setProperty("--c", colors[i % colors.length]);
    piece.style.animationDelay = `${Math.random() * 260}ms`;
    els.confettiLayer.appendChild(piece);
  }
  for (let i = 0; i < 16; i += 1) {
    const burst = document.createElement("span");
    burst.className = `confetti-burst ${i % 2 === 0 ? "left" : "right"}`;
    burst.style.animationDelay = `${i * 18}ms`;
    els.confettiLayer.appendChild(burst);
  }
  setTimeout(() => {
    els.confettiLayer.classList.remove("active");
    els.confettiLayer.innerHTML = "";
  }, 2100);
}

function render() {
  saveState();
  renderTasks();
  renderCalendar();
  els.todayLabel.textContent = todayKey();
}

function renderTasks() {
  els.taskGrid.innerHTML = "";
  state.tasks.forEach((task, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "task-card";
    card.dataset.index = String(index);
    card.style.setProperty("--task-color", task.color);
    if (filteredTaskId === task.id) card.classList.add("filtered");
    const stats = statsFor(task.id);
    card.innerHTML = `
      <div class="task-top">
        <span class="task-identity">
          <span class="task-icon">${task.icon}</span>
          <span class="task-name" data-title-edit-trigger="true">${task.name}</span>
        </span>
        <span class="task-count">累计 ${stats.total} 次</span>
      </div>
    `;
    bindTaskGestures(card, task, index);
    els.taskGrid.appendChild(card);
    if (shouldInsertExpandedRow(task, index)) {
      els.taskGrid.appendChild(expandedRow());
    }
  });
}

function shouldInsertExpandedRow(task, index) {
  if (!expandedTaskId) return false;
  if (task.id === expandedTaskId && index % 2 === 1) return true;
  if (task.id === expandedTaskId && index === state.tasks.length - 1) return true;
  if (index % 2 === 1) return state.tasks[index - 1]?.id === expandedTaskId;
  return false;
}

function expandedRow() {
  const task = taskById(expandedTaskId);
  const row = document.createElement("div");
  row.className = "task-expanded-row";
  row.style.setProperty("--task-color", task?.color || palette[0]);
  row.innerHTML = statsInlineHtml(statsFor(expandedTaskId));
  return row;
}

function statsInlineHtml(stats) {
  return `
    <div class="task-stats-inline">
      <span><strong>${stats.week}</strong><em>本周</em></span>
      <span><strong>${stats.month}</strong><em>本月</em></span>
      <span><strong>${stats.last || "暂无"}</strong><em>最近一次</em></span>
    </div>
  `;
}

function cardSnapshot() {
  return [...els.taskGrid.querySelectorAll(".task-card")].map((card) => ({
    index: Number(card.dataset.index),
    rect: card.getBoundingClientRect()
  }));
}

function getDropIndex(clientX, clientY) {
  const items = reorderState?.items || cardSnapshot();
  const candidates = [];
  items.forEach((item) => {
    if (item.index === reorderState?.sourceIndex) return;
    candidates.push({
      index: item.index,
      x: item.rect.left,
      y: item.rect.top + item.rect.height / 2
    });
    candidates.push({
      index: item.index + 1,
      x: item.rect.right,
      y: item.rect.top + item.rect.height / 2
    });
  });
  if (candidates.length === 0) return 0;
  return candidates.reduce((best, candidate) => {
    const distance = Math.hypot(clientX - candidate.x, clientY - candidate.y);
    return distance < best.distance ? { index: candidate.index, distance } : best;
  }, { index: 0, distance: Infinity }).index;
}

function dropLineRect(index) {
  const items = reorderState?.items || cardSnapshot();
  const before = items.find((item) => item.index === index);
  if (before) {
    return {
      left: before.rect.left,
      top: before.rect.top - 5,
      width: before.rect.width
    };
  }
  const last = items[items.length - 1];
  if (!last) {
    const grid = els.taskGrid.getBoundingClientRect();
    return { left: grid.left + 2, top: grid.top + 2, width: grid.width - 4 };
  }
  return {
    left: last.rect.left,
    top: last.rect.bottom + 5,
    width: last.rect.width
  };
}

function showDropIndicator(index) {
  if (!reorderState?.indicator) return;
  const rect = dropLineRect(index);
  reorderState.indicator.style.left = `${rect.left}px`;
  reorderState.indicator.style.top = `${rect.top}px`;
  reorderState.indicator.style.width = `${rect.width}px`;
}

function endReorder({ commit } = { commit: false }) {
  clearTimeout(longPressTimer);
  if (!reorderState) return;
  const { sourceIndex, dropIndex, ghost, indicator, sourceCard } = reorderState;
  ghost.remove();
  indicator.remove();
  sourceCard.classList.remove("dragging-placeholder");
  els.taskGrid.classList.remove("reordering");
  if (commit && dropIndex !== sourceIndex && dropIndex !== sourceIndex + 1) {
    const [moved] = state.tasks.splice(sourceIndex, 1);
    const adjustedIndex = dropIndex > sourceIndex ? dropIndex - 1 : dropIndex;
    state.tasks.splice(adjustedIndex, 0, moved);
  }
  reorderState = null;
  render();
}

function openTaskEdit(taskId) {
  const task = taskById(taskId);
  if (!task) return;
  editingTaskId = taskId;
  els.editTaskName.value = task.name;
  els.editTaskIcon.value = task.icon;
  els.editTaskColor.value = task.color;
  els.taskEditModal.classList.remove("hidden");
  setTimeout(() => els.editTaskName.focus(), 80);
}

function closeTaskEdit() {
  editingTaskId = null;
  els.taskEditModal.classList.add("hidden");
}

function saveTaskEdit() {
  const task = taskById(editingTaskId);
  if (!task) return closeTaskEdit();
  task.name = els.editTaskName.value.trim() || task.name;
  task.icon = els.editTaskIcon.value.trim() || task.icon;
  task.color = els.editTaskColor.value || task.color;
  closeTaskEdit();
  render();
}

function bindTaskGestures(card, task, index) {
  let taps = 0;
  let timer = null;
  let longPressed = false;
  let pressStartX = 0;
  let pressStartY = 0;
  card.addEventListener("click", (event) => {
    if (expandedTaskId === task.id && event.target.closest("[data-title-edit-trigger]")) {
      openTaskEdit(task.id);
      return;
    }
    if (longPressed) {
      longPressed = false;
      return;
    }
    taps += 1;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (taps === 1) {
        if (filteredTaskId === task.id) filteredTaskId = null;
        else expandedTaskId = expandedTaskId === task.id ? null : task.id;
      }
      if (taps >= 2) filteredTaskId = filteredTaskId === task.id ? null : task.id;
      taps = 0;
      render();
    }, 220);
  });
  card.addEventListener("pointerdown", (event) => {
    if (event.target.matches("input")) return;
    longPressed = false;
    pressStartX = event.clientX;
    pressStartY = event.clientY;
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      longPressed = true;
      const rect = card.getBoundingClientRect();
      const ghost = card.cloneNode(true);
      const indicator = document.createElement("div");
      ghost.classList.add("task-ghost");
      ghost.style.width = `${rect.width}px`;
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.setProperty("--task-color", task.color);
      indicator.className = "drop-indicator";
      document.body.appendChild(ghost);
      document.body.appendChild(indicator);
      card.classList.add("dragging-placeholder");
      els.taskGrid.classList.add("reordering");
      reorderState = {
        sourceIndex: index,
        dropIndex: index,
        ghost,
        indicator,
        sourceCard: card,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        items: cardSnapshot()
      };
      showDropIndicator(index);
      showToast("拖到想放的位置后松手");
    }, 520);
  });
  card.addEventListener("pointermove", (event) => {
    if (!reorderState && Math.hypot(event.clientX - pressStartX, event.clientY - pressStartY) > 12) {
      clearTimeout(longPressTimer);
      return;
    }
    if (!reorderState) return;
    reorderState.ghost.style.left = `${event.clientX - reorderState.offsetX}px`;
    reorderState.ghost.style.top = `${event.clientY - reorderState.offsetY}px`;
    const nextIndex = getDropIndex(event.clientX, event.clientY);
    if (nextIndex === reorderState.dropIndex) return;
    reorderState.dropIndex = nextIndex;
    showDropIndicator(nextIndex);
  });
  card.addEventListener("pointerup", () => {
    if (reorderState) endReorder({ commit: true });
    else clearTimeout(longPressTimer);
  });
  card.addEventListener("pointercancel", () => {
    if (reorderState) endReorder({ commit: false });
    else clearTimeout(longPressTimer);
  });
}

function statsFor(taskId) {
  const now = new Date();
  const weekStart = startOfWeek(now);
  let total = 0;
  let week = 0;
  let month = 0;
  let last = "";
  Object.values(state.entries).forEach((entry) => {
    if (!entry.taskIds.includes(taskId)) return;
    total += 1;
    const date = parseDate(entry.date);
    if (date >= weekStart) week += 1;
    if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) month += 1;
    if (!last || entry.date > last) last = entry.date;
  });
  return { total, week, month, last };
}

function renderCalendar() {
  els.calendarMode.textContent = filteredTaskId ? `${taskById(filteredTaskId)?.name || ""}记录` : "全部记录";
  els.calendarGrid.innerHTML = "";
  const start = startOfWeek(new Date());
  for (let week = 0; week < 18; week += 1) {
    const row = document.createElement("div");
    row.className = "week-row";
    for (let day = 0; day < 7; day += 1) {
      const date = addDays(start, day - week * 7);
      const key = formatDate(date);
      row.appendChild(dayCell(key));
    }
    els.calendarGrid.appendChild(row);
  }
}

function dayCell(key) {
  const entry = state.entries[key];
  const ids = entry ? entry.taskIds.filter((id) => !filteredTaskId || id === filteredTaskId) : [];
  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "day-cell";
  if (key === todayKey()) cell.classList.add("today");
  cell.innerHTML = `<span class="day-number">${parseDate(key).getDate()}</span><div class="color-stack"></div>`;
  const stack = cell.querySelector(".color-stack");
  ids.forEach((id) => {
    const task = taskById(id);
    if (!task) return;
    const strip = document.createElement("span");
    strip.style.background = task.color;
    stack.appendChild(strip);
  });
  cell.addEventListener("click", () => openDay(key));
  return cell;
}

function openTextModal() {
  els.storyInput.value = "";
  els.textModal.classList.remove("hidden");
  setTimeout(() => els.storyInput.focus(), 80);
}

function closeTextModal() {
  els.textModal.classList.add("hidden");
}

async function beginParse(text) {
  draftOriginal = text.trim();
  if (!draftOriginal) {
    showToast("先写一点今天的故事");
    return;
  }
  showToast("正在解析故事");
  try {
    const aiResult = await parseWithAI(draftOriginal);
    parsedDraft = (aiResult.events || []).map((event) => {
      const existing = state.tasks.find((task) => task.name === event.name);
      return {
        name: event.name,
        icon: existing?.icon || event.icon || eventMeta(event.name).icon,
        color: existing?.color || event.color || eventMeta(event.name).color,
        selected: true
      };
    });
  } catch (error) {
    parsedDraft = localParsedDraft(draftOriginal);
    showToast("AI 暂不可用，已用本地解析");
  }
  if (parsedDraft.length === 0) showToast("没有检测到打卡指令，可手动新增");
  renderParsed();
  closeTextModal();
  els.confirmOriginal.textContent = draftOriginal;
  els.confirmModal.classList.remove("hidden");
  showToast("解析完成");
}

function renderParsed() {
  els.parsedList.innerHTML = "";
  if (parsedDraft.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-parsed";
    empty.textContent = "没有发现明确的打卡指令。你可以说“读书这个帮我打卡一下”，也可以在下面手动新增。";
    els.parsedList.appendChild(empty);
    return;
  }
  parsedDraft.forEach((item, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `parsed-card${item.selected ? "" : " unselected"}`;
    card.style.setProperty("--event-color", item.color);
    card.innerHTML = `<span>${item.icon}</span><strong>${item.name}</strong>`;
    card.addEventListener("click", () => {
      const selectedCount = parsedDraft.filter((draft) => draft.selected).length;
      if (selectedCount === parsedDraft.length) {
        parsedDraft.forEach((draft, draftIndex) => draft.selected = draftIndex === index);
      } else {
        item.selected = !item.selected;
      }
      renderParsed();
    });
    els.parsedList.appendChild(card);
  });
}

function saveCheckin() {
  const selected = parsedDraft.filter((item) => item.selected);
  if (selected.length === 0) {
    showToast("请选择至少一个事项");
    return;
  }
  const ids = selected.map((item) => findOrCreateTask(item.name).id);
  const key = todayKey();
  const existing = state.entries[key];
  state.entries[key] = {
    date: key,
    original: existing?.original ? `${existing.original}\n${draftOriginal}` : draftOriginal,
    title: summarize(draftOriginal, selected.map((item) => item.name)),
    taskIds: [...new Set([...(existing?.taskIds || []), ...ids])]
  };
  els.confirmModal.classList.add("hidden");
  showToast("已打卡");
  celebrate();
  render();
}

function openDay(key) {
  selectedDay = key;
  const entry = state.entries[key] || { date: key, original: "这一天还没有记录。", title: "空白的一天", taskIds: [] };
  els.dayDate.textContent = key;
  els.dayTitle.textContent = entry.title || "今日记录";
  els.dayOriginal.textContent = entry.original || "这一天还没有记录。";
  renderDayEvents(entry);
  els.dayModal.classList.remove("hidden");
}

function renderDayEvents(entry) {
  els.dayEvents.innerHTML = "";
  entry.taskIds.forEach((id) => {
    const task = taskById(id);
    if (!task) return;
    const item = document.createElement("div");
    item.className = "day-event";
    item.style.setProperty("--event-color", task.color);
    item.innerHTML = `<button class="delete-event" type="button" aria-label="删除">×</button><span>${task.icon}</span><strong>${task.name}</strong>`;
    item.querySelector("button").addEventListener("click", () => {
      entry.taskIds = entry.taskIds.filter((taskId) => taskId !== id);
      state.entries[selectedDay] = entry;
      renderDayEvents(entry);
      render();
    });
    els.dayEvents.appendChild(item);
  });
}

function addEventToDay() {
  const name = els.dayManualInput.value.trim();
  if (!name || !selectedDay) return;
  const task = findOrCreateTask(name);
  const entry = state.entries[selectedDay] || { date: selectedDay, original: "", title: `${name}小记`, taskIds: [] };
  entry.taskIds = [...new Set([...entry.taskIds, task.id])];
  if (!entry.original) entry.original = "手动新增记录。";
  state.entries[selectedDay] = entry;
  els.dayManualInput.value = "";
  renderDayEvents(entry);
  render();
}

function setupSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const rec = new SpeechRecognition();
  rec.lang = "zh-CN";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += text;
      else interimText += text;
    }
    if (interimText) interimTranscript = interimText;
    if (finalText) {
      transcriptBuffer += finalText;
      interimTranscript = "";
      resetSilenceTimer();
      if (/我讲完了|讲完了|OK保存|保存吧|结束录音/.test(transcriptBuffer)) stopRecording();
    }
  };
  rec.onerror = (event) => {
    stopRecording();
    showToast(event.error === "not-allowed" ? "浏览器没有麦克风权限" : "语音识别中断，可以双击打字");
  };
  rec.onend = () => {
    if (recording) stopRecording();
  };
  return rec;
}

async function startMicrophoneMeter() {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaStreamSource(microphoneStream);
    source.connect(analyser);
    lastVolumeAt = Date.now();
    animateMeter();
    return true;
  } catch (error) {
    showToast(error.name === "NotAllowedError" ? "请允许网页使用麦克风" : "没有拿到麦克风声音");
    return false;
  }
}

function animateMeter() {
  if (!recording || !analyser) return;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  data.forEach((value) => {
    const centered = value - 128;
    sum += centered * centered;
  });
  const rms = Math.sqrt(sum / data.length);
  const level = Math.min(1, rms / 28);
  if (level > 0.035) {
    lastVolumeAt = Date.now();
    resetSilenceTimer();
  }
  document.documentElement.style.setProperty("--voice-level", String(level));
  audioFrame = requestAnimationFrame(animateMeter);
}

function stopMicrophoneMeter() {
  if (audioFrame) cancelAnimationFrame(audioFrame);
  audioFrame = null;
  if (microphoneStream) {
    microphoneStream.getTracks().forEach((track) => track.stop());
  }
  microphoneStream = null;
  analyser = null;
  if (audioContext) {
    audioContext.close().catch(() => {});
  }
  audioContext = null;
  document.documentElement.style.setProperty("--voice-level", "0");
}

function voiceSupportStatus() {
  const hasSpeechRecognition = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const hasMicrophoneApi = Boolean(navigator.mediaDevices?.getUserMedia);
  const protocol = window.location.protocol;
  if (!hasMicrophoneApi) {
    return {
      ok: false,
      message: "当前浏览器没有开放麦克风能力。请用手机 Chrome/Edge/Safari 打开，或先用双击打字。"
    };
  }
  if (protocol === "file:") {
    return {
      ok: false,
      message: "当前是本地 file 页面，内置浏览器没有提供语音转文字能力。部署到 HTTPS 或用支持 Web Speech 的浏览器打开后可用。"
    };
  }
  if (!window.isSecureContext) {
    return {
      ok: false,
      message: "当前页面不是安全环境，浏览器会关闭语音能力。请用 HTTPS 地址打开。"
    };
  }
  if (hasSpeechRecognition) return { ok: true, message: "语音识别可用" };
  return { ok: true, message: "麦克风可用，但当前浏览器可能不能自动转文字" };
}

function renderVoiceStatus() {
  const support = voiceSupportStatus();
  els.voiceStatus.textContent = support.ok ? support.message : "此环境语音不可用，双击可打字";
  els.voiceStatus.className = `voice-status ${support.ok ? "ok" : "warn"}`;
  els.arcControl.title = support.message;
}

function resetSilenceTimer() {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    if (recording) stopRecording();
  }, 15000);
}

async function startRecording() {
  const support = voiceSupportStatus();
  if (!support.ok) {
    showToast(support.message);
    setTimeout(openTextModal, 900);
    return;
  }
  recognition = recognition || setupSpeech();
  transcriptBuffer = "";
  interimTranscript = "";
  recording = true;
  els.arcControl.classList.add("recording");
  els.arcHint.textContent = "正在收音";
  resetSilenceTimer();
  const micReady = await startMicrophoneMeter();
  if (!micReady) {
    stopRecording();
    return;
  }
  showToast("麦克风已连接，开始讲述");
  if (recognition) {
    try {
      recognition.start();
    } catch {
      showToast("语音启动中，请稍后再试");
    }
  } else {
    showToast("当前浏览器不支持语音，双击可打字");
  }
}

function stopRecording(options = {}) {
  clearTimeout(silenceTimer);
  recording = false;
  els.arcControl.classList.remove("recording");
  els.arcHint.textContent = "单击讲述今天，双击打字";
  stopMicrophoneMeter();
  if (recognition) {
    try { recognition.stop(); } catch {}
  }
  if (options.silent) return;
  const clean = `${transcriptBuffer} ${interimTranscript}`.replace(/我讲完了|讲完了|OK保存|保存吧|结束录音/g, "").trim();
  if (clean) beginParse(clean);
  else if (Date.now() - lastVolumeAt < 3000) showToast("听到声音了，但浏览器没有转成文字");
  else showToast("没有听到内容，请检查网页麦克风权限");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

els.arcControl.addEventListener("pointerup", (event) => {
  event.preventDefault();
  const now = Date.now();
  const isDoubleTap = now - lastArcTapAt < 280;
  lastArcTapAt = now;
  if (isDoubleTap) {
    if (recording) stopRecording({ silent: true });
    openTextModal();
    return;
  }
  if (recording) stopRecording();
  else startRecording();
});

els.cancelText.addEventListener("click", closeTextModal);
els.submitText.addEventListener("click", () => beginParse(els.storyInput.value));
els.cancelConfirm.addEventListener("click", () => els.confirmModal.classList.add("hidden"));
els.saveCheckin.addEventListener("click", saveCheckin);
els.addManualEvent.addEventListener("click", () => {
  const name = els.manualEventInput.value.trim();
  if (!name) return;
  const meta = eventMeta(name);
  parsedDraft.push({ name, icon: meta.icon, color: meta.color, selected: true });
  els.manualEventInput.value = "";
  renderParsed();
});
els.showAllButton.addEventListener("click", () => {
  filteredTaskId = null;
  render();
});
els.closeDay.addEventListener("click", () => els.dayModal.classList.add("hidden"));
els.dayModal.addEventListener("click", (event) => {
  if (event.target === els.dayModal) els.dayModal.classList.add("hidden");
});
els.dayAddEvent.addEventListener("click", addEventToDay);
els.cancelTaskEdit.addEventListener("click", closeTaskEdit);
els.saveTaskEdit.addEventListener("click", saveTaskEdit);
els.taskEditModal.addEventListener("click", (event) => {
  if (event.target === els.taskEditModal) closeTaskEdit();
});
document.addEventListener("pointermove", (event) => {
  if (!reorderState) return;
  event.preventDefault();
  reorderState.ghost.style.left = `${event.clientX - reorderState.offsetX}px`;
  reorderState.ghost.style.top = `${event.clientY - reorderState.offsetY}px`;
  const nextIndex = getDropIndex(event.clientX, event.clientY);
  if (nextIndex !== reorderState.dropIndex) {
    reorderState.dropIndex = nextIndex;
    showDropIndicator(nextIndex);
  }
}, { passive: false });
document.addEventListener("pointerup", () => {
  if (reorderState) endReorder({ commit: true });
});
document.addEventListener("pointercancel", () => {
  if (reorderState) endReorder({ commit: false });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (reorderState) endReorder({ commit: false });
    document.querySelectorAll(".modal-layer").forEach((modal) => modal.classList.add("hidden"));
  }
});

render();
renderVoiceStatus();
