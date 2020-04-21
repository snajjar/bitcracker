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
const Prompt = require('prompt-password');
const encryption = require('./lib/encryption');
const KrakenClient = require('kraken-api');

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

const getKrakenData = async function(interval) {
    try {
        let response = await axios.get(`https://api.kraken.com/0/public/OHLC?pair=BTCEUR&interval=${interval}`);
        let results = response.data.result["XXBTZEUR"];

        let periods = [];
        _.each(results, r => {
            periods.push(extractFieldsFromKrakenData(r));
        });
        return _.sortBy(periods, p => p.timestamp);
    } catch (e) {
        console.error('Error while fetching Kraken data');
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
    constructor() {
        this.kraken = null;
        this.eurWallet = 0;
        this.btcWallet = 0;

        this.placedOrders = []; // history of orders we made

        this.openOrders = {};
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

        var promptPW = new Prompt({
            type: 'password',
            message: 'password',
            name: 'password'
        });
        let password = await promptPW.run();

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
            this.eurWallet = parseInt(r.result["ZEUR"]);
            this.btcWallet = parseInt(r.result["XXBT"]);
        } catch (e) {
            console.error('It appears that you are not logged in correctly'.red);
            throw e;
            process.exit(-1);
        }
    }

    async refreshBalance() {
        try {
            // get balance info
            let r = await this.kraken.api('Balance');
            this.eurWallet = parseInt(r.result["ZEUR"]);
            this.btcWallet = parseInt(r.result["XXBT"]);
        } catch (e) {
            console.error('Error retrieving account balance'.red);
            process.exit(-1);
        }
    }

    displayBalance() {
        console.log(`- You currently own ${price(this.eurWallet)} and ${btc(this.btcWallet)}.`);
    }

    async refreshOpenOrders() {
        try {
            // get balance info
            let r = await this.kraken.api('OpenOrders');
            this.openOrders = r.result.open;
        } catch (e) {
            console.error(('Error while retrieving orders: ' + e).red);
            process.exit(-1);
        }
    }

    displayOpenOrders() {
        console.log(`- ${_.keys(this.openOrders).length.toString().cyan} open orders`);
        _.each(this.openOrders, (o, key) => {
            console.log(`   - ${key}: ${o.descr.order}`);
        });
    }

    async buyAll(currentBitcoinPrice) {
        // reference that order, we never know
        let userref = Math.floor(Math.random() * 1000000000);
        let options = {
            pair: 'XBTEUR',
            type: 'buy',
            ordertype: 'market',
            volume: this._getMaxBTCVolume(currentBitcoinPrice),
            expiretm: "+60", // expire in 60s,
            userref: userref, // reference for order, to be used internally
            validate: true, // validate input only, do not submit order !
        }

        try {
            // get balance info
            let r = await this.kraken.api('AddOrder', options);
            console.log(`[*] placed BUY order: ${r.result.descr.order}`);
            this.placedOrders.push({ order: options, result: r.result });
        } catch (e) {
            console.error(('Error while buying: ' + e).red);
            console.error(e.message.red);
            throw e;
        }
    }

    async sellAll(currentBitcoinPrice) {
        // reference that order, we never know
        let userref = Math.floor(Math.random() * 1000000000);
        let options = {
            pair: 'XBTEUR',
            type: 'sell',
            ordertype: 'market',
            volume: this._getMaxEURVolume(currentBitcoinPrice),
            expiretm: "+60", // expire in 60s,
            userref: userref, // reference for order, to be used internally
            validate: true, // validate input only, do not submit order !
        }

        try {
            // get balance info
            let r = await this.kraken.api('AddOrder', options);
            console.log(`[*] placed SELL order: ${r.result.descr.order}`);
            this.placedOrders.push({ order: options, result: r.result });
        } catch (e) {
            console.error(('Error while selling: ' + e).red);
            console.error(e.message.red);
            throw e;
        }
    }
}

const realTrade = async function(name) {
    let trader = await getTrader(name);
    let k = new Kraken();
    let btcData = null;

    // check if we have some new data in in theses candles
    const isNewData = function(candles) {
        if (!btcData) {
            return true;
        } else {
            let lastKnownData = btcData[btcData.length - 1];
            let lastNewData = candles[candles.length - 1];
            return lastKnownData.timestamp !== lastNewData.timestamp;
        }
    }

    await k.login();
    console.log('[*] Successfully connected to your kraken account.');
    k.displayBalance();

    // get orders info
    await sleep(1);
    await k.refreshOpenOrders();
    k.displayOpenOrders();

    await sleep(10);
    console.log('you sleeped well');

    // every 5 sec: fetch BTC price and trade
    setInterval(async () => {
        let remoteData = await getKrakenData(1);
        if (remoteData && isNewData(remoteData)) {
            btcData = remoteData;
            let lastCandle = btcData[btcData.length - 1];
            let currentBitcoinPrice = lastCandle.close;
            console.log(`[*] Received data: ${candleStr(lastCandle)}`)

            // time for trader action
            let action = await trader.decideAction(btcData);
            console.log(`  - trader (${trader.hash()}): ${action.yellow}. expected status: ${traderStatusStr(trader, currentBitcoinPrice)}`);

            switch (action) {
                case "HOLD":
                    await k.refreshBalance();
                    break;
                case "SELL":
                    console.log(`  - SELLING ${btc(k.btcWallet)} at expected price ${price(currentBitcoinPrice * k.btcWallet)}`);
                    //await k.sellAll(currentBitcoinPrice);
                    break;
                case "BUY":
                    console.log(`  - BUYING for ${price(k.eurWallet)} of bitcoin at expected price ${price(currentBitcoinPrice)}: ${btc(k.eurWallet/currentBitcoinPrice)}`);
                    //await k.buyAll(currentBitcoinPrice);
                    break;
                default:
                    console.error('Trader returned no action !');
            }
        }
    }, 5000);

    // every 30 sec: refresh the private infos
    setInterval(async () => {
        console.log('[*] Current account status: ');
        await k.refreshBalance();
        k.displayBalance();

        // get orders info
        await sleep(1);
        await k.refreshOpenOrders();
        k.displayOpenOrders();
    }, 30000);
}

const fakeTrade = async function(name) {
    let trader = await getTrader(name);
    let btcData = null;

    const isNewData = function(candles) {
        if (!btcData) {
            return true;
        } else {
            let lastKnownData = btcData[btcData.length - 1];
            let lastNewData = candles[candles.length - 1];
            return lastKnownData.timestamp !== lastNewData.timestamp;
        }
    }

    // every 10 sec
    setInterval(async () => {
        let remoteData = await getKrakenData(1);
        if (remoteData && isNewData(remoteData)) {
            btcData = remoteData;
            let lastCandle = btcData[btcData.length - 1];
            let currentBitcoinPrice = lastCandle.close;
            console.log(`[*] Received data: ${candleStr(lastCandle)}`)

            // time for trader action
            let action = await trader.decideAction(btcData);
            console.log(`    trader: ${action.yellow}. status: ${traderStatusStr(trader, currentBitcoinPrice)}`);
        }
    }, 10000);
}

const trade = async function(name, fake) {
    if (fake) {
        console.log('[*] Fake trading on current bitcoin price');
        await fakeTrade(name);
    } else {
        console.log('[*] Real trading on current bitcoin price');
        await realTrade(name);
    }
}

module.exports = trade;