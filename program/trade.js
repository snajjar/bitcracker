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

const sleep = function(s) {
    return new Promise(resolve => setTimeout(resolve, s * 1000));
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

        this.placedOrders = []; // history of orders we made

        this.openOrders = {};
        this.closedOrders = {};

        this.tradeVolume = 0;
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

    // check if we have some new data in in theses candles
    const isNewData = function(candles) {
        if (!btcData || btcData.length == 0) {
            return true;
        } else {
            let lastKnownData = btcData[btcData.length - 1];
            let lastNewData = candles[candles.length - 1];
            return !lastKnownData || lastKnownData.timestamp !== lastNewData.timestamp;
        }
    }

    let traderRefreshed = false;
    let refreshTrader = async function(currentBitcoinPrice) {
        console.log('[*] Refreshing trader data');
        await k.refreshAccount();
        traderRefreshed = true;
        trader.setBalance(k.eurWallet, k.btcWallet, currentBitcoinPrice, k.lastBuyPrice());
        trader.setTradeVolume(k.tradeVolume);
    }

    // login and display account infos
    await k.login();
    let remoteData = await getKrakenData(1);
    await sleep(1);
    let currentBitcoinPrice = _.last(remoteData).close;
    await refreshTrader(currentBitcoinPrice);
    k.displayAccount();

    // every 5 sec: fetch BTC price and trade
    let lastCandle = null;
    while (1) {
        let since = lastCandle ? lastCandle.close + 1 : undefined; // add 1 sec to last candle
        let remoteData = await getKrakenData(1, since);
        if (!remoteData) {
            //probably reached API speed limit
            console.log('[*] waiting 10 seconds for API rate to go down');
            await sleep(10);
            continue;
        }

        // the last candle is the "current" minute, unfinished and subject to changes. Remove it.
        currantCandle = remoteData.pop();

        if (!_.isEmpty(remoteData) && isNewData(remoteData)) {
            // there is new data
            // concat new periods to old ones
            btcData = btcData.concat(remoteData);
            if (btcData.length > 1000) {
                btcData = btcData.slice(btcData.length - 1000);
            }

            lastCandle = _.last(btcData);
            let currentBitcoinPrice = lastCandle.close;
            console.log(`[*] Received data: ${candleStr(lastCandle)}`);
            console.log(`[*] Last prices: ${price(btcData[btcData.length-5].close)} -> ` +
                `${price(btcData[btcData.length-4].close)} -> ` +
                `${price(btcData[btcData.length-3].close)} -> ` +
                `${price(btcData[btcData.length-2].close)} -> ` +
                `${priceYellow(lastCandle.close)} (current candle)`);

            // time for trader action
            let candlesToAnalyse = btcData.slice(btcData.length - trader.analysisIntervalLength());
            dt.connectCandles(candlesToAnalyse);
            let action = await trader.decideAction(candlesToAnalyse);

            switch (action) {
                case "HOLD":
                    // refresh
                    if (!traderRefreshed) {
                        await refreshTrader(currentBitcoinPrice);
                        await sleep(1);
                    }
                    await sleep(5); // we just got new data, sleep for a while
                    break;
                case "SELL":
                    console.log(`  - SELLING ${btc(k.btcWallet)} at expected price ${price(currentBitcoinPrice * k.btcWallet)}`);
                    await k.sellAll(currentBitcoinPrice);
                    await sleep(1);
                    await refreshTrader(currentBitcoinPrice);
                    await sleep(1);
                    break;
                case "BUY":
                    console.log(`  - BUYING for ${price(k.eurWallet)} of bitcoin at expected price ${price(currentBitcoinPrice)}: ${btc(k.eurWallet/currentBitcoinPrice)}`);
                    await k.buyAll(currentBitcoinPrice);
                    await sleep(1);
                    await refreshTrader(currentBitcoinPrice);
                    await sleep(1);
                    break;
                default:
                    console.error('Trader returned no action !'.red);
            }

            let lastTradeStr = trader.inTrade ? ` lastBuy=${k.lastBuyPrice()}` : ""
            let objectiveStr = trader.getObjective ? ` objective=${trader.getObjective().toFixed(0)}€` : "";
            console.log(`[*] ${k.fake ? "(FAKE)" : ""} Trader (${trader.hash()}): ${action.yellow}. Status: inTrade=${trader.inTrade.toString().cyan}${lastTradeStr}€${objectiveStr} tv=${HRNumbers.toHumanString(trader.get30DaysTradingVolume())}, ${traderStatusStr(trader, currentBitcoinPrice)}`);
        } else {
            // no new data, rest API rate for a while
            await sleep(3);
        }
    }

    await sleep(4); // desynchronize both setInterval

    // every min: refresh the private infos
    setInterval(async () => {
        k.displayAccount();
    }, 60000 * 10);
}

module.exports = trade;