/******************************************************************************
 * trade.js - Trade with a trader on real market data
 *****************************************************************************/

const _ = require('lodash');
const utils = require('./lib/utils');
const config = require('./config');
const dt = require('./lib/datatools');
const moment = require('moment');
const colors = require('colors');
const axios = require('axios');
const dotenv = require('dotenv');
// const Prompt = require('prompt-password');
const prompts = require('prompts');
const encryption = require('./lib/encryption');
const Wallet = require('./lib/wallet');
const KrakenClient = require('kraken-api');
const HRNumbers = require('human-readable-numbers');

const extractFieldsFromKrakenData = function(arr) {
    return {
        "timestamp": arr[0],
        "open": parseFloat(arr[1]),
        "high": parseFloat(arr[2]),
        "low": parseFloat(arr[3]),
        "close": parseFloat(arr[4]),
        "volume": parseFloat(arr[6]),
    }
}

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

const priceYellow = function(p) {
    return priceStr(p).yellow
};

const amount = function(p) {
    return (p.toFixed(3)).cyan
}

const candleStr = function(c) {
    let time = moment.unix(c.timestamp);
    return `t=${time.format('DD/MM/YY hh:mm')} open=${price(c.open)} high=${price(c.high)} low=${price(c.low)} close=${price(c.close)} v=${c.volume}`;
}

const traderStatusStr = function(trader) {
    return trader.wallet.coloredStr();
}

class Kraken {
    constructor(fake) {
        this.fake = fake ? true : false;
        this.kraken = null;
        this.currency = "EUR";
        this.wallet = new Wallet(this.currency);

        // prices data for each asset
        // following format (example):
        // {
        //    "BTC": {
        //       candles: [],      // array of ohlc
        //       currCandle: null, // last ohlc (currently moving)
        //       since: 0,         // last timestamp we refreshed on + 1
        //    }
        //  }
        this.prices = {};
        this.candles = [];
        this.currCandle = null;
        this.since = 0;

        this.placedOrders = []; // history of orders we made

        this.openOrders = {};
        this.closedOrders = {};

        this.tradeVolume = 0;
        this.serverTimeDelay = 0; // number of ms diff between srv and client
    }

