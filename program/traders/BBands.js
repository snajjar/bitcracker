const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class BBandsTrader extends Trader {
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
        return "Algo_BBands";
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

    getBBands(candles) {
        let closePrices = _.map(candles, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.bbands.indicator([closePrices], [20, 2], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve([results[0], results[1], results[2]]);
                }
            });
        });
    }

    // decide for an action
    async action(candles, currentBitcoinPrice) {
        let stopped = this.takeProfit(0.006);
        if (stopped) return;

        stopped = this.stopLoss(0.003);
        if (stopped) return;

        // calculate sma indicator
        try {
            // We want to trade in the direction of the market. Filter trades with 200 ema
            // check if we are currently in uptrend or downtrend
            let ema = await this.getEMA(candles);
            let firstEMA = _.first(ema);
            let prevEMA = ema[ema.length - 2];
            let lastEMA = _.last(ema);
            let uptrend = currentBitcoinPrice > lastEMA;
            let downtrend = currentBitcoinPrice < lastEMA;

            // estimate trend strength
            let [lowBand, midBand, highBand] = await this.getBBands(candles);
            let buySignal = currentBitcoinPrice > _.last(highBand);
            let sellSignal = currentBitcoinPrice < _.last(lowBand);

            // estimate trend growth
            let growth = (lastEMA - firstEMA) / lastEMA;

            let buyCondition = buySignal && currentBitcoinPrice > lastEMA && growth > 0.01;

            if (!this.isInTrade()) {
                if (buyCondition) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (sellSignal) {
                    return this.sell();
                } else {
                    return this.hold(); // sell on stoploss/takeprofit
                }
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = BBandsTrader;