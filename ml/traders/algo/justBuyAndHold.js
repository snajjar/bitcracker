const Trader = require('../trader');
const _ = require('lodash');

const stopLossRatio = 0.04;
const takeProfitRatio = 0.04;

class JustBuyAndHoldTrader extends Trader {
    constructor() {
        super();
    }

    analysisIntervalLength() {
        return 1;
    }

    hash() {
        return "Algo_justBuyAndHold";
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        let stopped = this.stopLoss(stopLossRatio);
        if (stopped) return;

        stopped = this.takeProfit(takeProfitRatio);
        if (stopped) return;

        // calculate sma indicator
        try {

            if (!this.inTrade) {
                // BUY everytime
                this.buy();
            } else {
                this.hold();
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = JustBuyAndHoldTrader;