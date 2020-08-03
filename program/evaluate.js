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
const db = require('./lib/db');

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


const evaluateTrader = async function(name, duration, plot) {
    let trader = await getTrader(name);

    // fetch data from db
    let data = await db.getData();

    if (duration) {
        let splittedData = dt.splitByDuration(data, duration);

        // since our trader need the last n=trader.analysisIntervalLength() periods to decide an action
        // we need to connect the different set by adding the last n-1 periods to it
        let t = await getTrader(name);
        let analysisIntervalLength = t.analysisIntervalLength();
        _.each(splittedData, (candles, index) => {
            if (index > 0) {
                let endPeriodData = splittedData[index - 1].slice(splittedData[index - 1].length - analysisIntervalLength - 1);
                splittedData[index] = endPeriodData.concat(splittedData[index]);
            }
        });

        let assets = config.getAssets();
        let nbPeriods = splittedData.length;

        let results = {};
        for (let i = 0; i < nbPeriods; i++) {
            let start = moment.unix(splittedData[i][analysisIntervalLength].timestamp);

            // build the dataset for this period
            let dataset = splittedData[i];

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
        await trader.trade(data);

        // sell if trader still has assets
        if (trader.isInTrade()) {
            trader.closePositions();
        }
    }

    await trader.stats.display();
    await trader.wallet.display();
    await csv.plotTrader(trader);
}

// like evaluate trader, but start trade again from each period
const splitEvaluateTrader = async function(name, duration) {
    let data = await db.getData();
    if (duration) {
        let splittedData = dt.splitByDuration(data, duration);

        // since our trader need the last n=trader.analysisIntervalLength() periods to decide an action
        // we need to connect the different set by adding the last n-1 periods to it
        let t = await getTrader(name);
        let analysisIntervalLength = t.analysisIntervalLength();
        _.each(splittedData, (candles, index) => {
            if (index > 0) {
                let endPeriodData = splittedData[index - 1].slice(splittedData[index - 1].length - analysisIntervalLength - 1);
                splittedData[index] = endPeriodData.concat(splittedData[index]);
            }
        });

        let assets = config.getAssets();
        let nbPeriods = splittedData.length;

        let results = {};
        let traders = [];
        for (let i = 0; i < nbPeriods; i++) {
            let trader = await getTrader(name);
            traders.push(trader);

            // build the dataset for this period
            let dataset = splittedData[i];
            await trader.trade(dataset);

            // add a statistic object to log data related to this period
            if (trader.isInTrade()) {
                trader.closePositions();
            }
        }

        _.each(traders, t => {
            t.stats.display();
        });

        console.log('[*] Plotting traders');
        await csv.plotTraders(traders);
    } else {
        let trader = await getTrader(name);
        await trader.trade(data);

        // sell if trader still has assets
        if (trader.isInTrade()) {
            trader.closePositions();
        }
    }

}

const evaluate = async function(name, duration, split) {
    let TraderConstructor = require('./traders/' + name);
    if (!TraderConstructor) {
        console.error(`Trader ${name} is not implemented (yet!)`);
        process.exit(-1);
    }

    if (split) {
        return await splitEvaluateTrader(name, duration);
    } else {
        return await evaluateTrader(name, duration);
    }
}

module.exports = evaluate;