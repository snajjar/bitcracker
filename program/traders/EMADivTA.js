const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMADivTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 5;
        this.smaPeriods = 20;

        this.emaDownTrigger = { 'max': 0.38, 'min': 0.10 };
        this.emaUpTrigger = { 'max': 0.38, 'min': 0.20 };
    }

    analysisIntervalLength() {
        return 50;
    }

    hash() {
        return "Algo_EMADiv_Tax_Adapted";
    }


    // vary from 0.4 (when highest tax: 0.26%) to 0.25 (when lowest buy tax: 0.10%)
    adaptativeDownTrigger() {
        let emaDownRange = this.emaDownTrigger.max - this.emaDownTrigger.min;
        let buyTaxRange = 0.0026 - 0.001;
        let curr = this.getBuyTax() - 0.001;
        return this.emaDownTrigger.min + emaDownRange * curr / buyTaxRange;
    }

    // vary from 0.4 (when highest tax: 0.26%) to 0.20 (when lowest sell tax: 0%)
    adaptativeUpTrigger() {
        let emaUpRange = this.emaUpTrigger.max - this.emaUpTrigger.min;
        let sellTaxRange = 0.0016;
        let curr = this.getSellTax();
        return this.emaUpTrigger.min + emaUpRange * curr / sellTaxRange;
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
            let ema = await this.getEMA(dataPeriods);
            let currEMA = _.last(ema);

            let sma = await this.getSMA(dataPeriods);
            let lastSMA = _.last(sma);
            let firstSMA = _.first(sma);
            let upTrend = firstSMA < lastSMA;
            let downTrend = lastSMA < firstSMA;

            var diff = (currentBitcoinPrice / currEMA * 100) - 100;

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

module.exports = EMADivTrader;