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
        let candleSetsByAssets = _.mapValues(candlesByAsset, (v, k) => {
            let set = dt.splitByDuration(v, duration);
            console.log(`[*] splitted ${k} set into ${set.length} sets of ${set[0].length} candles`);
            return set;
        });

        // since our trader need the last n=trader.analysisIntervalLength() periods to decide an action
        // we need to connect the different set by adding the last n-1 periods to it
        let analysisIntervalLength = trader.analysisIntervalLength();
        _.each(candleSetsByAssets, (candleset, asset) => {
            for (var i = 0; i < candleset.length; i++) {
                if (i > 0) {
                    let previousSet = candleset[i - 1];
                    let endPeriodData = previousSet.slice(previousSet.length - analysisIntervalLength - 1);
                    candleset[i] = endPeriodData.concat(candleset[i]);
                }
            }
        });

        let assets = _.keys(candlesByAsset);
        let nbPeriods = candleSetsByAssets[assets[0]].length

        let results = {};
        for (let i = 0; i < nbPeriods; i++) {
            let start = moment.unix(candleSetsByAssets[assets[0]][i][analysisIntervalLength].timestamp);

            // build the dataset for this period
            let dataset = {};
            for (asset of assets) {
                dataset[asset] = candleSetsByAssets[asset][i];
            }

            // add a statistic object to log data related to this period
            let periodStat = new Statistics(trader);
            trader.addStatistic(periodStat);
            await trader.trade(dataset);
            if (i == nbPeriods - 1 && trader.isInTrade()) {
                trader.closePositions();
            }
            trader.removeStatistic(periodStat);

            // extract stats into our result array (for console.table)
            let stats = periodStat.getStatisticsStr();
            let period = `${start.format('YYYY-MM-DD hh:mm')}`;
            results[period] = ({
                'gain': stats.cumulatedGain,
                'w/l': stats.winLossRatio,
                'avgROI': stats.avgROI,
                'pos': stats.trades.nbPositiveTrades,
                'neg': stats.trades.nbNegativeTrades,
                // 'btc trend': btcTrend,
                // 'variance': HRNumbers.toHumanString(btcVar),
                'tv': HRNumbers.toHumanString(trader.calculatedTradeVolume30),
            });
        }

        console.table(results);

        _.each(trader.taxStats, stats => {
            stats.display();
        });

        _.each(trader.assetStats, stats => {
            stats.display();
        });
    } else {
        await trader.trade(candlesByAsset);

        // sell if trader still has assets
        if (trader.isInTrade()) {
            trader.closePositions();
        }
    }

    trader.stats.display();
    trader.wallet.display();
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