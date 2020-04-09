const Trader = require('../trader');
const _ = require('lodash');

const stopLossRatio = 0.04;
const takeProfitRatio = 0.04;

class RandomTrader extends Trader {
    constructor() {
        super();
    }

    analysisIntervalLength() {
        return 1;
    }

    hash() {
        return "Algo_random";
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        let stopped = this.stopLoss(stopLossRatio);
        if (stopped) return;

        stopped = this.takeProfit(takeProfitRatio);
        if (stopped) return;

        // calculate sma indicator
        try {
            let rand = Math.random() > 0.01; // buy in average once every 100 boxes

            if (!this.inTrade) {
                if (rand) {
                    // BUY condition
                    this.buy();
                } else {
                    this.hold();
                }
            } else {
                this.hold();
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = RandomTrader;