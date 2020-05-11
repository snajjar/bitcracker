const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMADivTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 2;
        this.emaDownTrigger = { 'max': 0.35, 'min': 0.15 };
        this.emaUpTrigger = { 'max': 0.4, 'min': 0.2 };
        this.adxPeriods = 14;
        this.adxTrigger = 13;
    }

    analysisIntervalLength() {
        return 28;
    }

    hash() {
        return "Algo_EMADiv_Tax_Adapted";
    }

    getTaxRatio() {
        let taxRange = 0.0016 * 2;
        let curr = this.getBuyTax() - 0.001 + this.getSellTax() - 0.001;
        return curr / taxRange;
    }

    // vary from 0.4 (when highest tax: 0.26%) to 0.25 (when lowest buy tax: 0.10%)
    adaptativeDownTrigger() {
        let emaDownRange = this.emaDownTrigger.max - this.emaDownTrigger.min;
        return this.emaDownTrigger.min + emaDownRange * this.getTaxRatio();
    }

    // vary from 0.4 (when highest tax: 0.26%) to 0.20 (when lowest sell tax: 0%)
    adaptativeUpTrigger() {
        let emaUpRange = this.emaUpTrigger.max - this.emaUpTrigger.min;
        return this.emaUpTrigger.min + emaUpRange * this.getTaxRatio();
    }

    getEMA(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.ema.indicator([closePrices], [this.emaPeriods], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
    }

    getADX(dataPeriods) {
        let highPrices = _.map(dataPeriods, p => p.high);
        let lowPrices = _.map(dataPeriods, p => p.low);
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.adx.indicator([highPrices, lowPrices, closePrices], [this.adxPeriods], function(err, results) {
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
            let ema = await this.getEMA(dataPeriods);
            let currEMA = _.last(ema);

            var diff = (currentBitcoinPrice / currEMA * 100) - 100;

            if (!this.inTrade) {
                let bigDown = diff < -this.adaptativeDownTrigger();

                // determine trend strengh with ADX
                let adx = await this.getADX(dataPeriods);
                let lastADX = adx[adx.length - 1];
                let trendSeemsStrong = !isNaN(lastADX) && lastADX > this.adxTrigger;

                if (bigDown && trendSeemsStrong) {
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

module.exports = EMADivTrader;