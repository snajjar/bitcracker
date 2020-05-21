const _ = require('lodash');
const config = require('../config');
const colors = require('colors');
const moment = require('moment');
const HRNumbers = require('human-readable-numbers');
const Statistics = require('../lib/statistics');

class Trader {
    static count = 0;

    constructor() {
        this.number = Trader.count++;

        this.s = new Statistics(this);

        // wallet and score values
        this.btcWallet = 0;
        this.eurWallet = config.getStartFund();
        this.lastBitcoinPrice = 0; // keep last bitcoin price for score computations

        // trade utils
        this.inTrade = false;
        this.enterTradeValue = 0;
        this.bidPrice = null;
        this.askPrice = null;

        // statistics utils
        this.lowestBalance = config.getStartFund();

        // config settings
        this.stopLossRatio = config.getStopLossRatio();
        this.takeProfitRatio = config.getTakeProfitRatio();
        this.nbStopLoss = 0;
        this.nbTakeProfit = 0;

        // actions record (compute 30 days trading volume, and stuff)
        this.actions = [];
        this.tradeVolume30 = null; // trade volume on 30 days. to be set with setTradingVolume()
        this.calculatedTradeVolume30 = null; // used if setTradingVolume() is not used
        this.recomputeTaxes();
    }

    hash() {
        throw "to be redefined";
    }

    getDescription() {
        return "this trader has no description";
    }

    setTradeVolume(v) {
        this.tradeVolume30 = v;
    }

    // if the last recorded transaction expired, recompute taxes
    volumeExpire(nowTimestamp) {
        let startWindow = moment.unix(this.lastTimestamp).subtract(30, "days");
        let lastRecordedAction = _.first(this.last30DaysActions);
        if (lastRecordedAction) {
            let lastRecordedActionTime = moment.unix(lastRecordedAction.timestamp);

            if (lastRecordedActionTime.isBefore(startWindow)) {
                this.recomputeTaxes();
            }
        }
    }

    get30DaysTradingVolume() {
        // if it's set from outside source, use that value
        if (this.tradeVolume30) {
            return this.tradeVolume30;
        } else {
            if (!this.calculatedTradeVolume30) {
                let startWindow = moment.unix(this.lastTimestamp).subtract(30, "days");
                this.last30DaysActions = _.filter(this.last30DaysActions, a => moment.unix(a.timestamp).isAfter(startWindow));

                let volume = 0;
                _.each(this.last30DaysActions, a => volume += a.volumeDollar);
                this.calculatedTradeVolume30 = volume;
            }

            return this.calculatedTradeVolume30;
        }
    }

    getTaxes() {
        const tradingFees = config.getTradingFees();
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
        return this.buyTax;
    }

    getSellTax() {
        return this.sellTax;
    }

    getBidTax() {
        return this.bidTax;
    }

    getAskTax() {
        return this.askTax;
    }

    getWinningPrice() {
        return this.enterTradeValue * (1 + this.getBuyTax() + this.getSellTax());
    }

    // to be redefined if needed
    initialize() {}

