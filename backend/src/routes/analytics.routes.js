const express = require('express');
const {reportAccountPnl}=require('../services/accountPnlReporting');
const router = express.Router();
const analyticsController = require('../controllers/analytics.controller');
const { authenticate } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   name: Analytics
 *   description: Trading analytics and performance metrics
 */

/**
 * @swagger
 * /api/analytics/overview:
 *   get:
 *     summary: Get analytics overview
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Analytics overview data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Analytics'
 */
router.get('/overview', authenticate, reportAccountPnl, analyticsController.getOverview);

/**
 * @swagger
 * /api/analytics/maemfe:
 *   get:
 *     summary: Get MAE/MFE analysis
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: MAE/MFE analysis data
 */
router.get('/maemfe', authenticate, reportAccountPnl, analyticsController.getMAEMFE);
router.get('/maemfe/trades', authenticate, reportAccountPnl, analyticsController.getMAEMFETrades);

/**
 * @swagger
 * /api/analytics/performance:
 *   get:
 *     summary: Get performance metrics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Performance metrics
 */
router.get('/performance', authenticate, reportAccountPnl, analyticsController.getPerformance);

/**
 * @swagger
 * /api/analytics/symbols:
 *   get:
 *     summary: Get symbol statistics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Symbol performance statistics
 */
router.get('/symbols', authenticate, reportAccountPnl, analyticsController.getSymbolStats);

/**
 * @swagger
 * /api/analytics/tags:
 *   get:
 *     summary: Get tag statistics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Tag performance statistics
 */
router.get('/tags', authenticate, reportAccountPnl, analyticsController.getTagStats);

/**
 * @swagger
 * /api/analytics/strategies:
 *   get:
 *     summary: Get strategy/setup statistics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Strategy performance statistics
 */
router.get('/strategies', authenticate, reportAccountPnl, analyticsController.getStrategyStats);

/**
 * @swagger
 * /api/analytics/hours:
 *   get:
 *     summary: Get hour of day statistics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Hour of day performance statistics
 */
router.get('/hours', authenticate, reportAccountPnl, analyticsController.getHourOfDayStats);

router.get('/calendar', authenticate, reportAccountPnl, analyticsController.getCalendarData);
router.get('/calendar/day', authenticate, reportAccountPnl, analyticsController.getCalendarDayDetail);
router.get('/export', authenticate, reportAccountPnl, analyticsController.exportData);
router.get('/charts', authenticate, reportAccountPnl, analyticsController.getChartData);
router.get('/drawdown', authenticate, reportAccountPnl, analyticsController.getDrawdownAnalysis);
router.get('/recommendations', authenticate, reportAccountPnl, analyticsController.getRecommendations);
router.get('/sectors', authenticate, reportAccountPnl, analyticsController.getSectorPerformance);
router.get('/sectors/available', authenticate, reportAccountPnl, analyticsController.getAvailableSectors);
router.get('/brokers/available', authenticate, reportAccountPnl, analyticsController.getAvailableBrokers);
router.get('/sectors/refresh', authenticate, reportAccountPnl, analyticsController.refreshSectorPerformance);
router.post('/categorize-symbols', authenticate, reportAccountPnl, analyticsController.categorizeSymbols);
router.get('/symbol-stats', authenticate, reportAccountPnl, analyticsController.getSymbolCategoryStats);

module.exports = router;