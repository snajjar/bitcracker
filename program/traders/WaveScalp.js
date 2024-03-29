const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');
const dt = require('../lib/datatools');
const indicators = require('../lib/indicators');

class WaveTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.candleSize = 5;
        this.smaPeriods = 3;

        // If we lower this value we are loosing more trades than we win.
        this.risk = 0.04; // 4% risk per trade

        // We buy if:
        this.zoneTreshold = 0.05; // - we are on the lowest 4% of price amplitude of history
        this.minZoneVolatility = 1.05; // - we observe at least 4% volatility on the period history (150 candles)

        this.wait = {};

        this.currentStopLoss = {};
        this.currentTakeProfit = {};
    }

    analysisIntervalLength() {
        return 140 * this.candleSize; // last 2h
    }

    hash() {
        return "Algo_WaveScalp";
    }

    getHighest(candles) {
        return _.maxBy(candles, o => o.high).high;
    }

    getLowest(candles) {
        return _.minBy(candles, o => o.low).low;
    }

    // return a percentage of how much the action moved compared to it's price
    getVolatility(candles) {
        let highest = this.getHighest(candles);
        let lowest = this.getLowest(candles);
        let volatility = 1 + (highest - lowest) / highest;
        return volatility;
    }

    getSMA(dataPeriods) {
        let candles = dataPeriods.slice(dataPeriods.length - 42);
        let closePrices = _.map(candles, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.ema.indicator([closePrices], [this.smaPeriods], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
    }

    // average true range indicator
    getATR(candles) {
        candles = candles.slice(candles.length - (14 * 5));
        let merged = dt.mergeCandlesBy(candles, 5);
        let s = 0;
        for (let candle of merged) {
            s += (candle.high - candle.low) / candle.low;
        }
        return s / candles.length;
    }

    hasBigDown(candles, currentPrice) {
        let relevantCandles = candles.slice(candles.length - 700);
        let highest = _.maxBy(relevantCandles, c => c.high).high;
        return currentPrice < highest * 0.97;
    }

    async getTrendDirections(candles) {
        let frameTrendDirections = [];

        // linear reg on the 1, 5, 15, 60 intervals
        for (let intervalLength of [60, 15, 5, 1]) {
            let sliced = candles.slice(this.analysisIntervalLength() % intervalLength);
            let mergedCandles = dt.mergeCandlesBy(sliced, intervalLength);
            let sma = await this.getSMA(mergedCandles);
            let last5SMA = sma.slice(sma.length - 5);
            let [a, b] = dt.linearRegression(_.range(last5SMA.length), last5SMA);
            frameTrendDirections.push(a);
        }

        // console.log(frameTrendDirections);
        return frameTrendDirections;
    }

    defineSLTP(asset, candles) {
        if (!this.currentStopLoss[asset] || !this.currentTakeProfit[asset]) {
            let enterPrice = this.getCurrentTradeEnterPrice(asset);
            if (enterPrice === null) {
                throw "enterPrice should not be undefined";
            }

            let taxes = this.getBuyTax() + this.getSellTax();
            let atr = this.getATR(candles);
            this.currentStopLoss[asset] = enterPrice * (1 - this.risk - atr + taxes);
            this.currentTakeProfit[asset] = enterPrice * (1 + this.risk + atr + taxes);
            // console.log(`Setting ATR=${atr} SL=${this.currentStopLoss} TP=${this.currentTakeProfit}`);
        }
    }

    getObjective(asset) {
        return this.currentTakeProfit[asset];
    }

    getStopLoss(asset) {
        return this.currentStopLoss[asset];
    }

    // decide for an action
    async action(asset, candles, price) {
        // BUY when at the lowest of the wave
        // SELL with stoploss/takeprofit
        try {
            if (!this.isInTrade(asset)) {
                if (this.wait[asset] && this.wait[asset] > 0) {
                    this.wait[asset]--;
                    // this.log('waiting after recent stoploss');
                    return this.hold();
                }

                let enterPrice = price.marketBuy;

                // first, check if price has dropped significantly
                let highest = this.getHighest(candles);
                let lowest = this.getLowest(candles);
                let amplitude = highest - lowest;
                let assetVolatility = this.getVolatility(candles);
                let priceDropped = assetVolatility > this.minZoneVolatility && price.marketBuy < lowest + amplitude * this.zoneTreshold;
                if (priceDropped) {
                    if (price.spread > 0.01) {
                        this.log('Not buying because spread is too high');
                        return this.hold();
                    } else {
                        // compute stoploss and takeprofit
                        let atr = this.getATR(candles);
                        let taxes = this.getBuyTax() + this.getSellTax();
                        let params = {
                            stopLoss: enterPrice * (1 - this.risk - atr + taxes),
                            takeProfit: enterPrice * (1 + this.risk + atr + taxes)
                        };
                        return this.buy(params);
                    }
                } else {
                    return this.hold();
                }
                // return this.hold();
            } else {
                if (!this.currentStopLoss[asset] || !this.currentTakeProfit[asset]) {
                    this.defineSLTP(asset, candles);
                }

                if (price.marketSell >= this.getObjective(asset)) {
                    this.log(`${asset} position hit take profit`);
                    this.currentStopLoss[asset] = null;
                    this.currentTakeProfit[asset] = null;
                    return this.sell();
                } else if (price.lastTraded <= this.getStopLoss(asset)) {
                    this.log(`${asset} position hit stoploss`);
                    this.wait[asset] = 300; // wait 5h
                    this.currentStopLoss[asset] = null;
                    this.currentTakeProfit[asset] = null;
                    return this.sell();
                } else {
                    return this.hold();
                }
            }
        } catch (e) {
            console.error("Err: " + e);
            process.exit(-1);
        }
    }
}

module.exports = WaveTrader;