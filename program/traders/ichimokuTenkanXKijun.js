const Trader = require('./trader');
const Ichimoku = require('ichimoku');
const _ = require('lodash');

class IchimokuTenkanXKijunTrader extends Trader {
    constructor() {
        super();
    }

    analysisIntervalLength() {
        // 52 period for ichimoku ssb
        // +26 for kijun
        // +2 for the 2 last ichimoku values
        // +1 for the last data value
        return 81;
    }

    hash() {
        return "Algo_ichimokuTenkanXKijun";
    }

    getIchimoku(dataPeriods) {
        const ichimoku = new Ichimoku({
            conversionPeriod: 9,
            basePeriod: 26,
            spanPeriod: 52,
            displacement: 26,
            values: []
        })

        let ich = [];
        for (let period of dataPeriods) {
            let ichimokuValue = ichimoku.nextValue({
                high: period.high,
                low: period.low,
                close: period.close
            })
            if (ichimokuValue) {
                ich.push(ichimokuValue);
            }
        }

        return ich;
    }

    // decide for an action
    async action(crypto, dataPeriods, currentBitcoinPrice) {
        let stopped = this.stopLoss(this.stopLossRatio);
        if (stopped) return;

        stopped = this.takeProfit(this.takeProfitRatio);
        if (stopped) return;

        // calculate sma indicator
        try {
            let ich = this.getIchimoku(dataPeriods);
            //console.log(ich);

            let lastIchimokuValue = ich[ich.length - 1];
            let prevIchimokuValue = ich[ich.length - 2];

            let tenkanCrossedKijun =
                prevIchimokuValue.conversion < prevIchimokuValue.base &&
                lastIchimokuValue.conversion >= lastIchimokuValue.base;

            if (!this.isInTrade()) {
                if (tenkanCrossedKijun) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                return this.hold();
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = IchimokuTenkanXKijunTrader;