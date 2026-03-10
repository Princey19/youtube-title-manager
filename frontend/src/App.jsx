import React, { useEffect, useState } from "react";
import ExcelUpload from "./components/ExcelUpload.jsx";
import DryRunPanel from "./components/DryRunPanel.jsx";
import LogsTable from "./components/LogsTable.jsx";
import {
  dryRun,
  startUpdate,
  processNow,
  fetchSummary,
  fetchLogs,
  downloadCsv,
  downloadDryRunCsv,
} from "./api/jobs.js";

export default function App() {
  const [file, setFile] = useState(null);
  const [matchBy, setMatchBy] = useState("id");
  const [dryRunResult, setDryRunResult] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [logs, setLogs] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");

  const [loadingDryRun, setLoadingDryRun] = useState(false);
  const [loadingStart, setLoadingStart] = useState(false);
  const [loadingProcess, setLoadingProcess] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function loadSummary() {
    try {
      const res = await fetchSummary();
      setSummary(res.data);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadLogs() {
    try {
      setLoadingLogs(true);
      const res = await fetchLogs({
        status: statusFilter || undefined,
        limit: 100,
      });
      setLogs(res.data.items);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLogs(false);
    }
  }

  useEffect(() => {
    loadSummary();
    loadLogs();
    const interval = setInterval(() => {
      loadSummary();
      loadLogs();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadLogs();
  }, [statusFilter]);

  const handleDryRun = async () => {
    if (!file) {
      setError("Please select an Excel file before running.");
      return;
    }
    setError("");
    setInfo("");
    setLoadingDryRun(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("matchBy", matchBy);
      const res = await dryRun(formData);
      setDryRunResult(res.data);
      setSessionId(res.data.sessionId);
      setInfo(
        "Run completed. Review changes, then click Start Update to create jobs.",
      );
    } catch (e) {
      console.error(e);
      setError(e.response?.data?.error || "Run failed.");
    } finally {
      setLoadingDryRun(false);
    }
  };

  const handleStartUpdate = async () => {
    if (!sessionId) {
      setError("Run a dry run first.");
      return;
    }
    setError("");
    setInfo("");
    if (
      !window.confirm(
        "Create update jobs based on the current dry run results?",
      )
    ) {
      return;
    }
    setLoadingStart(true);
    try {
      const res = await startUpdate(sessionId);
      setInfo(`Created ${res.data.created} jobs.`);
      await loadSummary();
      await loadLogs();
    } catch (e) {
      console.error(e);
      setError(e.response?.data?.error || "Failed to create jobs.");
    } finally {
      setLoadingStart(false);
    }
  };

  const handleProcessNow = async () => {
    setError("");
    setInfo("");
    setLoadingProcess(true);
    try {
      const res = await processNow();
      setInfo(`Processed ${res.data.processed} jobs in this run.`);
      await loadSummary();
      await loadLogs();
    } catch (e) {
      console.error(e);
      setError(e.response?.data?.error || "Processing failed.");
    } finally {
      setLoadingProcess(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>YouTube Title Manager</h1>
          <p className="subtitle">
            A tool to append label acronyms to YouTube video titles.
          </p>
        </div>
      </header>
      <main className="app-main">
        {(error || info) && (
          <div className="messages">
            {error && <div className="message error">{error}</div>}
            {info && <div className="message info">{info}</div>}
          </div>
        )}
        <section className="layout-grid">
          <div className="column">
            <ExcelUpload
              file={file}
              onFileChange={setFile}
              matchBy={matchBy}
              onMatchByChange={setMatchBy}
            />
            <DryRunPanel
              dryRunResult={dryRunResult}
              onDryRun={handleDryRun}
              onStartUpdate={handleStartUpdate}
              onProcessNow={handleProcessNow}
              onDownloadDryRunCsv={(action) =>
                sessionId ? downloadDryRunCsv(sessionId, action) : null
              }
              loadingDryRun={loadingDryRun}
              loadingStart={loadingStart}
              loadingProcess={loadingProcess}
              summary={summary}
            />
          </div>
          <div className="column">
            <LogsTable
              logs={logs}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              onRefresh={loadLogs}
              onDownloadCsv={downloadCsv}
              loading={loadingLogs}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
