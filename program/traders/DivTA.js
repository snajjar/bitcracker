const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class DivTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.smaPeriods = 5;
        this.smaDownTrigger = { 'min': 0.33, 'max': 1.2 };
        this.smaUpTrigger = { 'min': 0.33, 'max': 1.2 };

        this.emaPeriods = 2;
        this.emaDownTrigger = { 'max': 0.38, 'min': 0.14 };
        this.emaUpTrigger = { 'max': 0.42, 'min': 0.21 };

        this.timeInTrade = null;
    }

    analysisIntervalLength() {
        return 28;
    }

    hash() {
        return "Algo_Div_Tax_Adjusted";
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

    adaptativeSMADownTrigger() {
        return this.adaptativeTrigger(this.smaDownTrigger.min, this.smaDownTrigger.max, this.getTaxRatio());
    }

    adaptativeSMAUpTrigger() {
        return this.adaptativeTrigger(this.smaUpTrigger.min, this.smaUpTrigger.max, this.getTaxRatio());
    }

    adaptativeEMADownTrigger() {
        return this.adaptativeTrigger(this.emaDownTrigger.min, this.emaDownTrigger.max, this.getTaxRatio());
    }

    adaptativeEMAUpTrigger() {
        return this.adaptativeTrigger(this.emaUpTrigger.min, this.emaUpTrigger.max, this.getTaxRatio());
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
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            let sma = await this.getSMA(dataPeriods);
            let currSMA = _.last(sma);
            var smadiff = (currentBitcoinPrice / currSMA * 100) - 100;

            let ema = await this.getEMA(dataPeriods);
            let currEMA = _.last(ema);
            var emadiff = (currentBitcoinPrice / currEMA * 100) - 100;

            if (!this.inTrade) {
                let smaBigDown = smadiff < -this.adaptativeSMADownTrigger();
                let emaBigDown = emadiff < -this.adaptativeEMADownTrigger();
                if (smaBigDown || emaBigDown) {
                    // BUY condition
                    this.timeInTrade = 0;
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                this.timeInTrade++;
                let emaBigUp = emadiff > this.adaptativeEMAUpTrigger();
                let sellCondition = emaBigUp;
                if (this.timeInTrade <= 5) {
                    // if shortly after the buy, we ensure we sell at a winning price
                    let winningPrice = this.getWinningPrice();
                    sellCondition &= currentBitcoinPrice > winningPrice;
                }
                if (sellCondition) {
                    // SELL condition
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

module.exports = DivTrader;