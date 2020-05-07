const _ = require('lodash');
const config = require('../config');
const colors = require('colors');
const moment = require('moment');

const startingFunding = 1000;

const tradingFees = {
    0: {
        "maker": 0.0016,
        "taker": 0.0026,
    },
    50000: {
        "maker": 0.0014,
        "taker": 0.0024,
    },
    100000: {
        "maker": 0.0012,
        "taker": 0.0022,
    },
    250000: {
        "maker": 0.0010,
        "taker": 0.0020,
    },
    500000: {
        "maker": 0.0008,
        "taker": 0.0018,
    },
    1000000: {
        "maker": 0.0006,
        "taker": 0.0016,
    },
    2500000: {
        "maker": 0.0004,
        "taker": 0.0014,
    },
    5000000: {
        "maker": 0.0002,
        "taker": 0.0012,
    },
    10000000: {
        "maker": 0,
        "taker": 0.0010,
    },
}

// const tradingFees = {
//     0: {
//         "maker": -0.00025, // 0.025% for making trades
//         "taker": 0.00075
//     }
// }

class Trader {
    static count = 0;

    constructor() {
        this.number = Trader.count++;

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

        // actions record (compute 30 days trading volume, and stuff)
        this.actions = [];
    }

    hash() {
        throw "to be redefined";
    }

    getDescription() {
        return "this trader has no description";
    }

    get30DaysTradingVolume() {
        let startWindow = moment.unix(this.lastTimestamp).subtract(30, "days");
        let last30DaysActions = _.filter(this.actions, a => moment.unix(a.timestamp).isAfter(startWindow));

        let volume = 0;
        _.each(last30DaysActions, a => volume += a.volumeDollar);
        return volume;
    }

    getTaxes() {
        let tradingVolume = this.get30DaysTradingVolume();

        let keys = _.keys(tradingFees);
        let keysNumbers = _.map(keys, k => parseInt(k)).sort((a, b) => a - b);

        let volumeStep = 0;
        for (let i = 0; i < keysNumbers.length; i++) {
            if (tradingVolume > keysNumbers[i]) {
                volumeStep = keysNumbers[i];
            }
        }

        return tradingFees[volumeStep];
    }

    getBuyTax() {
        return this.getTaxes().taker;
    }

    getSellTax() {
        return this.getTaxes().maker;
    }

    // to be redefined if needed
    initialize() {}

    resetTrading() {
        this.btcWallet = 0;
        this.eurWallet = startingFunding;
        this.lastBitcoinPrice = 0;
        this.inTrade = false;
        this.enterTradeValue = 0;
        this.actions = [];
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
        return this.eurWallet > 0 ? 1 : 0;
    }

    hasBitcoins() {
        return this.btcWallet > 0 ? 1 : 0;
    }

    setBalance(eurWallet, btcWallet, currentBitcoinPrice, lastEnterTrade) {
        this.eurWallet = eurWallet;
        this.btcWallet = btcWallet;
        if (this.eurWallet > this.btcWallet * currentBitcoinPrice) {
            this.inTrade = false;
        } else {
            // set up trading position
            this.inTrade = true;
            this.enterTradeValue = lastEnterTrade;
        }
    }

    // called on each new period, will call the action() method
    async decideAction(dataPeriods) {
        if (dataPeriods.length !== this.analysisIntervalLength()) {
            console.error(`Trader ${this.hash()}: expected ${this.analysisIntervalLength()} periods but got ${dataPeriods.length}`);
        }

        // save this for trade count and the action methods buy/sell/hold
        this.lastBitcoinPrice = _.last(dataPeriods).close;
        this.lastTimestamp = _.last(dataPeriods).timestamp;

        return await this.action(dataPeriods, this.lastBitcoinPrice);
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

    buy() {
        let price = this.lastBitcoinPrice;

        this.nbBuy++;
        if (this.eurWallet > 0) {
            let buyTax = this.getBuyTax();

            this.addAction("BUY"); // do this before recording action

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
            let sellTax = this.getSellTax(); // do this before recording action

            this.addAction("SELL"); // record the action

            this.eurWallet += (this.btcWallet * (1 - sellTax)) * price;
            this.btcWallet = 0;

            this.inTrade = false;

            return "SELL";
        } else {
            this.nbPenalties++;
            return "";
        }
    }


    addAction(actionStr) {
        let price = this.lastBitcoinPrice;

        let totalVolume, actionTax, volumeEUR;
        if (actionStr == "BUY") {
            totalVolume = this.eurWallet;
            actionTax = this.getBuyTax();
            volumeEUR = totalVolume;
        } else if (actionStr == "SELL") {
            totalVolume = this.btcWallet;
            actionTax = this.getSellTax();
            volumeEUR = totalVolume * price;

            // add last trade statistics
            this.addTrade(this.enterTradeValue, price);
        }
        let volumeTF = totalVolume * (1 - actionTax);

        this.actions.push({
            type: actionStr,
            timestamp: this.lastTimestamp,
            btcPrice: this.lastBitcoinPrice,
            volume: actionStr,
            volumeTF: volumeTF,
            volumeEUR: volumeEUR,
            volumeDollar: volumeEUR * 1.08,
            tradingVolume30: this.get30DaysTradingVolume(),
            tax: actionTax,
        });
    }

    addTrade(oldBitcoinPrice, newBitcoinPrice) {
        this.trades.push(newBitcoinPrice / oldBitcoinPrice - this.getBuyTax() - this.getSellTax());
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