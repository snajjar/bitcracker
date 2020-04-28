const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class TurtleTrader extends Trader {
    constructor() {
        super();

        this.emaPeriods = 2;
        this.emaTrigger = 0.4;
    }

    analysisIntervalLength() {
        return 1440;
    }

    hash() {
        return "Algo_Turtle";
    }

    getEMA(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
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

    // decide for an action
    async action(candles, currentBitcoinPrice) {
        // calculate sma indicator
        try {
            let lowest = +Infinity;
            let highest = -Infinity;
            for (var i = 0; i < candles.length - 1; i++) {
                let candle = candles[i];
                if (candle.low < lowest) {
                    lowest = candle.low;
                }
                if (candle.high > highest) {
                    highest = candle.high;
                }
            }

            let treshold = 0.1;
            let priceCloseToLower = currentBitcoinPrice < lowest * (1 + treshold);
            let priceCloseToHighest = currentBitcoinPrice > highest * (1 - treshold);


            let ema = await this.getEMA(candles);
            let currEMA = ema[ema.length - 1];
            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let trendUp = diff < -this.emaTrigger;
            let trendDown = diff > this.emaTrigger;


            if (!this.inTrade) {
                if (trendUp && priceCloseToLower) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (trendDown) {
                    // SELL conditions are take profit and stop loss
                    return this.sell();
                } else {
                    return this.hold();
                }
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = TurtleTrader;