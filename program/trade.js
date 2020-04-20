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

const price = function(p) {
    return (p.toFixed(0) + '€').cyan
};

const candleStr = function(c) {
    let time = moment.unix(c.timestamp);
    return `t=${time.format('DD/MM/YY hh:mm')} open=${price(c.open)} high=${price(c.high)} low=${price(c.low)} close=${price(c.close)} v=${c.volume}`;
}

const traderStatusStr = function(trader, currentBitcoinPrice) {
    return `eur=${price(trader.eurWallet)} btc=${trader.btcWallet.toString().cyan} (${price(trader.btcWallet * currentBitcoinPrice)})`;
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
            console.log(`[*] new data: ${candleStr(lastCandle)}`)

            // time for trader action
            let action = await trader.decideAction(btcData);
            console.log(`    trader: ${action.yellow}. status: ${traderStatusStr(trader, currentBitcoinPrice)}`);
        }
    }, 10000);
}

const realTrade = async function(name) {
    process.env.NODE_PENDING_DEPRECATION = 0;
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
    const kraken = new KrakenClient(apiKey, secretApiKey);

    try {
        let balance = await kraken.api('Balance');

    } catch (e) {
        console.error('It appears that you are not logged in correctly'.red);
    }
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