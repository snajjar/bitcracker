/******************************************************************************
 * evaluate.js - Test a trader against data
 *****************************************************************************/

const _ = require('lodash');
const csv = require('./lib/csv');
const utils = require('./lib/utils');
const config = require('./config');
const dt = require('./lib/datatools');
const moment = require('moment');

const evaluateTrader = async function(trader, duration) {
    let btcData = await csv.getData();
    if (duration) {
        let btcDataSets = dt.splitByDuration(btcData, duration);
        console.log(`[*] splitted into ${btcDataSets.length} sets of ${btcDataSets[0].length} candles`);

        let results = [];
        for (let i = 0; i < btcDataSets.length; i++) {
            let dataset = btcDataSets[i];
            let start = moment.unix(dataset[0].timestamp);

            // adjust dataset to the trader, by adding end of previous data
            // (we simulate a continuous trading, but we want results period by period)
            if (i > 0) {
                let analysisIntervalLength = trader.analysisIntervalLength();
                let endPeriodData = btcDataSets[i - 1].slice(btcDataSets[i - 1].length - analysisIntervalLength);
                dataset = endPeriodData.concat(dataset);
            }

            await trader.trade(dataset);
            let stats = trader.statisticsStr();
            // console.log(JSON.stringify(stats, null, 2));

            results.push({
                'period': `${start.format('DD/MM/YY hh:mm')}`,
                'gain': stats.cumulatedGain,
                'w/l': stats.winLossRatio,
                'avgROI': stats.avgROI,
                'pos': stats.trades.nbPositiveTrades,
                'neg': stats.trades.nbNegativeTrades,
            });

            // trader.resetStatistics();
            // trader.resetTrading();
        }
        console.table(results);
    } else {
        await trader.trade(btcData);
        utils.displayTrader(trader);
    }
}

const evaluate = async function(name, duration) {
    let TraderConstructor = require('./traders/' + name);
    if (!TraderConstructor) {
        console.error(`Trader ${name} is not implemented (yet!)`);
        process.exit(-1);
    }

    let trader = new TraderConstructor();
    await trader.initialize(config.getInterval());
    return await evaluateTrader(trader, duration);
}

module.exports = evaluate;