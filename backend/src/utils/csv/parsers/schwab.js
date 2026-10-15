const { isExecutionDuplicate } = require('../dedup');
const { extractAccountFromRecord } = require('../detect');
const { parseDate, parseDateTime, getExecutionTimeBounds, cleanString, parseInstrumentData } = require('../shared');


async function parseSchwabTrades(records, existingPositions = {}, context = {}) {
  console.log(`Processing ${records.length} Schwab trade records`);

  // Check if this is the new transaction format: Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount
  if (records.length > 0 && !Array.isArray(records[0])) {
    const columns = Object.keys(records[0]);
    console.log('Available columns:');

    // Check for the new transaction format
    if (columns.includes('Date') && columns.includes('Action') && columns.includes('Symbol') && columns.includes('Price')) {
      console.log('Detected new Schwab transaction format - processing buy/sell transactions');
      return await parseSchwabTransactions(records, existingPositions, context);
    }
  }

  // Fall back to original format processing
  const completedTrades = [];
  let totalCommissions = 0;
  let totalFees = 0;
  let totalPnL = 0;

  for (const record of records) {
    try {
      let symbol, quantity, costPerShare, proceedsPerShare, gainLoss, openedDate, closedDate, costBasis, term, washSale;

      // Handle array format (positional data without headers)
      if (Array.isArray(record)) {
        symbol = record[0];
        openedDate = record[3];
        closedDate = record[2];
        quantity = Math.abs(parseFloat(record[4]?.replace(/,/g, '') || 0));
        proceedsPerShare = parseFloat(record[5]?.replace(/[$,]/g, '') || 0);
        costPerShare = parseFloat(record[6]?.replace(/[$,]/g, '') || 0);
        costBasis = parseFloat(record[8]?.replace(/[$,]/g, '') || 0);
        gainLoss = parseFloat(record[9]?.replace(/[$,]/g, '') || 0);
        term = record[13] || 'Unknown';
        washSale = record[15] === 'Yes';
      } else {
        // Handle original named columns format
        symbol = record['Symbol'];
        quantity = Math.abs(parseFloat(record['Quantity']?.replace(/,/g, '') || 0));
        costPerShare = parseFloat(record['Cost Per Share']?.replace(/[$,]/g, '') || 0);
        proceedsPerShare = parseFloat(record['Proceeds Per Share']?.replace(/[$,]/g, '') || 0);
        gainLoss = parseFloat(record['Gain/Loss ($)']?.replace(/[$,]/g, '') || 0);
        openedDate = record['Opened Date'];
        closedDate = record['Closed Date'];
        costBasis = parseFloat(record['Cost Basis (CB)']?.replace(/[$,]/g, '') || 0);
        term = record['Term'] || 'Unknown';
        washSale = record['Wash Sale?'] === 'Yes';
      }

      const estimatedCommission = 0;
      let gainLossPercent = 0;
      if (Array.isArray(record)) {
        gainLossPercent = parseFloat(record[10]?.replace(/[%,]/g, '') || 0);
      } else {
        gainLossPercent = parseFloat(record['Gain/Loss (%)']?.replace(/[%,]/g, '') || 0);
      }

      // Determine account identifier - user selection takes priority, then CSV column, then header extraction
      const accountIdentifier = context.selectedAccountId
        ? context.selectedAccountId
        : context.accountColumnName
          ? extractAccountFromRecord(record, context.accountColumnName)
          : (context.schwabAccountNumber || null);

      const trade = {
        symbol: cleanString(symbol),
        tradeDate: parseDate(openedDate),
        entryTime: parseDateTime(openedDate + ' 09:30'),
        exitTime: parseDateTime(closedDate + ' 16:00'),
        entryPrice: costPerShare,
        exitPrice: proceedsPerShare,
        quantity: quantity,
        side: 'long',
        commission: estimatedCommission,
        fees: 0,
        pnl: gainLoss,
        pnlPercent: gainLossPercent,
        broker: 'schwab',
        notes: `${term} - ${washSale ? 'Wash Sale' : 'Normal'}`,
        accountIdentifier
      };

      if (trade.symbol && trade.entryPrice > 0 && trade.exitPrice > 0 && trade.quantity > 0) {
        completedTrades.push(trade);
        totalCommissions += estimatedCommission;
        totalPnL += gainLoss;
        console.log(`Valid trade added: [detail omitted] - P&L: $[detail omitted]`);
      }
    } catch (error) {
      console.error('Error parsing Schwab trade:');
    }
  }

  console.log(`Created ${completedTrades.length} Schwab trades`);
  return completedTrades;
}

