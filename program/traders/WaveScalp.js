const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');
const dt = require('../lib/datatools');

class WaveTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.candleSize = 5;
        this.smaPeriods = 3;

        this.risk = 0.012; // 1.2% risk per trade

        // if we get to the lowest 4% of the price amplitude of history (and if the asset is volatile enough), let's buy
        this.zoneTreshold = 0.04;
        this.minZoneVolatility = 1.035; // we want to observe at least 3.5% volatility on the period history (150 candles)
        this.zoneMinTrend = -0.7; // if price are doing worse than something like f(x) = -0.7x + b (on a 5 min candle), don't buy
    }

    analysisIntervalLength() {
        return 30 * this.candleSize;
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

    // decide for an action
    async action(asset, candles, currentPrice) {

        // BUY when at the lowest of the wave
        // SELL when at the highest
        try {
            if (!this.isInTrade()) {
                let highest = this.getHighest(candles);
                let lowest = this.getLowest(candles);
                let amplitude = highest - lowest;

                let assetVolatility = this.getVolatility(candles);
                let inBuyZone = assetVolatility > this.minZoneVolatility && currentPrice < lowest + amplitude * this.zoneTreshold;
                if (inBuyZone) {
                    let trendDirections = await this.getTrendDirections(candles);
                    let minDirection = _.min(trendDirections);
                    if (minDirection > this.zoneMinTrend) {
                        return this.buy();
                    } else {
                        return this.hold();
                    }
                } else {
                    return this.hold();
                }
                // return this.hold();
            } else {
                let taxes = this.getBuyTax() + this.getSellTax();
                if (this.stopLoss(this.risk - taxes)) {
                    this.log('Position hit stoploss');
                    return this.sell();
                } else if (this.takeProfit(this.risk + taxes)) {
                    this.log('Position hit take profit');
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