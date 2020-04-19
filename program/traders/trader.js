const _ = require('lodash');
const config = require('../config');
const colors = require('colors');

const startingFunding = 1000;
const buyTax = 0.0026;
const sellTax = 0.0016;

class Trader {
    static count = 0;

    constructor() {
        this.number = Trader.count++;

        this.buyTax = buyTax;
        this.sellTax = sellTax;

        // wallet and score values
        this.btcWallet = 0;
        this.eurWallet = startingFunding;
        this.lastBitcoinPrice = 0; // keep last bitcoin price for score computations

        // trade utils
        this.inTrade = false;
        this.enterTradeValue = 0;

        // statistics utils
        this.nbPenalties = 0;
        this.trades = [];
        this.nbBuy = 0;
        this.nbSell = 0;
        this.nbHold = 0;
        this.nbHoldOut = 0;
        this.nbHoldIn = 0;

        // config settings
        this.stopLossRatio = config.getStopLossRatio();
        this.takeProfitRatio = config.getTakeProfitRatio();
        this.nbStopLoss = 0;
        this.nbTakeProfit = 0;
    }

    hash() {
        throw "to be redefined";
    }

    getDescription() {
        return "this trader has no description";
    }

    // to be redefined if needed
    initialize() {}

    resetTrading() {
        this.btcWallet = 0;
        this.eurWallet = startingFunding;
        this.lastBitcoinPrice = 0;
        this.inTrade = false;
        this.enterTradeValue = 0;
    }

    resetStatistics() {
        this.nbPenalties = 0;
        this.enterTradeValue = 0;
        this.trades = [];
        this.nbBuy = 0;
        this.nbSell = 0;
        this.nbHold = 0;
        this.nbHoldOut = 0;
        this.nbHoldIn = 0;
        this.nbStopLoss = 0;
        this.nbTakeProfit = 0;
    }

    statistics() {
        let totalROI = _.reduce(this.trades, (a, b) => a * b) || 1;
        let nbPositiveTrades = _.filter(this.trades, t => t > 1).length || 0;
        let nbNegativeTrades = this.trades.length - nbPositiveTrades || 0;
        let assets = this.btcWallet * this.lastBitcoinPrice + this.eurWallet;

        return {
            assets: assets,
            cumulatedGain: assets - startingFunding,
            avgROI: _.mean(this.trades) || 0,
            winLossRatio: (nbPositiveTrades / this.trades.length) || 0,
            trades: {
                nbTrades: this.trades.length,
                nbPositiveTrades: nbPositiveTrades,
                nbNegativeTrades: nbNegativeTrades,
                nbStopLoss: this.nbStopLoss,
                nbTakeProfit: this.nbTakeProfit,
                nbBuy: this.nbBuy,
                nbSell: this.nbSell,
                nbHold: this.nbHold,
                nbHoldIn: this.nbHoldIn,
                nbHoldOut: this.nbHoldOut
            }
        }
    }

    // same as statistics(), but return displayable strings
    statisticsStr() {
        let stats = this.statistics();

        let assetsStr = `${stats.assets.toFixed(0)}€`;
        stats.assets = assetsStr;

        let gainStr = `${stats.cumulatedGain.toFixed(0)}€`;
        stats.cumulatedGain = gainStr;
        // stats.cumulatedGain = stats.cumulatedGain > 0 ? gainStr.green : gainStr.red;

        let winLossRatioStr = `${(stats.winLossRatio*100).toFixed(2)}%`;
        stats.winLossRatio = winLossRatioStr;
        // stats.winLossRatio = stats.winLossRatio > 0.5 ? winLossRatioStr.green : winLossRatioStr.red;

        let avgROIStr = (stats.avgROI * 100).toFixed(2) + "%";
        stats.avgROI = avgROIStr;
        // stats.avgROI = stats.avgROI > 1 ? avgROIStr.green : avgROIStr.red;

        return stats;
    }

    statisticsColoredStr() {
        let stats = this.statistics();

        let gainStr = `${stats.cumulatedGain.toFixed(0)}€`;
        stats.cumulatedGain = stats.cumulatedGain > 0 ? gainStr.green : gainStr.red;

        let winLossRatioStr = `${(stats.winLossRatio*100).toFixed(2)}%`;
        stats.winLossRatio = stats.winLossRatio > 0.5 ? winLossRatioStr.green : winLossRatioStr.red;

        let avgROIStr = (stats.avgROI * 100).toFixed(2) + "%";
        stats.avgROI = stats.avgROI > 1 ? avgROIStr.green : avgROIStr.red;

        return stats;
    }

