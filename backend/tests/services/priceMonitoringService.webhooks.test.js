jest.mock('../../src/config/database', () => ({
  query: jest.fn()
}));

jest.mock('../../src/utils/logger', () => ({
  logError: jest.fn(),
  logWarn: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('../../src/utils/finnhub', () => ({}));
jest.mock('../../src/utils/priceFallbackManager', () => ({}));
jest.mock('../../src/utils/historicalPriceCache', () => ({}));
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: jest.fn() }))
}));
jest.mock('../../src/services/tierService', () => ({}));
jest.mock('../../src/services/notificationPreferenceService', () => ({
  isNotificationEnabled: jest.fn()
}));
jest.mock('../../src/events/domainEvents', () => ({
  publish: jest.fn()
}));

const db = require('../../src/config/database');
const NotificationPreferenceService = require('../../src/services/notificationPreferenceService');
const { publish } = require('../../src/events/domainEvents');
const finnhub = require('../../src/utils/finnhub');
const priceFallbackManager = require('../../src/utils/priceFallbackManager');
const priceMonitoringService = require('../../src/services/priceMonitoringService');

describe('priceMonitoringService price alert webhook publication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    NotificationPreferenceService.isNotificationEnabled.mockResolvedValue(true);
    db.query.mockResolvedValue({ rows: [] });
    finnhub.isCryptoSymbol = jest.fn(() => false);
    priceFallbackManager.getQuoteWithFallback = jest.fn();
    priceMonitoringService.failedSymbols.clear();
    priceMonitoringService.emailTransporter = null;
  });

  test('publishes price_alert.triggered from the live trigger path after state update', async () => {
    await priceMonitoringService.triggerAlert({
      id: 'alert-1',
      user_id: 'user-1',
      symbol: 'AAPL',
      alert_type: 'above',
      target_price: '200',
      change_percent: null,
      percent_change: '3.42',
      current_price: '205.15',
      email_enabled: false,
      browser_enabled: false,
      repeat_enabled: false,
      email: 'trader@example.com',
      user_email_enabled: false
    });

    expect(db.query).toHaveBeenCalledWith(
      'UPDATE price_alerts SET is_active = false, triggered_at = CURRENT_TIMESTAMP WHERE id = $1',
      ['alert-1']
    );
    expect(publish).toHaveBeenCalledWith(
      'price_alert.triggered',
      expect.objectContaining({
        alertId: 'alert-1',
        userId: 'user-1',
        symbol: 'AAPL',
        alertType: 'above',
        currentPrice: 205.15,
        targetPrice: 200,
        message: expect.stringContaining('above your target'),
        repeatEnabled: false
      }),
      { source: 'priceMonitoringService.triggerAlert' }
    );
  });

  test('skips saturated Finnhub background quotes without recording symbol failure', async () => {
    priceFallbackManager.getQuoteWithFallback.mockResolvedValue({
      data: null,
      source: 'none',
      error: {
        code: 'FINNHUB_SCHEDULER_SKIPPED',
        message: 'provider capacity reserved for active requests'
      }
    });

    await expect(priceMonitoringService.updateSymbolPrice('AAPL')).resolves.toBe('skipped');

    expect(priceMonitoringService.failedSymbols.has('AAPL')).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('explicit new crypto uses CoinGecko and a separate key even outside the static list',async()=>{
    finnhub.getCryptoQuote=jest.fn().mockResolvedValue({c:0.5});
    await expect(priceMonitoringService.updateSymbolPrice('FET','crypto')).resolves.toBe(true);
    expect(finnhub.getCryptoQuote).toHaveBeenCalledWith('FET');
    expect(priceFallbackManager.getQuoteWithFallback).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO price_monitoring'),expect.arrayContaining(['crypto:FET','coingecko']));
  });

  test('unresolved crypto never falls back to an equity quote',async()=>{
    finnhub.getCryptoQuote=jest.fn().mockRejectedValue(new Error('Unknown coin identity'));
    await expect(priceMonitoringService.updateSymbolPrice('NEWCOIN','crypto')).resolves.toBe(false);
    expect(priceFallbackManager.getQuoteWithFallback).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  test('explicit stock sharing a supported crypto ticker keeps its equity key and provider',async()=>{
    finnhub.isCryptoSymbol.mockReturnValue(true);
    finnhub.getCryptoQuote=jest.fn();
    priceFallbackManager.getQuoteWithFallback.mockResolvedValue({data:{c:100},source:'finnhub'});
    await expect(priceMonitoringService.updateSymbolPrice('SUI','stock')).resolves.toBe(true);
    expect(finnhub.getCryptoQuote).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO price_monitoring'),expect.arrayContaining(['SUI','finnhub']));
  });

  test('scheduled monitoring retains trade instrument types instead of guessing from ticker',async()=>{
    db.query.mockResolvedValueOnce({rows:[{symbol:'FET',instrument_type:'crypto'},{symbol:'FET',instrument_type:'stock'}]});
    const update=jest.spyOn(priceMonitoringService,'updateSymbolPrice').mockResolvedValue(false);
    await priceMonitoringService.monitorPrices();
    expect(update).toHaveBeenCalledWith('FET','crypto');
    expect(update).toHaveBeenCalledWith('FET','stock');
    update.mockRestore();
  });
});
