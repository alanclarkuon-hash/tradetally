const CronScheduler = require('./schedulers/CronScheduler');
const PortfolioService = require('./portfolioService');

class PortfolioSnapshotScheduler extends CronScheduler {
  constructor() {
    super({
      logPrefix: '[PORTFOLIO-SNAPSHOTS]',
      cronEnvVar: 'PORTFOLIO_SNAPSHOT_CRON',
      defaultCron: '15 20 * * *',
      guardRestart: true,
      getScheduleOptions: () => ({
        timezone: process.env.TZ || 'UTC'
      }),
      messages: {
        alreadyStarted: '[PORTFOLIO-SNAPSHOTS] Scheduler already running',
        started: (cronExpression) => `[PORTFOLIO-SNAPSHOTS] Scheduler started (${cronExpression})`,
        stopped: '[PORTFOLIO-SNAPSHOTS] Scheduler stopped'
      }
    });
  }

  async onTick() {
    try {
      console.log('[PORTFOLIO-SNAPSHOTS] Creating daily portfolio snapshots...');
      const summary = await PortfolioService.createDailySnapshotsForAllUsers();
      await require('./portfolioValueHistoryService').captureAllUsers();
      await require('./brokerPortfolioMaintenance').maintainAllUsers();
      console.log(`[PORTFOLIO-SNAPSHOTS] Snapshot run complete for ${summary.usersProcessed} users`);
    } catch (error) {
      console.error('[PORTFOLIO-SNAPSHOTS] Snapshot run failed:', error);
    }
  }

  async runNow(snapshotDate = null) {
    const result=await PortfolioService.createDailySnapshotsForAllUsers(snapshotDate);
    // Never stamp today's live value onto a caller's historical date.
    if(!snapshotDate || String(snapshotDate).slice(0,10)===new Date().toISOString().slice(0,10)) {
      await require('./portfolioValueHistoryService').captureAllUsers();
      await require('./brokerPortfolioMaintenance').maintainAllUsers();
    }
    return result;
  }
}

module.exports = new PortfolioSnapshotScheduler();
