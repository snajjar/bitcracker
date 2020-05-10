const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMAProfitTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 5;
        this.emaDownTrigger = { 'max': 0.5, 'min': 0.10 };
        this.emaUpTrigger = { 'max': 0.4, 'min': 0.2 };
        this.maxTimeInTrade = 60 * 2; // 2h, can't sell without profit
        this.objective = 0.02;

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

    getObjective() {
        return this.enterTradeValue * (1 + this.objective - this.timeInTrade * this.step);
    }

    getWinningPrice() {
        return this.enterTradeValue * (1 + this.getBuyTax() + this.getSellTax());
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(0.1);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        let ema = await this.getEMA(dataPeriods);
        let currEMA = _.last(ema);
        let diff = (currentBitcoinPrice / currEMA * 100) - 100;

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
            let bigUp = diff > this.adaptativeUpTrigger();
            let objectivePrice = this.getObjective();
            let winningPrice = this.getWinningPrice(); // price at which the trade is positive

            if (objectivePrice > winningPrice) {
                // we are in the time period shortly after trade, we only sell positive here
                if (currentBitcoinPrice > winningPrice) {
                    if (currentBitcoinPrice > objectivePrice) {
                        // objective reached
                        return this.sell();
                    } else if (bigUp) {
                        // big up price, sell here
                        return this.sell();
                    } else {
                        return this.hold();
                    }
                } else {
                    return this.hold();
                }
            } else {
                // the no-loosing-trade period has expired. Sell if bigUp detected
                if (bigUp) {
                    return this.sell();
                } else {
                    return this.hold();
                }
            }
        }
    }
}

module.exports = EMAProfitTrader;