    tradesStr() {
        return `${this.nbBuy} buy, ${this.nbSell} sell, ${this.nbHold} hold (${this.nbHoldIn} in, ${this.nbHoldOut} out)`;
    }

    hasEuros() {
        return this.eurWaller > 0 ? 1 : 0;
    }

    hasBitcoins() {
        return this.btcWallet > 0 ? 1 : 0;
    }

    // called on each new period, will call the action() method
    async decideAction(dataPeriods) {
        // save this for trade count and the action methods buy/sell/hold
        let currentBitcoinPrice = dataPeriods[dataPeriods.length - 1].close;
        this.lastBitcoinPrice = currentBitcoinPrice;
        // console.log("lastBitcoinPrice", this.lastBitcoinPrice);

        return await this.action(dataPeriods, currentBitcoinPrice);
    }

    async action(dataPeriods, currentBitcoinPrice) {
        throw "action must be redefined by the Trader subclass. It shall call either buy(), sell() or hold() method";
    }

    analysisIntervalLength() {
        throw "analysisIntervalLength must be redefined by the Trader subclass. It shall return the optimal number of periods needed for the action() method";
    }

    // trade on the whole data
    async trade(periods) {
        let analysisIntervalLength = this.analysisIntervalLength();
        if (!analysisIntervalLength) {
            throw "analysisIntervalLength is not defined for trader " + this.hash();
        }

        let dataPeriods = periods.slice(0, analysisIntervalLength - 1); // no trades in this area
        for (var i = analysisIntervalLength; i < periods.length; i++) {
            let nextPeriod = periods[i];
            dataPeriods.push(nextPeriod);
            await this.decideAction(dataPeriods);

            dataPeriods.shift();
        }
    }

    score() {
        // score is the global ROI of the trader
        // add the buy/sell tax into account
        //return this.gain();
    }

    addTrade(oldBitcoinPrice, newBitcoinPrice) {
        this.trades.push(newBitcoinPrice / oldBitcoinPrice - buyTax - sellTax);
    }

    buy() {
        let price = this.lastBitcoinPrice;

        this.nbBuy++;
        if (this.eurWallet > 0) {
            this.btcWallet += (this.eurWallet * (1 - buyTax)) / price;
            this.eurWallet = 0;

            this.inTrade = true;
            this.enterTradeValue = price;
            return "BUY";
        } else {
            this.nbPenalties++; // cant buy, have no money
            return "";
        }
    }

    sell() {
        let price = this.lastBitcoinPrice;

        this.nbSell++;
        if (this.btcWallet > 0) {
            this.eurWallet += (this.btcWallet * (1 - sellTax)) * price;
            this.btcWallet = 0;

            this.inTrade = false;

            // add last trade statistics
            this.addTrade(this.enterTradeValue, price);
            return "SELL";
        } else {
            this.nbPenalties++;
            return "";
        }
    }

    hold() {
        // doing nothing is what i do best
        this.nbHold++;
        if (this.inTrade) {
            this.nbHoldIn++;
        } else {
            this.nbHoldOut++;
        }
        return "HOLD";
    }

    stopLoss(ratio) {
        if (this.inTrade) {
            if (this.lastBitcoinPrice < this.enterTradeValue * (1 - ratio)) {
                //console.log('stopped loss !');
                this.nbStopLoss++;
                this.sell();
                return true;
            }
        }
        return false;
    }

    takeProfit(ratio) {
        if (this.inTrade) {
            if (this.lastBitcoinPrice > this.enterTradeValue * (1 + ratio)) {
                //console.log('took profit !');
                this.nbTakeProfit++;
                this.sell();
                return true;
            }
        }
        return false;
    }

    checkNotNaN() {
        if (isNaN(this.score())) {
            this.debug();
            process.exit(-1);
        }
    }

    debug() {
        console.log('#################################################');
        console.log(`Trader #${this.number} debug:`);
        let clone = _.clone(this);
        delete clone.trades;
        console.log(JSON.stringify(clone, null, 2));
        console.log('#################################################');
    }

    dispose() {
        this.model.dispose();
    }
}

module.exports = Trader;