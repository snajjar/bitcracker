const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class ADXTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 200;
        this.adxPeriods = 14;
    }

    analysisIntervalLength() {
        return this.emaPeriods + 1;
    }

    hash() {
        return "Algo_ADX";
    }

    getEMA(candles) {
        let closePrices = _.map(candles, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.ema.indicator([closePrices], [this.emaPeriods], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
    }

    getMACD(candles) {
        let closePrices = _.map(candles, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.macd.indicator([closePrices], [10, 26, 9], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            });
        });
    }

    getADX(candles) {
        let highPrices = _.map(candles, p => p.high);
        let lowPrices = _.map(candles, p => p.low);
        let closePrices = _.map(candles, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.adx.indicator([highPrices, lowPrices, closePrices], [this.adxPeriods], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
    }

    // decide for an action
    async action(candles, currentBitcoinPrice) {
        let stopped = this.takeProfit(0.005);
        if (stopped) return;

        stopped = this.stopLoss(0.0025);
        if (stopped) return;

        // calculate sma indicator
        try {
            // We want to trade in the direction of the market. Filter trades with 200 ema
            // check if we are currently in uptrend or downtrend
            let ema = await this.getEMA(candles);
            let firstEMA = _.first(ema);
            let prevEMA = ema[ema.length - 2];
            let lastEMA = _.last(ema);
            let priceOverEMA = currentBitcoinPrice > lastEMA;
            let trendGrowth = (lastEMA - firstEMA) / lastEMA;
            let trendUp = lastEMA > prevEMA;

            // estimate trend strength
            let adx = await this.getADX(candles);
            let lastADX = adx[adx.length - 1];
            let trendSeemsStrong = !isNaN(lastADX) && lastADX > 25;

            let buyCondition = trendUp && trendSeemsStrong && priceOverEMA && trendGrowth > 0.03;

            if (!this.isInTrade()) {
                if (buyCondition) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                return this.hold(); // sell on stoploss/takeprofit
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = ADXTrader;