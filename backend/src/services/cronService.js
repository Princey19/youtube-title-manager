import cron from 'node-cron';
import { processPendingJobsForToday } from './jobService.js';

export function startCron() {
  // Run once per day at 01:00 server time
  cron.schedule('0 1 * * *', async () => {
    console.log('[cron] Starting daily job processing');
    try {
      const result = await processPendingJobsForToday();
      console.log('[cron] Job processing result', result);
    } catch (err) {
      console.error('[cron] Job processing failed', err);
    }
  });
}

