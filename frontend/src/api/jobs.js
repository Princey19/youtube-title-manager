import api from "./client.js";

export function dryRun(formData) {
  return api.post("/jobs/dry-run", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
}

export function startUpdate(sessionId) {
  return api.post("/jobs/start", { sessionId });
}

export function processNow() {
  return api.post("/jobs/process-now");
}

export function fetchSummary() {
  return api.get("/jobs/summary");
}

export function fetchLogs(params) {
  return api.get("/jobs/logs", { params });
}

export function downloadCsv(status) {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  const url = `${api.defaults.baseURL}/jobs/report.csv${params}`;
  window.open(url, "_blank");
}

export function downloadDryRunCsv(sessionId, action) {
  if (!sessionId) return;
  const params = action ? `?action=${encodeURIComponent(action)}` : "";
  const url = `${api.defaults.baseURL}/jobs/dry-run/${encodeURIComponent(
    sessionId,
  )}/report.csv${params}`;
  window.open(url, "_blank");
}
