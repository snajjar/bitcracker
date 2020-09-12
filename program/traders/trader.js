const _ = require('lodash');
const config = require('../config');
const colors = require('colors');
const moment = require('moment');
const HRNumbers = require('human-readable-numbers');
const Statistics = require('../lib/statistics');
const Wallet = require('../lib/wallet');

const _price = function(n) {
    return `${n.toPrecision(4)}€`.cyan;
}

const _amount = function(n) {
    return `${n.toFixed(3)}`.cyan;
}


class Trader {
    static count = 0;

    constructor() {
        this.number = Trader.count++;
        this.verbose = config.getVerbose();

        this.stats = new Statistics(this);
        this.assetStats = {};
        this.taxStats = {};
        this.otherStatistics = []; // other stats that can be added via addStatistics()
        this.wallet = new Wallet();
        this.wallet.setAmount("EUR", config.getStartFund());

        if (config.getRealTradeSimulation()) {
            this.bidCompletionProba = 0.05;
            this.askCompletionProba = 0.05;
        } else {
            this.bidCompletionProba = 1;
            this.askCompletionProba = 1;
        }

        // trade utils
        // trades have the following definition
        // this.currentTrades[asset] = {
        //     asset: null,
        //     enterPrice: null,
        //     enterTimestamp: null,
        // }
        this.currentTrades = {};
        this.currentAsset = null;
        this.currentOrders = [];

        // actions record (compute 30 days trading volume, and stuff)
        this.actions = [];
        this.tradeVolume30 = null; // trade volume on 30 days. to be set with setTradingVolume()
        this.calculatedTradeVolume30 = null; // used if setTradingVolume() is not used
        this.recomputeTaxes();

        // simulation data
        let randomSpreadFactor = 1 / 100;
    }

