const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMAScalpBidTrader extends Trader {
    constructor() {
        super();

        // EMA triggers we react to
        this.emaPeriods = 5;
        this.emaDownTrigger = { 'min': 0.1, 'max': 0.7 };
        this.emaUpTrigger = { 'min': 0.1, 'max': 0.7 };

        // Trader will also scalp shortly after a buy
        this.timeInTrade = null;
        this.winTradePeriod = 30;
        this.shortScalpProfit = { 'min': 0.0001, 'max': 0.002 };
    }

    analysisIntervalLength() {
        return 28;
    }

    hash() {
        return "Algo_EMAScalpBid";
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
        let curr = this.getAskTax() + this.getBidTax();
        return curr / taxRange;
    }

    adaptativeEMADownTrigger() {
        return this.logSlider(this.emaDownTrigger.min, this.emaDownTrigger.max, this.getTaxRatio());
    }

    adaptativeEMAUpTrigger() {
        return this.logSlider(this.emaUpTrigger.min, this.emaUpTrigger.max, this.getTaxRatio());
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
                    return this.bid(currentBitcoinPrice);
                } else {
                    return this.hold();
                }
            } else {
                this.timeInTrade++;
                let winningTrade = currentBitcoinPrice > this.getWinningPrice();

                let scalpProfit = this.adaptativeScalp();
                let winningScalpTrade = currentBitcoinPrice > this.getWinningPrice() * (1 + scalpProfit);

                if (this.timeInTrade <= this.winTradePeriod && winningScalpTrade) {
                    return this.ask(currentBitcoinPrice);
                }

                // if EMA tells us to sell, sell if it's winning
                let emaBigUp = emadiff > this.adaptativeEMAUpTrigger();
                if (emaBigUp && winningTrade) {
                    return this.ask(currentBitcoinPrice);
                }

                // if both tells us to sell (and it's not winning), sell if we didnt buy less than 5 min ago
                if (emaBigUp) {
                    // if we're shortly after buy, don't sell at loss
                    if (!winningTrade && this.timeInTrade <= this.winTradePeriod) {
                        return this.hold();
                    } else {
                        return this.ask(currentBitcoinPrice);
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

module.exports = EMAScalpBidTrader;