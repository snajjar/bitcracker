/******************************************************************************
 * trade.js - Trade with a trader on real market data
 *****************************************************************************/

const _ = require('lodash');
const config = require('./config');
const dt = require('./lib/datatools');
const HRNumbers = require('human-readable-numbers');
const KrakenClient = require('./lib/krakenclient');

const getTrader = async function(name) {
    let TraderConstructor = require('./traders/' + name);
    if (!TraderConstructor) {
        console.error(`Trader ${name} is not implemented (yet!)`);
        process.exit(-1);
    }

    let trader = new TraderConstructor();
    await trader.initialize(config.getInterval());
    return trader;
}

const sleepms = function(s) {
    return new Promise(resolve => setTimeout(resolve, s));
}

const sleep = function(s) {
    return sleepms(s * 1000);
}

const priceStr = function(p) {
    if (p > 1000) {
        return (p.toFixed(1) + '€')
    } else if (p > 100) {
        return (p.toFixed(2) + '€')
    } else if (p > 10) {
        return (p.toFixed(3) + '€')
    } else {
        return (p.toFixed(4) + '€')
    }
};

const price = function(p) {
    return priceStr(p).cyan;
}

const amount = function(p) {
    return (p.toFixed(3)).cyan
}

const traderStatusStr = function(trader) {
    return trader.wallet.coloredStr();
}

const getAssets = function() {
    // get the assets we want to trade on
    let assets = config.getAssets();

    // replace "BTC" by "XBT" for Kraken
    if (assets.includes("BTC")) {
        _.each(assets, (asset, index) => {
            if (asset == "BTC") {
                assets[index] = "XBT";
            }
        });
    }

    return assets;
}

