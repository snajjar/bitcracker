const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class SMADivTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.smaPeriods = 5;
        this.smaDownTrigger = { 'min': 0.33, 'max': 1.2 };
        this.smaUpTrigger = { 'min': 0.33, 'max': 1.2 };
    }

    analysisIntervalLength() {
        return 28;
    }

    hash() {
        return "Algo_SMADiv_Tax_Adjusted";
    }

    // return the current value for position (between 0 and 1), on a logarithmic scale from min to max
    logSlider(min, max, position) {
        let minv = Math.log(min);
        let maxv = Math.log(max);
        var scale = (maxv - minv) / (max - min);
        return Math.exp(minv + scale * (position - min));
    }

    getTaxRatio() {
        let taxRange = 0.0016 * 2;
        let curr = this.getBuyTax() - 0.001 + this.getSellTax() - 0.001;
        return curr / taxRange;
    }

    adaptativeTrigger(min, max, ratio) {
        let range = max - min;
        let positionOnLinearScale = min + range * ratio;
        let positionOnLogScale = this.logSlider(min, max, positionOnLinearScale);
        return positionOnLogScale;
    }

    // vary from 0.4 (when highest tax: 0.26%) to 0.25 (when lowest buy tax: 0.10%)
    adaptativeDownTrigger() {
        return this.adaptativeTrigger(this.smaDownTrigger.min, this.smaDownTrigger.max, this.getTaxRatio());
    }

    // vary from 0.4 (when highest tax: 0.26%) to 0.20 (when lowest sell tax: 0%)
    adaptativeUpTrigger() {
        return this.adaptativeTrigger(this.smaUpTrigger.min, this.smaUpTrigger.max, this.getTaxRatio());
    }

    getSMA(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.sma.indicator([closePrices], [this.smaPeriods], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            let sma = await this.getSMA(dataPeriods);
            let currSMA = _.last(sma);

            var diff = (currentBitcoinPrice / currSMA * 100) - 100;

            if (!this.inTrade) {
                let bigDown = diff < -this.adaptativeDownTrigger();
                if (bigDown) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                let bigUp = diff > this.adaptativeUpTrigger();
                if (bigUp) {
                    // SELL conditions are take profit and stop loss
                    return this.sell();
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

module.exports = SMADivTrader;