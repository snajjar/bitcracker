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
        return (p.toFixed(0) + '€')
    } else if (p > 100) {
        return (p.toFixed(1) + '€')
    } else if (p > 10) {
        return (p.toFixed(2) + '€')
    } else {
        return (p.toFixed(3) + '€')
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
    let priceTolerance = 0.0005;

    let refreshTrader = async function() {
        console.log('[*] Refreshing trader data');
        await k.refreshAccount();
        trader.setBalance(k.wallet, k.lastBuyPrice());
        trader.setTradeVolume(k.tradeVolume);
    }

    let displayTraderStatus = function(action) {
        let lastTradeStr = trader.inTrade ? ` lastBuy=${k.lastBuyPrice()}€` : ``
        let objectiveStr = trader.getObjective ? ` objective=${trader.getObjective().toFixed(0)}€` : "";
        console.log(`[*] ${k.fake ? "(FAKE) " : ""}Trader (${trader.hash()}): ${action.yellow} inTrade=${trader.isInTrade().toString().cyan}${lastTradeStr}${objectiveStr} tv=${HRNumbers.toHumanString(trader.get30DaysTradingVolume())}, ${traderStatusStr(trader)}`);
    }

    let waitForOrderCompletion = async function() {
        while (k.hasOpenOrders()) {
            console.log(`[*] Refreshing status of open orders`);
            k.refreshOpenOrders();
            await sleep(3);

            if (!k.hasOpenOrders()) {
                await k.refreshTrader();
            }
        }
    }

    // login and display account infos
    await k.login();
    await k.synchronize(); // get server time delay
    for (let asset of assets) {
        k.addAsset(asset);
        await k.refreshOHLC(asset);
        await sleep(1);
    }
    await refreshTrader();
    k.displayAccount();

    let count = 0;
    while (1) {
        await k.nextMinute();

        console.log('');
        console.log('');

        for (let asset of assets) {
            console.log('');

            // wait for the next ohlc tick
            await k.nextData(asset);

            k.displayLastPrices(asset);

            // resolve current price
            // give the price of the worst case scenario to our trader
            let lastTradedPrice = k.getLastTradedPrice(asset)
            let currentPrice;
            if (trader.isInTrade()) {
                let estimatedPrice = k.estimateSellPrice(asset);
                if (estimatedPrice && !isNaN(estimatedPrice)) {
                    currentPrice = Math.min(estimatedPrice, lastTradedPrice);
                } else {
                    currentPrice = lastTradedPrice;
                }
            } else {
                let estimatedPrice = k.estimateBuyPrice(asset);
                if (estimatedPrice && !isNaN(estimatedPrice)) {
                    currentPrice = Math.max(estimatedPrice, lastTradedPrice);
                } else {
                    currentPrice = lastTradedPrice;
                }
            }

            // time for trader action
            let candles = k.getPriceCandles(asset);
            let candlesToAnalyse = candles.slice(candles.length - trader.analysisIntervalLength());
            dt.connectCandles(candlesToAnalyse);
            let action = await trader.decideAction(asset, candlesToAnalyse);
            displayTraderStatus(action);

            switch (action) {
                case "HOLD":
                    break;
                case "BUY":
                    console.log(`  - BUYING for ${price(k.wallet.getCurrencyAmount())} of ${asset} at expected price ${price(currentPrice)}: ${amount(k.wallet.getCurrencyAmount()/currentPrice)} ${asset}`);
                    await k.buyAll(asset, currentPrice);
                    await refreshTrader();
                    k.displayAccount();
                    break;
                case "SELL":
                    console.log(`  - SELLING ${amount(k.wallet.getAmount(asset))} ${asset} at expected price ${price(currentPrice * k.wallet.getAmount(asset))}`);
                    await k.sellAll(asset, currentPrice);
                    await refreshTrader();
                    k.displayAccount();
                    break;
                case "BID":
                    console.log(`  - BIDDING for ${price(k.wallet.getCurrencyAmount())} of ${asset} at expected price ${price(currentPrice)}: ${amount(k.wallet.getCurrencyAmount()/currentPrice)} ${asset}`);
                    await k.bidAll(asset, currentPrice);
                    await waitForOrderCompletion();
                    k.displayAccount();

                    break;
                case "ASK":
                    console.log(`  - ASKING for ${amount(k.wallet.getAmount(asset))} ${asset} at expected price ${price(currentPrice * k.wallet.getAmount(asset))}`);
                    await k.askAll(asset, currentPrice);
                    await waitForOrderCompletion();
                    k.displayAccount();
                    break;
                default:
                    console.error('Trader returned no action !'.red);
            }
        }

        if (count++ % 10 == 9) {
            // every once in a while, refresh the trader data and display it's status
            await refreshTrader();
            k.displayAccount();
        }
    }
}

module.exports = trade;