const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class ScalpingTrader extends Trader {
    constructor() {
        super();

        // trade decision making
        this.inTrade = false;
        this.enterTradeValue = 0;
    }

    analysisIntervalLength() {
        return 50;
    }

    hash() {
        return "Algo_scalping";
    }

    getAVG(dataPeriods) {
        return _.meanBy(dataPeriods, 'close')
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        let stopped = this.stopLoss(this.stopLossRatio);
        if (stopped) return;

        stopped = this.takeProfit(this.takeProfitRatio);
        if (stopped) return;

        let avg = this.getAVG(dataPeriods);

        if (!this.inTrade) {
            if (currentBitcoinPrice < avg) {
                // BUY condition
                this.inTrade = true;
                this.enterTradeValue = currentBitcoinPrice;
                return this.buy();
            } else {
                return this.hold();
            }
        } else {
            return this.hold();
        }
    }
}

module.exports = ScalpingTrader;