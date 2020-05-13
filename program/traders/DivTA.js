const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class DivTrader extends Trader {
    constructor() {
        super();

        // SMA triggers we react to
        this.smaPeriods = 5;
        this.smaDownTrigger = { 'min': 0.33, 'max': 1.2 };
        this.smaUpTrigger = { 'min': 0.33, 'max': 1.2 };

        // EMA triggers we react to
        this.emaPeriods = 2;
        this.emaDownTrigger = { 'min': 0.14, 'max': 0.38 };
        this.emaUpTrigger = { 'min': 0.21, 'max': 0.42 };

        // Trader will also scalp shortly after a buy
        this.timeInTrade = null;
        this.winTradePeriod = 30;
        this.shortScalpProfit = 0.0013;
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
                let winningTrade = currentBitcoinPrice > this.getWinningPrice();
                let winningScalpTrade = currentBitcoinPrice > this.getWinningPrice() * (1 + this.shortScalpProfit);
                if (this.timeInTrade <= this.winTradePeriod && winningScalpTrade) {
                    return this.sell();
                }

                // if SMA tells us to sell, sell if it's winning
                let smaBigUp = smadiff > this.adaptativeSMAUpTrigger();
                if (smaBigUp && winningTrade) {
                    return this.sell();
                }

                // if EMA tells us to sell, sell if it's winning
                let emaBigUp = emadiff > this.adaptativeEMAUpTrigger();
                if (emaBigUp && winningTrade) {
                    return this.sell();
                }

                // if both tells us to sell (and it's not winning), sell if we didnt buy less than 5 min ago
                if (emaBigUp) {
                    // if we're shortly after buy, don't sell at loss
                    if (!winningTrade && this.timeInTrade <= this.winTradePeriod) {
                        return this.hold();
                    } else {
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