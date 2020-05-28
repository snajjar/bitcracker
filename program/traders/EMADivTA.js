const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMADivTrader extends Trader {
    constructor() {
        super();

        // parameters
        // this.emaPeriods = 5;
        // this.emaDownTrigger = { 'min': 0.31, 'max': 0.75 };
        // this.emaUpTrigger = { 'min': 0.31, 'max': 0.75 };

        // parameters
        this.emaPeriods = 2;
        this.emaDownTrigger = { 'min': 0.2, 'max': 0.48 };
        this.emaUpTrigger = { 'min': 0.14, 'max': 0.48 };
    }

    analysisIntervalLength() {
        return 28;
    }

    hash() {
        return "Algo_EMADiv_Tax_Adjusted";
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
        return this.adaptativeTrigger(this.emaDownTrigger.min, this.emaDownTrigger.max, this.getTaxRatio());
    }

    // vary from 0.4 (when highest tax: 0.26%) to 0.20 (when lowest sell tax: 0%)
    adaptativeUpTrigger() {
        return this.adaptativeTrigger(this.emaUpTrigger.min, this.emaUpTrigger.max, this.getTaxRatio());
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

    // decide for an action
    async action(crypto, dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            let ema = await this.getEMA(dataPeriods);
            let currEMA = _.last(ema);
            var diff = (currentBitcoinPrice / currEMA * 100) - 100;

            if (!this.isInTrade()) {
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
                if (this.timeInTrade <= 5) {
                    // in the next 10 min, only sell if it's positive
                    let bigUp = diff > this.adaptativeUpTrigger();
                    let winningPrice = this.getWinningPrice();
                    if (bigUp && currentBitcoinPrice > winningPrice) {
                        return this.sell();
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
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = EMADivTrader;