    // get OHLC data for asset "asset"
    // return true if there is new data, false otherwise
    async refreshOHLC(asset) {
        const isNewData = (candles) => {
            if (!this.candles || this.candles.length == 0) {
                return true;
            } else {
                let lastKnownData = _.last(this.candles);
                let lastNewData = _.last(candles);
                return !lastKnownData || lastKnownData.timestamp !== lastNewData.timestamp;
            }
        }

        if (!this.prices[asset]) {
            this.prices[asset] = {
                candles: [],
                currCandle: null,
                since: 0,
            };
        }

        let r = null;
        try {
            // get last prices
            let options = {
                pair: `${asset}${this.currency}`,
                interval: 1,
                since: this.prices[asset].since,
            }
            r = await this.kraken.api('OHLC', options);

            // format data into candles
            let firstKey = _.keys(r.result)[0];
            let results = r.result[firstKey];
            let periods = [];
            _.each(results, r => {
                periods.push(extractFieldsFromKrakenData(r));
            });

            let candles = _.sortBy(periods, p => p.timestamp);
            this.prices[asset].currCandle = candles.pop();
            let lastCandle = _.last(candles);
            if (lastCandle) {
                this.prices[asset].since = lastCandle ? lastCandle.timestamp + 1 : 0; // set the new "since" period
                //console.log(`SET PRICE ${lastCandle.close} for ASSET ${asset}`);
                this.wallet.setPrice(asset, lastCandle.close); // refresh wallet price

                if (!_.isEmpty(candles) && isNewData(candles)) {
                    // there is new data
                    // concat new periods to old ones
                    this.prices[asset].candles = this.prices[asset].candles.concat(candles);
                    if (this.prices[asset].candles.length > 1000) {
                        this.prices[asset].candles = this.prices[asset].candles.slice(this.prices[asset].candles.length - 1000);
                    }
                    return true;
                } else {
                    return false;
                }
            } else {
                return false;
            }
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error refreshing prices: ' + errorMsg.red);
                console.error(e);
                if (errorMsg.includes("API:Rate limit exceeded")) {
                    console.log('[*] sleeping 10s');
                    await sleep(10);
                }
            } else {
                console.error('Error refreshing prices');
                console.error(e);
                console.log(JSON.stringify(r));
            }
        }
    }

    getCurrentPrice(asset) {
        if (!this.prices[asset] || !this.prices[asset].currCandle) {
            throw new Error("You should first refresh OHLC data before getting current price");
        }
        return this.prices[asset].currCandle.close;
    }

    getPriceCandles(asset) {
        if (!this.prices[asset] || !this.prices[asset].candles) {
            throw new Error("You should first refresh OHLC data before getting candles");
        }
        return _.clone(this.prices[asset].candles);
    }

    displayLastPrices(asset) {
        let p = this.prices[asset];
        let time = moment.unix(p.currCandle.timestamp);
        let candles = p.candles;
        console.log(`[*] ${moment().format('DD/MM/YY hh:mm:ss')} ${asset}: ${price(candles[candles.length-4].close)} -> ` +
            `${price(candles[candles.length-3].close)} -> ` +
            `${price(candles[candles.length-2].close)} -> ` +
            `${price(candles[candles.length-1].close)} -> ` +
            `${priceYellow(this.getCurrentPrice(asset))} (current candle ${time.format('hh:mm:ss')})`);
    }

    displayAllPrices() {
        console.log('');
        _.each(this.prices, (p, asset) => {
            let time = moment.unix(p.currCandle.timestamp);
            let candles = p.candles;
            console.log(`[*] ${moment().format('DD/MM/YY hh:mm:ss')} ${asset}: ${price(candles[candles.length-4].close)} -> ` +
                `${price(candles[candles.length-3].close)} -> ` +
                `${price(candles[candles.length-2].close)} -> ` +
                `${price(candles[candles.length-1].close)} -> ` +
                `${priceYellow(this.getCurrentPrice(asset))} (current candle ${time.format('hh:mm:ss')})`);
        })
        console.log('');
    }

    // get the max BTC volume we can buy with our current EUR wallet
    _getMaxAssetVolume(price) {
        // for safety of orders, let's assume BTC price increased by 0.1% since last price
        price = price * 1.002;

        // adjust volumal precision: 8 decimals for a BTC. Round it to 3
        return Math.floor((this.wallet.getAmount(this.wallet.getMainCurrency()) / price) * 1000) / 1000;
    }

    // get the max EUR volume we can get with our current BTC wallet
    _getMaxCurrencyVolume(asset, price) {
        // for safety of orders, let's assume BTC price decreased by 0.1% since last price
        price = price * 0.998;

        // adjust volumal precision: 1 decimals for a EUR. Round it to 0
        return Math.floor(this.wallet.getAmount(asset) * price);
    }

    async login() {
        let envConfig = dotenv.config();
        if (!envConfig || !envConfig.parsed) {
            console.error("You must auth first.".red);
            process.exit(-1);
        }
        let config = envConfig.parsed;
        if (!config.KRAKEN_API_KEY || !config.KRAKEN_SECRET_API_KEY) {
            console.error("You must auth first.".red);
            process.exit(-1);
        }

        const response = await prompts({
            type: 'password',
            name: 'password',
            message: 'password',
            validate: value => value.length < 8 ? `password is at least 8 chararacters` : true
        });
        let password = await response.password;

        // decrypt api key, secret key, and login to kraken
        let apiKey = encryption.decrypt(config.KRAKEN_API_KEY, password);
        let secretApiKey = encryption.decrypt(config.KRAKEN_SECRET_API_KEY, password);

        // console.log("apiKey:", apiKey);
        // console.log("secretAPIKey: ", secretApiKey);

        try {
            this.kraken = new KrakenClient(apiKey, secretApiKey);
        } catch (e) {
            console.error("Auth failed, incorrect password".red);
            process.exit(-1);
        }

        // check if we logged in successfully but retrieving balance
        try {
            // get balance info
            let r = await this.kraken.api('Balance');

            _.each(r.result, (amountStr, key) => {
                let name = key;
                if (name.length == 4) {
                    // kraken sometimes prefix with 'X' for cryptos and 'Z' for currencies
                    name = name.substr(1);
                }
                let amount = parseFloat(amountStr);
                this.wallet.setAmount(name, amount);
            });
        } catch (e) {
            console.error('It appears that you are not logged in correctly'.red);
            throw e;
        }
    }

    async getServerTime() {
        let r = null;
        try {
            // get balance info
            r = await this.kraken.api('Time');
            let time = parseInt(r.result["unixtime"]);
            return time;
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error retrieving account balance: ' + errorMsg.red);
                console.error(e);
            } else {
                console.error('Error retrieving account balance');
                console.error(e);
                console.log(JSON.stringify(r));
            }
        }
    }

    // save difference between local time and server time
    async synchronize() {
        // server time synchronisation
        let serverTime = await this.getServerTime();
        let diff = moment() - moment.unix(serverTime);
        this.serverTimeDelay = diff % 60000 - 200; // remove 200ms for ping delay
        console.log(`[*] Time synchronisation: ${this.serverTimeDelay}ms`);
    }

    // required synchronisation
    async nextMinute() {
        let now = moment();
        let nextMinute = moment().add(1, "minute").startOf("minute");
        if (this.serverTimeDelay > 0) {
            nextMinute.add(this.serverTimeDelay, "milliseconds");
        }
        let diff = moment.duration(nextMinute - now).asMilliseconds();
        await sleepms(diff);
    }

    // return when there is a new price data available
    async nextData(asset) {
        let since = _.get(this.prices, [asset, "since"]) || 0;
        let startOfLastMinute = moment().subtract(1, 'minute').subtract(1, 'second').startOf('minute');
        let lastAssetRefresh = moment.unix(since);

        // if last refresh happened in this minute, wait for the next minute
        if (startOfLastMinute.isBefore(lastAssetRefresh)) {
            await this.nextMinute();
        }

        let newDataAvailable = await this.refreshOHLC(asset);
        while (!newDataAvailable) {
            //console.log(`[*] Last data for ${asset} at ${lastAssetRefresh.format('DD/MM/YYYY HH:mm:ss')}, now ${moment().format('DD/MM/YYYY HH:mm:ss')}, retrying...`);
            await sleep(1);
            newDataAvailable = await this.refreshOHLC(asset);
        }
    }

    async refreshBalance() {
        let r = null;
        try {
            // get balance info
            r = await this.kraken.api('Balance');
            _.each(r.result, (amountStr, assetName) => {
                if (assetName.length == 4) {
                    // remove Kraken 'X' prefix (cryptos) or 'Z' prefix (currencies)
                    assetName = assetName.substr(1);
                }

                this.wallet.setAmount(assetName, parseFloat(amountStr));
            });
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error retrieving account balance: ' + errorMsg.red);
                console.error(e);
            } else {
                console.error('Error retrieving account balance');
                console.error(e);
                console.log(JSON.stringify(r));
            }
        }
    }

    async refreshOpenOrders() {
        let r = null;
        try {
            // get balance info
            r = await this.kraken.api('OpenOrders');
            this.openOrders = r.result.open;
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error retrieving account orders: ' + errorMsg.red);
            } else {
                console.error('Error retrieving account orders');
                console.error(e);
                console.log(JSON.stringify(r));
            }
        }
    }

    async refreshClosedOrders() {
        let r = null;
        try {
            // get balance info
            r = await this.kraken.api('ClosedOrders');
            //console.log(JSON.stringify(r));
            this.closedOrders = r.result.closed;
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error retrieving account orders: ' + errorMsg.red);
            } else {
                console.error('Error retrieving account orders');
                console.error(e);
                console.log(JSON.stringify(r));
            }
        }
    }

    async refreshTradeVolume() {
        let r = null;
        try {
            // get balance info
            r = await this.kraken.api('TradeVolume');
            this.tradeVolume = parseFloat(r.result.volume);
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error retrieving account orders: ' + errorMsg.red);
            } else {
                console.error('Error retrieving account orders');
                console.error(e);
                console.log(JSON.stringify(r));
            }
        }
    }

    getPairKey(asset) {
        return `${asset}${this.currency}`;
    }

    async buyAll(asset, currentAssetPrice) {
        let r = null;

        // reference that order, we never know
        let userref = Math.floor(Math.random() * 1000000000);
        let options = {
            pair: this.getPairKey(asset),
            type: 'buy',
            ordertype: 'market',
            volume: this._getMaxAssetVolume(currentAssetPrice),
            expiretm: "+60", // expire in 60s,
            userref: userref, // reference for order, to be used internally
            // validate: true, // validate input only, do not submit order !
        }
        if (this.fake) {
            options.validate = true;
        }

        try {
            // get balance info
            r = await this.kraken.api('AddOrder', options);
            console.log(`[*] placed ${this.fake ? "(FAKE)": ""} BUY order: ${r.result.descr.order}`);
            this.placedOrders.push({ order: options, result: r.result });
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error while buying: ' + errorMsg.red);
            } else {
                console.error('Error while buying'.red);
                console.error(e);
                console.log(JSON.stringify(r));
            }
            //process.exit(-1);
        }
    }

    async sellAll(asset) {
        let r = null;

        // reference that order, we never know
        let userref = Math.floor(Math.random() * 1000000000);
        let options = {
            pair: this.getPairKey(asset),
            type: 'sell',
            ordertype: 'market',
            volume: this.wallet.getAmount(asset),
            expiretm: "+60", // expire in 60s,
            userref: userref, // reference for order, to be used internally
        }

        if (this.fake) {
            options.validate = true;
        }

        try {
            // get balance info
            r = await this.kraken.api('AddOrder', options);
            console.log(`[*] placed ${this.fake ? "(FAKE)": ""} SELL order: ${r.result.descr.order}`);
            this.placedOrders.push({ order: options, result: r.result });
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error while selling: ' + errorMsg.red);
            } else {
                console.error('Error while selling'.red);
                console.error(e);
                console.log(JSON.stringify(r));
            }
            //process.exit(-1);
        }
    }


    // bidding is like buying, but at a limit price, expiration in 55 seconds
    // (to be sure it's expired when next period starts)
    // we use post limit order to make sure we get the maker fees
    async bidAll(asset, price) {
        let r = null;

        // reference that order, we never know
        let userref = Math.floor(Math.random() * 1000000000);
        let options = {
            pair: this.getPairKey(asset),
            type: 'buy',
            ordertype: 'limit',
            volume: this._getMaxAssetVolume(price),
            expiretm: "+55", // expire in 55s,
            oflags: "post",
            price: price.toFixed(1),
            userref: userref, // reference for order, to be used internally
            // validate: true, // validate input only, do not submit order !
        }
        if (this.fake) {
            options.validate = true;
        }

        try {
            // get balance info
            r = await this.kraken.api('AddOrder', options);
            console.log(`[*] placed ${this.fake ? "(FAKE)": ""} BUY order: ${r.result.descr.order}`);
            this.placedOrders.push({ order: options, result: r.result });
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error while bidding: ' + errorMsg.red);
            } else {
                console.error('Error while bidding'.red);
                console.error(e);
                console.log(JSON.stringify(r));
            }
            //process.exit(-1);
        }
    }

    async askAll(asset, price) {
        let r = null;

        // reference that order, we never know
        let userref = Math.floor(Math.random() * 1000000000);
        let options = {
            pair: this.getPairKey(asset),
            type: 'sell',
            ordertype: 'limit',
            volume: this.wallet.getAmount(asset),
            expiretm: "+55", // expire in 60s,
            oflags: "post",
            price: price.toFixed(1),
            userref: userref, // reference for order, to be used internally
        }

        if (this.fake) {
            options.validate = true;
        }

        try {
            // get balance info
            r = await this.kraken.api('AddOrder', options);
            console.log(`[*] placed ${this.fake ? "(FAKE)": ""} SELL order: ${r.result.descr.order}`);
            this.placedOrders.push({ order: options, result: r.result });
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error while asking: ' + errorMsg.red);
            } else {
                console.error('Error while asking'.red);
                console.error(e);
                console.log(JSON.stringify(r));
            }
            //process.exit(-1);
        }
    }

    async refreshAccount() {
        this.refreshTradeVolume();
        await sleep(1);

        await this.refreshBalance();
        await sleep(1);

        await this.refreshOpenOrders();
        await sleep(2);

        await this.refreshClosedOrders();
        await sleep(2);
    }

    displayBalance() {
        this.wallet.display();
    }

    displayOpenOrders() {
        console.log(`- ${_.keys(this.openOrders).length.toString().cyan} open orders`);
        _.each(this.openOrders, (o, key) => {
            console.log(`   - ${key}: ${o.descr.order}`);
        });
    }

    displayClosedOrders() {
        console.log(`- ${_.keys(this.closedOrders).length.toString().cyan} closed orders (last 10):`);
        let sortedClosedOrders = _.sortBy(this.closedOrders, o => o.closetm);
        let lastOrders = _.slice(sortedClosedOrders, sortedClosedOrders.length - 10);
        _.each(_.reverse(lastOrders), (o, key) => {
            if (o.price > 0) {
                console.log(`   - ${key}: ${o.descr.order} (price: ${o.price})`);
            } else {
                console.log(`   - ${key}: ${o.descr.order}`);
            }
        });
    }

    lastBuyPrice() {
        let buys = _.sortBy(this.closedOrders, o => o.descr.type == "buy");
        let sortedBuys = _.sortBy(buys, o => o.closetm);
        let lastBuy = _.last(sortedBuys);
        return lastBuy.price;
    }

    lastSellPrice() {
        let buys = _.sortBy(this.closedOrders, o => o.descr.type == "sell");
        let sortedBuys = _.sortBy(buys, o => o.closetm);
        let lastSell = _.last(sortedBuys);
        return lastSell.price;
    }

    displayAccount() {
        console.log('-----------------------------------------------------------------------------');
        console.log(' Current account status: ');
        this.displayBalance();
        this.displayOpenOrders();
        this.displayClosedOrders();
        console.log('-----------------------------------------------------------------------------');
    }
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
        console.log('[*] Fake trading on current bitcoin price');
    } else {
        console.log('[*] Real trading on current bitcoin price');
    }

    let trader = await getTrader(name);
    let k = new Kraken(fake);
    let assets = getAssets();

    let refreshTrader = async function() {
        console.log('[*] Refreshing trader data');
        await k.refreshAccount();
        trader.setBalance(k.wallet, k.lastBuyPrice());
        trader.setTradeVolume(k.tradeVolume);
    }

    let displayTraderStatus = function(action) {
        let lastTradeStr = trader.inTrade ? ` lastBuy=${k.lastBuyPrice()}€` : ` lastSell=${k.lastSellPrice()}€`
        let objectiveStr = trader.getObjective ? ` objective=${trader.getObjective().toFixed(0)}€` : "";
        console.log(`[*] ${k.fake ? "(FAKE) " : ""}Trader (${trader.hash()}): ${action.yellow} inTrade=${trader.isInTrade().toString().cyan}${lastTradeStr}${objectiveStr} tv=${HRNumbers.toHumanString(trader.get30DaysTradingVolume())}, ${traderStatusStr(trader)}`);
    }

    // login and display account infos
    await k.login();
    await k.synchronize(); // get server time delay
    // for (let asset of assets) {
    //     await k.refreshOHLC(asset);
    // }
    await refreshTrader();
    k.displayAccount();

    //k.displayAllPrices();
    //displayTraderStatus("HOLD");

    let count = 0;
    while (1) {
        console.log('');
        console.log('');

        for (let asset of assets) {
            console.log('');

            // wait for the next ohlc tick
            await k.nextData(asset);

            k.displayLastPrices(asset);
            let currentPrice = k.getCurrentPrice(asset);

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
                    await sleep(20); // sleep 20s
                    await refreshTrader();
                    k.displayAccount();
                    break;
                case "ASK":
                    console.log(`  - ASKING for ${amount(k.wallet.getAmount(asset))} ${asset} at expected price ${price(currentPrice * k.wallet.getAmount(asset))}`);
                    await k.askAll(asset, currentPrice);
                    await sleep(20); // sleep 20s
                    await refreshTrader();
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