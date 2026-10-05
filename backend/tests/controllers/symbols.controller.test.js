const mockDb = {
  query: jest.fn()
};

const mockFinnhub = {
  isConfigured: jest.fn(() => true),
  symbolSearch: jest.fn(),
  getQuote: jest.fn(),
  getCryptoQuote: jest.fn(),
  isCryptoSymbol: jest.fn(() => false),
  isFinnhub: true,
  providerName: 'finnhub'
};

const mockCache = {
  get: jest.fn(),
  set: jest.fn()
};

const mockSymbolCategories = {
  getSymbolCategories: jest.fn()
};

jest.mock('../../src/config/database', () => mockDb);
jest.mock('../../src/utils/finnhub', () => mockFinnhub);
jest.mock('../../src/utils/cache', () => mockCache);
jest.mock('../../src/utils/symbolCategories', () => mockSymbolCategories);
jest.mock('../../src/services/cryptoCategoriesService', () => ({getCachedCategories:jest.fn().mockResolvedValue({logo:'https://coin-images.coingecko.com/coins/images/26375/small/sui.png'})}));

const symbolsController = require('../../src/controllers/symbols.controller');

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
}

describe('symbols controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCache.get.mockReturnValue(null);
    mockSymbolCategories.getSymbolCategories.mockResolvedValue(new Map());
    mockFinnhub.isCryptoSymbol.mockReturnValue(false);
  });

  test('crypto SUI logo comes from CoinGecko, not its colliding stock',async()=>{
    mockDb.query.mockResolvedValue({rows:[{symbol:'SUI',company_name:'Sun Communities',logo:'https://stock.example/sui.png'}]});
    const res=createRes();
    await symbolsController.getSymbolMetadata({query:{symbols:'SUI',asset_type:'crypto'}},res,jest.fn());
    expect(res.json).toHaveBeenCalledWith({metadata:{SUI:expect.objectContaining({companyName:'Sui',asset_type:'crypto',logo:expect.stringContaining('coin-images.coingecko.com')})}});
  });
  test('explicit stock SUI preserves equity metadata',async()=>{
    mockDb.query.mockResolvedValue({rows:[{symbol:'SUI',company_name:'Sun Communities',logo:'https://stock.example/sui.png'}]});
    const res=createRes();
    await symbolsController.getSymbolMetadata({query:{symbols:'SUI',asset_type:'stock'}},res,jest.fn());
    expect(res.json).toHaveBeenCalledWith({metadata:{SUI:expect.objectContaining({companyName:'Sun Communities',logo:'https://stock.example/sui.png'})}});
  });

  test('getSymbolMetadata returns cached data before background hydration', async () => {
    mockDb.query.mockResolvedValue({
      rows: [{
        symbol: 'NVDA',
        company_name: null,
        exchange: null,
        logo: null
      }]
    });

    mockSymbolCategories.getSymbolCategories.mockResolvedValue(new Map([
      ['NVDA', {
        symbol: 'NVDA',
        company_name: 'NVIDIA Corporation',
        exchange: 'NASDAQ',
        logo: 'https://logo.test/nvda.png'
      }]
    ]));

    const req = {
      query: { symbols: 'NVDA' }
    };
    const res = createRes();

    await symbolsController.getSymbolMetadata(req, res);

    expect(mockSymbolCategories.getSymbolCategories).toHaveBeenCalledWith(['NVDA']);
    expect(res.json).toHaveBeenCalledWith({metadata:{NVDA:expect.objectContaining({companyName:null,metadataPending:true})}});
    await new Promise(resolve=>setImmediate(resolve));
    expect(mockCache.set).toHaveBeenCalledWith('symbol_metadata_entry:stock:NVDA',expect.objectContaining({companyName:'NVIDIA Corporation'}),expect.any(Number));
  });

  test('stalled provider does not delay metadata response and warming is deduplicated',async()=>{
    mockDb.query.mockResolvedValue({rows:[]});
    let finish;
    mockSymbolCategories.getSymbolCategories.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const req={query:{symbols:'COLD',asset_type:'stock'}};
    const first=createRes(),second=createRes();
    await symbolsController.getSymbolMetadata(req,first);
    await symbolsController.getSymbolMetadata(req,second);
    expect(first.json).toHaveBeenCalledWith({metadata:{COLD:expect.objectContaining({metadataPending:true})}});
    expect(mockSymbolCategories.getSymbolCategories).toHaveBeenCalledTimes(1);
    finish(new Map([['COLD',{company_name:'Cold test',logo:'https://example.com/logo.png'}]]));
    await new Promise(resolve=>setImmediate(resolve));
  });

  test('searchSymbols hydrates traded symbols that are missing local metadata', async () => {
    mockDb.query
      .mockResolvedValueOnce({
        rows: [{
          symbol: 'AMD',
          company_name: null,
          exchange: null,
          logo: null
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    mockSymbolCategories.getSymbolCategories.mockResolvedValue(new Map([
      ['AMD', {
        symbol: 'AMD',
        company_name: 'Advanced Micro Devices',
        exchange: 'NASDAQ',
        logo: 'https://logo.test/amd.png'
      }]
    ]));

    const req = {
      user: { id: 'user-1' },
      query: { q: 'AMD' }
    };
    const res = createRes();

    await symbolsController.searchSymbols(req, res);

    expect(mockSymbolCategories.getSymbolCategories).toHaveBeenCalledWith(['AMD']);
    expect(res.json).toHaveBeenCalledWith({
      results: [
        {
          symbol: 'AMD',
          company_name: 'Advanced Micro Devices',
          exchange: 'NASDAQ',
          logo: 'https://logo.test/amd.png',
          source: 'user_trades'
        }
      ]
    });
  });

  test('getSymbolQuote returns a normalized current quote', async () => {
    mockFinnhub.getQuote.mockResolvedValue({
      c: 213.55,
      pc: 211.22,
      d: 2.33,
      dp: 1.1031,
      t: 1783708200
    });

    const req = {
      user: { id: 'user-1' },
      query: { symbol: ' aapl ' }
    };
    const res = createRes();

    await symbolsController.getSymbolQuote(req, res);

    expect(mockFinnhub.getQuote).toHaveBeenCalledWith('AAPL', 'user-1');
    expect(res.json).toHaveBeenCalledWith({
      symbol: 'AAPL',
      current_price: 213.55,
      previous_close: 211.22,
      change: 2.33,
      change_percent: 1.1031,
      timestamp: 1783708200
    });
  });

  test('searchSymbols includes supported crypto without relying on stock-provider search', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockFinnhub.symbolSearch.mockResolvedValue({ result: [] });

    const req = {
      user: { id: 'user-1' },
      query: { q: 'bitcoin' }
    };
    const res = createRes();

    await symbolsController.searchSymbols(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.results[0]).toEqual({
      symbol: 'BTC',
      company_name: 'Bitcoin',
      exchange: 'Crypto',
      logo: null,
      source: 'crypto',
      asset_type: 'crypto'
    });
  });

  test('getSymbolQuote routes crypto symbols to the crypto quote provider', async () => {
    mockFinnhub.isCryptoSymbol.mockReturnValue(true);
    mockFinnhub.getCryptoQuote.mockResolvedValue({
      c: 118250.25,
      pc: 116900,
      d: 1350.25,
      dp: 1.155,
      t: 1787778000
    });

    const req = {
      user: { id: 'user-1' },
      query: { symbol: ' btc ' }
    };
    const res = createRes();

    await symbolsController.getSymbolQuote(req, res);

    expect(mockFinnhub.getCryptoQuote).toHaveBeenCalledWith('BTC');
    expect(mockFinnhub.getQuote).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      symbol: 'BTC',
      current_price: 118250.25,
      previous_close: 116900,
      change: 1350.25,
      change_percent: 1.155,
      timestamp: 1787778000
    });
  });

  test('searchSymbols excludes option contracts and non-equity provider results', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockFinnhub.symbolSearch.mockResolvedValue({
      result: [
        { symbol: 'AAPL', description: 'Apple Inc', type: 'Common Stock' },
        { symbol: 'AAPL260117C00200000', description: 'AAPL call', type: 'Option' },
        { symbol: 'AAPLW', description: 'Apple warrant', type: 'Warrant' },
        { symbol: 'AAXJ', description: 'iShares MSCI All Country Asia ETF', type: 'ETP' }
      ]
    });

    const req = {
      user: { id: 'user-1' },
      query: { q: 'AA' }
    };
    const res = createRes();

    await symbolsController.searchSymbols(req, res);

    expect(res.json).toHaveBeenCalledWith({
      results: [
        {
          symbol: 'AAPL',
          company_name: 'Apple Inc',
          exchange: null,
          logo: null,
          source: 'finnhub'
        },
        {
          symbol: 'AAXJ',
          company_name: 'iShares MSCI All Country Asia ETF',
          exchange: null,
          logo: null,
          source: 'finnhub'
        }
      ]
    });
  });
});
