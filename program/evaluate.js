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

const evaluate = async function(type, interval, options) {
    if (type == "ml") {
        let model = options.model;
        if (!model) {
            console.error("ml option must be used with --model");
            process.exit(-1);
        }

        let TraderConstructor = require('./traders/ml/' + model);
        if (!TraderConstructor) {
            console.error(`model ${model} is not implemented (yet!)`);
            process.exit(-1);
        }

        let trader = new TraderConstructor();
        await trader.initialize();
        return await evaluateTrader(trader, interval);
    } else if (type == "algo") {
        let strategy = options.strategy;
        if (!strategy) {
            console.error("algo option must be used with --strategy");
            process.exit(-1);
        }

        let TraderConstructor = require('./traders/algo/' + strategy);
        if (!TraderConstructor) {
            console.error(`strategy ${strategy} is not implemented (yet!)`);
            process.exit(-1);
        }

        let trader = new TraderConstructor();
        return await evaluateTrader(trader, interval);
    }
}

module.exports = evaluate;