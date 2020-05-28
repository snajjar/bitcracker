const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class RSITrader extends Trader {
    constructor() {
        super();
    }

    analysisIntervalLength() {
        return 120;
    }

    hash() {
        return "Algo_rsi";
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
    async action(crypto, dataPeriods, currentBitcoinPrice) {
        let stopped = this.stopLoss(this.stopLossRatio);
        if (stopped) return;

        stopped = this.takeProfit(this.takeProfitRatio);
        if (stopped) return;

        // calculate sma indicator
        try {
            let rsi = await this.getRSI(dataPeriods);
            let lastRSI = rsi[0][rsi[0].length - 1];

            if (!this.isInTrade()) {
                if (lastRSI < 20) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (lastRSI > 80) {
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

module.exports = RSITrader;