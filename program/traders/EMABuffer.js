const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMAProfitTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 2;
        this.emaDownTrigger = { 'max': 0.35, 'min': 0.15 };
        this.emaUpTrigger = { 'max': 0.4, 'min': 0.2 };
        this.maxTimeInTrade = 60 * 5; // 5h
        this.objective = 0.02;
        this.bbandStdDev = 1;

        // trade decision making
        this.inTrade = false;
        this.enterTradeValue = 0;
        this.timeInTrade = 0;
        this.sellTreshold = null;
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

    getTaxRatio() {
        let taxRange = 0.0026 - 0.001;
        let curr = this.getBuyTax() - 0.001 + this.getSellTax();
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

    getObjective() {
        return this.enterTradeValue * (1 + this.objective - this.timeInTrade * this.step);
    }

    getWinningPrice() {
        return this.enterTradeValue * (1 + this.getBuyTax() + this.getSellTax());
    }

    getBBands(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.bbands.indicator([closePrices], [20, 2], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve([results[0], results[1], results[2]]);
                }
            });
        });
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
                this.sellTreshold = null;
                return this.buy();
            } else {
                return this.hold();
            }
        } else {
            this.timeInTrade++;
            let bigUp = diff > this.adaptativeUpTrigger();
            if (bigUp) {
                return this.sell();
            } else {
                // if we are in a winning position, set a minimum according to bollinger's bands (variability).
                // if price goes under that treshold we set, we sell.
                if (this.sellTreshold !== null && currentBitcoinPrice < this.sellTreshold) {
                    //console.log(`FORCED SELLING AT: ${this.sellTreshold.toFixed(0)}€ when entered at ${this.enterTradeValue.toFixed(0)}€`);
                    this.sellTreshold = null;
                    return this.sell();
                } else {
                    let objectivePrice = this.getObjective();
                    let winningPrice = this.getWinningPrice();

                    // check if we need to set/increase our treshold
                    let [lowBand, midBand, highBand] = await this.getBBands(dataPeriods);
                    let lbPrice = _.last(lowBand);
                    let mbPrice = _.last(midBand);

                    // the closer we are to objective, the more we push the treshold close the the actual price
                    let newSellTreshold = currentBitcoinPrice - (mbPrice - lbPrice) * this.bbandStdDev * (1 - currentBitcoinPrice / objectivePrice);
                    if (newSellTreshold > winningPrice) {
                        // we should have a treshold here
                        if (!this.sellTreshold || newSellTreshold > this.sellTreshold) {
                            this.sellTreshold = newSellTreshold;
                        }
                    }

                    // check if we reached objective or if EMA diff is strong and makes us sell
                    let bigUp = diff > this.adaptativeUpTrigger();
                    if (currentBitcoinPrice > objectivePrice || bigUp) {
                        this.sellTreshold = null;
                        return this.sell();
                    } else {
                        return this.hold();
                    }
                }
            }
        }
    }
}

module.exports = EMAProfitTrader;