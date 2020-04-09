const Trader = require('../trader');
const tulind = require('tulind');
const _ = require('lodash');

class RSITrader_70_30 extends Trader {
    constructor() {
        super();
    }

    analysisIntervalLength() {
        return 120;
    }

    hash() {
        return "Algo_rsi_70_30";
    }

    getRSI(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.rsi.indicator([closePrices], [14], function(err, results) {
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
            let rsi = await this.getRSI(dataPeriods);
            let lastRSI = rsi[0][rsi[0].length - 1];

            if (!this.inTrade) {
                if (lastRSI < 30) {
                    // BUY condition
                    this.buy();
                } else {
                    this.hold();
                }
            } else {
                if (lastRSI > 70) {
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

module.exports = RSITrader_70_30;