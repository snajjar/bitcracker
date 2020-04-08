const Trader = require('../trader');
const tulind = require('tulind');
const _ = require('lodash');

const stopLossRatio = 0.01;
const takeProfitRatio = 0.02;

class EMAxSMATrader extends Trader {
    constructor() {
        super();
    }

    analysisIntervalLength() {
        return 120;
    }

    hash() {
        return "Algo_stochastic";
    }

    getStochastic(dataPeriods) {
        let highPrices = _.map(dataPeriods, p => p.high);
        let lowPrices = _.map(dataPeriods, p => p.low);
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.stoch.indicator([highPrices, lowPrices, closePrices], [14, 3, 3], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            });
        });
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        let stopped = this.stopLoss(stopLossRatio);
        if (stopped) return;

        stopped = this.takeProfit(takeProfitRatio);
        if (stopped) return;

        // calculate sma indicator
        try {
            let stoch = await this.getStochastic(dataPeriods);
            let lastStoch = stoch[0][stoch[0].length - 1];

            if (!this.inTrade) {
                if (lastStoch < 20) {
                    // BUY condition
                    this.buy();
                } else {
                    this.hold();
                }
            } else {
                if (lastStoch > 80) {
                    this.sell(currentBitcoinPrice);
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

module.exports = EMAxSMATrader;