const Trader = require('../trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMADivTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.smaPeriods = 200;
        this.emaPeriods = 5;

        this.prevSMA = null;
        this.prevEMA = null;
    }

    analysisIntervalLength() {
        return Math.max(this.smaPeriods, this.emaPeriods) + 1;
    }

    hash() {
        return "Algo_EMADiv";
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
    async action(dataPeriods, currentBitcoinPrice) {
        let stopped = this.stopLoss(this.stopLossRatio);
        if (stopped) return;

        stopped = this.takeProfit(this.takeProfitRatio);
        if (stopped) return;

        // calculate sma indicator
        try {
            let ema = await this.getEMA(dataPeriods);
            let currEMA = ema[ema.length - 1];

            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let upTrend = -0.2;
            let downTrend = +0.2;

            if (!this.inTrade) {
                if (diff < upTrend) {
                    // BUY condition
                    this.buy();
                } else {
                    this.hold();
                }
            } else {
                if (diff > downTrend) {
                    // SELL conditions are take profit and stop loss
                    this.sell();
                } else {
                    this.hold();
                }
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = EMADivTrader;