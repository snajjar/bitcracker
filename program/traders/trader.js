const _ = require('lodash');
const config = require('../config');
const colors = require('colors');
const moment = require('moment');
const HRNumbers = require('human-readable-numbers');
const Statistics = require('../lib/statistics');


const _price = function(n) {
    return `${n.toFixed(0)}€`.cyan;
}

const _amount = function(n) {
    return `${n.toFixed(3)}`.cyan;
}

class Wallet {
    // assets: array of names of asset we want to trade
    constructor(mainCurrency = "EUR") {
        this.mainCurrency = mainCurrency; // the currency that will be the base value
        this.assetNames = [];
        this.reset();
    }

    getMainCurrency() {
        return this.mainCurrency;
    }

    reset() {
        this.assetNames = [];
        this.assets = {};
        _.each(this.assetsNames, name => {
            this.init(name);
        });
    }

    init(assetName) {
        if (assetName == undefined) {
            throw new Error("asset cant be undefined");
        }

        if (!this.assetNames.includes(assetName)) {
            this.assetNames.push(assetName);
        }
        this.assets[assetName] = {
            amount: 0,
            price: null,
        }

        if (assetName == this.mainCurrency) {
            this.assets[assetName].price = 1;
        }
    }

    get(name) {
        if (!this.assets[name]) {
            this.init(name);
        }
        return this.assets[name];
    }

    setAmount(name, v) {
        this.get(name).amount = v;
    }

    getAmount(name) {
        let asset = this.get(name);
        if (asset) {
            return asset.amount;
        } else {
            return 0;
        }
    }

    setPrice(name, v) {
        this.get(name).price = v;
    }

    getPrice(name) {
        return this.get(name).price;
    }

    setAmounts(o) {
        _.each(o, (amount, name) => {
            this.setAmount(name, amount);
        });
    }

    setPrices(o) {
        _.each(o, (price, name) => {
            this.setPrice(name, price);
        });
    }

    has(asset) {
        return this.getAmount(asset) > 0;
    }

    // return the asset that contains the most value
    getMaxAsset() {
        let maxValue = 0;
        let asset = 0;
        _.each(this.asset, (asset, assetName) => {
            if (this.value(assetName) > maxValue) {
                maxValue = this.value(assetName);
                asset = assetName;
            }
        });

        return assetName;
    }

    // compute the current value of the wallet
    value(assetName = null) {
        if (assetName) {
            let asset = this.get(assetName);
            return asset.amount * asset.price;
        } else {
            let s = 0;
            _.each(this.assets, asset => {
                s += asset.amount * asset.price;
            });
            return s;
        }
    }

    display() {
        console.log('================================================');
        _.each(this.assets, (asset, assetName) => {
            console.log(`${assetName}: ${asset.amount.toFixed(3)} (${(asset.amount * asset.price).toFixed(2)}€)`);
        });
        console.log('================================================');
    }
}

class Trader {
    static count = 0;

    constructor(assetNames) {
        this.number = Trader.count++;
        this.assetNames = assetNames;
        this.logActions = false;

        this.stats = new Statistics(this);
        this.otherStatistics = []; // other stats that can be added via addStatistics()
        this.wallet = new Wallet();
        this.wallet.setAmount("EUR", config.getStartFund());

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
        _.each(this.otherStatistics, s => {
            s.logAction(actionStr);
        });
    }

    logTransaction(actionObject) {
        this.stats.logTransaction(actionObject);
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

    setBalance(assetAmounts, assetPrices, lastEnterTrade) {
        this.wallet.setAmount(assetAmounts);
        this.wallet.setPrices(assetPrices);

        // check if we are currently in trade
        let maxAsset = this.wallet.getMaxAsset();
        if (maxAsset == "EUR") {
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
            if (lastCandle.low <= this.currentBid.price) {
                this._fullfillBid();
            } else {
                this._clearBid();
            }
        }
    }

    checkAskValidation(asset, lastCandle) {
        if (this.currentAsk !== null && this.currentAsk.asset == asset) {
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

        // first check if our bids and asks were fullfilled
        let last = _.last(candles);
        this.checkBidValidation(assetName, last);
        this.checkAskValidation(assetName, last);

        this.wallet.setPrice(assetName, last.close);
        this.lastTimestamp = last.timestamp;

        if (candles.length !== this.analysisIntervalLength()) {
            console.error(`Trader ${this.hash()}: expected ${this.analysisIntervalLength()} periods but got ${candles.length}`);
        }

        let action = await this.action(assetName, candles, last.close);
        this.logAction(action);
        return action;
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