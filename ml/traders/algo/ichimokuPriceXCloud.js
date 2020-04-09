const Trader = require('../trader');
const Ichimoku = require('ichimoku');
const _ = require('lodash');

class IchimokuPriceXCloudTrader extends Trader {
    constructor() {
        super();
    }

    analysisIntervalLength() {
        // 52 period for ichimoku indicators
        // +2 for the 2 last ichimoku values
        // + 1 for the last data value
        return 55;
    }

    hash() {
        return "Algo_ichimokuPriceXCloud";
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
    async action(dataPeriods, currentBitcoinPrice) {
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
            let prevBitcoinPrice = dataPeriods[dataPeriods.length - 2].close;

            let previouslyUnderCloud = prevBitcoinPrice < prevIchimokuValue.spanA || prevBitcoinPrice < prevIchimokuValue.spanB;
            let nowOverCloud = currentBitcoinPrice > prevIchimokuValue.spanA && currentBitcoinPrice > prevIchimokuValue.spanB

            let priceXCloud = previouslyUnderCloud && nowOverCloud;

            if (!this.inTrade) {
                if (priceXCloud) {
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

module.exports = IchimokuPriceXCloudTrader;