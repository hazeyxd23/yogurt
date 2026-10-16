import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const client = axios.create({ baseURL });

async function request(config) {
  try {
    const response = await client.request(config);
    return response.data;
  } catch (error) {
    if (!axios.isCancel(error)) {
      console.error(`API error [${config.method?.toUpperCase() || "GET"} ${config.url}]:`, error);
    }
    throw error;
  }
}

export const isCancel = axios.isCancel;

// Read functions take an optional AbortSignal as their last argument so components
// can cancel in-flight requests on unmount instead of leaving them to hold a connection.

// ---------- Guitar ----------

export function createGuitarSession(duration, bpm, notes) {
  return request({
    method: "post",
    url: "/guitar/sessions",
    data: { duration_minutes: duration, bpm, notes },
  });
}

export function getGuitarSessions(signal) {
  return request({ method: "get", url: "/guitar/sessions", signal });
}

export function getGuitarStats(signal) {
  return request({ method: "get", url: "/guitar/stats", signal });
}

// ---------- Reading ----------

export function createBook(title, author, total_pages) {
  return request({
    method: "post",
    url: "/books",
    data: { title, author, total_pages },
  });
}

export function getBooks(signal) {
  return request({ method: "get", url: "/books", signal });
}

export function updateBook(id, updates) {
  return request({ method: "patch", url: `/books/${id}`, data: updates });
}

export function createReadingSession(book_id, duration, pages_read, key_note) {
  return request({
    method: "post",
    url: "/reading/sessions",
    data: { book_id, duration_minutes: duration, pages_read, key_note },
  });
}

export function getReadingSessions(signal) {
  return request({ method: "get", url: "/reading/sessions", signal });
}

export function getReadingStats(signal) {
  return request({ method: "get", url: "/reading/stats", signal });
}

// ---------- LeetCode ----------

export function createLeetcodeProblem(name, difficulty, note) {
  return request({
    method: "post",
    url: "/leetcode/problems",
    data: { question_name: name, difficulty, key_note: note },
  });
}

export function getLeetcodeProblems(signal) {
  return request({ method: "get", url: "/leetcode/problems", signal });
}

export function updateLeetcodeProblem(id, updates) {
  return request({ method: "patch", url: `/leetcode/problems/${id}`, data: updates });
}

export function getLeetcodeStats(signal) {
  return request({ method: "get", url: "/leetcode/stats", signal });
}

// ---------- Tasks ----------

export function createTask(title, description, scheduled_time, priority) {
  return request({
    method: "post",
    url: "/tasks",
    data: { title, description, scheduled_time, priority },
  });
}

export function getTodaysTasks(signal) {
  return request({ method: "get", url: "/tasks", signal });
}

export function updateTask(id, updates) {
  return request({ method: "patch", url: `/tasks/${id}`, data: updates });
}

// ---------- Analytics ----------

export function getAnalyticsSummary(signal) {
  return request({ method: "get", url: "/analytics/summary", signal });
}

export function getStreaks(signal) {
  return request({ method: "get", url: "/analytics/streaks", signal });
}

export function getAnalyticsWeekly(signal) {
  return request({ method: "get", url: "/analytics/weekly", signal });
}

export function getHeatmap(month_year, signal) {
  return request({ method: "get", url: "/analytics/heatmap", params: { month: month_year }, signal });
}

// ---------- Notes ----------

export function getNotes(signal) {
  return request({ method: "get", url: "/notes", signal });
}

export function getDashboardNote(signal) {
  return request({ method: "get", url: "/notes/dashboard", signal });
}

/** App-owned notes (e.g. "leetcode"), created on first use. */
export function getSystemNote(key, signal) {
  return request({ method: "get", url: `/notes/system/${key}`, signal });
}

export function createNote(data) {
  return request({ method: "post", url: "/notes", data });
}

export function updateNote(id, updates) {
  return request({ method: "patch", url: `/notes/${id}`, data: updates });
}

export function deleteNote(id) {
  return request({ method: "delete", url: `/notes/${id}` });
}

/** Fire-and-forget save that survives the page unloading (used for unsaved edits on close). */
export function updateNoteKeepalive(id, updates) {
  try {
    fetch(`${baseURL}/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
      keepalive: true,
    });
  } catch {
    // Best effort only.
  }
}

/** Sessions for one book, newest first - their key notes are the "where I left off" notes. */
export function getBookSessions(bookId, signal) {
  return request({ method: "get", url: "/reading/sessions", params: { book_id: bookId, limit: 200 }, signal });
}

export function createReadingSessionFull(data) {
  return request({ method: "post", url: "/reading/sessions", data });
}

// ---------- Calendar (tasks with times) ----------

export function getTasksRange(start, end, signal) {
  return request({ method: "get", url: "/tasks", params: { start, end }, signal });
}

export function createTaskFull(data) {
  return request({ method: "post", url: "/tasks", data });
}

/** scope: "this" | "following" | "all" (only matters for repeating events) */
export function updateTaskScoped(id, updates, scope = "this") {
  return request({ method: "patch", url: `/tasks/${id}`, params: { scope }, data: updates });
}

export function deleteTaskScoped(id, scope = "this") {
  return request({ method: "delete", url: `/tasks/${id}`, params: { scope } });
}

// ---------- Ask (LLM text-to-SQL agent) ----------

export function askAgent(question, signal) {
  return request({ method: "post", url: "/agent/ask", data: { question }, signal, timeout: 300000 });
}

export function getAgentStatus(signal) {
  return request({ method: "get", url: "/agent/status", signal });
}
