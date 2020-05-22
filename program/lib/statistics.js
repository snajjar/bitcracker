const _ = require('lodash');
const config = require('../config');
const HRNumbers = require('human-readable-numbers');

// Advanced statistics object logging
// Log trader actions and extract statistics from it
// Statistics are classified according to current trading volume (which change taxes)
class Statistics {
    constructor(trader) {
        this.trader = trader;

        // initialize the statistics object
        this.statistics = this.getInitialStatistics();
        this.actions = [];
    }

    getInitialStatistics() {
        return {
            nbBuy: 0,
            nbSell: 0,
            nbBid: 0,
            nbAsk: 0,
            nbHold: 0,
            nbHoldOut: 0,
            nbHoldIn: 0,
        }
    }

    logAction() {
        this.actions.push(_.clone(this.trader.getLastAction()));
    }

    log(actionStr) {
        switch (actionStr) {
            case "BUY":
                this.statistics.nbBuy++;
                break;
            case "SELL":
                this.statistics.nbSell++;
                break;
            case "BID":
                this.statistics.nbBid++;
                break;
            case "ASK":
                this.statistics.nbAsk++;
                break;
            case "HOLD":
                this.statistics.nbHold++;
                if (this.trader.isInTrade()) {
                    this.statistics.nbHoldIn++;
                } else {
                    this.statistics.nbHoldOut++;
                }
                break;
            default:
                throw new Error("Unrecognized action string: " + actionStr);
        }
    }

    getTrades() {
        let trades = [];

        let lastAction = null;
        let actions = _.sortBy(this.actions, a => a.timestamp);
        _.each(actions, action => {
            if (action.type == "BUY" || action.type == "BID") {
                lastAction = action;
            } else if (action.type == "SELL" || action.type == "ASK") {
                if (lastAction) {
                    let totalTax = lastAction.totalTax + action.totalTax;
                    let beforeTrade = lastAction.volumeEUR;
                    let afterTrade = action.volumeEUR - action.totalTax;
                    let roi = afterTrade / beforeTrade;
                    let trade = {
                        enterPrice: lastAction.cryptoPrice,
                        exitPrice: action.cryptoPrice,
                        volume: lastAction.volumeEUR + action.volumeEUR,
                        taxRatio: lastAction.tax + action.tax,
                        totalTax: totalTax,
                        gain: afterTrade - beforeTrade,
                        roi: roi
                    };

                    // console.log('beforeTrader:', beforeTrade, 'afterTrade:', afterTrade);
                    // console.log(JSON.stringify(trade, null, 2));
                    trades.push(trade);
                    lastAction = null;
                }
            }
        });

        return trades;
    }

    getStatistics() {
        let stats = this.statistics;
        let trades = this.getTrades();
        let totalROI = _.reduce(trades, (a, b) => a.roi * b.roi) || 1;
        let nbPositiveTrades = _.filter(trades, t => t.roi > 1).length || 0;
        let nbNegativeTrades = trades.length - nbPositiveTrades || 0;
        let assets = config.getStartFund() * totalROI;

        return {
            assets: assets,
            cumulatedGain: _.sumBy(trades, t => t.gain),
            avgROI: _.meanBy(trades, t => t.roi) || 0,
            totalROI: totalROI,
            winLossRatio: (nbPositiveTrades / trades.length) || 0,
            trades: {
                nbTrades: trades.length,
                nbPositiveTrades: nbPositiveTrades,
                nbNegativeTrades: nbNegativeTrades,
                avgTax: _.meanBy(trades, t => t.totalTax) || 0,
                nbBuy: stats.nbBuy,
                nbSell: stats.nbSell,
                nbBid: stats.nbBid,
                nbAsk: stats.nbAsk,
                nbHold: stats.nbHold,
                nbHoldIn: stats.nbHoldIn,
                nbHoldOut: stats.nbHoldOut
            }
        }
    }

    // same as statistics(), but return displayable strings
    getStatisticsStr() {
        let stats = this.getStatistics();

        let assetsStr = `${stats.assets.toFixed(0)}€`;
        stats.assets = assetsStr;

        let gainStr = `${stats.cumulatedGain.toFixed(0)}€`;
        stats.cumulatedGain = gainStr;

        let winLossRatioStr = `${(stats.winLossRatio*100).toFixed(2)}%`;
        stats.winLossRatio = winLossRatioStr;

        let avgROIStr = (stats.avgROI * 100).toFixed(2) + "%";
        stats.avgROI = avgROIStr;

        let totalROIStr = (stats.totalROI * 100).toFixed(2) + "%";
        stats.totalROI = totalROIStr;

        // let lowestBalance = `${(stats.lowestBalance).toFixed(0)}€`;
        // stats.lowestBalance = lowestBalance;

        return stats;
    }

    getColoredStatistics() {
        let stats = this.getStatistics();

        let gainStr = `${HRNumbers.toHumanString(stats.cumulatedGain.toFixed(0))}€`;
        stats.cumulatedGain = stats.cumulatedGain > 0 ? gainStr.green : gainStr.red;

        let winLossRatioStr = `${(stats.winLossRatio*100).toFixed(2)}%`;
        stats.winLossRatio = stats.winLossRatio > 0.5 ? winLossRatioStr.green : winLossRatioStr.red;

        let avgROIStr = (stats.avgROI * 100).toFixed(2) + "%";
        stats.avgROI = stats.avgROI > 1 ? avgROIStr.green : avgROIStr.red;

        let totalROIStr = (stats.totalROI * 100).toFixed(2) + "%";
        stats.totalROI = stats.totalROI > 1 ? totalROIStr.green : totalROIStr.red;

        // let lowestBalance = `${(stats.lowestBalance).toFixed(0)}€`;
        // stats.lowestBalance = lowestBalance.cyan;

        return stats;
    }

    async display() {
        let t = this.trader;
        let hash = await this.trader.hash();
        let s = this.getColoredStatistics();
        let trades = s.trades;
        console.log("");
        console.log(`    Trader #${t.number} (${hash}): Final results`);
        console.log(`      gain: ${s.cumulatedGain} win/loss: ${s.winLossRatio} avg ROI: ${s.avgROI}`);
        console.log(`      ${trades.nbTrades} trades, ${trades.nbPositiveTrades} won, ${trades.nbNegativeTrades} lost, avg tax: ${trades.avgTax.toFixed(2)}€`);
        console.log(`      ${trades.nbBuy} buy, ${trades.nbSell} sell, ${trades.nbBid} bid, ${trades.nbAsk} ask, ${trades.nbHold} hold (${trades.nbHoldIn} in, ${trades.nbHoldOut} out)`);
    }

    async displayDetails() {
        let t = this.trader;
        let hash = await this.trader.hash();
        let s = this.getColoredStatistics();
        let trades = s.trades;
        console.log("");
        console.log(`    Trader #${t.number} (${hash}): Final results`);
        console.log(`      gain: ${s.cumulatedGain} win/loss: ${s.winLossRatio} avg ROI: ${s.avgROI}`);
        console.log(`      ${trades.nbTrades} trades, ${trades.nbPositiveTrades} won, ${trades.nbNegativeTrades} lost, avg tax: ${trades.avgTax.toFixed(2)}€`);
        console.log(`      ${trades.nbBuy} buy, ${trades.nbSell} sell, ${trades.nbBid} bid, ${trades.nbAsk} ask, ${trades.nbHold} hold (${trades.nbHoldIn} in, ${trades.nbHoldOut} out)`);
    }
}

module.exports = Statistics;