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
        this.statistics = {}
        this.initializeStatistics();

        this.buffer = [];
    }

    saveToBuffer() {
        this.buffer.push(_.clone(this.statistics));
        this.initializeStatistics();
    }

    mergeBuffer() {
        //this.saveToBuffer();
        this.statistics = {};
        _.each(this.buffer, stats => {
            _.each(stats, (s, key) => {
                let targetStatistics = this.statistics[key];
                if (!targetStatistics) {
                    this.statistics[key] = this.getInitialStatistics();
                    targetStatistics = this.statistics[key];
                }

                targetStatistics.actions = targetStatistics.actions.concat(s.actions);
                targetStatistics.nbBuy += s.nbBuy;
                targetStatistics.nbSell += s.nbSell;
                targetStatistics.nbBid += s.nbBid;
                targetStatistics.nbAsk += s.nbAsk;
                targetStatistics.nbHold += s.nbHold;
                targetStatistics.nbHoldOut += s.nbHoldOut;
                targetStatistics.nbHoldIn += s.nbHoldIn;
            });
        });
    }

    getTaxKey() {
        const { maker, taker } = this.trader.getTaxes();
        return Math.round(maker * 10000) + "#" + Math.round(taker * 10000);
    }

    getCurrentStats() {
        const key = this.getTaxKey();
        let stats = this.statistics[key];
        if (!stats) {
            this.statistics[key] = this.getInitialStatistics();
            stats = this.statistics[key];
        }
        return stats;
    }

    initializeStatistics() {
        this.statistics = {};
        const key = this.getTaxKey();
        this.statistics[key] = this.getInitialStatistics();
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
            actions: [],
        }
    }

    logAction(action) {
        let stats = this.getCurrentStats();
        stats.actions.push(this.trader.getLastAction());
    }

    log(actionStr) {
        let stats = this.getCurrentStats();

        switch (actionStr) {
            case "BUY":
                stats.nbBuy++;
                break;
            case "SELL":
                stats.nbSell++;
                break;
            case "BID":
                stats.nbBid++;
                break;
            case "ASK":
                stats.nbAsk++;
                break;
            case "HOLD":
                stats.nbHold++;
                if (this.trader.inTrade) {
                    stats.nbHoldIn++;
                } else {
                    stats.nbHoldOut++;
                }
                break;
            default:
                throw new Error("Unrecognized action string: " + actionStr);
        }
    }

    getSortedKeys() {
        let keys = _.remove(_.keys(this.statistics), k => k !== "all");
        let sorted = _.sortBy(keys, k => parseInt(k));
        return _.reverse(sorted);
    }

    stack() {

    }

    pop() {

    }

    getTrades(key = null) {
        if (!key) {
            key = this.getTaxKey();
        }
        let stats = this.statistics[key];
        let trades = [];

        let lastAction = null;
        _.each(stats.actions, action => {
            if (action.type == "BUY" || action.type == "BID") {
                lastAction = action;
            } else if (action.type == "SELL" || action.type == "ASK") {
                if (lastAction) {
                    let volume = action.volume;
                    let totalTax = lastAction.tax * volume * lastAction.btcPrice + action.tax * volume * action.btcPrice;
                    let beforeTrade = volume * lastAction.btcPrice;
                    let afterTrade = volume * action.btcPrice - totalTax;
                    let roi = afterTrade / beforeTrade;
                    let trade = {
                        enterPrice: lastAction.btcPrice,
                        exitPrice: action.btcPrice,
                        volume: action.volume,
                        taxRatio: lastAction.tax + action.tax,
                        totalTax: totalTax,
                        gain: afterTrade - beforeTrade,
                        roi: roi
                    };
                    //console.log(JSON.stringify(trade, null, 2));
                    trades.push(trade);
                    lastAction = null;
                }
            }
        });

        return trades;
    }

    getStatistics(key = null) {
        if (!key) {
            key = this.getTaxKey();
        }

        let stats = this.statistics[key];
        let trades = this.getTrades(key);
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
                avgTax: _.meanBy(trades, t => t.totalTax),
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
    getStatisticsStr(key = null) {
        if (!key) {
            key = this.getTaxKey();
        }

        let stats = this.getStatistics(key);

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

    getColoredStatistics(key = null) {
        if (!key) {
            key = this.getTaxKey();
        }

        let stats = this.getStatistics(key);

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
        this.mergeStatistics();
        let s = this.getColoredStatistics("all");
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
        let keys = this.getSortedKeys();

        _.each(keys, k => {
            let taxNumbers = k.split('#');
            let makerTax = parseInt(taxNumbers[0]) / 100 + '%';
            let takerTax = parseInt(taxNumbers[1]) / 100 + '%';
            let s = this.getColoredStatistics(k);
            let trades = s.trades;
            console.log('key: ' + k);
            console.log(``);
            console.log(`      maker=${makerTax.cyan}, taker=${takerTax.cyan}`);
            console.log(`      gain: ${s.cumulatedGain} win/loss: ${s.winLossRatio} avg ROI: ${s.avgROI}`);
            console.log(`      ${trades.nbTrades} trades, ${trades.nbPositiveTrades} won, ${trades.nbNegativeTrades} lost, avg tax: ${trades.avgTax.toFixed(2)}€`);
            console.log(`      ${trades.nbBuy} buy, ${trades.nbSell} sell, ${trades.nbBid} bid, ${trades.nbAsk} ask, ${trades.nbHold} hold (${trades.nbHoldIn} in, ${trades.nbHoldOut} out)`);
        });

        this.mergeStatistics();
        let s = this.getColoredStatistics("all");
        let trades = s.trades;
        console.log("");
        console.log(`    Trader #${t.number} (${hash}): Final results`);
        console.log(`      gain: ${s.cumulatedGain} win/loss: ${s.winLossRatio} avg ROI: ${s.avgROI}`);
        console.log(`      ${trades.nbTrades} trades, ${trades.nbPositiveTrades} won, ${trades.nbNegativeTrades} lost, avg tax: ${trades.avgTax.toFixed(2)}€`);
        console.log(`      ${trades.nbBuy} buy, ${trades.nbSell} sell, ${trades.nbBid} bid, ${trades.nbAsk} ask, ${trades.nbHold} hold (${trades.nbHoldIn} in, ${trades.nbHoldOut} out)`);
    }

    mergeStatistics() {
        delete this.statistics["all"];
        let stats = this.getInitialStatistics();

        _.each(this.statistics, (s, key) => {
            stats.nbBuy += s.nbBuy;
            stats.nbSell += s.nbSell;
            stats.nbBid += s.nbBid;
            stats.nbAsk += s.nbAsk;
            stats.nbHold += s.nbHold;
            stats.nbHoldOut += s.nbHoldOut;
            stats.nbHoldIn += s.nbHoldIn;
            stats.actions = stats.actions.concat(s.actions);
        });

        this.statistics["all"] = stats;
    }
}

module.exports = Statistics;