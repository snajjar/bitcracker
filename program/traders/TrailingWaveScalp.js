const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');
const dt = require('../lib/datatools');
const indicators = require('../lib/indicators');

class TrailingWaveTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.candleSize = 5;
        this.smaPeriods = 3;

        // If we lower this value we are loosing more trades than we win.
        this.risk = 0.03; // 3% risk

        // We buy if:
        this.zoneTreshold = 0.05; // - we are on the lowest 4% of price amplitude of history
        this.minZoneVolatility = 1.05; // - we observe at least 4% volatility on the period history (150 candles)

        this.wait = {};
    }

    analysisIntervalLength() {
        return 140 * this.candleSize; // last 2h
    }

    hash() {
        return "Algo_TrailingWaveScalp";
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

    getStopLoss() {
        return this.currentStopLoss;
    }

    detectRecentBearishPattern(candles, nbPeriods) {
        let patterns = indicators.patternDetection(candles.slice(candles.length - nbPeriods));
        patterns.bearish = patterns.bearish.filter(patternName => patternName !== "Marubozu");
        patterns.bullish = patterns.bullish.filter(patternName => patternName !== "Marubozu");
        return patterns.bearish.length > 0;
    }

    // decide for an action
    async action(asset, candles, price) {
        // BUY when at the lowest of the wave
        // SELL with stoploss/takeprofit
        try {
            if (this.wait[asset] && this.wait[asset] > 0) {
                this.wait[asset]--;
                // this.log('waiting after recent stoploss');
                return this.hold();
            }

            if (!this.isInTrade()) {
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
                        // if we have a market reversal buy signal on the 1h candles, go buy
                        let candles5 = dt.mergeCandlesBy(candles.slice(candles.length % 5), 5);
                        let candles15 = dt.mergeCandlesBy(candles.slice(candles.length % 15), 15);
                        //let candles30 = dt.mergeCandlesBy(candles.slice(candles.length % 30), 30);

                        let bearishPattern = this.detectRecentBearishPattern(candles, 75);
                        let bearishPattern5 = this.detectRecentBearishPattern(candles5, 15);
                        let bearishPattern15 = this.detectRecentBearishPattern(candles15, 5);

                        if (bearishPattern || bearishPattern5 || bearishPattern15) {
                            console.log('Bearish pattern detected');
                            return this.hold();
                        } else {
                            return this.buy();
                        }
                    }
                } else {
                    return this.hold();
                }
                // return this.hold();
            } else {
                let taxes = this.getBuyTax() + this.getSellTax();
                let range = indicators.getRange(candles);
                // console.log('asset =', asset, 'range =', range, 'sl =', stopLossGap);

                if (!this.currentStopLoss) {
                    let stopLossGap = this.risk; // 4*average hourly range, or 1%
                    this.currentStopLoss = this.currentTrade.enterPrice * (1 - stopLossGap);
                }

                // update trailing stoploss with current price information
                if (price.lastTraded > this.getWinningPrice()) {
                    let stopLossGap = Math.max(range - taxes, 0.01); // 4*average hourly range, or 1%
                    let newStopLoss = price.lastTraded * (1 - stopLossGap);
                    if (newStopLoss > this.currentStopLoss) {
                        this.currentStopLoss = newStopLoss;
                    }
                }

                if (price.lastTraded <= this.getStopLoss()) {
                    this.log('Position hit stoploss');
                    if (price.lastTraded < this.getWinningPrice()) {
                        this.wait[asset] = 300; // if it's a loosing stoploss, wait a few hours
                    }
                    this.currentStopLoss = null;
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

module.exports = TrailingWaveTrader;