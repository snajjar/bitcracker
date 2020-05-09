const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMAProfitTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 5;
        this.emaDownTrigger = { 'max': 0.333, 'min': 0.15 };
        this.emaUpTrigger = { 'max': 0.333, 'min': 0.15 };
        this.maxTimeInTrade = 60 * 3; // 6h
        this.objective = 0.03;

        // trade decision making
        this.inTrade = false;
        this.enterTradeValue = 0;
        this.timeInTrade = 0;
        this.step = (this.objective - this.getBuyTax() + this.getSellTax()) / this.maxTimeInTrade;
    }

    analysisIntervalLength() {
        //return this.emaPeriods + 1;
        return 50;
    }

    hash() {
        return "Algo_EMAProfit";
    }

    getAVG(dataPeriods) {
        return _.meanBy(dataPeriods, 'close')
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

    // vary from 0.4 (when highest tax: 0.26%) to 0.25 (when lowest buy tax: 0.10%)
    adaptativeDownTrigger() {
        let emaDownRange = this.emaDownTrigger.max - this.emaDownTrigger.min;
        let buyTaxRange = 0.0026 - 0.001;
        let curr = this.getBuyTax() - 0.001;
        return this.emaDownTrigger.min + emaDownRange * curr / buyTaxRange;
    }

    // vary from 0.4 (when highest tax: 0.26%) to 0.20 (when lowest sell tax: 0%)
    adaptativeUpTrigger() {
        let emaDownRange = this.emaDownTrigger.max - this.emaDownTrigger.min;
        let sellTaxRange = 0.0016;
        let curr = this.getSellTax();
        return this.emaDownTrigger.min + emaDownRange * curr / sellTaxRange;
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(0.1);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        let ema = await this.getEMA(dataPeriods);
        let currEMA = ema[ema.length - 1];

        var diff = (currentBitcoinPrice / currEMA * 100) - 100;

        if (!this.inTrade) {
            let bigDown = diff < -this.adaptativeDownTrigger();
            if (bigDown) {
                // BUY condition
                this.timeInTrade = 0;
                return this.buy();
            } else {
                return this.hold();
            }
        } else {
            this.timeInTrade++;
            let objectivePrice = this.enterTradeValue * (1 + this.objective - this.timeInTrade * this.step);
            let bigUp = diff > this.adaptativeUpTrigger();
            if (currentBitcoinPrice > objectivePrice || bigUp) {
                return this.sell();
            } else {
                return this.hold();
            }
        }
    }
}

module.exports = EMAProfitTrader;