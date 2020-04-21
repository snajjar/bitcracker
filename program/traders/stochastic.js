const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class StochasticTrader extends Trader {
    constructor() {
        super();
    }

    analysisIntervalLength() {
        return 120;
    }

    hash() {
        return "Algo_stochastic_70_30";
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
        let stopped = this.stopLoss(this.stopLossRatio);
        if (stopped) return;

        stopped = this.takeProfit(this.takeProfitRatio);
        if (stopped) return;

        // calculate sma indicator
        try {
            let stoch = await this.getStochastic(dataPeriods);
            let lastStoch = stoch[0][stoch[0].length - 1];

            if (!this.inTrade) {
                if (lastStoch < 30) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (lastStoch > 70) {
                    return this.sell(currentBitcoinPrice);
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

module.exports = StochasticTrader;