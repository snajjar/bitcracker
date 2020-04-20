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
    let response = await axios.get(`https://api.kraken.com/0/public/OHLC?pair=BTCEUR&interval=${interval}`);
    let results = response.data.result["XXBTZEUR"];

    let periods = [];
    _.each(results, r => {
        periods.push(extractFieldsFromKrakenData(r));
    });
    return _.sortBy(periods, p => p.timestamp);
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

const trade = async function(name) {
    let trader = await getTrader(name);
    let btcData = null;

    const price = (p) => { return (p.toFixed(0) + '€').cyan };

    const candleStr = function(c) {
        let time = moment.unix(c.timestamp);
        return `t=${time.format('DD/MM/YY hh:mm')} open=${price(c.open)} high=${price(c.high)} low=${price(c.low)} close=${price(c.close)} v=${c.volume}`;
    }

    const traderStatusStr = function(trader, currentBitcoinPrice) {
        return `eur=${price(trader.eurWallet)} btc=${trader.btcWallet.toString().cyan} (${price(trader.btcWallet * currentBitcoinPrice)})`;
    }

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
        if (isNewData(remoteData)) {
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

module.exports = trade;