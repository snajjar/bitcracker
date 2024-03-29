const Trader = require('./trader');
const _ = require('lodash');

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
    async action(crypto, dataPeriods, currentBitcoinPrice) {
        /*
        let stopped = this.stopLoss(this.stopLossRatio);
        if (stopped) return;

        stopped = this.takeProfit(this.takeProfitRatio);
        if (stopped) return;
        */

        // calculate sma indicator
        try {

            if (!this.isInTrade()) {
                // BUY everytime
                return this.buy();
            } else {
                return this.hold();
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = JustBuyAndHoldTrader;