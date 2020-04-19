const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMAxSMATrader extends Trader {
    constructor() {
        super();

        // parameters
        this.smaPeriods = 100;

        this.prevSMA = null;
        this.prevPrice = 0;
    }

    analysisIntervalLength() {
        return Math.max(this.smaPeriods) + 1;
    }

    hash() {
        return "Algo_PricexSMA";
    }

    getSMA(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.sma.indicator([closePrices], [this.smaPeriods], function(err, results) {
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
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            let sma = await this.getSMA(dataPeriods);

            let currSMA = sma[sma.length - 1];
            let prevSMA = sma[sma.length - 2];

            let priceCrossingSMAUp = currentBitcoinPrice < prevSMA && currentBitcoinPrice >= currSMA;
            let priceCrossingSMADown = currentBitcoinPrice > prevSMA && currentBitcoinPrice <= currSMA;

            if (!this.inTrade) {
                if (priceCrossingSMAUp) {
                    // BUY condition
                    this.buy();
                } else {
                    this.hold();
                }
            } else {
                if (priceCrossingSMADown) {
                    this.sell();
                } else {
                    // SELL conditions are take profit and stop loss
                    this.hold();
                }
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = EMAxSMATrader;