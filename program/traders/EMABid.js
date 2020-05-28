const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMABidTrader extends Trader {
    constructor() {
        super();

        // EMA triggers we react to
        this.emaPeriods = 2;
        this.emaTrigger = { 'min': 0.5, 'max': 1.4 };
    }

    analysisIntervalLength() {
        return 28;
    }

    hash() {
        return "Algo_EMABid";
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

    adaptativeEMATrigger() {
        return this.logSlider(this.emaTrigger.min, this.emaTrigger.max, this.getTaxRatio());
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

    getWinningPrice() {
        return this.enterTradeValue * (1 + this.getBidTax() + this.getAskTax());
    }

    // decide for an action
    async action(crypto, dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        // try {
        //     let ema = await this.getEMA(dataPeriods);
        //     let currEMA = _.last(ema);

        //     if (!this.isInTrade()) {
        //         let trigger = 0.4;
        //         let bidPrice = (1 - trigger / 100) * currEMA;
        //         //console.log(`btc=${currentBitcoinPrice} ema=${currEMA} bid=${bidPrice}`);
        //         return this.bid(bidPrice);
        //     } else {
        //         let trigger = 0.4;
        //         let askPrice = (1 + trigger / 100) * currEMA;
        //         return this.ask(askPrice);
        //     }
        // } catch (e) {
        //     console.error("Err: " + e.stack);
        //     process.exit(-1);
        // }

        try {
            let ema = await this.getEMA(dataPeriods);
            let currEMA = _.last(ema);

            if (!this.isInTrade()) {
                let bidPrice = (1 - this.adaptativeEMATrigger() / 100) * currEMA;
                return this.bid(Math.min(bidPrice, currentBitcoinPrice));
            } else {
                let askPrice = (1 + this.adaptativeEMATrigger() / 100) * currEMA;
                return this.ask(Math.max(askPrice, currentBitcoinPrice));
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = EMABidTrader;