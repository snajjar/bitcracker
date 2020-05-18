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

const getKrakenData = async function(interval, since) {
    let response = null;
    let results = null;
    let url = null;

    if (since) {
        url = `https://api.kraken.com/0/public/OHLC?pair=BTCEUR&interval=${interval}&since=${since}`;
    } else {
        url = `https://api.kraken.com/0/public/OHLC?pair=BTCEUR&interval=${interval}`;
    }

    try {
        response = await axios.get(url);
        results = response.data.result["XXBTZEUR"];

        let periods = [];
        _.each(results, r => {
            periods.push(extractFieldsFromKrakenData(r));
        });
        return _.sortBy(periods, p => p.timestamp);
    } catch (e) {
        let errorMsg = _.get(response, ['data', 'error', 0]);
        if (errorMsg) {
            console.error('Error from Kraken while fetching data: ' + errorMsg.red);
        } else {
            console.error('Error while fetching Kraken data');
        }
        return null;
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

const price = function(p) {
    return (p.toFixed(0) + '€').cyan
};

const priceYellow = function(p) {
    return (p.toFixed(0) + '€').yellow
};

const btc = function(p) {
    return (p.toFixed(3) + 'BTC').cyan
}

const candleStr = function(c) {
    let time = moment.unix(c.timestamp);
    return `t=${time.format('DD/MM/YY hh:mm')} open=${price(c.open)} high=${price(c.high)} low=${price(c.low)} close=${price(c.close)} v=${c.volume}`;
}

const traderStatusStr = function(trader, currentBitcoinPrice) {
    return `eur=${price(trader.eurWallet)} btc=${trader.btcWallet.toString().cyan} (${price(trader.btcWallet * currentBitcoinPrice)})`;
}

class Kraken {
    constructor(fake) {
        this.fake = fake ? true : false;
        this.kraken = null;
        this.eurWallet = 0;
        this.btcWallet = 0;

        // last prices
        this.candles = [];
        this.currCandle = null;
        this.since = 0;

        this.placedOrders = []; // history of orders we made

        this.openOrders = {};
        this.closedOrders = {};

        this.tradeVolume = 0;
        this.serverTimeDelay = 0; // number of ms diff between srv and client
    }

    // get OHLC data since "since"
    // return true if there is new data, false otherwise
    async refreshOHLC() {
        const isNewData = (candles) => {
            if (!this.candles || this.candles.length == 0) {
                return true;
            } else {
                let lastKnownData = _.last(this.candles);
                let lastNewData = _.last(candles);
                return !lastKnownData || lastKnownData.timestamp !== lastNewData.timestamp;
            }
        }

        let r = null;
        try {
            // get last prices
            let options = {
                pair: 'BTCEUR',
                interval: 1,
                since: this.since,
            }
            r = await this.kraken.api('OHLC', options);

            // format data into candles
            let results = r.result["XXBTZEUR"];
            let periods = [];
            _.each(results, r => {
                periods.push(extractFieldsFromKrakenData(r));
            });

            let candles = _.sortBy(periods, p => p.timestamp);
            this.currCandle = candles.pop();
            let lastCandle = _.last(candles);
            this.since = lastCandle ? lastCandle.timestamp + 1 : 0; // set the new "since" period

            if (!_.isEmpty(candles) && isNewData(candles)) {
                // there is new data
                // concat new periods to old ones
                this.candles = this.candles.concat(candles);
                if (this.candles.length > 1000) {
                    this.candles = this.candles.slice(this.candles.length - 1000);
                }
                return true;
            } else {
                return false;
            }
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error refreshing prices: ' + errorMsg.red);
                console.error(e);
            } else {
                console.error('Error refreshing prices');
                console.error(e);
                //console.log(JSON.stringify(r));
            }
        }
    }

    getCurrentBitcoinPrice() {
        if (!this.currCandle) {
            throw new Error("You should first refresh OHLC data before getting bitcoin price");
        }
        return this.currCandle.close;
    }

    getPriceCandles() {
        if (!this.candles) {
            throw new Error("You should first refresh OHLC data before getting bitcoin price");
        }
        return _.clone(this.candles);
    }

    displayLastPrices() {
        let time = moment.unix(this.currCandle.timestamp);
        let candles = this.candles;
        console.log(`[*] ${moment().format('DD/MM/YY hh:mm:ss')} Prices: ${price(candles[candles.length-4].close)} -> ` +
            `${price(candles[candles.length-3].close)} -> ` +
            `${price(candles[candles.length-2].close)} -> ` +
            `${price(candles[candles.length-1].close)} -> ` +
            `${priceYellow(this.getCurrentBitcoinPrice())} (current candle ${time.format('hh:mm:ss')})`);
    }

    // get the max BTC volume we can buy with our current EUR wallet
    _getMaxBTCVolume(currentBitcoinPrice) {
        // for safety of orders, let's assume BTC price increased by 0.1% since last price
        currentBitcoinPrice = currentBitcoinPrice * 1.001;

        // adjust volumal precision: 8 decimals for a BTC. Round it to 3
        return Math.floor((this.eurWallet / currentBitcoinPrice) * 1000) / 1000;
    }

    // get the max EUR volume we can get with our current BTC wallet
    _getMaxEURVolume(currentBitcoinPrice) {
        // for safety of orders, let's assume BTC price decreased by 0.1% since last price
        currentBitcoinPrice = currentBitcoinPrice * 0.999;

        // adjust volumal precision: 1 decimals for a EUR. Round it to 0
        return Math.floor(this.btcWallet * currentBitcoinPrice);
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
            this.eurWallet = parseFloat(r.result["ZEUR"]);
            this.btcWallet = parseFloat(r.result["XXBT"]);
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
    async nextData() {
        await this.nextMinute();
        let newDataAvailable = await this.refreshOHLC();
        while (!newDataAvailable) {
            console.log('[*] Retrying refresh...');
            await sleep(1);
            newDataAvailable = await this.refreshOHLC();
        }
    }

    async refreshBalance() {
        let r = null;
        try {
            // get balance info
            r = await this.kraken.api('Balance');
            this.eurWallet = parseFloat(r.result["ZEUR"]);
            this.btcWallet = parseFloat(r.result["XXBT"]);
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

    async buyAll(currentBitcoinPrice) {
        let r = null;

        // reference that order, we never know
        let userref = Math.floor(Math.random() * 1000000000);
        let options = {
            pair: 'XBTEUR',
            type: 'buy',
            ordertype: 'market',
            volume: this._getMaxBTCVolume(currentBitcoinPrice),
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
            process.exit(-1);
        }
    }

    // bidding is like buying, but at a limit price, expiration in 55 seconds
    // (to be sure it's expired when next period starts)
    // we use post limit order to make sure we get the maker fees
    async bidAll(currentBitcoinPrice) {
        let r = null;

        // reference that order, we never know
        let userref = Math.floor(Math.random() * 1000000000);
        let options = {
            pair: 'XBTEUR',
            type: 'buy',
            ordertype: 'limit',
            volume: this._getMaxBTCVolume(currentBitcoinPrice),
            expiretm: "+55", // expire in 55s,
            oflags: "post",
            price: currentBitcoinPrice.toFixed(1),
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
            process.exit(-1);
        }
    }

    async sellAll(currentBitcoinPrice) {
        let r = null;

        // reference that order, we never know
        let userref = Math.floor(Math.random() * 1000000000);
        let options = {
            pair: 'XBTEUR',
            type: 'sell',
            ordertype: 'market',
            volume: this.btcWallet,
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
            process.exit(-1);
        }
    }

    async askAll() {
        let r = null;

        // reference that order, we never know
        let userref = Math.floor(Math.random() * 1000000000);
        let options = {
            pair: 'XBTEUR',
            type: 'sell',
            ordertype: 'limit',
            volume: this.btcWallet,
            expiretm: "+55", // expire in 60s,
            oflags: "post",
            price: currentBitcoinPrice.toFixed(1),
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
            process.exit(-1);
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
        console.log(`- You currently own ${price(this.eurWallet)} and ${btc(this.btcWallet)}.`);
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

    isInTrade() {

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

const trade = async function(name, fake) {
    if (fake) {
        console.log('[*] Fake trading on current bitcoin price');
    } else {
        console.log('[*] Real trading on current bitcoin price');
    }

    let trader = await getTrader(name);
    let k = new Kraken(fake);
    let btcData = [];

    let traderRefreshed = false;
    let refreshTrader = async function(currentBitcoinPrice) {
        console.log('[*] Refreshing trader data');
        await k.refreshAccount();
        traderRefreshed = true;
        trader.setBalance(k.eurWallet, k.btcWallet, currentBitcoinPrice, k.lastBuyPrice());
        trader.setTradeVolume(k.tradeVolume);
    }

    let displayTraderStatus = function(action) {
        let lastTradeStr = trader.inTrade ? ` lastBuy=${k.lastBuyPrice()}€` : ` lastSell=${k.lastSellPrice()}€`
        let objectiveStr = trader.getObjective ? ` objective=${trader.getObjective().toFixed(0)}€` : "";
        console.log(`[*] ${k.fake ? "(FAKE) " : ""}Trader (${trader.hash()}): ${action.yellow} inTrade=${trader.inTrade.toString().cyan}${lastTradeStr}${objectiveStr} tv=${HRNumbers.toHumanString(trader.get30DaysTradingVolume())}, ${traderStatusStr(trader, currentBitcoinPrice)}`);
    }

    // login and display account infos
    await k.login();
    await k.synchronize(); // get server time delay
    await k.refreshOHLC();
    let currentBitcoinPrice = k.getCurrentBitcoinPrice();
    await refreshTrader(currentBitcoinPrice);
    k.displayAccount();
    k.displayLastPrices();

    let count = 0;
    while (1) {
        // wait for the next minute
        await k.nextData();
        k.displayLastPrices();

        currentBitcoinPrice = k.getCurrentBitcoinPrice();

        // time for trader action
        let candles = k.getPriceCandles();
        let candlesToAnalyse = candles.slice(candles.length - trader.analysisIntervalLength());
        dt.connectCandles(candlesToAnalyse);
        let action = await trader.decideAction(candlesToAnalyse);
        displayTraderStatus(action);

        switch (action) {
            case "HOLD":
                if (count++ % 10 == 9) {
                    // every once in a while, refresh the trader data and display it's status
                    await refreshTrader(currentBitcoinPrice);
                    k.displayAccount();
                }
                break;
            case "BUY":
                console.log(`  - BUYING for ${price(k.eurWallet)} of bitcoin at expected price ${price(currentBitcoinPrice)}: ${btc(k.eurWallet/currentBitcoinPrice)}`);
                await k.buyAll(currentBitcoinPrice);
                await refreshTrader(currentBitcoinPrice);
                k.displayAccount();
                break;
            case "SELL":
                console.log(`  - SELLING ${btc(k.btcWallet)} at expected price ${price(currentBitcoinPrice * k.btcWallet)}`);
                await k.sellAll(currentBitcoinPrice);
                await refreshTrader(currentBitcoinPrice);
                k.displayAccount();
                break;
            case "BID":
                console.log(`  - BIDDING for ${price(k.eurWallet)} of bitcoin at expected price ${price(currentBitcoinPrice)}: ${btc(k.eurWallet/currentBitcoinPrice)}`);
                await k.bidAll(currentBitcoinPrice);
                await sleep(20); // sleep 20s
                await refreshTrader(currentBitcoinPrice);
                k.displayAccount();
                break;
            case "ASK":
                console.log(`  - ASKING for ${btc(k.btcWallet)} at expected price ${price(currentBitcoinPrice * k.btcWallet)}`);
                await k.askAll(currentBitcoinPrice);
                await sleep(20); // sleep 20s
                await refreshTrader(currentBitcoinPrice);
                k.displayAccount();
                break;
            default:
                console.error('Trader returned no action !'.red);
        }
    }
}

module.exports = trade;