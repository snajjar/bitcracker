const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class ChampionTrader extends Trader {
    constructor() {
        super();

        // EMA triggers we react to
        this.emaPeriods = 2;
        this.emaDownTrigger = { 'min': 0.15, 'max': 0.4 };
        this.emaUpTrigger = { 'min': 0.15, 'max': 0.4 };

        // Trader will also scalp shortly after a buy
        this.timeInTrade = null;
        this.winTradePeriod = 20;
        this.shortScalpProfit = { 'min': 0.0009, 'max': 0.0014 };
    }

    analysisIntervalLength() {
        return 28;
    }

    hash() {
        return "Algo_Champion2";
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

    getBidWinningPrice() {
        return this.enterTradeValue * (1 + this.getBuyTax() + this.getAskTax());
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
            let emadiff = (currentBitcoinPrice / currEMA * 100) - 100;
            let bidtaxdiff = (this.getBuyTax() + this.getSellTax() - this.getAskTax() - this.getBidTax()) / 2;
            let emabiddiff = (currentBitcoinPrice * (1 - bidtaxdiff) / currEMA * 100) - 100;

            if (!this.inTrade) {
                if (emadiff < -this.adaptativeEMADownTrigger()) {
                    // BUY condition
                    this.timeInTrade = 0;
                    return this.buy();
                } else if (emabiddiff < -this.adaptativeEMADownTrigger()) {
                    return this.bid(currentBitcoinPrice);
                } else {
                    return this.hold();
                }
            } else {
                this.timeInTrade++;
                let winningTrade = currentBitcoinPrice > this.getWinningPrice();

                let scalpProfit = this.adaptativeScalp();
                let winningScalpTrade = currentBitcoinPrice > this.getWinningPrice() * (1 + scalpProfit);
                let winningBidScalpTrade = currentBitcoinPrice > this.getBidWinningPrice() * (1 + scalpProfit);;

                if (winningScalpTrade) {
                    return this.sell();
                }

                if (winningBidScalpTrade) {
                    return this.ask(currentBitcoinPrice);
                }

                // if EMA tells us to sell, sell if it's winning
                let emaBigUp = emadiff > this.adaptativeEMAUpTrigger();
                if (emaBigUp && winningTrade) {
                    return this.sell();
                }

                let winningAsk = emabiddiff > this.adaptativeEMAUpTrigger();
                if (winningAsk) {
                    return this.ask(currentBitcoinPrice);
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

module.exports = ChampionTrader;