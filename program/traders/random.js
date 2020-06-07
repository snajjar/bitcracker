const Trader = require('./trader');
const _ = require('lodash');

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
    async action(crypto, dataPeriods, currentAssetPrice) {
        let stopped = this.stopLoss(this.stopLossRatio);
        if (stopped) return this.sell();

        stopped = this.takeProfit(this.takeProfitRatio);
        if (stopped) return this.sell();

        // calculate sma indicator
        try {
            let rand = Math.random() < 0.5; // buy in average once every 100 boxes

            if (!this.isInTrade()) {
                if (rand) {
                    // BUY condition
                    return this.bid(currentAssetPrice);
                } else {
                    return this.hold();
                }
            } else {
                if (rand) {
                    return this.ask(currentAssetPrice);
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

module.exports = RandomTrader;