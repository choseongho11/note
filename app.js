const STORAGE_KEY = "everyday-notes:v1";
const SETTINGS_KEY = "everyday-notes:settings";
const DEFAULT_SUMMARY_ENDPOINT =
  window.location.protocol === "file:" ? "http://localhost:1500/summarize" : `${window.location.origin}/summarize`;

const notesList = document.querySelector("#notesList");
const titleInput = document.querySelector("#titleInput");
const bodyInput = document.querySelector("#bodyInput");
const searchInput = document.querySelector("#searchInput");
const newNoteBtn = document.querySelector("#newNoteBtn");
const deleteBtn = document.querySelector("#deleteBtn");
const exportBtn = document.querySelector("#exportBtn");
const importInput = document.querySelector("#importInput");
const voiceBtn = document.querySelector("#voiceBtn");
const voiceStatus = document.querySelector("#voiceStatus");
const summaryEndpointInput = document.querySelector("#summaryEndpointInput");
const summarizeBtn = document.querySelector("#summarizeBtn");
const summaryOutput = document.querySelector("#summaryOutput");

let notes = loadNotes();
let activeId = notes[0]?.id ?? createNote().id;
let settings = loadSettings();
let recognition = null;

summaryEndpointInput.value = settings.summaryEndpoint ?? DEFAULT_SUMMARY_ENDPOINT;

render();

newNoteBtn.addEventListener("click", () => {
  activeId = createNote().id;
  render();
  titleInput.focus();
});

deleteBtn.addEventListener("click", () => {
  if (notes.length <= 1) {
    updateActiveNote({ title: "", body: "", summary: "" });
    render();
    return;
  }

  notes = notes.filter((note) => note.id !== activeId);
  activeId = notes[0].id;
  persist();
  render();
});

titleInput.addEventListener("input", () => updateActiveNote({ title: titleInput.value }));
bodyInput.addEventListener("input", () => updateActiveNote({ body: bodyInput.value }));
searchInput.addEventListener("input", renderList);

exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(notes, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `notes-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

importInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported)) throw new Error("Invalid notes file");

    notes = imported
      .filter((note) => note && typeof note === "object")
      .map((note) => ({
        id: note.id || crypto.randomUUID(),
        title: note.title || "",
        body: note.body || "",
        summary: note.summary || "",
        updatedAt: note.updatedAt || new Date().toISOString(),
      }));

    if (notes.length === 0) notes = [createNote(false)];
    activeId = notes[0].id;
    persist();
    render();
  } catch {
    alert("가져올 수 없는 파일입니다. JSON 메모 백업 파일인지 확인해주세요.");
  } finally {
    importInput.value = "";
  }
});

voiceBtn.addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceStatus.textContent = "이 브라우저는 음성 인식을 지원하지 않습니다.";
    return;
  }

  if (recognition) {
    recognition.stop();
    recognition = null;
    voiceStatus.textContent = "음성 명령을 멈췄습니다.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "ko-KR";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.start();
  voiceStatus.textContent = "듣고 있습니다. 예: 새 메모 오늘 회의 내용";

  recognition.addEventListener("result", (event) => {
    const transcript = event.results[0][0].transcript.trim();
    handleVoiceCommand(transcript);
  });

  recognition.addEventListener("end", () => {
    recognition = null;
  });
});

summaryEndpointInput.addEventListener("input", () => {
  settings.summaryEndpoint = summaryEndpointInput.value.trim();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
});

summarizeBtn.addEventListener("click", async () => {
  const note = getActiveNote();
  const endpoint = summaryEndpointInput.value.trim();

  if (!note.body.trim()) {
    summaryOutput.textContent = "요약할 메모 내용이 없습니다.";
    return;
  }

  if (!endpoint) {
    summaryOutput.textContent =
      "요약 프록시 주소를 먼저 입력해주세요. GitHub Pages에서는 배포한 프록시 주소가 필요합니다.";
    return;
  }

  summarizeBtn.disabled = true;
  summaryOutput.textContent = "요약하는 중입니다...";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: note.title, body: note.body }),
    });

    if (!response.ok) throw new Error("Summary request failed");
    const data = await response.json();
    const summary = data.summary || data.text || "";
    if (!summary) throw new Error("Empty summary");

    updateActiveNote({ summary });
    summaryOutput.textContent = summary;
  } catch {
    summaryOutput.textContent = "요약에 실패했습니다. 서버 주소와 배포 상태를 확인해주세요.";
  } finally {
    summarizeBtn.disabled = false;
  }
});

function loadNotes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function createNote(shouldPersist = true) {
  const note = {
    id: crypto.randomUUID(),
    title: "",
    body: "",
    summary: "",
    updatedAt: new Date().toISOString(),
  };
  notes.unshift(note);
  if (shouldPersist) persist();
  return note;
}

function getActiveNote() {
  return notes.find((note) => note.id === activeId) || notes[0];
}

function updateActiveNote(patch) {
  const note = getActiveNote();
  Object.assign(note, patch, { updatedAt: new Date().toISOString() });
  persist();
  renderList();
  summaryOutput.textContent = note.summary || "";
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

function render() {
  const note = getActiveNote();
  titleInput.value = note.title;
  bodyInput.value = note.body;
  summaryOutput.textContent = note.summary || "";
  renderList();
}

function renderList() {
  const keyword = searchInput.value.trim().toLowerCase();
  const filtered = notes.filter((note) => {
    const haystack = `${note.title} ${note.body}`.toLowerCase();
    return haystack.includes(keyword);
  });

  notesList.innerHTML = "";
  filtered.forEach((note) => {
    const button = document.createElement("button");
    button.className = `note-item${note.id === activeId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <span class="note-title">${escapeHtml(note.title || "제목 없는 메모")}</span>
      <span class="note-preview">${escapeHtml(note.body || "내용이 없습니다.")}</span>
      <span class="note-date">${formatDate(note.updatedAt)}</span>
    `;
    button.addEventListener("click", () => {
      activeId = note.id;
      render();
    });
    notesList.append(button);
  });
}

function handleVoiceCommand(transcript) {
  voiceStatus.textContent = `인식됨: ${transcript}`;
  const normalized = transcript.replace(/\s+/g, " ");

  if (normalized.startsWith("새 메모")) {
    const body = normalized.replace(/^새 메모\s*/, "");
    const note = createNote();
    activeId = note.id;
    updateActiveNote({ title: body.slice(0, 24) || "음성 메모", body });
    render();
    return;
  }

  if (normalized.includes("요약")) {
    summarizeBtn.click();
    return;
  }

  updateActiveNote({ body: `${getActiveNote().body}\n${transcript}`.trim() });
  bodyInput.value = getActiveNote().body;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
