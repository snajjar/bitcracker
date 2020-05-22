/******************************************************************************
 * evaluate.js - Test a trader against data
 *****************************************************************************/

const _ = require('lodash');
const csv = require('./lib/csv');
const utils = require('./lib/utils');
const config = require('./config');
const dt = require('./lib/datatools');
const moment = require('moment');
const HRNumbers = require('human-readable-numbers');

const evaluateTrader = async function(trader, duration) {
    let candles = await csv.getData();
    if (duration) {
        let candlesSets = dt.splitByDuration(candles, duration);
        console.log(`[*] splitted into ${candlesSets.length} sets of ${candlesSets[0].length} candles`);

        let results = {};
        let lastGain = 0;
        for (let i = 0; i < candlesSets.length; i++) {
            let dataset = candlesSets[i];
            let start = moment.unix(dataset[0].timestamp);

            let btcTrend = (dt.trend(dataset) * 100).toFixed(0) + '%'
            let btcVar = dt.variance(dataset).toFixed(0);

            // adjust dataset to the trader, by adding end of previous data
            // (we simulate a continuous trading, but we want results period by period)
            if (i > 0) {
                let analysisIntervalLength = trader.analysisIntervalLength();
                let endPeriodData = candlesSets[i - 1].slice(candlesSets[i - 1].length - analysisIntervalLength);
                dataset = endPeriodData.concat(dataset);
            }

            await trader.trade({ 'BTC': dataset });

            trader.stats.mergeStatistics();
            let s = trader.stats.getStatistics("all"); // as numbers
            let stats = trader.stats.getStatisticsStr("all"); // as displayable strings

            // console.log(JSON.stringify(stats, null, 2));
            let period = `${start.format('YYYY-MM-DD hh:mm')}`;
            results[period] = ({
                'gain': (s.cumulatedGain - lastGain).toFixed(0) + '€',
                'w/l': stats.winLossRatio,
                'avgROI': stats.avgROI,
                'pos': stats.trades.nbPositiveTrades,
                'neg': stats.trades.nbNegativeTrades,
                'btc trend': btcTrend,
                'variance': HRNumbers.toHumanString(btcVar),
                'tv': HRNumbers.toHumanString(trader.calculatedTradeVolume30),
            });
            lastGain = s.cumulatedGain;

            trader.stats.saveToBuffer();
        }
        console.table(results);
        trader.stats.mergeBuffer();
        trader.stats.displayDetails();
        trader.wallet.display();
    } else {
        await trader.trade({ 'BTC': candles });
        trader.stats.display();
        trader.wallet.display();
        // console.log(JSON.stringify(trader.actions, null, 2));
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