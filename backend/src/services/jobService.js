import DryRunSession from '../models/DryRunSession.js';
import Job from '../models/Job.js';
import { getAuthorizedYoutubeClient } from '../config/youtubeClient.js';

const DAILY_JOB_LIMIT = parseInt(process.env.DAILY_JOB_LIMIT || '190', 10);
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

function normalizeTitleText(text) {
  return (text || '')
    .toString()
    .normalize('NFKC')
    // Remove zero-width characters and normalize NBSP to space
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function escapeRegExp(text) {
  return (text || '').toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isAcceptableTitleMatch(excelTitle, youtubeTitle, acronym) {
  const excelNorm = normalizeTitleText(excelTitle);
  const ytNorm = normalizeTitleText(youtubeTitle);
  if (!excelNorm || !ytNorm) return false;

  // 1) Exact match (case/space/unicode normalized)
  if (excelNorm === ytNorm) return true;

  // 2) Accept when YouTube already has the acronym suffix we would append
  if (acronym) {
    const excelWithAcronymNorm = normalizeTitleText(`${excelTitle} (${acronym})`);
    if (ytNorm === excelWithAcronymNorm) return true;

    // 3) Safety fallback: base title matches prefix AND the correct acronym is present
    const hasAcronym = new RegExp(`\\(${escapeRegExp(acronym)}\\)`, 'i').test(youtubeTitle || '');
    if (hasAcronym && ytNorm.startsWith(excelNorm)) return true;
  }

  return false;
}

function titleAlreadyHasAcronym(title, acronym) {
  if (!title || !acronym) return false;
  const pattern = new RegExp(`\\(${acronym}\\)`, 'i');
  return pattern.test(title);
}

function computeNewTitle(title, acronym) {
  if (titleAlreadyHasAcronym(title, acronym)) {
    return { shouldUpdate: false, newTitle: title };
  }
  return { shouldUpdate: true, newTitle: `${title} (${acronym})` };
}

async function fetchVideoSnippetById(youtube, videoId) {
  const resp = await youtube.videos.list({
    part: ['snippet'],
    id: videoId
  });
  if (!resp.data.items || resp.data.items.length === 0) return null;
  const item = resp.data.items[0];
  return {
    videoId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    categoryId: item.snippet.categoryId
  };
}

async function fetchVideoSnippetByTitle(youtube, title, acronym) {
  const resp = await youtube.search.list({
    part: ['snippet'],
    q: title,
    maxResults: 20,
    type: 'video',
    // Restrict results to the authorized user's channel to avoid matching videos elsewhere on YouTube.
    forMine: true,
    // If provided, further restrict to a specific channel.
    channelId: YOUTUBE_CHANNEL_ID || undefined
  });
  if (!resp.data.items || resp.data.items.length === 0) return null;

  // Select the first candidate that matches safely.
  for (const item of resp.data.items) {
    const ytTitle = item?.snippet?.title || '';
    const candidateVideoId = item?.id?.videoId;
    if (!candidateVideoId) continue;
    if (!isAcceptableTitleMatch(title, ytTitle, acronym)) continue;
    return {
      videoId: candidateVideoId,
      title: ytTitle,
      description: item.snippet.description,
      categoryId: item.snippet.categoryId
    };
  }

  return null;
}

export async function createDryRunSessionFromRows(rows, matchBy) {
  const youtube = await getAuthorizedYoutubeClient();

  const items = [];
  let willUpdateCount = 0;
  let willSkipCount = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const { Id: excelId, title, label, acronym } = row;
    let videoInfo = null;
    let reason = '';

    try {
      if ((matchBy === 'id' || matchBy === 'both') && excelId) {
        videoInfo = await fetchVideoSnippetById(youtube, excelId);
        if (!videoInfo && (matchBy === 'both' || matchBy === 'id')) {
          reason = 'Video not found by Id';
        }
      }

      if (!videoInfo && (matchBy === 'title' || matchBy === 'both') && title) {
        videoInfo = await fetchVideoSnippetByTitle(youtube, title, acronym);
        if (!videoInfo && !reason) {
          reason = 'Video not found by title';
        }
      }

      if (!videoInfo) {
        items.push({
          excelRowIndex: i + 1,
          videoId: excelId || null,
          titleFromExcel: title,
          label,
          acronym,
          matchBy,
          oldTitle: null,
          newTitle: null,
          action: 'skip',
          reason: reason || 'Video not found'
        });
        willSkipCount += 1;
        continue;
      }

      const { shouldUpdate, newTitle } = computeNewTitle(videoInfo.title, acronym);

      if (shouldUpdate) {
        items.push({
          excelRowIndex: i + 1,
          videoId: videoInfo.videoId,
          titleFromExcel: title,
          label,
          acronym,
          matchBy,
          oldTitle: videoInfo.title,
          newTitle,
          action: 'update',
          reason: ''
        });
        willUpdateCount += 1;
      } else {
        items.push({
          excelRowIndex: i + 1,
          videoId: videoInfo.videoId,
          titleFromExcel: title,
          label,
          acronym,
          matchBy,
          oldTitle: videoInfo.title,
          newTitle: videoInfo.title,
          action: 'skip',
          reason: 'Title already contains acronym'
        });
        willSkipCount += 1;
      }
    } catch (err) {
      items.push({
        excelRowIndex: i + 1,
        videoId: excelId || null,
        titleFromExcel: title,
        label,
        acronym,
        matchBy,
        oldTitle: null,
        newTitle: null,
        action: 'skip',
        reason: `Error during dry run: ${err.message}`
      });
      willSkipCount += 1;
    }
  }

  const session = await DryRunSession.create({
    matchBy,
    totalRows: rows.length,
    willUpdateCount,
    willSkipCount,
    items
  });

  return session;
}

export async function createJobsFromSession(sessionId) {
  const session = await DryRunSession.findById(sessionId).lean();
  if (!session) {
    throw new Error('Dry run session not found');
  }

  const jobsToInsert = session.items
    .filter((item) => item.action === 'update')
    .map((item) => ({
      excelRowIndex: item.excelRowIndex,
      videoId: item.videoId,
      titleFromExcel: item.titleFromExcel,
      label: item.label,
      acronym: item.acronym,
      matchBy: item.matchBy,
      oldTitle: item.oldTitle,
      newTitle: item.newTitle,
      status: 'pending',
      sessionId: session._id
    }));

  if (!jobsToInsert.length) return { created: 0 };

  const inserted = await Job.insertMany(jobsToInsert);
  return { created: inserted.length };
}

export async function processPendingJobsForToday() {
  const youtube = await getAuthorizedYoutubeClient();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const processedToday = await Job.countDocuments({
    processedAt: { $gte: startOfDay, $lte: endOfDay }
  });

  const remaining = Math.max(DAILY_JOB_LIMIT - processedToday, 0);
  if (remaining <= 0) {
    return { processed: 0, remaining: 0, limit: DAILY_JOB_LIMIT };
  }

  const pendingJobs = await Job.find({ status: 'pending' })
    .sort({ createdAt: 1 })
    .limit(remaining)
    .exec();

  let processedCount = 0;

  for (const job of pendingJobs) {
    try {
      const snippet = await fetchVideoSnippetById(youtube, job.videoId);
      if (!snippet) {
        job.status = 'failed';
        job.errorMessage = 'Video not found during processing';
        job.processedAt = new Date();
        await job.save();
        processedCount += 1;
        continue;
      }

      const { shouldUpdate, newTitle } = computeNewTitle(snippet.title, job.acronym);

      if (!shouldUpdate) {
        job.status = 'skipped';
        job.oldTitle = snippet.title;
        job.newTitle = snippet.title;
        job.processedAt = new Date();
        await job.save();
        processedCount += 1;
        continue;
      }

      await youtube.videos.update({
        part: ['snippet'],
        requestBody: {
          id: job.videoId,
          snippet: {
            title: newTitle,
            description: snippet.description,
            categoryId: snippet.categoryId
          }
        }
      });

      job.status = 'updated';
      job.oldTitle = snippet.title;
      job.newTitle = newTitle;
      job.processedAt = new Date();
      await job.save();
      processedCount += 1;
    } catch (err) {
      const isQuotaError =
        err?.errors?.some?.((e) => e.reason === 'quotaExceeded' || e.reason === 'userRateLimitExceeded') ||
        err?.code === 403;

      if (isQuotaError) {
        // Leave current job as pending and stop for today; will resume next run.
        break;
      }

      job.status = 'failed';
      job.errorMessage = err.message || 'Unknown error';
      job.processedAt = new Date();
      await job.save();
      processedCount += 1;
    }
  }

  return {
    processed: processedCount,
    remaining: Math.max(DAILY_JOB_LIMIT - (processedToday + processedCount), 0),
    limit: DAILY_JOB_LIMIT
  };
}

export async function getSummary() {
  const [pending, updated, skipped, failed, total] = await Promise.all([
    Job.countDocuments({ status: 'pending' }),
    Job.countDocuments({ status: 'updated' }),
    Job.countDocuments({ status: 'skipped' }),
    Job.countDocuments({ status: 'failed' }),
    Job.countDocuments({})
  ]);

  return { pending, updated, skipped, failed, total };
}