    resetTrading() {
        this.btcWallet = 0;
        this.eurWallet = config.getStartFund();
        this.lastBitcoinPrice = 0;
        this.inTrade = false;
        this.enterTradeValue = 0;
        this.actions = [];
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

    recomputeTaxes() {
        // in case trading volume isn't externally set, compute it
        if (!this.tradeVolume30) {
            // recompute 30-days volume and taxes
            this.calculatedTradeVolume30 = null; // erase previous value
            let taxes = this.getTaxes();
            this.buyTax = taxes.taker; // all market orders are provided the taker fee
            this.sellTax = taxes.taker; // all market orders are provided the taker fee, even for sell
            this.bidTax = taxes.maker;
            this.askTax = taxes.maker;
        }
    }

    // called on each new period, will call the action() method
    async decideAction(dataPeriods) {
        this.volumeExpire();

        // first check if our bids and asks were fullfilled
        var lastPeriod = _.last(dataPeriods);
        if (this.bidPrice !== null) {
            if (lastPeriod.low <= this.bidPrice) {
                this._fullfillBid();
            } else {
                this._clearBid();
            }
        } else if (this.askPrice !== null) {
            if (lastPeriod.high >= this.askPrice) {
                this._fullfillAsk();
            } else {
                this._clearAsk();
            }
        }

        if (dataPeriods.length !== this.analysisIntervalLength()) {
            console.error(`Trader ${this.hash()}: expected ${this.analysisIntervalLength()} periods but got ${dataPeriods.length}`);
        }

        // save this for trade count and the action methods buy/sell/hold
        this.lastBitcoinPrice = _.last(dataPeriods).close;
        this.lastTimestamp = _.last(dataPeriods).timestamp;

        let action = await this.action(dataPeriods, this.lastBitcoinPrice);
        this.s.log(action);
        return action;
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

    buy(price = this.lastBitcoinPrice) {
        //console.log(`btcPrice=${this.lastBitcoinPrice} buyingAt=${price}`);

        if (this.eurWallet > 0) {
            let buyTax = this.getBuyTax();

            this.addAction("BUY"); // do this before recording action
            //console.log('BUYING at ' + price.toFixed(0) + ", tax: " + (buyTax * price).toFixed(1));

            this.btcWallet += (this.eurWallet * (1 - buyTax)) / price;
            this.eurWallet = 0;

            this.inTrade = true;
            this.enterTradeValue = price;

            return "BUY";
        } else {
            return "";
        }
    }

    sell(price = this.lastBitcoinPrice) {
        //console.log(`btcPrice=${this.lastBitcoinPrice} sellingAt=${price}`);

        if (this.btcWallet > 0) {
            let sellTax = this.getSellTax(); // do this before recording action
            //console.log('SELLING at ' + price.toFixed(0) + ", tax: " + (sellTax * price).toFixed(1));

            this.addAction("SELL"); // record the action

            this.eurWallet += (this.btcWallet * (1 - sellTax)) * price;
            this.btcWallet = 0;

            this.inTrade = false;

            return "SELL";
        } else {
            return "";
        }
    }

    bid(bidPrice) {
        this.bidPrice = bidPrice;
        return "BID";
    }

    ask(askPrice) {
        this.askPrice = askPrice;
        return "ASK";
    }

    _fullfillBid() {
        let price = this.bidPrice;

        if (this.eurWallet > 0) {
            let bidTax = this.getBidTax();
            // console.log('BUYING at ' + this.bidPrice.toFixed(0) + ", tax: " + (this.bidTax * price).toFixed(1));

            this.addAction("BID"); // do this before recording action

            this.btcWallet += (this.eurWallet * (1 - bidTax)) / price;
            this.eurWallet = 0;

            this.inTrade = true;
            this.enterTradeValue = price;

            this.bidPrice = null;

            return "BUY";
        } else {
            this.bidPrice = null;
            return "";
        }
    }

    _clearBid() {
        this.bidPrice = null;
    }

    _fullfillAsk() {
        let price = this.askPrice;

        if (this.btcWallet > 0) {
            let askTax = this.getAskTax(); // do this before recording action
            // console.log('SELLING at ' + this.askPrice.toFixed(0) + ", tax: " + (this.askTax * price).toFixed(0));

            this.addAction("ASK"); // record the action

            this.eurWallet += (this.btcWallet * (1 - askTax)) * price;
            this.btcWallet = 0;

            this.inTrade = false;
            this.askPrice = null;
            return "SELL";
        } else {
            this.askPrice = null;
            return "";
        }
    }

    _clearAsk() {
        this.askPrice = null;
    }

    getAction(actionStr) {
        let totalVolume, actionTax, volumeEUR;
        if (actionStr == "BUY") {
            totalVolume = this.eurWallet;
            actionTax = this.getBuyTax();
            volumeEUR = totalVolume;
        } else if (actionStr == "BID") {
            totalVolume = this.eurWallet;
            actionTax = this.getBidTax();
            volumeEUR = totalVolume;
        } else if (actionStr == "ASK") {
            let price = this.askPrice;
            totalVolume = this.btcWallet;
            actionTax = this.getAskTax();
            volumeEUR = totalVolume * price;
            if (volumeEUR < this.lowestBalance) {
                this.lowestBalance = volumeEUR;
            }

            // add last trade statistics
            let lastAction = _.last(this.actions);
        } else if (actionStr == "SELL") {
            let price = this.lastBitcoinPrice;
            totalVolume = this.btcWallet;
            actionTax = this.getSellTax();
            volumeEUR = totalVolume * price;
            if (volumeEUR < this.lowestBalance) {
                this.lowestBalance = volumeEUR;
            }

            // add last trade statistics
            let lastAction = _.last(this.actions);
        }
        let volumeTF = totalVolume * (1 - actionTax);

        let action = {
            type: actionStr,
            timestamp: this.lastTimestamp,
            btcPrice: this.lastBitcoinPrice,
            volume: totalVolume,
            volumeTF: volumeTF,
            volumeEUR: volumeEUR,
            volumeDollar: volumeEUR * 1.08,
            tradeVolume30: this.get30DaysTradingVolume(),
            tax: actionTax,
        };
        return action;
    }

    addAction(actionStr) {
        let action = this.getAction(actionStr);
        this.actions.push(action);
        this.last30DaysActions.push(action);
        this.s.logAction(action);

        this.recomputeTaxes();
    }

    getLastAction() {
        return _.last(this.actions);
    }

    hold() {
        // doing nothing is what i do best
        return "HOLD";
    }

    stopLoss(ratio) {
        if (this.inTrade) {
            if (this.lastBitcoinPrice < this.enterTradeValue * (1 - ratio)) {
                //console.log('stopped loss !');
                this.nbStopLoss++;
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