async function parseSchwabTransactions(records, existingPositions = {}, context = {}) {
  console.log(`Processing ${records.length} Schwab transaction records`);

  const transactions = [];
  const completedTrades = [];

  // First, parse all transactions - only process Buy and Sell actions
  for (const record of records) {
    try {
      const action = (record['Action'] || '').toLowerCase();
      const symbol = cleanString(record['Symbol'] || '');
      const quantityStr = (record['Quantity'] || '').toString().replace(/,/g, '');
      const priceStr = (record['Price'] || '').toString().replace(/[$,]/g, '');
      const amountStr = (record['Amount'] || '').toString().replace(/[$,]/g, '');
      const feesStr = (record['Fees & Comm'] || '').toString().replace(/[$,]/g, '');
      const date = record['Date'] || '';
      const description = record['Description'] || '';

      // Only process buy and sell transactions
      if (!action.includes('buy') && !action.includes('sell')) {
        console.log(`Skipping non-trade action: [detail omitted]`);
        continue;
      }

      // Skip if missing essential data
      if (!symbol || !quantityStr || !priceStr) {
        console.log(`Skipping transaction missing data:`);
        continue;
      }

      const quantity = Math.abs(parseFloat(quantityStr));
      const price = parseFloat(priceStr);
      const amount = Math.abs(parseFloat(amountStr));
      const fees = parseFloat(feesStr) || 0;

      if (quantity === 0 || price === 0) {
        console.log(`Skipping transaction with zero values:`);
        continue;
      }

      // Detect short sales - only check action field to avoid false positives
      // from security names containing "short" (e.g., "PROSHARES SHORT QQQ ETF")
      const isShort = action.includes('sell short');

      let transactionType;
      if (action.includes('buy')) {
        transactionType = isShort ? 'cover' : 'buy';  // Buy to cover vs regular buy
      } else {
        transactionType = isShort ? 'short' : 'sell'; // Short sell vs regular sell
      }

      // Parse date and skip if invalid
      const parsedDate = parseDate(date);
      if (!parsedDate) {
        console.log(`Skipping transaction with invalid date:`);
        continue;
      }

      const parsedDateTime = parseDateTime(date + ' 09:30');
      if (!parsedDateTime) {
        console.log(`Skipping transaction with invalid datetime:`);
        continue;
      }

      // Determine account identifier - user selection takes priority, then CSV column, then header extraction
      const accountIdentifier = context.selectedAccountId
        ? context.selectedAccountId
        : context.accountColumnName
          ? extractAccountFromRecord(record, context.accountColumnName)
          : (context.schwabAccountNumber || null);

      transactions.push({
        symbol,
        date: parsedDate,
        datetime: parsedDateTime,
        action: transactionType,
        quantity,
        price,
        amount,
        fees,
        description,
        isShort,
        raw: record,
        accountIdentifier
      });

      console.log(`Parsed transaction: [detail omitted] [detail omitted] [detail omitted] @ $[detail omitted] [detail omitted]`);
    } catch (error) {
      console.error('Error parsing Schwab transaction:');
    }
  }

  // Assign unique times to transactions on the same date+symbol to preserve CSV order
  // This prevents issues with duplicate detection when multiple round trips occur on the same day
  const transactionsByDateSymbol = {};
  for (const txn of transactions) {
    // txn.date is a string in YYYY-MM-DD format from parseDate()
    // Ensure date is valid (not null) before using it
    if (!txn.date) {
      console.warn(`[WARNING] Transaction missing date field:`);
      continue;
    }
    const key = `${txn.symbol}_${txn.date}`;
    if (!transactionsByDateSymbol[key]) {
      transactionsByDateSymbol[key] = [];
    }
    transactionsByDateSymbol[key].push(txn);
  }

  // Assign incremental seconds to transactions with the same date+symbol to make each unique
  // IMPORTANT: Keep datetime as a naive string (no Z suffix) so convertTradeDatetimesToUTC
  // will properly convert it using the user's timezone, not Docker's TZ env var
  for (const key in transactionsByDateSymbol) {
    const group = transactionsByDateSymbol[key];
    if (group.length > 1) {
      console.log(`[DEBUG] Found [detail omitted] transactions for [detail omitted]:`);
      group.forEach((txn, index) => {
        const originalTime = txn.datetime;
        // Add incremental seconds to make each unique while keeping naive format
        // Parse the existing time and add index seconds
        const match = String(txn.datetime).match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):(\d{2})(.*)$/);
        if (match) {
          const [, prefix, secStr, suffix] = match;
          const newSec = String(Math.min(parseInt(secStr) + index, 59)).padStart(2, '0');
          txn.datetime = `${prefix}:${newSec}${suffix}`;
        }
        console.log(`[DEBUG]   [[detail omitted]] [detail omitted] [detail omitted] @ $[detail omitted] - Time: [detail omitted] → [detail omitted]`);
      });
      console.log(`[INFO] Assigned unique times to [detail omitted] transactions for [detail omitted] to preserve order`);
    }
  }

  // Sort transactions by symbol and date
  transactions.sort((a, b) => {
    if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
    return new Date(a.datetime) - new Date(b.datetime);
  });

  console.log(`Parsed ${transactions.length} valid transactions`);

  // Track the last trade end time for each symbol (for time-gap-based grouping)
  const lastTradeEndTime = {};

  // Group transactions by symbol
  const transactionsBySymbol = {};
  for (const transaction of transactions) {
    if (!transactionsBySymbol[transaction.symbol]) {
      transactionsBySymbol[transaction.symbol] = [];
    }
    transactionsBySymbol[transaction.symbol].push(transaction);
  }

  // Process transactions using round-trip trade grouping (like TradersVue)
  for (const symbol in transactionsBySymbol) {
    const symbolTransactions = transactionsBySymbol[symbol];

    console.log(`\n=== Processing [detail omitted] transactions for [detail omitted] ===`);

    // Detect instrument type to apply correct multiplier
    const instrumentData = parseInstrumentData(symbol);
    const valueMultiplier = instrumentData.instrumentType === 'option' ? 100 :
                            instrumentData.instrumentType === 'future' ? (instrumentData.pointValue || 1) : 1;

    console.log(`Instrument type: [detail omitted], value multiplier: [detail omitted]`);

    // Start with existing position if we have one for this symbol
    const existingPosition = existingPositions[symbol];
    let currentPosition = existingPosition ?
      (existingPosition.side === 'long' ? existingPosition.quantity : -existingPosition.quantity) : 0;
    let currentTrade = existingPosition ? {
      symbol: symbol,
      entryTime: existingPosition.entryTime,
      tradeDate: existingPosition.tradeDate,
      side: existingPosition.side,
      executions: Array.isArray(existingPosition.executions)
        ? existingPosition.executions
        : (existingPosition.executions ? JSON.parse(existingPosition.executions) : []),
      totalQuantity: existingPosition.quantity,
      totalFees: existingPosition.commission || 0,
      entryValue: existingPosition.quantity * existingPosition.entryPrice * valueMultiplier,
      exitValue: 0,
      broker: existingPosition.broker || 'schwab',
      isExistingPosition: true,
      existingTradeId: existingPosition.id,
      newExecutionsAdded: 0
    } : null;
    const openLots = []; // FIFO queue of position lots

    if (existingPosition) {
      console.log(`  → Starting with existing [detail omitted] position: [detail omitted] [detail omitted] @ $[detail omitted]`);
      console.log(`  → Initial position: [detail omitted], entryValue: $[detail omitted]`);
    }

    for (const transaction of symbolTransactions) {
      const qty = transaction.quantity;
      const prevPosition = currentPosition;

      console.log(`\n[detail omitted] [detail omitted] @ $[detail omitted] | Position: [detail omitted]`);

      // Start new trade if going from flat to position
      if (currentPosition === 0) {
        currentTrade = {
          symbol: symbol,
          entryTime: transaction.datetime,
          tradeDate: transaction.date,
          side: transaction.action === 'buy' ? 'long' : 'short',
          executions: [],
          totalQuantity: 0,
          totalFees: 0,
          weightedEntryPrice: 0,
          weightedExitPrice: 0,
          entryValue: 0,
          exitValue: 0,
          broker: 'schwab',
          accountIdentifier: transaction.accountIdentifier
        };
        console.log(`  → Started new [detail omitted] trade`);
      }

      // Add execution to current trade (check for duplicates first)
      if (currentTrade) {
        const newExecution = {
          action: transaction.action,
          quantity: qty,
          price: transaction.price,
          datetime: transaction.datetime,
          fees: transaction.fees || 0
        };

        // First, check if this execution exists in ANY existing trade (complete or open)
        const existsGlobally = isExecutionDuplicate(newExecution, symbol, context);

        // Then check if it exists in the current trade being built
        // For fresh imports, we trust each CSV row is a unique execution
        // Only deduplicate if we have unique identifiers
        const executionExists = existsGlobally || currentTrade.executions.some(exec => {
          // If both have order IDs, use that for comparison
          if (exec.orderId && newExecution.orderId) {
            return exec.orderId === newExecution.orderId;
          }
          // Without unique identifiers, don't deduplicate within the current import
          return false;
        });

        if (existsGlobally) {
          console.log(`  [SKIP] Execution already exists in a completed or open trade: [detail omitted] [detail omitted] @ $[detail omitted]`);
        }

        if (!executionExists) {
          currentTrade.executions.push(newExecution);
          currentTrade.totalFees += (transaction.fees || 0);
          console.log(`  → Added execution: [detail omitted] [detail omitted] @ $[detail omitted] at [detail omitted]`);
          if (currentTrade.isExistingPosition) {
            currentTrade.newExecutionsAdded++;
          }
        } else {
          console.log(`  → Skipping duplicate execution: [detail omitted] [detail omitted] @ $[detail omitted] at [detail omitted]`);
        }
      }

      // Process the transaction
      if (transaction.action === 'buy') {
        currentPosition += qty;

        // Add to entry or exit value based on trade direction
        if (currentTrade && currentTrade.side === 'long') {
          const beforeEntry = currentTrade.entryValue;
          const beforeQty = currentTrade.totalQuantity;
          currentTrade.entryValue += qty * transaction.price;
          currentTrade.totalQuantity += qty;
          console.log(`  → [LONG BUY] Added to entry: [detail omitted] + [detail omitted] = [detail omitted], Qty: [detail omitted] + [detail omitted] = [detail omitted]`);
        } else if (currentTrade && currentTrade.side === 'short') {
          currentTrade.exitValue += qty * transaction.price;
          console.log(`  → [SHORT BUY] Added to exit: [detail omitted]`);

          // Check if this is a partial close (position will still be negative after this buy)
          if (currentPosition < 0 && currentTrade.totalQuantity > 0) {
            // Calculate P&L for this partial close using weighted average entry price
            const avgEntryPrice = currentTrade.entryValue / (currentTrade.totalQuantity * valueMultiplier);
            const partialPnl = (avgEntryPrice - transaction.price) * qty * valueMultiplier;
            // Prorate commission for partial close
            const partialCommission = (currentTrade.totalFees / currentTrade.totalQuantity) * qty;
            const netPartialPnl = partialPnl - partialCommission;

            // Update the last execution with exit info and P&L
            const lastExec = currentTrade.executions[currentTrade.executions.length - 1];
            if (lastExec && lastExec.action === 'buy') {
              lastExec.entryTime = currentTrade.entryTime;
              lastExec.exitTime = transaction.datetime;
              lastExec.exitPrice = transaction.price;
              lastExec.entryPrice = avgEntryPrice;
              lastExec.pnl = netPartialPnl;
              console.log(`  → [PARTIAL COVER] Covered [detail omitted] @ $[detail omitted], Entry avg: $[detail omitted], P&L: $[detail omitted], Remaining: [detail omitted] shares short`);
            }
          }
        }

        openLots.push({
          type: 'long',
          quantity: qty,
          price: transaction.price,
          date: transaction.date,
          datetime: transaction.datetime
        });

      } else if (transaction.action === 'short' || transaction.action === 'sell') {
        currentPosition -= qty;

        // Add to entry or exit value based on trade direction
        if (currentTrade && currentTrade.side === 'short') {
          currentTrade.entryValue += qty * transaction.price;
          currentTrade.totalQuantity += qty;
          console.log(`  → [SHORT SELL] Added to entry: [detail omitted], Qty: [detail omitted]`);
        } else if (currentTrade && currentTrade.side === 'long') {
          const beforeExit = currentTrade.exitValue;
          currentTrade.exitValue += qty * transaction.price;
          console.log(`  → [LONG SELL] Added to exit: [detail omitted] + [detail omitted] = [detail omitted]`);

          // Check if this is a partial close (position will still be positive after this sell)
          if (currentPosition > 0 && currentTrade.totalQuantity > 0) {
            // Calculate P&L for this partial close using weighted average entry price
            const avgEntryPrice = currentTrade.entryValue / (currentTrade.totalQuantity * valueMultiplier);
            const partialPnl = (transaction.price - avgEntryPrice) * qty * valueMultiplier;
            // Prorate commission for partial close
            const partialCommission = (currentTrade.totalFees / currentTrade.totalQuantity) * qty;
            const netPartialPnl = partialPnl - partialCommission;

            // Update the last execution with exit info and P&L
            const lastExec = currentTrade.executions[currentTrade.executions.length - 1];
            if (lastExec && lastExec.action === 'sell') {
              lastExec.entryTime = currentTrade.entryTime;
              lastExec.exitTime = transaction.datetime;
              lastExec.exitPrice = transaction.price;
              lastExec.entryPrice = avgEntryPrice;
              lastExec.pnl = netPartialPnl;
              console.log(`  → [PARTIAL CLOSE] Sold [detail omitted] @ $[detail omitted], Entry avg: $[detail omitted], P&L: $[detail omitted], Remaining: [detail omitted] shares`);
            }
          }
        }

        if (transaction.action === 'short') {
          openLots.push({
            type: 'short',
            quantity: qty,
            price: transaction.price,
            date: transaction.date,
            datetime: transaction.datetime
          });
        }
      }

      console.log(`  Position: [detail omitted] → [detail omitted]`);

      // Close trade if position goes to zero
      if (currentPosition === 0 && currentTrade && currentTrade.totalQuantity > 0) {
        // Calculate weighted average prices
        // Divide by multiplier to get per-contract/per-share price
        currentTrade.entryPrice = currentTrade.entryValue / (currentTrade.totalQuantity * valueMultiplier);
        currentTrade.exitPrice = currentTrade.exitValue / (currentTrade.totalQuantity * valueMultiplier);

        // Calculate P/L
        if (currentTrade.side === 'long') {
          currentTrade.pnl = currentTrade.exitValue - currentTrade.entryValue - currentTrade.totalFees;
        } else {
          currentTrade.pnl = currentTrade.entryValue - currentTrade.exitValue - currentTrade.totalFees;
        }

        currentTrade.pnlPercent = (currentTrade.pnl / currentTrade.entryValue) * 100;
        currentTrade.quantity = currentTrade.totalQuantity;
        currentTrade.commission = currentTrade.totalFees;
        currentTrade.fees = 0;

        // Calculate proper entry and exit times from all executions
        const { entryTime, exitTime } = getExecutionTimeBounds(currentTrade.executions);
        if (entryTime && exitTime) {
          currentTrade.entryTime = entryTime;
          currentTrade.exitTime = exitTime;
        }

        currentTrade.executionData = currentTrade.executions;

        // Mark as update if this was an existing position
        if (currentTrade.isExistingPosition) {
          currentTrade.shouldUpdate = true;
          currentTrade.notes = `Closed existing position: ${currentTrade.executions.length} total executions`;
          console.log(`  [SUCCESS] CLOSED existing [detail omitted] position: [detail omitted] shares, P/L: $[detail omitted]`);
        } else {
          currentTrade.notes = `Round trip: ${currentTrade.executions.length} executions`;
          console.log(`  [SUCCESS] Completed [detail omitted] trade: [detail omitted] shares, [detail omitted] executions, P/L: $[detail omitted]`);
        }

        completedTrades.push(currentTrade);

        // Record the end time for time-gap-based grouping
        lastTradeEndTime[symbol] = transaction.datetime;

        currentTrade = null;
        openLots.length = 0; // Clear lots when trade completes
      }
    }

    console.log(`\n[detail omitted] Final Position: [detail omitted] shares`);
    if (currentTrade && currentPosition !== 0) {
      // Add open position as incomplete trade
      // Check if this is an update to existing position or new position
      if (currentTrade.isExistingPosition && currentTrade.newExecutionsAdded > 0) {
        // Updated existing position - mark for update
        currentTrade.shouldUpdate = true;
        currentTrade.notes = `Updated open position: ${currentTrade.newExecutionsAdded} new executions added`;
        console.log(`  [SUCCESS] UPDATED open [detail omitted] position: [detail omitted] shares, [detail omitted] new executions`);
      } else if (!currentTrade.isExistingPosition) {
        // New open position
        currentTrade.notes = `Open position: ${currentTrade.executions.length} executions`;
        console.log(`  → Added open [detail omitted] position: [detail omitted] shares`);
      }

      // Calculate weighted average entry price for display
      // Divide by multiplier to get per-contract/per-share price
      currentTrade.entryPrice = currentTrade.entryValue / (currentTrade.totalQuantity * valueMultiplier);
      currentTrade.quantity = currentTrade.totalQuantity;
      currentTrade.commission = currentTrade.totalFees;
      currentTrade.fees = 0;
      currentTrade.executionData = currentTrade.executions;

      completedTrades.push(currentTrade);
      console.log(`Active trade: [detail omitted] [detail omitted] shares, [detail omitted] executions`);
    }
  }

  console.log(`Created ${completedTrades.length} completed trades (including open positions) from transaction pairing`);
  console.log(`\n[DEBUG] Schwab trades summary:`);
  completedTrades.forEach((trade, index) => {
    console.log(`  Trade #[detail omitted]: [detail omitted] [detail omitted] [detail omitted] shares, Entry: $[detail omitted], Exit: $[detail omitted], P&L: $[detail omitted]`);
  });

  return completedTrades;
}

module.exports = {
  parseSchwabTrades,
  parseSchwabTransactions
};
