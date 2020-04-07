const Trader = require('../trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMAxSMATrader extends Trader {
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
        let avg = this.getAVG(dataPeriods);
        let lastCandle = dataPeriods[dataPeriods.length - 1];

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
            if (currentBitcoinPrice > this.enterTradeValue * this.takeProfitRatio) {
                // SELL condition: stop loss
                this.inTrade = false;
                this.enterTradeValue = 0;
                this.sell(currentBitcoinPrice);
            } else {
                this.hold();
            }
        }
    }
}

module.exports = EMAxSMATrader;