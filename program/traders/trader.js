const _ = require('lodash');
const config = require('../config');
const colors = require('colors');
const moment = require('moment');
const HRNumbers = require('human-readable-numbers');
const Statistics = require('../lib/statistics');
const Wallet = require('../lib/wallet');

const _price = function(n) {
    return `${n.toFixed(0)}€`.cyan;
}

const _amount = function(n) {
    return `${n.toFixed(3)}`.cyan;
}


class Trader {
    static count = 0;

    constructor() {
        this.number = Trader.count++;
        this.logActions = false;

        this.stats = new Statistics(this);
        this.assetStats = {};
        this.otherStatistics = []; // other stats that can be added via addStatistics()
        this.wallet = new Wallet();
        this.wallet.setAmount("EUR", config.getStartFund());

        this.bidCompletionProba = 1;
        this.askCompletionProba = 1;

        // trade utils
        this.currentAsset = null;
        this.currentTrade = null;
        // currentTrade has the following definition
        // this.currentTrade = {
        //     asset: null,
        //     enterPrice: null,
        //     enterTimestamp: null,
        // }

        this.currentBid = null;
        this.currentAsk = null;

        // actions record (compute 30 days trading volume, and stuff)
        this.actions = [];
        this.tradeVolume30 = null; // trade volume on 30 days. to be set with setTradingVolume()
        this.calculatedTradeVolume30 = null; // used if setTradingVolume() is not used
        this.recomputeTaxes();
    }

    logAction(actionStr) {
        this.stats.logAction(actionStr);
        if (!this.assetStats[this.currentAsset]) {
            this.assetStats[this.currentAsset] = new Statistics(this, null, this.currentAsset);
        }
        this.assetStats[this.currentAsset].logAction(actionStr);
        _.each(this.otherStatistics, s => {
            s.logAction(actionStr);
        });
    }

    getAssetStats() {
        if (!this.assetStats[this.currentAsset]) {
            this.assetStats[this.currentAsset] = new Statistics(this, null, this.currentAsset);
        }
        return this.assetStats[this.currentAsset];
    }

    logTransaction(actionObject) {
        this.stats.logTransaction(actionObject);
        this.getAssetStats().logTransaction(actionObject);
        _.each(this.otherStatistics, s => {
            s.logTransaction(actionObject);
        });
    }

    addStatistic(s) {
        this.otherStatistics.push(s);
    }

    removeStatistic(s) {
        _.remove(this.otherStatistics, stat => stat == s);
    }

    hash() {
        throw "to be redefined";
    }

    getDescription() {
        return "this trader has no description";
    }

    isInTrade() {
        return this.currentTrade !== null;
    }

    getCurrentTradeAsset() {
        return this.currentTrade.asset;
    }

    getCurrentTradeEnterPrice() {
        return this.currentTrade.enterPrice;
    }

    setTradeVolume(v) {
        this.tradeVolume30 = v;
    }

    // if the last recorded transaction expired, recompute taxes
    volumeExpire() {
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
        return this.getTaxes().taker;
    }

    getSellTax() {
        return this.getTaxes().taker;
    }

    getBidTax() {
        return this.getTaxes().maker;
    }

    getAskTax() {
        return this.getTaxes().maker;
    }

    getWinningPrice() {
        return this.getSellWinningPrice(); // for historical reasons
    }

    getSellWinningPrice() {
        return this.getCurrentTradeEnterPrice() * (1 + this.getBuyTax()) / (1 - this.getSellTax());
    }

    getAskWinningPrice() {
        return this.getCurrentTradeEnterPrice() * (1 + this.getBuyTax()) / (1 - this.getAskTax());
    }

    // to be redefined if needed
    initialize() {}

    resetTrading() {
        this.wallet = new Wallet();
        this.wallet.setAmount("EUR", config.getStartFund);
        this.currentTrade = null;
        this.bidPrice = null;
        this.askPrice = null;
        this.actions = [];
    }