    logAction(actionStr) {
        // log action in main stat
        this.stats.logAction(actionStr);

        // log in asset stat
        if (!this.assetStats[this.currentAsset]) {
            this.assetStats[this.currentAsset] = new Statistics(this, null, this.currentAsset);
        }
        this.assetStats[this.currentAsset].logAction(actionStr);

        // log in the current tax stat
        let taxKey = this.getTaxKey();
        if (!this.taxStats[taxKey]) {
            this.taxStats[taxKey] = new Statistics(this, null, taxKey);
        }
        this.taxStats[taxKey].logAction(actionStr);

        // log for other stats
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

    getTaxKey() {
        let taxes = this.getTaxes();
        return "m" + taxes.maker.toString() + "t" + taxes.taker.toString();
    }

    logTransaction(actionObject) {
        // log into main stat
        this.stats.logTransaction(actionObject);

        // log into the asset stat
        this.getAssetStats().logTransaction(actionObject);

        // log into the current tax stat
        let taxKey = this.getTaxKey();
        if (!this.taxStats[taxKey]) {
            this.taxStats[taxKey] = new Statistics(this);
        }
        this.taxStats[taxKey].logTransaction(actionObject);

        // log for other statistics (periods, etc)
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

    isInTrade(asset) {
        if (asset === undefined) {
            console.trace();
            throw "isInTrade() method now takes an asset";
        }
        return this.currentTrades[asset] !== undefined && this.currentTrades[asset] !== null;
    }

    getCurrentTradeEnterPrice(asset) {
        return _.get(this.currentTrades[asset], ["enterPrice"]) || null;
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
        this.currentTrades = {};
        this.bidPrice = null;
        this.askPrice = null;
        this.actions = [];
    }

    // enterTradePrices: dictionnary of price at which we entered the trades
    setBalance(wallet, enterTradePrices) {
        this.wallet = Wallet.clone(wallet);

        // check if we are currently in trade
        this.currentTrades = {};
        _.each(this.wallet.getAssets(), asset => {
            let value = this.wallet.value(asset);

            // everything with value > 10€ is tradable
            if (value > 10) {
                let enterPrice = enterTradePrices[asset];
                console.log(`Trader is trading ${maxAsset}, entered at ${enterPrice}`);
                this.currentTrades.push({
                    asset: asset,
                    enterPrice: enterPrice
                });
            }
        });
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
    async decideAction(asset, candles, currentPrice) {
        this.currentAsset = asset;
        this.volumeExpire();

        if (candles.length == this.analysisIntervalLength()) {
            // first check if our bids and asks were fullfilled
            let last = _.last(candles);

            if (!currentPrice) {
                currentPrice = {
                    marketBuy: last.close + config.getSpread(asset),
                    lastTraded: last.close,
                    marketSell: last.close - config.getSpread(asset),
                    spread: config.getSpread(asset)
                }
            }

            if (last) {
                this.lastTimestamp = last.timestamp;

                if (this.isInTrade(asset)) {
                    // if we're in a trade, only make SELL/ASK decisions on that asset
                    let action = await this.action(asset, candles, currentPrice);
                    this.logAction(action);
                    return action;
                } else {
                    let action = await this.action(asset, candles, currentPrice);
                    this.logAction(action);
                    return action;
                }
            }
        } else {
            console.error(`Trader ${this.hash()}: expected ${this.analysisIntervalLength()} periods but got ${candles.length}`);
        }
    }

    async action(asset, candles, currentBitcoinPrice) {
        throw "action must be redefined by the Trader subclass. It shall call either buy(), sell() or hold() method";
    }

    analysisIntervalLength() {
        throw "analysisIntervalLength must be redefined by the Trader subclass. It shall return the optimal number of periods needed for the action() method";
    }

    processBuy(order, lastCandle) {
        let asset = order.asset;
        let currencyAmount = this.wallet.getAmount(this.wallet.getMainCurrency());
        let assetPrice = this.wallet.getPrice(asset);
        let assetAmount = this.wallet.getAmount(asset);
        let spread = config.getSpread(asset); // real buy price is affected by the spread

        if (currencyAmount > 0) {
            this.addAction("BUY"); // do this before changing the wallet

            let buyTax = this.getBuyTax();
            let newAssetAmount = assetAmount + currencyAmount * (1 - buyTax) * (1 - spread) / assetPrice;
            this.wallet.setAmount(asset, newAssetAmount);
            this.wallet.setAmount(this.wallet.getMainCurrency(), 0);

            this.currentTrades[asset] = {
                asset: asset,
                enterPrice: assetPrice,
                timestamp: this.lastTimestamp
            }

            this.log(`- BUY for ${_price(currencyAmount)} of ${asset.cyan} at ${_price(assetPrice)}`);
            return "BUY";
        } else {
            return "ERROR (BUY)"
        }
    }

    processSell(order, lastCandle) {
        let asset = order.asset;
        let currencyAmount = this.wallet.getAmount(this.wallet.getMainCurrency());
        let assetPrice = this.wallet.getPrice(asset);
        let assetAmount = this.wallet.getAmount(asset);
        let spread = config.getSpread(asset); // real sell price is affected by the spread

        if (assetAmount > 0) {
            this.addAction("SELL"); // record the action before we change the wallet

            let sellTax = this.getSellTax();
            let newCurrencyAmount = currencyAmount + assetAmount * (1 - sellTax) * (1 - spread) * assetPrice;
            this.wallet.setAmount(this.wallet.getMainCurrency(), newCurrencyAmount);
            this.wallet.setAmount(asset, 0);

            this.currentTrades[asset] = null;
            this.log(`- SELL ${_amount(assetAmount)} of ${asset.cyan} at ${_price(assetPrice)}: ${_price(newCurrencyAmount)}`);

            return "SELL";
        } else {
            return "SELL";
        }
    }

    processAsk(order, lastCandle) {
        let randomCondition = Math.random() < this.askCompletionProba;
        let spread = config.getSpread(asset);

        if (lastCandle.high * (1 - spread) >= order.price && randomCondition) {
            // fullfill ask
            let currencyAmount = this.wallet.getAmount(this.wallet.getMainCurrency());
            let assetPrice = order.price;
            let asset = order.asset;
            let assetAmount = this.wallet.getAmount(asset);

            if (assetAmount > 0) {
                this.addAction("ASK"); // record the action before we change the wallet

                let askTax = this.getAskTax(); // do this before recording action
                let newCurrencyAmount = currencyAmount + assetAmount * (1 - askTax) * assetPrice;
                this.wallet.setAmount(this.wallet.getMainCurrency(), newCurrencyAmount);
                this.wallet.setAmount(asset, 0);

                this.currentTrades[asset] = null;
                this.log(`- ASK ${_amount(assetAmount)} of ${asset.cyan} at ${_price(assetPrice)}:  ${_price(newCurrencyAmount)}`);
            }
        }
    }

    processBid(order, lastCandle) {
        let randomCondition = Math.random() < this.bidCompletionProba;
        let spread = config.getSpread(asset);
        if (lastCandle.low * (1 + spread) <= order.price && randomCondition) {
            // fullfill bid
            let currencyAmount = this.wallet.getAmount(this.wallet.getMainCurrency());
            let assetPrice = order.price;
            let asset = order.asset;
            let assetAmount = this.wallet.getAmount(asset);

            if (currencyAmount > 0) {
                this.addAction("BID"); // do this before recording action

                let bidTax = this.getBidTax();
                let newAssetAmount = assetAmount + currencyAmount * (1 - bidTax) / assetPrice;
                this.wallet.setAmount(asset, newAssetAmount);
                this.wallet.setAmount(this.wallet.getMainCurrency(), 0);

                this.currentTrades[asset] = {
                    asset: asset,
                    enterPrice: assetPrice,
                    timestamp: this.lastTimestamp,
                    amount: newAssetAmount
                }
                this.log(`- BID for ${_price(currencyAmount)} of ${asset.cyan} at ${_price(assetPrice)}`);
            }
        }
    }

    // process SELLs, BUYs, ASKs and BIDs
    processOrder(order, lastCandle) {
        switch (order.type) {
            case "BUY":
                return this.processBuy(order, lastCandle);
            case "SELL":
                return this.processSell(order, lastCandle);
            case "BID":
                return this.processBid(order, lastCandle);
            case "ASK":
                return this.processAsk(order, lastCandle);
            default:
                console.error("Order: " + JSON.stringify(order, null, 2));
                throw "Unknown order type: " + order.type;
        }
    }

    processOrders(priceData) {
        _.each(this.currentOrders, order => {
            let asset = order.asset;
            let lastCandle = priceData[asset];
            if (lastCandle && !_.isEmpty(lastCandle)) {
                this.processOrder(order, lastCandle);
            }
        });

        this.currentOrders = [];
    }

    updatePrices(priceData) {
        for (let asset of config.getAssets()) {
            let lastCandle = priceData[asset];
            if (lastCandle && !_.isEmpty(lastCandle)) {
                this.wallet.setPrice(asset, lastCandle.open);
            }
        }
    }

    // trade on the whole data
    async trade(priceData) {
        let analysisIntervalLength = this.analysisIntervalLength();
        if (!analysisIntervalLength) {
            throw "analysisIntervalLength is not defined for trader " + this.hash();
        }

        let assets = config.getAssets();
        let candles = {};

        for (var j = 0; j < assets.length; j++) {
            let asset = assets[j];
            candles[asset] = [];
            if (!candles[asset]) {
                candles[asset] = [];
            }

            for (var i = 0; i < analysisIntervalLength - 1; i++) {
                let candle = priceData[i][asset];
                if (candle !== null) {
                    candles[asset].push(candle);
                }
            }
        }

        for (var i = analysisIntervalLength; i < priceData.length; i++) {
            let lastPrices = priceData[i];
            this.updatePrices(lastPrices);
            this.processOrders(lastPrices);

            for (var j = 0; j < assets.length; j++) {
                let asset = assets[j];
                let nextPeriod = priceData[i][asset];
                if (candles[asset].length >= analysisIntervalLength - 1 && nextPeriod !== undefined && nextPeriod !== null) {
                    candles[asset].push(nextPeriod);

                    let lastPrice = _.last(candles[asset]).close;
                    if (config.getRealTradeSimulation()) {
                        // alterate the buy/sell price a little bit to adjust to market simulation
                        // add a 1% random spread
                        let randomSpread = Math.random() * lastPrice * this.randomSpreadFactor;
                        if (this.isInTrade(asset)) {
                            lastPrice -= randomSpread;
                        } else {
                            lastPrice += randomSpread;
                        }
                    }

                    // averaging 0.5% spread factor
                    let spread = config.getSpread(asset);
                    let currentPrice = {
                        marketBuy: lastPrice * (1 + spread),
                        lastTraded: lastPrice,
                        marketSell: lastPrice * (1 - spread),
                        spread: spread
                    }
                    await this.decideAction(asset, candles[asset], currentPrice);

                    if (this.wallet.value() < 20) {
                        // can't trade anymore
                        console.log('trader reached low wallet, interrupting trade');
                        this.wallet.display();
                        return;
                    }

                    candles[asset].shift();
                }
            }
        }
    }

    score() {
        // score is the global ROI of the trader
        // add the buy/sell tax into account
        //return this.gain();
    }

    buy(params) {
        this.currentOrders.push({
            type: "BUY",
            asset: this.currentAsset,
            price: this.wallet.getPrice(this.currentAsset),
            params: params || null,
        });
        return "BUY";
    }

    sell(params) {
        this.currentOrders.push({
            type: "SELL",
            asset: this.currentAsset,
            price: this.wallet.getPrice(this.currentAsset),
            params: params || null,
        });
        return "SELL";
    }

    bid(bidPrice, params) {
        this.currentOrders.push({
            type: "BID",
            asset: this.currentAsset,
            price: bidPrice,
            params: params || null,
        });
        return "BID";
    }

    ask(askPrice, params) {
        this.currentOrders.push({
            type: "ASK",
            asset: this.currentAsset,
            price: askPrice,
            params: params || null,
        });
        return "ASK";
    }

    closePositions() {
        _.each(this.wallet.getAssets(), asset => {
            if (this.wallet.getAmount(asset) > 0) {
                this.currentAsset = asset;
                this.addAction("SELL");
                this.sell();
                this.logAction("SELL");
            }
        });
    }

    deleteOrders() {
        this.currentOrders = [];
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

    checkNotNaN() {
        if (isNaN(this.score())) {
            this.debug();
            process.exit(-1);
        }
    }

    log(...args) {
        if (this.verbose) {
            console.log(...args);
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