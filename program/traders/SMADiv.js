const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMADivTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.smaPeriods = 5;
        this.smaTrigger = 0.5; // best settings: 1.3 for max fees, 0.22 for min fees
    }

    analysisIntervalLength() {
        return 50;
    }

    hash() {
        return "Algo_SMADiv";
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
            let currSMA = _.last(sma);

            var diff = (currentBitcoinPrice / currSMA * 100) - 100;
            let bigDown = diff < -this.smaTrigger;
            let bigUp = diff > this.smaTrigger;

            if (!this.inTrade) {
                if (bigDown) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (bigUp) {
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

module.exports = EMADivTrader;