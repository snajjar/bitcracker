/******************************************************************************
 * evaluate.js - Test a trader against data
 *****************************************************************************/

const _ = require('lodash');
const csv = require('./lib/csv');
const utils = require('./lib/utils');

const evaluateTrader = async function(trader, interval) {
    let btcData = await csv.getDataForInterval(interval);
    await trader.trade(btcData);
    utils.displayTraders([trader]);
}

const evaluate = async function(name, interval) {
    let TraderConstructor = require('./traders/' + name);
    if (!TraderConstructor) {
        console.error(`Trader ${name} is not implemented (yet!)`);
        process.exit(-1);
    }

    let trader = new TraderConstructor();
    await trader.initialize(interval);
    return await evaluateTrader(trader, interval);
}

module.exports = evaluate;