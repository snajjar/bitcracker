/******************************************************************************
 * evaluate.js - Test a trader against data
 *****************************************************************************/

const _ = require('lodash');
const csv = require('./lib/csv');
const utils = require('./lib/utils');

const evaluateTrader = async function(trader, interval) {
    let btcData = await csv.getData(`./data/Cex_BTCEUR_${utils.intervalToStr(interval)}_Refined_Adjusted.csv`);
    await trader.trade(btcData);
    utils.displayTraders([trader]);
}

const evaluate = async function(type, interval, options) {
    if (type == "ml") {
        console.error('To be implemented. ;)');
        process.exit(-1);
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