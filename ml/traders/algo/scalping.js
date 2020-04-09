const Trader = require('../trader');
const tulind = require('tulind');
const _ = require('lodash');

class ScalpingTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.takeProfitRatio = 0.02;

        // trade decision making
        this.inTrade = false;
        this.enterTradeValue = 0;
    }

    analysisIntervalLength() {
        return 50;
    }

    hash() {
        return "Algo_scalping_2%";
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
                this.buy();
            } else {
                this.hold();
            }
        } else {
            // if (currentBitcoinPrice > this.enterTradeValue * this.takeProfitRatio) {
            //     // SELL condition: stop loss
            //     this.inTrade = false;
            //     this.enterTradeValue = 0;
            //     this.sell(currentBitcoinPrice);
            // } else {
            //     this.hold();
            // }
            this.hold();
        }
    }
}

module.exports = ScalpingTrader;