const trade = async function(name, fake) {
    if (fake) {
        console.log('[*] Fake trading starting');
    } else {
        console.log('[*] Real trading starting');
    }

    let trader = await getTrader(name);
    let k = new KrakenClient(fake);
    let assets = getAssets();
    let nbAssets = assets.length;

    let refreshTrader = async function() {
        console.log('[*] Refreshing trader data');
        await k.refreshAccount();
        // console.log('[*] Last buy price=', k.lastBuyPrice());
        trader.setBalance(k.wallet, k.lastBuyPrice());
        trader.setTradeVolume(k.tradeVolume);
    }

    let displayTraderStatus = function(action, asset) {
        let lastTradeStr = "",
            objectiveStr = "",
            stopLossStr = "";
        if (trader.isInTrade() && trader.getCurrentTradeAsset() == asset) {
            lastTradeStr = ` lastBuy=${price(k.lastBuyPrice() || 0)}`;
            objectiveStr = trader.getObjective ? ` objective=${price(trader.getObjective())}` : "";
            stopLossStr = trader.getStopLoss ? ` sl=${price(trader.getStopLoss())}` : "";
        }
        console.log(`[*] ${k.fake ? "(FAKE) " : ""}Trader (${trader.hash()}): ${action.yellow} asset=${trader.currentAsset} inTrade=${trader.isInTrade().toString().cyan}${lastTradeStr}${objectiveStr}${stopLossStr} tv=${HRNumbers.toHumanString(trader.get30DaysTradingVolume())}, ${traderStatusStr(trader)}`);
    }

    let waitForOrderCompletion = async function() {
        k.refreshOpenOrders();
        while (k.hasOpenOrders()) {
            console.log(`[*] Refreshing status of open orders`);
            await sleep(3);
            k.refreshOpenOrders();

            if (!k.hasOpenOrders()) {
                await refreshTrader();
            }
        }
    }

    // trader mutex to make sure we don't handle 2 assets at the same time
    // to avoid confusing the trader
    let traderBusy = false;
    let takeTraderMutex = async function() {
        return new Promise((resolve) => {
            let checkIfTraderReady = () => {
                if (traderBusy) {
                    setTimeout(checkIfTraderReady, 1000);
                } else {
                    traderBusy = true;
                    resolve();
                }
            }
            checkIfTraderReady();
        });
    };
    let releaseTraderMutex = function() {
        traderBusy = false;
    }

    let count = 0;

    // login and display account infos
    k.setHistorySize(trader.analysisIntervalLength());
    for (let asset of assets) {
        k.addAsset(asset);
    }
    await k.login();
    await k.synchronize(); // get server time delay
    await k.initSocket(); // connect to websocket
    await refreshTrader();
    k.displayAccount();
    k.onNewCandle(async (asset, newCandle) => {
        await takeTraderMutex();
        console.log('');

        k.displayLastPrices(asset);

        // resolve current price
        // give the price of the worst case scenario to our trader
        let lastTradedPrice = k.getLastTradedPrice(asset)
        let estimatedSellPrice = k.estimateSellPrice(asset);
        let estimatedBuyPrice = k.estimateBuyPrice(asset);
        let isValid = (p) => p !== null && p !== undefined && !isNaN(p) && p;
        let currentPrice = {
            marketBuy: isValid(estimatedBuyPrice) ? estimatedBuyPrice : lastTradedPrice,
            lastTraded: lastTradedPrice,
            marketSell: isValid(estimatedSellPrice) ? estimatedSellPrice : lastTradedPrice
        }

        // important: update price on the trader wallet
        trader.wallet.setPrice(asset, currentPrice.lastTraded);

        // time for trader action
        let analysisIntervalLength = trader.analysisIntervalLength();
        let candles = k.getPriceCandles(asset);
        if (candles.length >= analysisIntervalLength) {
            let candlesToAnalyse = candles.slice(candles.length - analysisIntervalLength);
            //dt.connectCandles(candlesToAnalyse);
            let action = await trader.decideAction(asset, candlesToAnalyse, currentPrice);
            displayTraderStatus(action, asset);

            let expectedAmount, expectedPrice;
            switch (action) {
                case "HOLD":
                    break;
                case "BUY":
                    expectedAmount = (k.wallet.getCurrencyAmount() / currentPrice.marketBuy * (1 - trader.getBuyTax()));
                    console.log(`  - BUYING for ${price(k.wallet.getCurrencyAmount())} of ${asset} at expected price ${price(currentPrice.marketBuy)}: ${amount(expectedAmount)} ${asset}`);
                    await k.buyAll(asset, currentPrice.marketBuy);
                    await sleep(3);
                    await refreshTrader();
                    k.displayAccount();
                    trader.deleteOrders();
                    break;
                case "SELL":
                    expectedPrice = currentPrice.marketSell * k.wallet.getAmount(asset) * (1 - trader.getSellTax());
                    console.log(`  - SELLING ${amount(k.wallet.getAmount(asset))} ${asset} at expected price ${price(expectedPrice)}`);
                    await k.sellAll(asset, currentPrice.marketSell);
                    await sleep(3);
                    await refreshTrader();
                    k.displayAccount();
                    trader.deleteOrders();
                    break;
                case "BID":
                    expectedAmount = k.wallet.getCurrencyAmount() / currentPrice.lastTraded * (1 - trader.getBidTax());
                    console.log(`  - BIDDING for ${price(k.wallet.getCurrencyAmount())} of ${asset} at expected price ${price(currentPrice.lastTraded)}: ${amount(expectedAmount)} ${asset}`);
                    await k.bidAll(asset, currentPrice.lastTraded);
                    await waitForOrderCompletion();
                    k.displayAccount();
                    trader.deleteOrders();
                    break;
                case "ASK":
                    expectedPrice = currentPrice.lastTraded * k.wallet.getAmount(asset) * (1 - trader.getAskTax());
                    console.log(`  - ASKING for ${amount(k.wallet.getAmount(asset))} ${asset} at expected price ${price(expectedPrice)}`);
                    await k.askAll(asset, currentPrice.lastTraded);
                    await waitForOrderCompletion();
                    k.displayAccount();
                    trader.deleteOrders();
                    break;
                default:
                    console.error('Trader returned no action !'.red);
            }

            if (count++ % (5 * nbAssets) == (5 * nbAssets) - 1) {
                // every once in a while, refresh the trader data and display it's status
                await refreshTrader();
                k.displayAccount();
            }
        } else {
            console.log(`[*] skipping trader action, ${candles.length}/${analysisIntervalLength} periods necessary for analysis`);
        }

        releaseTraderMutex();
    });
}

module.exports = trade;