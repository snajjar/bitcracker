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
const Statistics = require('./lib/statistics');

const evaluateTrader = async function(trader, duration) {
    let candlesByAsset = await csv.getData();
    if (duration) {
        let candlesSets = dt.splitByDuration(candles, duration);
        console.log(`[*] splitted into ${candlesSets.length} sets of ${candlesSets[0].length} candles`);

        let results = {};
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

            let periodStat = new Statistics(trader);
            trader.addStatistic(periodStat);
            await trader.trade({ 'BTC': dataset });
            trader.removeStatistic(periodStat);

            let stats = periodStat.getStatisticsStr();
            //console.log(JSON.stringify(stats));

            let period = `${start.format('YYYY-MM-DD hh:mm')}`;
            results[period] = ({
                'gain': stats.cumulatedGain,
                'w/l': stats.winLossRatio,
                'avgROI': stats.avgROI,
                'pos': stats.trades.nbPositiveTrades,
                'neg': stats.trades.nbNegativeTrades,
                'btc trend': btcTrend,
                'variance': HRNumbers.toHumanString(btcVar),
                'tv': HRNumbers.toHumanString(trader.calculatedTradeVolume30),
            });
        }
        console.table(results);
        trader.stats.display();
        trader.wallet.display();
    } else {
        await trader.trade(candlesByAsset);
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