/******************************************************************************
 * evaluate.js - Test a trader against data
 *****************************************************************************/

const _ = require('lodash');
const csv = require('./lib/csv');
const utils = require('./lib/utils');
const config = require('./config');

const evaluateTrader = async function(trader) {
    let btcData = await csv.getData();
    await trader.trade(btcData);
    utils.displayTraders([trader]);
}

const evaluate = async function(name) {
    let TraderConstructor = require('./traders/' + name);
    if (!TraderConstructor) {
        console.error(`Trader ${name} is not implemented (yet!)`);
        process.exit(-1);
    }

    let trader = new TraderConstructor();
    await trader.initialize(config.getInterval());
    return await evaluateTrader(trader);
}

module.exports = evaluate;