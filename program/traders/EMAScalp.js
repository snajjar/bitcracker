const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class DivTrader extends Trader {
    constructor() {
        super();

        // EMA triggers we react to
        this.emaPeriods = 2;
        this.emaDownTrigger = { 'min': 0.2, 'max': 0.48 };

        // Trader will also scalp shortly after a buy
        this.timeInTrade = null;
        this.winTradePeriod = 60;
        this.shortScalpProfit = { 'min': 0.0009, 'max': 0.0018 };
    }

    analysisIntervalLength() {
        return 28;
    }

    hash() {
        return "Algo_EMAScalp_TA";
    }

    // return the current value for position (between 0 and 1), on a logarithmic scale from min to max
    logSlider(min, max, ratio) {
        let minv = Math.log(min);
        let maxv = Math.log(max);
        let scale = (maxv - minv) / (max - min);
        let position = this.linearSlider(min, max, ratio);
        return Math.exp(minv + scale * (position - min));
    }

    linearSlider(min, max, ratio) {
        let range = max - min;
        return min + range * ratio;
    }

    getTaxRatio() {
        let taxRange = 0.0016 * 2;
        let curr = this.getBuyTax() - 0.001 + this.getSellTax() - 0.001;
        return curr / taxRange;
    }

    adaptativeEMADownTrigger() {
        return this.logSlider(this.emaDownTrigger.min, this.emaDownTrigger.max, this.getTaxRatio());
    }

    adaptativeScalp() {
        return this.logSlider(this.shortScalpProfit.min, this.shortScalpProfit.max, this.getTaxRatio());
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
            var emadiff = (currentBitcoinPrice / currEMA * 100) - 100;

            if (!this.isInTrade()) {
                let emaBigDown = emadiff < -this.adaptativeEMADownTrigger();
                if (emaBigDown) {
                    // BUY condition
                    this.timeInTrade = 0;
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                this.timeInTrade++;
                let winningTrade = currentBitcoinPrice > this.getWinningPrice();

                let scalpProfit = this.adaptativeScalp();
                let winningScalpTrade = currentBitcoinPrice > this.getWinningPrice() * (1 + scalpProfit);

                if (this.timeInTrade <= this.winTradePeriod && winningScalpTrade) {
                    return this.sell();
                }

                if (this.timeInTrade > this.winTradePeriod) {
                    if (this.stopLoss(0.01)) {
                        return this.sell();
                    }
                }

                return this.hold();
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = DivTrader;