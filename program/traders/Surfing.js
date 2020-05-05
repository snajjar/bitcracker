const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class SurfingTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.diffTrigger = 0.02;
        // this.emaPeriods = 2;
        // this.emaTrigger = 0.4;
    }

    analysisIntervalLength() {
        return 60;
    }

    hash() {
        return "Algo_Surfing";
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
        let stopped = this.stopLoss(0.1);
        if (stopped) return;

        stopped = this.takeProfit(0.03);
        if (stopped) return;

        let highestCandle = _.maxBy(candles, c => c.close);
        let lowestCandle = _.minBy(candles, c => c.close);
        let highestPrice = highestCandle.close;
        let lowestPrice = lowestCandle.close;
        let buySignal = currentBitcoinPrice * (1 + this.diffTrigger) < highestPrice;
        let sellSignal = currentBitcoinPrice * (1 - this.diffTrigger) > lowestPrice;

        // calculate sma indicator
        try {
            // let ema = await this.getEMA(dataPeriods);
            // let currEMA = ema[ema.length - 1];

            // var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            // let trendUp = diff < -this.emaTrigger;
            // let trendDown = diff > this.emaTrigger;

            if (!this.inTrade) {
                if (buySignal) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                // if (sellSignal) {
                //     // SELL conditions are take profit and stop loss
                //     return this.sell();
                // } else {
                //     return this.hold();
                // }
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = SurfingTrader;