    setBalance(wallet, lastEnterTrade) {
        this.wallet = Wallet.clone(wallet);

        // check if we are currently in trade
        let maxAsset = this.wallet.getMaxAsset();

        if (maxAsset == this.wallet.getMainCurrency()) {
            this.currentTrade = null;
        } else {
            this.currentTrade = {
                asset: maxAsset,
                enterPrice: lastEnterTrade,
            }
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

    checkBidValidation(asset, lastCandle) {
        if (this.currentBid !== null && this.currentBid.asset == asset) {
            let randomCondition = Math.random() < this.bidCompletionProba;
            if (lastCandle.low <= this.currentBid.price) {
                this._fullfillBid();
            } else {
                this._clearBid();
            }
        }
    }

    checkAskValidation(asset, lastCandle) {
        if (this.currentAsk !== null && this.currentAsk.asset == asset) {
            let randomCondition = Math.random() < this.askCompletionProba;
            if (lastCandle.high >= this.currentAsk.price) {
                this._fullfillAsk();
            } else {
                this._clearAsk();
            }
        }
    }

    // called on each new period, will call the action() method
    async decideAction(assetName, candles) {
        this.currentAsset = assetName;
        this.volumeExpire();

        if (candles.length == this.analysisIntervalLength()) {
            // first check if our bids and asks were fullfilled
            let last = _.last(candles);
            if (last) {
                this.checkBidValidation(assetName, last);
                this.checkAskValidation(assetName, last);

                this.wallet.setPrice(assetName, last.close);
                this.lastTimestamp = last.timestamp;

                let action = await this.action(assetName, candles, last.close);
                this.logAction(action);
                return action;
            }
        } else {
            console.error(`Trader ${this.hash()}: expected ${this.analysisIntervalLength()} periods but got ${candles.length}`);
        }
    }

    async action(candles, currentBitcoinPrice) {
        throw "action must be redefined by the Trader subclass. It shall call either buy(), sell() or hold() method";
    }

    analysisIntervalLength() {
        throw "analysisIntervalLength must be redefined by the Trader subclass. It shall return the optimal number of periods needed for the action() method";
    }

    // trade on the whole data
    async trade(candlesByasset) {
        let analysisIntervalLength = this.analysisIntervalLength();
        if (!analysisIntervalLength) {
            throw "analysisIntervalLength is not defined for trader " + this.hash();
        }

        let candles = {};
        _.each(candlesByasset, (periods, asset) => {
            candles[asset] = periods.slice(0, analysisIntervalLength - 1); // no trades in this area
        });

        let assets = _.keys(candlesByasset);
        for (var i = analysisIntervalLength; i < candlesByasset[assets[0]].length; i++) {
            for (var j = 0; j < assets.length; j++) {
                let asset = assets[j];
                let nextPeriod = candlesByasset[asset][i];

                candles[asset].push(nextPeriod);
                await this.decideAction(asset, candles[asset]);

                candles[asset].shift();
            }
        }

        // if at the end, we're still in trade, sell
        if (this.isInTrade()) {
            this.sell();
        }
    }

    score() {
        // score is the global ROI of the trader
        // add the buy/sell tax into account
        //return this.gain();
    }

    buy() {
        let currencyAmount = this.wallet.getAmount(this.wallet.getMainCurrency());
        let assetPrice = this.wallet.getPrice(this.currentAsset);
        let assetAmount = this.wallet.getAmount(this.currentAsset);

        if (currencyAmount > 0) {
            this.addAction("BUY"); // do this before changing the wallet

            let buyTax = this.getBuyTax();
            let newassetAmount = assetAmount + currencyAmount * (1 - buyTax) / assetPrice;
            this.wallet.setAmount(this.currentAsset, newassetAmount);
            this.wallet.setAmount(this.wallet.getMainCurrency(), 0);

            this.currentTrade = {
                asset: this.currentAsset,
                enterPrice: assetPrice,
                timestamp: this.lastTimestamp
            }

            if (this.logActions) {
                console.log(`- BUY for ${_price(currencyAmount)} of ${this.currentAsset.cyan} at ${_price(assetPrice)}`);
            }

            return "BUY";
        } else {
            return "ERROR (BUY)"
        }
    }

    sell() {
        let currencyAmount = this.wallet.getAmount(this.wallet.getMainCurrency());
        let assetPrice = this.wallet.getPrice(this.currentAsset);
        let assetAmount = this.wallet.getAmount(this.currentAsset);
        if (assetAmount > 0) {
            this.addAction("SELL"); // record the action before we change the wallet

            let sellTax = this.getSellTax();
            let newCurrencyAmount = currencyAmount + assetAmount * (1 - sellTax) * assetPrice;
            this.wallet.setAmount(this.wallet.getMainCurrency(), newCurrencyAmount);
            this.wallet.setAmount(this.currentAsset, 0);

            this.currentTrade = null;

            if (this.logActions) {
                console.log(`- SELL ${_amount(assetAmount)} of ${this.currentAsset.cyan} at ${_price(assetPrice)}: ${_price(newCurrencyAmount)}`);
            }

            return "SELL";
        } else {
            return "ERROR (SELL)";
        }
    }

    bid(bidPrice) {
        this.currentBid = {
            asset: this.currentAsset,
            price: bidPrice,
        }
        return "BID";
    }

    ask(askPrice) {
        this.currentAsk = {
            asset: this.currentAsset,
            price: askPrice,
        }
        return "ASK";
    }

    _fullfillBid() {
        let currencyAmount = this.wallet.getAmount(this.wallet.getMainCurrency());
        let assetPrice = this.currentBid.price;
        let assetAmount = this.wallet.getAmount(this.currentAsset);

        if (currencyAmount > 0) {
            this.addAction("BID"); // do this before recording action

            let bidTax = this.getBidTax();
            let newassetAmount = assetAmount + currencyAmount * (1 - bidTax) / assetPrice;
            this.wallet.setAmount(this.currentAsset, newassetAmount);
            this.wallet.setAmount(this.wallet.getMainCurrency(), 0);

            this.currentTrade = {
                asset: this.currentAsset,
                enterPrice: assetPrice,
                timestamp: this.lastTimestamp
            }
            this.currentBid = null;

            if (this.logActions) {
                console.log(`- BID for ${_price(currencyAmount)} of ${this.currentAsset.cyan} at ${_price(assetPrice)}`);
            }
        }

        this._clearBid();
    }

    _clearBid() {
        this.currentBid = null;
    }

    _fullfillAsk() {
        let currencyAmount = this.wallet.getAmount(this.wallet.getMainCurrency());
        let assetPrice = this.currentAsk.price;
        let assetAmount = this.wallet.getAmount(this.currentAsset);

        if (assetAmount > 0) {
            this.addAction("ASK"); // record the action before we change the wallet

            let askTax = this.getAskTax(); // do this before recording action
            let newCurrencyAmount = currencyAmount + assetAmount * (1 - askTax) * assetPrice;
            this.wallet.setAmount(this.wallet.getMainCurrency(), newCurrencyAmount);
            this.wallet.setAmount(this.currentAsset, 0);

            this.currentTrade = null;

            if (this.logActions) {
                console.log(`- ASK ${_amount(assetAmount)} of ${this.currentAsset.cyan} at ${_price(assetPrice)}:  ${_price(newCurrencyAmount)}`);
            }
        }

        this._clearAsk();
    }

    _clearAsk() {
        this.currentAsk = null;
    }

    getTransaction(actionStr) {
        let assetPrice, totalVolume, actionTax, volumeEUR;
        if (actionStr == "BUY") {
            assetPrice = this.wallet.getPrice(this.currentAsset);
            totalVolume = this.wallet.getAmount(this.wallet.getMainCurrency());
            actionTax = this.getBuyTax();
            volumeEUR = totalVolume;
        } else if (actionStr == "BID") {
            assetPrice = this.currentBid.price;
            totalVolume = this.wallet.getAmount(this.wallet.getMainCurrency());
            actionTax = this.getBidTax();
            volumeEUR = totalVolume;
        } else if (actionStr == "SELL") {
            assetPrice = this.wallet.getPrice(this.currentAsset);
            totalVolume = this.wallet.getAmount(this.currentAsset);
            actionTax = this.getSellTax();
            volumeEUR = totalVolume * assetPrice;
        } else if (actionStr == "ASK") {
            assetPrice = this.currentAsk.price;
            totalVolume = this.wallet.getAmount(this.currentAsset);
            actionTax = this.getAskTax();
            volumeEUR = totalVolume * assetPrice;
        }

        let totalTax = volumeEUR * actionTax;
        let volumeTF = totalVolume * (1 - actionTax);

        let action = {
            type: actionStr,
            timestamp: this.lastTimestamp,
            assetPrice: assetPrice,
            volume: totalVolume,
            volumeTF: volumeTF,
            volumeEUR: volumeEUR,
            volumeDollar: volumeEUR * 1.08,
            tradeVolume30: this.get30DaysTradingVolume(),
            tax: actionTax,
            totalTax: totalTax
        };
        return action;
    }

    addAction(actionStr) {
        let transaction = this.getTransaction(actionStr);
        this.actions.push(transaction);
        this.last30DaysActions.push(transaction);
        this.logTransaction(transaction);

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
        if (this.currentTrade) {
            if (this.wallet.getPrice(this.currentTrade.asset) < this.currentTrade.enterPrice * (1 - ratio)) {
                return true;
            }
        }
        return false;
    }

    takeProfit(ratio) {
        if (this.currentTrade) {
            if (this.wallet.getPrice(this.currentTrade.asset) > this.currentTrade.enterPrice * (1 + ratio)) {
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