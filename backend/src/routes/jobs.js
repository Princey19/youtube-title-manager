import express from "express";
import multer from "multer";
import XLSX from "xlsx";
import Job from "../models/Job.js";
import DryRunSession from "../models/DryRunSession.js";
import {
  createDryRunSessionFromRows,
  createJobsFromSession,
  processPendingJobsForToday,
  getSummary,
} from "../services/jobService.js";
import { stringify } from "csv-stringify";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/dry-run", upload.single("file"), async (req, res) => {
  try {
    const matchBy = req.body.matchBy || "id";
    if (!["id", "title", "both"].includes(matchBy)) {
      return res.status(400).json({ error: "Invalid matchBy value" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Excel file is required" });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) {
      return res.status(400).json({ error: "Excel file is empty" });
    }
    // Map headers case-insensitively to supported logical names
    const headerMap = {};
    const firstRowKeys = Object.keys(rows[0]);
    for (const key of firstRowKeys) {
      const lower = key.toLowerCase();
      if (
        ["id", "title", "label", "acronym"].includes(lower) &&
        !headerMap[lower]
      ) {
        headerMap[lower] = key;
      }
    }

    const requiredColumns = ["id", "title", "label", "acronym"];
    const missing = requiredColumns.filter((c) => !headerMap[c]);
    if (missing.length) {
      return res.status(400).json({
        error: `Missing required columns (case-insensitive): ${missing.join(
          ", ",
        )}`,
      });
    }

    const normalizedRows = rows.map((row) => ({
      Id: row[headerMap.id],
      title: row[headerMap.title],
      label: row[headerMap.label],
      acronym: row[headerMap.acronym],
    }));

    const session = await createDryRunSessionFromRows(normalizedRows, matchBy);

    const preview = session.items.slice(0, 20);
    res.json({
      sessionId: session._id,
      totalRows: session.totalRows,
      willUpdateCount: session.willUpdateCount,
      willSkipCount: session.willSkipCount,
      preview,
    });
  } catch (err) {
    console.error("Dry-run error", err);
    res.status(500).json({ error: "Dry run failed", details: err.message });
  }
});

router.post("/start", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const session = await DryRunSession.findById(sessionId).lean();
    if (!session) {
      return res.status(404).json({ error: "Dry run session not found" });
    }

    const { created } = await createJobsFromSession(sessionId);
    res.json({ created });
  } catch (err) {
    console.error("Start jobs error", err);
    res
      .status(500)
      .json({ error: "Failed to create jobs", details: err.message });
  }
});

router.post("/process-now", async (req, res) => {
  try {
    const result = await processPendingJobsForToday();
    res.json(result);
  } catch (err) {
    console.error("Process-now error", err);
    res.status(500).json({ error: "Processing failed", details: err.message });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const summary = await getSummary();
    res.json(summary);
  } catch (err) {
    console.error("Summary error", err);
    res
      .status(500)
      .json({ error: "Failed to load summary", details: err.message });
  }
});

router.get("/logs", async (req, res) => {
  try {
    const status = req.query.status;
    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "50", 10);
    const skip = (page - 1) * limit;

    const filter = {};
    if (
      status &&
      ["pending", "updated", "skipped", "failed"].includes(status)
    ) {
      filter.status = status;
    }

    const [items, total] = await Promise.all([
      Job.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Job.countDocuments(filter),
    ]);

    res.json({
      items,
      total,
      page,
      pageSize: limit,
    });
  } catch (err) {
    console.error("Logs error", err);
    res
      .status(500)
      .json({ error: "Failed to load logs", details: err.message });
  }
});

router.get("/report.csv", async (req, res) => {
  try {
    const status = req.query.status;
    const filter = {};
    if (
      status &&
      ["pending", "updated", "skipped", "failed"].includes(status)
    ) {
      filter.status = status;
    }

    const jobs = await Job.find(filter).sort({ createdAt: -1 }).lean();

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="youtube-title-manager-report.csv"',
    );

    const stringifier = stringify({
      header: true,
      columns: [
        "videoId",
        "excelRowIndex",
        "titleFromExcel",
        "label",
        "acronym",
        "oldTitle",
        "newTitle",
        "status",
        "errorMessage",
        "createdAt",
        "processedAt",
      ],
    });

    stringifier.pipe(res);
    for (const job of jobs) {
      stringifier.write({
        videoId: job.videoId,
        excelRowIndex: job.excelRowIndex,
        titleFromExcel: job.titleFromExcel,
        label: job.label,
        acronym: job.acronym,
        oldTitle: job.oldTitle,
        newTitle: job.newTitle,
        status: job.status,
        errorMessage: job.errorMessage || "",
        createdAt: job.createdAt?.toISOString?.() || "",
        processedAt: job.processedAt?.toISOString?.() || "",
      });
    }
    stringifier.end();
  } catch (err) {
    console.error("CSV report error", err);
    res
      .status(500)
      .json({ error: "Failed to generate CSV", details: err.message });
  }
});

router.get("/dry-run/:sessionId/report.csv", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const action = req.query.action;

    const session = await DryRunSession.findById(sessionId).lean();
    if (!session) {
      return res.status(404).json({ error: "Dry run session not found" });
    }

    let items = session.items || [];
    if (action && ["update", "skip"].includes(action)) {
      items = items.filter((item) => item.action === action);
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="youtube-title-manager-dry-run-${sessionId}.csv"`,
    );

    const stringifier = stringify({
      header: true,
      columns: [
        "excelRowIndex",
        "videoId",
        "titleFromExcel",
        "label",
        "acronym",
        "matchBy",
        "oldTitle",
        "newTitle",
        "action",
        "reason",
      ],
    });

    stringifier.pipe(res);
    for (const item of items) {
      stringifier.write({
        excelRowIndex: item.excelRowIndex,
        videoId: item.videoId || "",
        titleFromExcel: item.titleFromExcel || "",
        label: item.label || "",
        acronym: item.acronym || "",
        matchBy: item.matchBy || "",
        oldTitle: item.oldTitle || "",
        newTitle: item.newTitle || "",
        action: item.action || "",
        reason: item.reason || "",
      });
    }
    stringifier.end();
  } catch (err) {
    console.error("Dry-run CSV report error", err);
    res.status(500).json({
      error: "Failed to generate dry-run CSV",
      details: err.message,
    });
  }
});

export default router;
